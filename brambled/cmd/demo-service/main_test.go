package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func serve(t *testing.T, path, accept string) *httptest.ResponseRecorder {
	t.Helper()
	fixed := func() time.Time { return time.Date(2026, 11, 6, 18, 30, 0, 0, time.UTC) }
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	rec := httptest.NewRecorder()
	newHandler("gateway-host", fixed).ServeHTTP(rec, req)
	return rec
}

// Scripts and agents (curl, demo-agent, the MCP tool, rehearse.py) send no
// text/html Accept and must keep getting the JSON task.
func TestTaskJSONForClients(t *testing.T) {
	for _, accept := range []string{"", "*/*", "application/json"} {
		rec := serve(t, "/task", accept)
		if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
			t.Fatalf("Accept %q: got %d %q", accept, rec.Code, rec.Header().Get("Content-Type"))
		}
		var body map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("Accept %q: %v", accept, err)
		}
		if body["task"] != "report-private-service-health" || body["status"] != "healthy" ||
			body["host"] != "gateway-host" || body["observedAt"] != "2026-11-06T18:30:00Z" {
			t.Fatalf("Accept %q: unexpected body %v", accept, body)
		}
	}
}

func TestPageForBrowsers(t *testing.T) {
	browser := "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
	for _, path := range []string{"/", "/task"} {
		rec := serve(t, path, browser)
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/html; charset=utf-8" {
			t.Fatalf("%s: got %d %q", path, rec.Code, rec.Header().Get("Content-Type"))
		}
		body := rec.Body.String()
		for _, want := range []string{"Home server", "gateway-host", "2026-11-06T18:30:00Z", "prefers-color-scheme: dark"} {
			if !strings.Contains(body, want) {
				t.Fatalf("%s: page lacks %q", path, want)
			}
		}
		// The page must load with one gateway decision: no external or
		// sub-resource URLs.
		if m := regexp.MustCompile(`(?i)(src|href)="(https?:)?//|url\(`).FindString(body); m != "" {
			t.Fatalf("%s: page references an external resource: %q", path, m)
		}
	}
	// "/" is the page even without an Accept header.
	if rec := serve(t, "/", ""); !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("/ without Accept: got %q", rec.Header().Get("Content-Type"))
	}
}

func TestEveryResponseClosesTheConnection(t *testing.T) {
	for _, path := range []string{"/", "/task", "/favicon.ico", "/other"} {
		if got := serve(t, path, "").Header().Get("Connection"); got != "close" {
			t.Fatalf("%s: Connection %q, want close", path, got)
		}
	}
}

func TestHostIsEscaped(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	newHandler("<script>x</script>", time.Now).ServeHTTP(rec, req)
	if strings.Contains(rec.Body.String(), "<script>x</script>") {
		t.Fatal("host name is not HTML-escaped")
	}
}

func TestOtherPathsKeepPlainText(t *testing.T) {
	rec := serve(t, "/hello", "")
	if !strings.HasPrefix(rec.Body.String(), "demo-service on gateway-host, request path=/hello") {
		t.Fatalf("got %q", rec.Body.String())
	}
}
