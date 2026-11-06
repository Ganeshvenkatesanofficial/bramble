package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// WellKnownPath is where the install host publishes the node config
// (ETH-177 shared contract v1).
const WellKnownPath = "/.well-known/bramble.json"

// Service is one tailnet service the daemon forwards to a loopback port, so
// the UI test button (POST /api/test) can reach it through the mesh.
type Service struct {
	Peer    string `json:"peer"`
	Service string `json:"service"`
	// Path is the HTTP path the test fetches. Default "/".
	Path string `json:"path,omitempty"`
}

// NodeConfig is the public node config served at /.well-known/bramble.json.
// It holds public values only: no keys, no tokens.
type NodeConfig struct {
	Version       string `json:"version"`
	Tailnet       string `json:"tailnet"`
	ChainID       int64  `json:"chainId"`
	RPCURL        string `json:"rpcUrl"`
	Registry      string `json:"registry"`
	RelayRegistry string `json:"relayRegistry,omitempty"`
	// RegistryDeployBlock and RelayDeployBlock are where the sidecar starts
	// its log scans (device discovery, relay discovery). The RPC behind
	// rpcUrl must serve logs back to these blocks.
	RegistryDeployBlock uint64            `json:"registryDeployBlock,omitempty"`
	RelayDeployBlock    uint64            `json:"relayDeployBlock,omitempty"`
	JoinAPI             string            `json:"joinApi"`
	Rendezvous          string            `json:"rendezvous,omitempty"`
	STUN                stringList        `json:"stun,omitempty"`
	DataRelays          map[string]string `json:"dataRelays,omitempty"`
	RelayPeers          []string          `json:"relayPeers,omitempty"`
	// Peers, when set, limits the device to these peers (brambled -peer)
	// instead of discovering every device on the tailnet (docs/adr/0010).
	// Service and relay peers are always included.
	Peers    []string  `json:"peers,omitempty"`
	Services []Service `json:"services,omitempty"`
	// SponsoredRelay asks the relays for operator-sponsored sessions, so a
	// device with no Hedera key needs no payment. nil means true.
	SponsoredRelay *bool `json:"sponsoredRelay,omitempty"`
	// RelayFirst routes every peer through the data-relay pool, so the
	// device works with no direct path. nil means true when DataRelays is
	// not empty.
	RelayFirst *bool `json:"relayFirst,omitempty"`
	// RendezvousPaymentURL is the payment sidecar paired with Rendezvous
	// (env BRAMBLE_RENDEZVOUS_PAYMENT_URL).
	RendezvousPaymentURL string `json:"rendezvousPaymentUrl,omitempty"`
}

// UseSponsoredRelay reports whether brambled gets -sponsored-relay.
func (c *NodeConfig) UseSponsoredRelay() bool {
	return c.SponsoredRelay == nil || *c.SponsoredRelay
}

// UseRelayFirst reports whether brambled gets -relay-first.
func (c *NodeConfig) UseRelayFirst() bool {
	if c.RelayFirst != nil {
		return *c.RelayFirst
	}
	return len(c.DataRelays) > 0
}

// stringList accepts either "a" or ["a","b"].
type stringList []string

func (l *stringList) UnmarshalJSON(b []byte) error {
	var one string
	if err := json.Unmarshal(b, &one); err == nil {
		*l = nil
		for _, s := range strings.Split(one, ",") {
			if s = strings.TrimSpace(s); s != "" {
				*l = append(*l, s)
			}
		}
		return nil
	}
	var many []string
	if err := json.Unmarshal(b, &many); err != nil {
		return fmt.Errorf("expected a string or a list of strings")
	}
	*l = many
	return nil
}

// registries is the alternative shape {"registries": {"tailnet": "0x..", "relay": "0x.."}}.
type registries struct {
	Tailnet string `json:"tailnet"`
	Relay   string `json:"relay"`
}

var addressRE = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

// LabelRE is the device label rule the approval service enforces
// (approval/src/lib/validation.ts).
var LabelRE = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

var serviceRE = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

// ParseNodeConfig decodes and validates a node config.
func ParseNodeConfig(data []byte) (*NodeConfig, error) {
	var cfg NodeConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("the node config is not valid JSON: %w", err)
	}
	var alt struct {
		Registries *registries `json:"registries"`
	}
	if err := json.Unmarshal(data, &alt); err == nil && alt.Registries != nil {
		if cfg.Registry == "" {
			cfg.Registry = alt.Registries.Tailnet
		}
		if cfg.RelayRegistry == "" {
			cfg.RelayRegistry = alt.Registries.Relay
		}
	}
	cfg.Tailnet = strings.ToLower(strings.TrimSpace(cfg.Tailnet))
	if cfg.Tailnet == "" {
		return nil, fmt.Errorf("the node config has no tailnet name")
	}
	if !addressRE.MatchString(cfg.Registry) {
		return nil, fmt.Errorf("the node config has no valid tailnet registry address")
	}
	if cfg.RelayRegistry != "" && !addressRE.MatchString(cfg.RelayRegistry) {
		return nil, fmt.Errorf("the node config's relay registry address is not valid")
	}
	if err := checkHTTPURL(cfg.JoinAPI); err != nil {
		return nil, fmt.Errorf("the node config's joinApi: %w", err)
	}
	cfg.JoinAPI = strings.TrimRight(cfg.JoinAPI, "/")
	if cfg.RPCURL != "" {
		if err := checkHTTPURL(cfg.RPCURL); err != nil {
			return nil, fmt.Errorf("the node config's rpcUrl: %w", err)
		}
	}
	if cfg.Rendezvous != "" {
		if _, _, err := net.SplitHostPort(cfg.Rendezvous); err != nil {
			return nil, fmt.Errorf("the node config's rendezvous must be host:port: %w", err)
		}
	}
	for _, s := range cfg.STUN {
		if _, _, err := net.SplitHostPort(s); err != nil {
			return nil, fmt.Errorf("the node config's stun server %q must be host:port", s)
		}
	}
	if cfg.RendezvousPaymentURL != "" {
		if err := checkHTTPURL(cfg.RendezvousPaymentURL); err != nil {
			return nil, fmt.Errorf("the node config's rendezvousPaymentUrl: %w", err)
		}
	}
	for label, u := range cfg.DataRelays {
		if err := checkHTTPURL(u); err != nil {
			return nil, fmt.Errorf("the node config's data relay %q: %w", label, err)
		}
	}
	for _, p := range append(append([]string(nil), cfg.RelayPeers...), cfg.Peers...) {
		if !LabelRE.MatchString(p) {
			return nil, fmt.Errorf("the node config's peer %q is not a valid label", p)
		}
	}
	for i, s := range cfg.Services {
		if !LabelRE.MatchString(s.Peer) || !serviceRE.MatchString(s.Service) {
			return nil, fmt.Errorf("the node config's service %d needs a valid peer label and service name", i)
		}
		if s.Path == "" {
			cfg.Services[i].Path = "/"
		} else if !strings.HasPrefix(s.Path, "/") {
			return nil, fmt.Errorf("the node config's service %d path must start with /", i)
		}
	}
	return &cfg, nil
}

func checkHTTPURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("%q is not an http(s) URL", raw)
	}
	if u.User != nil {
		return fmt.Errorf("URL must not contain credentials")
	}
	return nil
}

// NormalizeConfigURL turns an install host ("https://host") into the full
// well-known URL. A full URL or a local file path is returned unchanged.
func NormalizeConfigURL(raw string) string {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return raw
	}
	if u.Path == "" || u.Path == "/" {
		u.Path = WellKnownPath
	}
	return u.String()
}

// FetchNodeConfig loads the node config from an http(s) URL or a local file.
func FetchNodeConfig(ctx context.Context, source string) (*NodeConfig, error) {
	if source == "" {
		return nil, fmt.Errorf("no node config URL is set")
	}
	if !strings.HasPrefix(source, "http://") && !strings.HasPrefix(source, "https://") {
		data, err := os.ReadFile(source)
		if err != nil {
			return nil, fmt.Errorf("reading the node config: %w", err)
		}
		return ParseNodeConfig(data)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching the node config: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching the node config: HTTP %d from %s", resp.StatusCode, source)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("reading the node config: %w", err)
	}
	return ParseNodeConfig(data)
}
