// mock-join-api is a local stand-in for the approval service's join routes
// (ETH-177 contract v1), for testing bramble before ETH-181 lands. Approve
// runs the real admincli enroll on Sepolia, so the device ends up enrolled in
// ENS exactly as the real service would leave it; -grant also writes an ACL
// grant with admincli set-acl.
//
// Usage:
//
//	go run ./cmd/mock-join-api -addr 127.0.0.1:7801 -admincli ../admincli \
//	  [-auto-approve] [-grant gateway-label:granter-label:service]
//
// The admincli child processes inherit this process's environment
// (BRAMBLE_TAILNET_NAME, BRAMBLE_TAILNET_REGISTRY, the Sepolia signer, and
// the granter key ring settings for -grant). Writes need the admin token in
// $MOCK_JOIN_TOKEN when it is set.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

type join struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Tailnet   string `json:"tailnet"`
	Status    string `json:"status"`
	MeshIP    string `json:"meshIp,omitempty"`
	DecidedAt string `json:"decidedAt,omitempty"`
	pubkey    string
}

type server struct {
	admincli    string
	autoApprove bool
	grant       string
	token       string

	mu    sync.Mutex
	joins map[string]*join
}

var (
	labelRE  = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
	pubkeyRE = regexp.MustCompile(`^[0-9a-f]{64}$`)
	meshRE   = regexp.MustCompile(`\b\d+\.\d+\.\d+\.\d+/\d+\b`)
)

func main() {
	addr := flag.String("addr", "127.0.0.1:7801", "listen address")
	admincli := flag.String("admincli", "../admincli", "admincli package directory")
	autoApprove := flag.Bool("auto-approve", false, "approve every request as soon as it arrives")
	grant := flag.String("grant", "", "also grant the device a service on approve: gateway-label:granter-label:service")
	flag.Parse()
	s := &server{admincli: *admincli, autoApprove: *autoApprove, grant: *grant, token: os.Getenv("MOCK_JOIN_TOKEN"), joins: map[string]*join{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/joins", s.create)
	mux.HandleFunc("GET /api/joins/{id}", s.get)
	mux.HandleFunc("GET /api/joins", s.authed(s.list))
	mux.HandleFunc("POST /api/joins/{id}/{action}", s.authed(s.decide))
	log.Printf("mock join API on http://%s (auto-approve=%v)", *addr, *autoApprove)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *server) authed(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.token != "" && r.Header.Get("Authorization") != "Bearer "+s.token {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "admin token required"})
			return
		}
		h(w, r)
	}
}

func (s *server) create(w http.ResponseWriter, r *http.Request) {
	var body struct{ Label, Pubkey, Tailnet string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if !labelRE.MatchString(body.Label) || !pubkeyRE.MatchString(body.Pubkey) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid label or pubkey"})
		return
	}
	var b [8]byte
	_, _ = rand.Read(b[:])
	j := &join{ID: hex.EncodeToString(b[:]), Label: body.Label, Tailnet: body.Tailnet, Status: "pending", pubkey: body.Pubkey}
	s.mu.Lock()
	s.joins[j.ID] = j
	s.mu.Unlock()
	log.Printf("join %s: %s requests %s", j.ID, j.Label, j.Tailnet)
	writeJSON(w, http.StatusCreated, map[string]string{"id": j.ID, "status": "pending"})
	if s.autoApprove {
		go s.approve(j.ID)
	}
}

func (s *server) get(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	j, ok := s.joins[r.PathValue("id")]
	var out join
	if ok {
		out = *j
	}
	s.mu.Unlock()
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) list(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	out := make([]join, 0, len(s.joins))
	for _, j := range s.joins {
		out = append(out, *j)
	}
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, out)
}

func (s *server) decide(w http.ResponseWriter, r *http.Request) {
	id, action := r.PathValue("id"), r.PathValue("action")
	s.mu.Lock()
	_, ok := s.joins[id]
	s.mu.Unlock()
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	switch action {
	case "approve":
		go s.approve(id)
	case "deny":
		s.setStatus(id, "denied", "")
	case "revoke":
		go s.revoke(id)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown action"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": id})
}

func (s *server) setStatus(id, status, meshIP string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j := s.joins[id]
	j.Status = status
	if meshIP != "" {
		j.MeshIP = meshIP
	}
	j.DecidedAt = time.Now().UTC().Format(time.RFC3339)
	log.Printf("join %s: %s", id, status)
}

func (s *server) admincliRun(args ...string) (string, error) {
	cmd := exec.Command("bun", append([]string{"run"}, args...)...)
	cmd.Dir = s.admincli
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	return out.String(), err
}

func (s *server) approve(id string) {
	s.mu.Lock()
	j := *s.joins[id]
	s.mu.Unlock()
	log.Printf("join %s: enrolling %s", id, j.Label)
	out, err := s.admincliRun("src/enroll.ts", j.Label, j.pubkey)
	if err != nil {
		log.Printf("join %s: enroll failed: %v", id, err)
		return
	}
	meshIP := ""
	if m := meshRE.FindAllString(out, -1); len(m) > 0 {
		meshIP = m[len(m)-1]
	}
	if s.grant != "" {
		parts := strings.Split(s.grant, ":")
		if len(parts) == 3 {
			log.Printf("join %s: granting %s on %s", id, parts[2], parts[0])
			if _, err := s.admincliRun("src/set-acl.ts", j.Label, parts[0], parts[1], parts[2]); err != nil {
				log.Printf("join %s: set-acl failed: %v", id, err)
			}
		}
	}
	s.setStatus(id, "approved", meshIP)
}

func (s *server) revoke(id string) {
	s.mu.Lock()
	j := *s.joins[id]
	s.mu.Unlock()
	if _, err := s.admincliRun("src/revoke.ts", j.Label, "true"); err != nil {
		log.Printf("join %s: revoke failed: %v", id, err)
		return
	}
	s.setStatus(id, "revoked", "")
}
