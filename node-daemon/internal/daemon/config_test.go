package daemon

import (
	"slices"
	"strings"
	"testing"
	"time"
)

const sampleConfig = `{
  "version": "0.1.0",
  "tailnet": "Demo.eth",
  "chainId": 11155111,
  "rpcUrl": "https://rpc.example.test/sepolia",
  "registries": {"tailnet": "0x1111111111111111111111111111111111111111", "relay": "0x2222222222222222222222222222222222222222"},
  "joinApi": "https://console.example.test/",
  "rendezvous": "203.0.113.1:7000",
  "stun": "203.0.113.1:3478",
  "dataRelays": {"relay-a": "http://203.0.113.1:7891"},
  "registryDeployBlock": 11640407,
  "relayDeployBlock": 11640500,
  "relayPeers": ["gateway"],
  "services": [{"peer": "gateway", "service": "health"}],
  "futureField": true
}`

func TestParseNodeConfig(t *testing.T) {
	cfg, err := ParseNodeConfig([]byte(sampleConfig))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Tailnet != "demo.eth" {
		t.Errorf("tailnet = %q, want lowercased demo.eth", cfg.Tailnet)
	}
	if cfg.Registry != "0x1111111111111111111111111111111111111111" || cfg.RelayRegistry != "0x2222222222222222222222222222222222222222" {
		t.Errorf("registries not read from the nested form: %+v", cfg)
	}
	if cfg.JoinAPI != "https://console.example.test" {
		t.Errorf("joinApi trailing slash not trimmed: %q", cfg.JoinAPI)
	}
	if !slices.Equal(cfg.STUN, []string{"203.0.113.1:3478"}) {
		t.Errorf("stun = %v", cfg.STUN)
	}
	if cfg.Services[0].Path != "/" {
		t.Errorf("service path default = %q, want /", cfg.Services[0].Path)
	}
}

func TestParseNodeConfigRejects(t *testing.T) {
	cases := map[string]string{
		"no tailnet":      `{"registry":"0x1111111111111111111111111111111111111111","joinApi":"https://x"}`,
		"bad registry":    `{"tailnet":"d.eth","registry":"0x12","joinApi":"https://x"}`,
		"bad joinApi":     `{"tailnet":"d.eth","registry":"0x1111111111111111111111111111111111111111","joinApi":"ftp://x"}`,
		"creds in URL":    `{"tailnet":"d.eth","registry":"0x1111111111111111111111111111111111111111","joinApi":"https://u:p@x"}`,
		"bad rendezvous":  `{"tailnet":"d.eth","registry":"0x1111111111111111111111111111111111111111","joinApi":"https://x","rendezvous":"nohostport"}`,
		"bad service":     `{"tailnet":"d.eth","registry":"0x1111111111111111111111111111111111111111","joinApi":"https://x","services":[{"peer":"Gate","service":"h"}]}`,
		"bad relay peer":  `{"tailnet":"d.eth","registry":"0x1111111111111111111111111111111111111111","joinApi":"https://x","relayPeers":["-x"]}`,
		"not json at all": `nope`,
	}
	for name, raw := range cases {
		if _, err := ParseNodeConfig([]byte(raw)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestNormalizeConfigURL(t *testing.T) {
	cases := map[string]string{
		"https://console.example.test":                     "https://console.example.test/.well-known/bramble.json",
		"https://console.example.test/":                    "https://console.example.test/.well-known/bramble.json",
		"https://console.example.test/custom/bramble.json": "https://console.example.test/custom/bramble.json",
		"./local.json": "./local.json",
	}
	for in, want := range cases {
		if got := NormalizeConfigURL(in); got != want {
			t.Errorf("NormalizeConfigURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestServeArgsAndEnv(t *testing.T) {
	cfg, err := ParseNodeConfig([]byte(sampleConfig))
	if err != nil {
		t.Fatal(err)
	}
	spec := NodeSpec{Label: "laptop", PrivateKeyHex: "secret-key-hex", Config: cfg}
	ports := NodePorts{WireGuard: 51820, Status: 40001, Sidecar: 40002, Forwards: map[string]int{"gateway/health": 40003}}
	args := strings.Join(ServeArgs(spec, ports), " ")
	for _, want := range []string{
		"serve -label laptop",
		"-netstack",
		"-status-port 40001",
		"-status-bind 127.0.0.1",
		"-rendezvous 203.0.113.1:7000",
		"-stun-servers 203.0.113.1:3478",
		"-data-relay relay-a=http://203.0.113.1:7891",
		"-relay-peer gateway",
		"-forward 40003=gateway:health",
	} {
		if !strings.Contains(args, want) {
			t.Errorf("args %q lack %q", args, want)
		}
	}
	if strings.Contains(args, "secret-key-hex") {
		t.Fatalf("the private key must never be on the command line")
	}
	env := strings.Join(ServeEnv(spec, ports), "\n")
	for _, want := range []string{
		"BRAMBLE_PRIVATE_KEY=secret-key-hex",
		"BRAMBLE_TAILNET_NAME=demo.eth",
		"BRAMBLE_TAILNET_REGISTRY=0x1111111111111111111111111111111111111111",
		"BRAMBLE_RELAY_REGISTRY=0x2222222222222222222222222222222222222222",
		"BRAMBLE_SIDECAR_PORT=40002",
		"SEPOLIA_RPC_URL=https://rpc.example.test/sepolia",
		"BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK=11640407",
		"BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK=11640500",
	} {
		if !strings.Contains(env, want) {
			t.Errorf("env lacks %q", want)
		}
	}

	if strings.Contains(args, " -peer ") {
		t.Errorf("no peers in the config means discovery, got %q", args)
	}
	cfg.Peers = []string{"printer", "laptop"}
	if a := strings.Join(ServeArgs(spec, ports), " "); !strings.Contains(a, "-peer printer -peer gateway") || strings.Contains(a, "-peer laptop") {
		t.Errorf("explicit peers must include service and relay peers but not self: %q", a)
	}
	cfg.Peers = nil

	spec.TUN = true
	if strings.Contains(strings.Join(ServeArgs(spec, ports), " "), "-netstack") {
		t.Errorf("TUN mode must not pass -netstack")
	}

	// The device never forwards to or relays for itself.
	spec.Label = "gateway"
	if a := strings.Join(ServeArgs(spec, ports), " "); strings.Contains(a, "-relay-peer gateway") || strings.Contains(a, "-forward") {
		t.Errorf("self-referencing relay peer or forward in %q", a)
	}
}

func TestConvertPeers(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	fresh := now.Add(-30 * time.Second).UnixNano()
	stale := now.Add(-10 * time.Minute).UnixNano()
	relays := map[string]bool{"203.0.113.1": true}
	raw := []statusPeer{
		{Label: "c-relay", Authorized: true, AllowedIPs: []string{"10.77.0.3/32"}, LastHandshakeUnixNs: fresh, Endpoint: "203.0.113.1:40000"},
		{Label: "b-direct", Authorized: true, AllowedIPs: []string{"10.77.0.2/32"}, LastHandshakeUnixNs: fresh, Endpoint: "198.51.100.5:51820"},
		{Label: "d-stale", Authorized: true, AllowedIPs: []string{"10.77.0.4/32"}, LastHandshakeUnixNs: stale, Endpoint: "198.51.100.6:51820"},
		{Label: "e-never", Authorized: true, AllowedIPs: []string{"10.77.0.5/32"}},
		{Label: "f-reported", Authorized: true, LastHandshakeUnixNs: fresh, Endpoint: "198.51.100.7:1", Path: "relayed"},
		{Label: "a-unauthorized", Authorized: false, LastHandshakeUnixNs: fresh},
	}
	got := ConvertPeers(raw, relays, now)
	want := map[string]string{"b-direct": "direct", "c-relay": "relay", "d-stale": "none", "e-never": "none", "f-reported": "relay"}
	if len(got) != len(want) {
		t.Fatalf("got %d peers, want %d: %+v", len(got), len(want), got)
	}
	for _, p := range got {
		if want[p.Label] != p.Path {
			t.Errorf("%s path = %q, want %q", p.Label, p.Path, want[p.Label])
		}
	}
	if got[0].Label != "b-direct" || got[0].MeshIP != "10.77.0.2" || got[0].LastHandshake == nil {
		t.Errorf("first peer = %+v", got[0])
	}
	for _, p := range got {
		if p.Label == "e-never" && p.LastHandshake != nil {
			t.Errorf("a peer that never shook hands has no lastHandshake")
		}
	}
}

func TestFingerprint(t *testing.T) {
	if got := Fingerprint("abcdef0123456789ffff"); got != "abcd ef01 2345 6789" {
		t.Errorf("Fingerprint = %q", got)
	}
}

func TestLineTail(t *testing.T) {
	tail := &lineTail{max: 2}
	_, _ = tail.Write([]byte("one\nerror: two\nthr"))
	_, _ = tail.Write([]byte("ee\n"))
	if got := tail.lastMatching("error"); got != "error: two" {
		t.Errorf("lastMatching = %q", got)
	}
	if len(tail.lines) != 2 || tail.lines[1] != "three" {
		t.Errorf("lines = %q", tail.lines)
	}
}
