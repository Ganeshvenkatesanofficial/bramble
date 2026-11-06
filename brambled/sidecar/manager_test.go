package sidecar

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

// newHealthServer starts a real HTTP server answering /health with the given
// body, and returns the port it's listening on so it can be plugged into a
// Manager as if it were the sidecar child process.
func newHealthServer(t *testing.T, resp healthResponse, status int) (*httptest.Server, int) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parsing test server URL: %v", err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parsing test server port: %v", err)
	}
	return srv, port
}

// TestWaitHealthy_AcceptsMatchingTailnetIdentity is the baseline: a /health
// response for the tailnet this Manager was configured for is healthy.
func TestWaitHealthy_AcceptsMatchingTailnetIdentity(t *testing.T) {
	srv, port := newHealthServer(t, healthResponse{OK: true, TailnetName: "acme.eth", TailnetRegistry: "0xAbC0000000000000000000000000000000dEaD"}, http.StatusOK)
	defer srv.Close()

	m := &Manager{Port: port, wantTailnetName: "acme.eth", wantTailnetRegistry: "0xabc0000000000000000000000000000000dead"}
	if err := m.waitHealthy(2 * time.Second); err != nil {
		t.Fatalf("expected matching tailnet identity to be accepted, got: %v", err)
	}
}

// TestWaitHealthy_RejectsMismatchedTailnetIdentity is the regression test
// for the port-7890-health-check finding: a process answering /health with
// ok:true for a *different* tailnet (e.g. a second node's sidecar left
// running on the same host, or any other process that happens to be on this
// port) must not be accepted as this node's sidecar.
func TestWaitHealthy_RejectsMismatchedTailnetIdentity(t *testing.T) {
	srv, port := newHealthServer(t, healthResponse{OK: true, TailnetName: "other-tailnet.eth", TailnetRegistry: "0xDeAd0000000000000000000000000000000bEeF"}, http.StatusOK)
	defer srv.Close()

	m := &Manager{Port: port, wantTailnetName: "acme.eth", wantTailnetRegistry: "0xabc0000000000000000000000000000000dead"}
	err := m.waitHealthy(300 * time.Millisecond)
	if err == nil {
		t.Fatal("expected a mismatched tailnet identity to be rejected, got nil error")
	}
	if !strings.Contains(err.Error(), "other-tailnet.eth") {
		t.Fatalf("expected the error to name the tailnet the port actually answered for, got: %v", err)
	}
}

// TestWaitHealthy_RejectsHealthyButUnidentifiedResponse guards against
// silently accepting an old-shape {ok:true} response with no tailnet
// identity at all (e.g. an unrelated process, or a sidecar built before
// this fix) as a match.
func TestWaitHealthy_RejectsHealthyButUnidentifiedResponse(t *testing.T) {
	srv, port := newHealthServer(t, healthResponse{OK: true}, http.StatusOK)
	defer srv.Close()

	m := &Manager{Port: port, wantTailnetName: "acme.eth", wantTailnetRegistry: "0xabc0000000000000000000000000000000dead"}
	if err := m.waitHealthy(300 * time.Millisecond); err == nil {
		t.Fatal("expected an ok:true response with no tailnet identity to be rejected, got nil error")
	}
}

// newTorStatusServer answers /tor/status with each body in turn, repeating
// the last one, and reports how many requests it served.
func newTorStatusServer(t *testing.T, status int, bodies ...torStatusResponse) (*httptest.Server, int, *int) {
	t.Helper()
	served := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tor/status" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		i := served
		if i >= len(bodies) {
			i = len(bodies) - 1
		}
		served++
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(bodies[i])
	}))
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parsing test server URL: %v", err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parsing test server port: %v", err)
	}
	return srv, port, &served
}

// TestWaitTorReady_WaitsThroughStartingAndFailed: the sidecar reports
// "starting", then a failed attempt, then ready after its own retry. Start
// must wait through all of it rather than give up on the first non-ready.
func TestWaitTorReady_WaitsThroughStartingAndFailed(t *testing.T) {
	srv, port, served := newTorStatusServer(t, http.StatusOK,
		torStatusResponse{State: "starting", Message: "starting Tor"},
		torStatusResponse{State: "failed", LastError: "no guard", Message: "Tor failed to start: no guard"},
		torStatusResponse{State: "ready", Message: "Tor ready"},
	)
	defer srv.Close()

	m := &Manager{Port: port}
	if err := m.waitTorReady(2*time.Second, 10*time.Millisecond); err != nil {
		t.Fatalf("expected ready, got: %v", err)
	}
	if *served != 3 {
		t.Fatalf("expected 3 polls, got %d", *served)
	}
}

// TestWaitTorReady_TimesOutWithSidecarMessage: a sidecar that never becomes
// ready fails Start with the sidecar's own description of why.
func TestWaitTorReady_TimesOutWithSidecarMessage(t *testing.T) {
	srv, port, _ := newTorStatusServer(t, http.StatusOK,
		torStatusResponse{State: "failed", LastError: "no guard", Message: "Tor failed to start: no guard"},
	)
	defer srv.Close()

	m := &Manager{Port: port}
	err := m.waitTorReady(100*time.Millisecond, 10*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "Tor failed to start: no guard") {
		t.Fatalf("expected timeout carrying the sidecar message, got: %v", err)
	}
}

// TestWaitTorReady_TreatsNotFoundAsReady: a sidecar without the Tor module
// has no /tor/status route and must not block startup.
func TestWaitTorReady_TreatsNotFoundAsReady(t *testing.T) {
	srv, port, _ := newTorStatusServer(t, http.StatusNotFound, torStatusResponse{})
	defer srv.Close()

	m := &Manager{Port: port}
	if err := m.waitTorReady(time.Second, 10*time.Millisecond); err != nil {
		t.Fatalf("expected 404 to count as ready, got: %v", err)
	}
}
