//go:build unix

package daemon

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestStopReapsSidecarThatHoldsTheOutputPipe reproduces a real hang: SIGTERM
// reached brambled while its sidecar was still starting, brambled died, and
// the orphaned sidecar kept the output pipe open, so Stop never returned.
func TestStopReapsSidecarThatHoldsTheOutputPipe(t *testing.T) {
	dir := t.TempDir()
	pidFile := filepath.Join(dir, "child.pid")
	script := filepath.Join(dir, "fake-brambled")
	body := "#!/bin/sh\nsh -c 'trap \"\" TERM; sleep 300' &\necho $! > " + pidFile + "\nexec sleep 300\n"
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	cfg := &NodeConfig{Tailnet: "demo.eth", Registry: "0x1111111111111111111111111111111111111111", JoinAPI: "http://127.0.0.1:1"}
	n, err := StartNode(NodeSpec{Brambled: script, Label: "laptop", Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	var childPID int
	for deadline := time.Now().Add(5 * time.Second); childPID == 0 && time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if b, err := os.ReadFile(pidFile); err == nil {
			childPID, _ = strconv.Atoi(strings.TrimSpace(string(b)))
		}
	}
	if childPID == 0 {
		t.Fatal("fake brambled did not start its child")
	}

	start := time.Now()
	stopped := make(chan struct{})
	go func() { n.Stop(time.Second); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(15 * time.Second):
		t.Fatal("Stop hung on the orphaned child's pipe")
	}
	t.Logf("Stop returned after %s", time.Since(start).Round(time.Millisecond))
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if syscall.Kill(childPID, 0) != nil {
			return
		}
	}
	t.Fatalf("child %d still alive after Stop", childPID)
}

// TestBrambledOutputAboutPeersIsNotKept covers the rule that peer
// authorization never touches disk: StartNode has no log sink at all, and
// the in-memory tail drops admission lines too, so the crash summary the
// daemon logs cannot repeat them.
func TestBrambledOutputAboutPeersIsNotKept(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "fake-brambled")
	body := "#!/bin/sh\n" +
		"echo 'admission: bob-laptop: authorized (pubkey 0123abcd)' >&2\n" +
		"echo 'admission: carol: not authorized' >&2\n" +
		"echo 'serve: fatal error: cannot bind port' >&2\n" +
		"exit 1\n"
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	cfg := &NodeConfig{Tailnet: "demo.eth", Registry: "0x1111111111111111111111111111111111111111", JoinAPI: "http://127.0.0.1:1"}
	n, err := StartNode(NodeSpec{Brambled: script, Label: "laptop", Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-n.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("fake brambled did not exit")
	}
	if got := n.ExitSummary(); got != "serve: fatal error: cannot bind port" {
		t.Fatalf("ExitSummary = %q", got)
	}
	for _, l := range n.tail.lines {
		if strings.Contains(l, "bob-laptop") || strings.Contains(l, "carol") || strings.Contains(l, "0123abcd") {
			t.Fatalf("peer line kept in memory: %q", l)
		}
	}
}

// TestRelayDiscoveredByBrambledCountsAsRelayPath: a relay that ENS discovery
// found, and bramble.json never named, still marks its peers as relayed.
func TestRelayDiscoveredByBrambledCountsAsRelayPath(t *testing.T) {
	now := time.Now()
	peers := fmt.Sprintf(`[
		{"label":"gateway","authorized":true,"allowedIPs":["10.77.0.1/32"],"lastHandshakeUnixNs":%d,"endpoint":"203.0.113.9:40000"},
		{"label":"worker","authorized":true,"allowedIPs":["10.77.0.2/32"],"lastHandshakeUnixNs":%d,"endpoint":"198.51.100.4:51820"}]`,
		now.UnixNano(), now.UnixNano())
	mux := http.NewServeMux()
	mux.HandleFunc("/peers", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, peers) })
	mux.HandleFunc("/relays", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"dataRelays": map[string]string{"relay-discovered": "http://203.0.113.9:8080"}})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	_, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())
	var port int
	fmt.Sscan(portStr, &port)

	n := &RunningNode{Ports: NodePorts{Status: port}, relayHosts: map[string]bool{}}
	got, err := n.FetchPeers(t.Context(), now)
	if err != nil {
		t.Fatal(err)
	}
	paths := map[string]string{}
	for _, p := range got {
		paths[p.Label] = p.Path
	}
	if paths["gateway"] != "relay" || paths["worker"] != "direct" {
		t.Fatalf("paths = %v, want gateway relay and worker direct", paths)
	}
}
