package statusapi

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

// The approval console (approval/test/fixtures/activity-status.json) parses
// this feed. The fixture must stay decodable by the real ActivityEvent type,
// with no field the server does not emit, and must cover every kind.
func TestApprovalFixtureMatchesActivityContract(t *testing.T) {
	raw, err := os.ReadFile("../../approval/test/fixtures/activity-status.json")
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var events []ActivityEvent
	if err := dec.Decode(&events); err != nil {
		t.Fatalf("fixture does not match ActivityEvent: %v", err)
	}
	seen := map[string]bool{}
	for _, e := range events {
		seen[e.Kind+"/"+e.Outcome] = true
	}
	for _, want := range []string{"admission/", "gateway/allowed", "gateway/denied", "peer/dropped"} {
		if !seen[want] {
			t.Errorf("fixture lacks %q", want)
		}
	}
}
