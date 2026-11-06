package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// NodeSpec is everything needed to start brambled serve for this device.
type NodeSpec struct {
	Brambled      string
	Label         string
	PrivateKeyHex string
	Config        *NodeConfig
	// TUN uses a real OS interface. It needs root or cap_net_admin on the
	// brambled binary. The default is brambled -netstack, which needs no
	// privilege; local programs then reach the mesh through loopback
	// forwards only (spec D10).
	TUN bool
	Log io.Writer
}

// NodePorts are the local ports this node uses.
type NodePorts struct {
	WireGuard int // UDP
	Status    int // brambled status API, loopback
	Sidecar   int // ENS sidecar, loopback
	// Forwards maps a ServiceKey to the loopback port forwarded to it.
	Forwards map[string]int
}

// ServiceKey names a forwarded service.
func ServiceKey(peer, service string) string { return peer + "/" + service }

// ServeArgs builds the brambled serve command line. It holds no secret: the
// private key travels in the environment (BRAMBLE_PRIVATE_KEY), never in
// argv, which other local users can read.
func ServeArgs(spec NodeSpec, ports NodePorts) []string {
	cfg := spec.Config
	args := []string{
		"serve",
		"-label", spec.Label,
		"-listen-port", strconv.Itoa(ports.WireGuard),
		"-status-port", strconv.Itoa(ports.Status),
		"-status-bind", "127.0.0.1",
		// Keeps NAT mappings and the relay's learned address alive on an
		// idle link, and keeps handshakes fresh so the path stays visible.
		"-keepalive", "25",
	}
	if !spec.TUN {
		args = append(args, "-netstack")
	}
	for _, p := range explicitPeers(cfg, spec.Label) {
		args = append(args, "-peer", p)
	}
	if cfg.Rendezvous != "" {
		args = append(args, "-rendezvous", cfg.Rendezvous)
	}
	if len(cfg.STUN) > 0 {
		args = append(args, "-stun-servers", strings.Join(cfg.STUN, ","))
	}
	relayLabels := make([]string, 0, len(cfg.DataRelays))
	for label := range cfg.DataRelays {
		relayLabels = append(relayLabels, label)
	}
	sort.Strings(relayLabels)
	for _, label := range relayLabels {
		args = append(args, "-data-relay", label+"="+cfg.DataRelays[label])
	}
	if cfg.UseSponsoredRelay() {
		args = append(args, "-sponsored-relay")
	}
	if cfg.UseRelayFirst() {
		args = append(args, "-relay-first")
	} else {
		for _, p := range cfg.RelayPeers {
			if p != spec.Label {
				args = append(args, "-relay-peer", p)
			}
		}
	}
	for _, s := range cfg.Services {
		if s.Peer == spec.Label {
			continue
		}
		if port, ok := ports.Forwards[ServiceKey(s.Peer, s.Service)]; ok {
			args = append(args, "-forward", fmt.Sprintf("%d=%s:%s", port, s.Peer, s.Service))
		}
	}
	return args
}

// explicitPeers is the -peer list: empty (discover every device) unless the
// config names peers, in which case service and relay peers are added so
// brambled accepts the -forward and -relay-peer flags for them.
func explicitPeers(cfg *NodeConfig, own string) []string {
	if len(cfg.Peers) == 0 {
		return nil
	}
	seen := map[string]bool{own: true}
	var out []string
	add := func(p string) {
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, p := range cfg.Peers {
		add(p)
	}
	for _, s := range cfg.Services {
		add(s.Peer)
	}
	for _, p := range cfg.RelayPeers {
		add(p)
	}
	return out
}

// ServeEnv is the environment brambled serve needs on top of the daemon's
// own environment.
func ServeEnv(spec NodeSpec, ports NodePorts) []string {
	cfg := spec.Config
	env := []string{
		"BRAMBLE_PRIVATE_KEY=" + spec.PrivateKeyHex,
		"BRAMBLE_TAILNET_NAME=" + cfg.Tailnet,
		"BRAMBLE_TAILNET_REGISTRY=" + cfg.Registry,
		"BRAMBLE_SIDECAR_PORT=" + strconv.Itoa(ports.Sidecar),
	}
	if cfg.RPCURL != "" {
		env = append(env, "SEPOLIA_RPC_URL="+cfg.RPCURL)
	}
	if cfg.RegistryDeployBlock > 0 {
		env = append(env, "BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK="+strconv.FormatUint(cfg.RegistryDeployBlock, 10))
	}
	if cfg.RelayRegistry != "" {
		env = append(env, "BRAMBLE_RELAY_REGISTRY="+cfg.RelayRegistry)
	}
	if cfg.RelayDeployBlock > 0 {
		env = append(env, "BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK="+strconv.FormatUint(cfg.RelayDeployBlock, 10))
	}
	if cfg.RendezvousPaymentURL != "" {
		env = append(env, "BRAMBLE_RENDEZVOUS_PAYMENT_URL="+cfg.RendezvousPaymentURL)
	}
	return env
}

// FindBrambled locates the brambled binary: $BRAMBLE_BRAMBLED_BIN, then next
// to this executable (the install layout, ~/.bramble/bin), then $PATH.
func FindBrambled() (string, error) {
	if v := os.Getenv("BRAMBLE_BRAMBLED_BIN"); v != "" {
		return v, nil
	}
	if self, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(self), "brambled")
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
			return candidate, nil
		}
	}
	if p, err := exec.LookPath("brambled"); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("brambled was not found next to bramble or on PATH")
}

// FreeTCPPort asks the OS for a free loopback TCP port.
func FreeTCPPort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

// FreeUDPPort returns preferred if it is free, else a free UDP port.
func FreeUDPPort(preferred int) (int, error) {
	if preferred > 0 {
		if c, err := net.ListenUDP("udp", &net.UDPAddr{Port: preferred}); err == nil {
			c.Close()
			return preferred, nil
		}
	}
	c, err := net.ListenUDP("udp", &net.UDPAddr{})
	if err != nil {
		return 0, err
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port, nil
}

// AllocatePorts picks free ports for one node run.
func AllocatePorts(cfg *NodeConfig, ownLabel string) (NodePorts, error) {
	var p NodePorts
	var err error
	if p.WireGuard, err = FreeUDPPort(51820); err != nil {
		return p, err
	}
	if p.Status, err = FreeTCPPort(); err != nil {
		return p, err
	}
	if p.Sidecar, err = FreeTCPPort(); err != nil {
		return p, err
	}
	p.Forwards = map[string]int{}
	for _, s := range cfg.Services {
		if s.Peer == ownLabel {
			continue
		}
		port, err := FreeTCPPort()
		if err != nil {
			return p, err
		}
		p.Forwards[ServiceKey(s.Peer, s.Service)] = port
	}
	return p, nil
}

// RunningNode is one brambled serve child process.
type RunningNode struct {
	Ports      NodePorts
	relayHosts map[string]bool
	cmd        *exec.Cmd
	done       chan struct{}
	tail       *lineTail

	mu      sync.Mutex
	exitErr error
}

// StartNode starts brambled serve. It returns once the process has started;
// the node's ENS sidecar can take minutes more to reach Tor.
func StartNode(spec NodeSpec) (*RunningNode, error) {
	ports, err := AllocatePorts(spec.Config, spec.Label)
	if err != nil {
		return nil, fmt.Errorf("finding free local ports: %w", err)
	}
	cmd := exec.Command(spec.Brambled, ServeArgs(spec, ports)...)
	cmd.Env = append(os.Environ(), ServeEnv(spec, ports)...)
	cmd.SysProcAttr = childProcAttr()
	tail := &lineTail{max: 30}
	var out io.Writer = tail
	if spec.Log != nil {
		out = io.MultiWriter(spec.Log, tail)
	}
	cmd.Stdout = out
	cmd.Stderr = out
	// brambled's sidecar inherits the output pipe. If the sidecar outlives
	// brambled, Wait must not block on that pipe forever.
	cmd.WaitDelay = 3 * time.Second
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting brambled: %w", err)
	}
	n := &RunningNode{
		Ports:      ports,
		relayHosts: relayHosts(spec.Config),
		cmd:        cmd,
		done:       make(chan struct{}),
		tail:       tail,
	}
	go func() {
		err := cmd.Wait()
		// brambled stops its sidecar on a clean exit, but not when a signal
		// kills it during startup (before it installs its handler). Reap
		// whatever is left in its process group.
		signalGroup(cmd.Process.Pid, syscall.SIGKILL)
		n.mu.Lock()
		n.exitErr = err
		n.mu.Unlock()
		close(n.done)
	}()
	return n, nil
}

// Done is closed when the process exits.
func (n *RunningNode) Done() <-chan struct{} { return n.done }

// ExitSummary describes why the process exited, with its last log lines.
func (n *RunningNode) ExitSummary() string {
	n.mu.Lock()
	err := n.exitErr
	n.mu.Unlock()
	last := n.tail.lastMatching("error")
	switch {
	case last != "":
		return last
	case err != nil:
		return err.Error()
	default:
		return "brambled stopped"
	}
}

// Stop sends SIGTERM to brambled and its sidecar, then SIGKILL after
// timeout.
func (n *RunningNode) Stop(timeout time.Duration) {
	select {
	case <-n.done:
		return
	default:
	}
	pid := n.cmd.Process.Pid
	signalGroup(pid, syscall.SIGTERM)
	select {
	case <-n.done:
	case <-time.After(timeout):
		signalGroup(pid, syscall.SIGKILL)
		<-n.done
	}
}

// statusPeer mirrors brambled/statusapi.PeerStatus, plus the "path" field
// the hole-punch work (ETH-39) adds to it.
type statusPeer struct {
	Label               string   `json:"label"`
	Authorized          bool     `json:"authorized"`
	AllowedIPs          []string `json:"allowedIPs"`
	LastHandshakeUnixNs int64    `json:"lastHandshakeUnixNs"`
	Endpoint            string   `json:"endpoint"`
	Path                string   `json:"path"`
}

// FetchPeers reads the node's status API and converts it to the UI's shape.
func (n *RunningNode) FetchPeers(ctx context.Context, now time.Time) ([]Peer, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/peers", n.Ports.Status), nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status API answered HTTP %d", resp.StatusCode)
	}
	var raw []statusPeer
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&raw); err != nil {
		return nil, err
	}
	return ConvertPeers(raw, n.relayHosts, now), nil
}

// handshakeFresh is how recent a handshake must be for a path to count as
// up. WireGuard renews a session every 2 minutes while traffic or the
// 25-second keepalive flows, so 3 minutes means "currently working".
const handshakeFresh = 3 * time.Minute

// ConvertPeers turns status API rows into UI peers. Unauthorized peers are
// left out: ENS does not currently admit them.
func ConvertPeers(raw []statusPeer, relayHosts map[string]bool, now time.Time) []Peer {
	out := make([]Peer, 0, len(raw))
	for _, r := range raw {
		if !r.Authorized {
			continue
		}
		p := Peer{Label: r.Label, Path: "none"}
		if len(r.AllowedIPs) > 0 {
			p.MeshIP = strings.TrimSuffix(r.AllowedIPs[0], "/32")
		}
		var hs time.Time
		if r.LastHandshakeUnixNs > 0 {
			hs = time.Unix(0, r.LastHandshakeUnixNs).UTC()
			s := hs.Format(time.RFC3339)
			p.LastHandshake = &s
		}
		switch {
		case r.Path == "relayed" || r.Path == "relay":
			p.Path = "relay"
		case r.Path == "direct" || r.Path == "none":
			p.Path = r.Path
		case hs.IsZero() || now.Sub(hs) > handshakeFresh:
			p.Path = "none"
		case relayHosts[endpointHost(r.Endpoint)]:
			p.Path = "relay"
		default:
			p.Path = "direct"
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out
}

func endpointHost(endpoint string) string {
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil {
		return ""
	}
	return host
}

// relayHosts resolves every data relay's host to its IP addresses: a peer
// whose WireGuard endpoint is one of them is reached through the relay.
func relayHosts(cfg *NodeConfig) map[string]bool {
	hosts := map[string]bool{}
	for _, raw := range cfg.DataRelays {
		u, err := url.Parse(raw)
		if err != nil || u.Hostname() == "" {
			continue
		}
		hosts[u.Hostname()] = true
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		addrs, err := net.DefaultResolver.LookupHost(ctx, u.Hostname())
		cancel()
		if err == nil {
			for _, a := range addrs {
				hosts[a] = true
			}
		}
	}
	return hosts
}

// lineTail keeps the last max lines written to it.
type lineTail struct {
	mu      sync.Mutex
	max     int
	partial string
	lines   []string
}

func (t *lineTail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	s := bufio.NewScanner(strings.NewReader(t.partial + string(p)))
	t.partial = ""
	var lines []string
	for s.Scan() {
		lines = append(lines, s.Text())
	}
	if len(p) > 0 && p[len(p)-1] != '\n' && len(lines) > 0 {
		t.partial = lines[len(lines)-1]
		lines = lines[:len(lines)-1]
	}
	t.lines = append(t.lines, lines...)
	if len(t.lines) > t.max {
		t.lines = t.lines[len(t.lines)-t.max:]
	}
	return len(p), nil
}

// lastMatching returns the newest line containing substr, or "".
func (t *lineTail) lastMatching(substr string) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i := len(t.lines) - 1; i >= 0; i-- {
		if strings.Contains(strings.ToLower(t.lines[i]), substr) {
			return t.lines[i]
		}
	}
	return ""
}
