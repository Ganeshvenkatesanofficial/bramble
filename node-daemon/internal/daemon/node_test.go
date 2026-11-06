//go:build unix

package daemon

import (
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
