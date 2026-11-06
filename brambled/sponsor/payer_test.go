package sponsor

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPayer_SendsLabelAndDecodesResponses(t *testing.T) {
	var gotPath, gotLabel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		var body struct{ Label string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotLabel = body.Label
		if strings.HasSuffix(r.URL.Path, "rendezvous-token") {
			_, _ = w.Write([]byte(`{"token":"t","expiresAt":9}`))
			return
		}
		_, _ = w.Write([]byte(`{"sessionId":"s","port":4242,"expiresAt":9,"bytes":1048576}`))
	}))
	defer srv.Close()

	p := &Payer{Label: "device1"}
	tok, err := p.RendezvousToken(srv.URL + "/")
	if err != nil || tok.Token != "t" || gotPath != "/sponsored/rendezvous-token" || gotLabel != "device1" {
		t.Fatalf("token: %+v %v path=%s label=%s", tok, err, gotPath, gotLabel)
	}
	sess, err := p.DataRelaySession(srv.URL, 5)
	if err != nil || sess.Port != 4242 || sess.Bytes != 1<<20 || sess.SettlementTxID != "" {
		t.Fatalf("session: %+v %v", sess, err)
	}
	if gotPath != "/sponsored/data-relay-session" {
		t.Fatalf("path %s", gotPath)
	}
}

func TestPayer_SurfacesRefusal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"label is not enrolled: revoked"}`))
	}))
	defer srv.Close()
	_, err := (&Payer{Label: "x"}).DataRelaySession(srv.URL, 1)
	if err == nil || !strings.Contains(err.Error(), "403") || !strings.Contains(err.Error(), "not enrolled") {
		t.Fatalf("expected a 403 not-enrolled error, got %v", err)
	}
}
