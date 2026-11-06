// demo-service is the private service behind the demo gateway. It is not
// part of the brambled binary. It answers on loopback only, so the gateway's
// forward is the only way in.
//
// It serves two views of the same service:
//
//   - GET /task for scripts and agents: JSON with the host name and the time
//     it answered, which proves the reply crossed the tunnel rather than being
//     faked locally. rehearse.py, demo-agent and the agent MCP tool read this.
//   - GET / (and GET /task from a browser) for people: a self-contained HTML
//     page. It makes no other requests, so one gateway decision loads it.
//
// Every response closes its connection. The gateway checks access once per
// connection, so a browser reload after a revoke opens a new connection and
// gets a fresh decision instead of reusing a kept-alive one.
package main

import (
	_ "embed"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"strings"
	"time"
)

//go:embed page.html
var pageHTML string

var page = template.Must(template.New("page").Parse(pageHTML))

type pageData struct {
	Host     string
	ServedAt string
}

// wantsHTML reports whether the client asked for a page. Browsers list
// text/html in Accept; curl, Go and Node clients do not by default.
func wantsHTML(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

func newHandler(hostname string, now func() time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Connection", "close")
		w.Header().Set("Cache-Control", "no-store")
		served := now().UTC().Format(time.RFC3339)
		switch {
		case r.URL.Path == "/favicon.ico":
			w.WriteHeader(http.StatusNoContent)
		case r.URL.Path == "/" || (r.URL.Path == "/task" && wantsHTML(r)):
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			_ = page.Execute(w, pageData{Host: hostname, ServedAt: served})
		case r.URL.Path == "/task":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{
				"task":       "report-private-service-health",
				"host":       hostname,
				"status":     "healthy",
				"observedAt": served,
			})
		default:
			fmt.Fprintf(w, "demo-service on %s, request path=%s, served at %s\n", hostname, r.URL.Path, served)
		}
	})
}

func main() {
	port := flag.String("port", "9100", "port to listen on, 127.0.0.1 only")
	flag.Parse()

	hostname, _ := os.Hostname()
	addr := "127.0.0.1:" + *port
	fmt.Fprintf(os.Stderr, "demo-service listening on %s\n", addr)
	if err := http.ListenAndServe(addr, newHandler(hostname, time.Now)); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
