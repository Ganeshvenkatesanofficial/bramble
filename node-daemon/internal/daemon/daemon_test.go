package daemon

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

// fakeJoinAPI is an in-memory join API: the contract's open routes plus a
// token-gated list route for the admin proxy test.
type fakeJoinAPI struct {
	mu      sync.Mutex
	joins   map[string]*Join
	pubkeys map[string]string
	seen    []string // "METHOD path auth"
	// hold, when set, makes POST /api/joins signal arrived and wait for
	// release before it answers.
	hold    bool
	arrived chan struct{}
	release chan struct{}
}

func newFakeJoinAPI() *fakeJoinAPI {
	return &fakeJoinAPI{joins: map[string]*Join{}, pubkeys: map[string]string{}}
}

func (f *fakeJoinAPI) set(id string, status JoinStatus, meshIP string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.joins[id].Status = status
	f.joins[id].MeshIP = meshIP
}

func (f *fakeJoinAPI) forget(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.joins, id)
}

func (f *fakeJoinAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seen = append(f.seen, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization"))
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/joins":
		var body struct{ Label, Pubkey, Tailnet string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		if f.hold {
			f.hold = false
			f.mu.Unlock()
			f.arrived <- struct{}{}
			<-f.release
			f.mu.Lock()
		}
		if !LabelRE.MatchString(body.Label) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":"invalid label"}`)
			return
		}
		id := "join-" + body.Label
		f.joins[id] = &Join{ID: id, Label: body.Label, Tailnet: body.Tailnet, Status: JoinPending}
		f.pubkeys[id] = body.Pubkey
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"id": id, "status": "pending"})
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/joins/"):
		j, ok := f.joins[strings.TrimPrefix(r.URL.Path, "/api/joins/")]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(j)
	case r.Method == http.MethodGet && r.URL.Path == "/api/joins":
		if r.Header.Get("Authorization") != "Bearer admin-secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `[]`)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// fakeNode stands in for brambled: it reports whatever peers the test sets.
type fakeNode struct {
	mu      sync.Mutex
	peers   []Peer
	done    chan struct{}
	stopped bool
	spec    NodeSpec
}

func (n *fakeNode) Done() <-chan struct{} { return n.done }
func (n *fakeNode) ExitSummary() string   { return "error: fake exit" }
func (n *fakeNode) Stop(time.Duration) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if !n.stopped {
		n.stopped = true
		close(n.done)
	}
}
func (n *fakeNode) FetchPeers(context.Context, time.Time) ([]Peer, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]Peer(nil), n.peers...), nil
}
func (n *fakeNode) ForwardPort(peer, service string) (int, bool) {
	return 4242, peer == "gateway" && service == "health"
}

type harness struct {
	t     *testing.T
	api   *fakeJoinAPI
	d     *Daemon
	srv   *Server
	h     http.Handler
	mu    sync.Mutex
	nodes []*fakeNode
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	api := newFakeJoinAPI()
	apiSrv := httptest.NewServer(api)
	t.Cleanup(apiSrv.Close)

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "bramble.json")
	cfg := `{"tailnet":"demo.eth","registry":"0x1111111111111111111111111111111111111111","joinApi":"` + apiSrv.URL + `","services":[{"peer":"gateway","service":"health"}]}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	hs := &harness{t: t, api: api}
	hs.d = &Daemon{
		Store:        &Store{Dir: filepath.Join(dir, "home")},
		ConfigURL:    cfgPath,
		PendingPoll:  20 * time.Millisecond,
		ApprovedPoll: 20 * time.Millisecond,
		HealthPoll:   10 * time.Millisecond,
	}
	hs.d.startNode = func(s NodeSpec) (nodeHandle, error) {
		n := &fakeNode{done: make(chan struct{}), spec: s}
		hs.mu.Lock()
		hs.nodes = append(hs.nodes, n)
		hs.mu.Unlock()
		return n, nil
	}
	if err := hs.d.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { hs.d.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	hs.srv = &Server{Daemon: hs.d, UI: fstest.MapFS{"index.html": {Data: []byte("ui")}, "join.html": {Data: []byte("join page")}}, Port: 7777}
	hs.h = hs.srv.Handler()
	return hs
}

func (hs *harness) do(method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://127.0.0.1:7777"+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	return rec
}

func (hs *harness) state() State {
	var st State
	rec := hs.do("GET", "/api/state", "", nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		hs.t.Fatalf("decoding state: %v (%s)", err, rec.Body)
	}
	return st
}

func (hs *harness) waitPhase(want Phase) State {
	hs.t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		st := hs.state()
		if st.Phase == want {
			return st
		}
		if time.Now().After(deadline) {
			hs.t.Fatalf("phase = %q (error %+v), want %q", st.Phase, st.Error, want)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (hs *harness) lastNode() *fakeNode {
	hs.mu.Lock()
	defer hs.mu.Unlock()
	if len(hs.nodes) == 0 {
		return nil
	}
	return hs.nodes[len(hs.nodes)-1]
}

func TestDaemonJoinLifecycle(t *testing.T) {
	hs := newHarness(t)
	st := hs.waitPhase(PhaseSetup)
	if st.Fingerprint == "" || len(st.PublicKey) != 64 || st.DefaultTailnet != "demo.eth" || st.IsAdmin {
		t.Fatalf("first-run state = %+v", st)
	}
	if fi, err := os.Stat(filepath.Join(hs.d.Store.Dir, identityFile)); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("identity file must exist with mode 0600: %v %v", fi, err)
	}

	if rec := hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil); rec.Code != http.StatusConflict {
		t.Fatalf("join before setup: HTTP %d, want 409", rec.Code)
	}
	if rec := hs.do("POST", "/api/setup", `{"name":"Not Valid"}`, nil); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "nextStep") {
		t.Fatalf("invalid name: HTTP %d %s", rec.Code, rec.Body)
	}
	if rec := hs.do("POST", "/api/setup", `{"name":"laptop"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("setup: HTTP %d %s", rec.Code, rec.Body)
	}
	hs.waitPhase(PhaseReady)

	if rec := hs.do("POST", "/api/join", `{"tailnet":"other.eth"}`, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("join of an unknown tailnet: HTTP %d %s", rec.Code, rec.Body)
	}
	if rec := hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("join: HTTP %d %s", rec.Code, rec.Body)
	}
	st = hs.waitPhase(PhasePending)
	if st.JoinID != "join-laptop" || st.Tailnet != "demo.eth" {
		t.Fatalf("pending state = %+v", st)
	}
	if hs.api.pubkeys["join-laptop"] != st.PublicKey {
		t.Fatalf("join request carried pubkey %q, want the device key", hs.api.pubkeys["join-laptop"])
	}
	if j, _ := hs.d.Store.LoadJoin(); j == nil || j.JoinID != "join-laptop" {
		t.Fatalf("join id not remembered on disk: %+v", j)
	}
	if hs.lastNode() != nil {
		t.Fatalf("node started before approval")
	}

	hs.api.set("join-laptop", JoinApproved, "10.77.0.9/24")
	st = hs.waitPhase(PhaseApproved)
	if st.MeshIP != "10.77.0.9/24" {
		t.Fatalf("approved state = %+v", st)
	}
	deadline := time.Now().Add(2 * time.Second)
	for hs.lastNode() == nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	node := hs.lastNode()
	if node == nil || node.spec.Label != "laptop" || node.spec.Config.Tailnet != "demo.eth" {
		t.Fatalf("node not started with the device's label: %+v", node)
	}

	node.mu.Lock()
	node.peers = []Peer{{Label: "gateway", MeshIP: "10.77.0.1", Path: "relay"}}
	node.mu.Unlock()
	st = hs.waitPhase(PhaseConnected)
	if len(st.Peers) != 1 || st.Peers[0].Path != "relay" {
		t.Fatalf("connected peers = %+v", st.Peers)
	}

	// Revocation: the node stops and the UI explains.
	hs.api.set("join-laptop", JoinRevoked, "")
	st = hs.waitPhase(PhaseDenied)
	if st.Error == nil || st.Error.NextStep == "" {
		t.Fatalf("revoked state lacks a next step: %+v", st)
	}
	select {
	case <-node.Done():
	case <-time.After(2 * time.Second):
		t.Fatalf("node not stopped after revoke")
	}
	if j, _ := hs.d.Store.LoadJoin(); j != nil {
		t.Fatalf("revoked join still on disk: %+v", j)
	}
}

func TestDaemonRestartsCrashedNodeAndLeaves(t *testing.T) {
	hs := newHarness(t)
	hs.do("POST", "/api/setup", `{"name":"laptop"}`, nil)
	hs.do("POST", "/api/join", `{}`, nil) // empty tailnet = this install's tailnet
	hs.waitPhase(PhasePending)
	hs.api.set("join-laptop", JoinApproved, "10.77.0.9/24")
	hs.waitPhase(PhaseApproved)
	deadline := time.Now().Add(2 * time.Second)
	for hs.lastNode() == nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	first := hs.lastNode()
	first.Stop(0) // simulate a crash
	st := hs.waitPhase(PhaseError)
	if !strings.Contains(st.Error.Message, "fake exit") {
		t.Fatalf("crash message = %+v", st.Error)
	}
	// The supervisor restarts it after its backoff (5 s); make that instant.
	hs.d.mu.Lock()
	hs.d.retryAt = time.Time{}
	hs.d.mu.Unlock()
	deadline = time.Now().Add(2 * time.Second)
	for hs.lastNode() == first && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	second := hs.lastNode()
	if second == first {
		t.Fatalf("crashed node was not restarted")
	}
	second.mu.Lock()
	second.peers = []Peer{{Label: "gateway", Path: "direct"}}
	second.mu.Unlock()
	hs.waitPhase(PhaseConnected)

	if rec := hs.do("POST", "/api/leave", ``, nil); rec.Code != http.StatusOK {
		t.Fatalf("leave: HTTP %d", rec.Code)
	}
	st = hs.waitPhase(PhaseReady)
	if st.Tailnet != "" || st.Name != "laptop" {
		t.Fatalf("after leave = %+v", st)
	}
	select {
	case <-second.Done():
	case <-time.After(2 * time.Second):
		t.Fatalf("node still running after leave")
	}
}

func TestDaemonDeniedAndLostRequest(t *testing.T) {
	hs := newHarness(t)
	hs.do("POST", "/api/setup", `{"name":"laptop"}`, nil)
	hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil)
	hs.waitPhase(PhasePending)
	hs.api.set("join-laptop", JoinDenied, "")
	hs.waitPhase(PhaseDenied)

	hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil)
	hs.waitPhase(PhasePending)
	hs.api.forget("join-laptop")
	st := hs.waitPhase(PhaseError)
	if st.Error == nil || !strings.Contains(st.Error.NextStep, "Join") {
		t.Fatalf("lost request = %+v", st.Error)
	}
}

func TestDaemonRestoresPendingJoinAfterRestart(t *testing.T) {
	hs := newHarness(t)
	hs.do("POST", "/api/setup", `{"name":"laptop"}`, nil)
	hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil)
	hs.waitPhase(PhasePending)
	pub := hs.state().PublicKey

	// A second daemon on the same data dir: same key, still pending, and it
	// learns the approval from the join API, not from disk.
	d2 := &Daemon{Store: hs.d.Store, ConfigURL: hs.d.ConfigURL}
	if err := d2.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	st := d2.State()
	if st.PublicKey != pub || st.Phase != PhasePending || st.JoinID != "join-laptop" {
		t.Fatalf("restored state = %+v", st)
	}
}

func TestTestEndpoint(t *testing.T) {
	hs := newHarness(t)
	var body TestResult
	rec := hs.do("POST", "/api/test", `{}`, nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.OK || body.Error == nil {
		t.Fatalf("test before joining = %+v", body)
	}

	hs.do("POST", "/api/setup", `{"name":"laptop"}`, nil)
	hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil)
	hs.api.set("join-laptop", JoinApproved, "10.77.0.9/24")
	hs.waitPhase(PhaseApproved)
	deadline := time.Now().Add(2 * time.Second)
	for hs.lastNode() == nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	var gotURL string
	ok := hs.d.Test(context.Background(), "", "", func(_ context.Context, u string) (int, error) { gotURL = u; return 200, nil })
	if !ok.OK || ok.Status != 200 || gotURL != "http://127.0.0.1:4242/" || ok.Peer != "gateway" || ok.Service != "health" {
		t.Fatalf("test = %+v url=%q", ok, gotURL)
	}
	denied := hs.d.Test(context.Background(), "gateway", "health", func(context.Context, string) (int, error) { return 0, io.EOF })
	if denied.OK || denied.Error == nil || denied.Error.NextStep == "" {
		t.Fatalf("failed test = %+v", denied)
	}
	unknown := hs.d.Test(context.Background(), "nobody", "", nil)
	if unknown.OK || unknown.Error == nil {
		t.Fatalf("unknown target = %+v", unknown)
	}
}

func TestGuardRejectsForeignHostAndOrigin(t *testing.T) {
	hs := newHarness(t)
	req := httptest.NewRequest("GET", "http://evil.example:7777/api/state", nil)
	rec := httptest.NewRecorder()
	hs.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("rebinding Host: HTTP %d, want 403", rec.Code)
	}
	if rec := hs.do("POST", "/api/setup", `{"name":"laptop"}`, map[string]string{"Origin": "https://evil.example"}); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-site POST: HTTP %d, want 403", rec.Code)
	}
	if rec := hs.do("POST", "/api/setup", `{"name":"laptop"}`, map[string]string{"Sec-Fetch-Site": "cross-site"}); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-site fetch: HTTP %d, want 403", rec.Code)
	}
	if rec := hs.do("POST", "/api/setup", `{"name":"laptop"}`, map[string]string{"Origin": "http://localhost:7777"}); rec.Code != http.StatusOK {
		t.Fatalf("same-origin POST: HTTP %d %s", rec.Code, rec.Body)
	}
	if rec := hs.do("GET", "/", "", nil); rec.Code != http.StatusOK || rec.Body.String() != "ui" {
		t.Fatalf("UI index: HTTP %d %q", rec.Code, rec.Body)
	}
	if rec := hs.do("GET", "/join", "", nil); rec.Code != http.StatusOK || rec.Body.String() != "join page" {
		t.Fatalf("UI route fallback: HTTP %d %q", rec.Code, rec.Body)
	}
}

func TestAdminProxyAddsSavedToken(t *testing.T) {
	hs := newHarness(t)
	// Without a token the request passes through without credentials, and a
	// browser-supplied Authorization header is dropped.
	rec := hs.do("GET", "/api/admin/joins", "", map[string]string{"Authorization": "Bearer from-browser"})
	if rec.Code != http.StatusUnauthorized || hs.state().IsAdmin {
		t.Fatalf("no token: HTTP %d", rec.Code)
	}
	if err := hs.d.Store.SaveAdminToken("admin-secret"); err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Stat(filepath.Join(hs.d.Store.Dir, adminTokenFile)); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("admin token must be mode 0600: %v %v", fi, err)
	}
	rec = hs.do("GET", "/api/admin/joins", "", nil)
	if rec.Code != http.StatusOK || !hs.state().IsAdmin {
		t.Fatalf("with token: HTTP %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "admin-secret") {
		t.Fatalf("token leaked into the response")
	}
	hs.api.mu.Lock()
	seen := strings.Join(hs.api.seen, "\n")
	hs.api.mu.Unlock()
	if strings.Contains(seen, "from-browser") || !strings.Contains(seen, "GET /api/joins Bearer admin-secret") {
		t.Fatalf("upstream saw:\n%s", seen)
	}
	if rec := hs.do("DELETE", "/api/admin/joins", "", nil); rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE through admin proxy: HTTP %d", rec.Code)
	}
}

// holdNextJoin makes the next POST /api/joins wait until the returned
// function is called; arrived is signalled when the request reaches the API.
func (hs *harness) holdNextJoin() (arrived <-chan struct{}, release func()) {
	hs.api.mu.Lock()
	defer hs.api.mu.Unlock()
	hs.api.hold = true
	hs.api.arrived = make(chan struct{}, 1)
	hs.api.release = make(chan struct{})
	return hs.api.arrived, func() { close(hs.api.release) }
}

func TestLeaveDuringJoinDiscardsTheLateResponse(t *testing.T) {
	hs := newHarness(t)
	hs.waitPhase(PhaseSetup)
	hs.do("POST", "/api/setup", `{"name":"laptop"}`, nil)
	hs.waitPhase(PhaseReady)

	arrived, release := hs.holdNextJoin()
	joined := make(chan int, 1)
	go func() { joined <- hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil).Code }()
	select {
	case <-arrived:
	case <-time.After(3 * time.Second):
		t.Fatal("join request never reached the API")
	}
	if rec := hs.do("POST", "/api/leave", "", nil); rec.Code != http.StatusOK {
		t.Fatalf("leave: HTTP %d %s", rec.Code, rec.Body)
	}
	release()
	if code := <-joined; code == http.StatusOK {
		t.Fatalf("a join that Leave overtook answered 200")
	}
	st := hs.state()
	if st.Phase != PhaseReady || st.JoinID != "" || st.Error != nil {
		t.Fatalf("late response changed the state after Leave: %+v", st)
	}
	if j, _ := hs.d.Store.LoadJoin(); j != nil {
		t.Fatalf("late response saved a join id after Leave: %+v", j)
	}

	// Joining again after the cancelled attempt works.
	if rec := hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil); rec.Code != http.StatusOK {
		t.Fatalf("rejoin: HTTP %d %s", rec.Code, rec.Body)
	}
	hs.waitPhase(PhasePending)
}

func TestConcurrentJoinIsRejected(t *testing.T) {
	hs := newHarness(t)
	hs.waitPhase(PhaseSetup)
	hs.do("POST", "/api/setup", `{"name":"laptop"}`, nil)
	hs.waitPhase(PhaseReady)

	arrived, release := hs.holdNextJoin()
	first := make(chan int, 1)
	go func() { first <- hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil).Code }()
	<-arrived
	if rec := hs.do("POST", "/api/join", `{"tailnet":"demo.eth"}`, nil); rec.Code != http.StatusConflict {
		t.Fatalf("second join while one is in flight: HTTP %d %s, want 409", rec.Code, rec.Body)
	}
	release()
	if code := <-first; code != http.StatusOK {
		t.Fatalf("first join: HTTP %d", code)
	}
	if st := hs.waitPhase(PhasePending); st.JoinID != "join-laptop" {
		t.Fatalf("state = %+v", st)
	}
}
