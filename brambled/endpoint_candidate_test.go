package main

import "testing"

func TestPeerEndpointFromCandidate(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"203.0.113.9:51820", "203.0.113.9:51820"},
		{"ep1:host=10.0.0.2:51820,srflx=203.0.113.7:41000", "203.0.113.7:41000"},
	}
	for _, c := range cases {
		got, err := peerEndpointFromCandidate(c.in)
		if err != nil || got.String() != c.want {
			t.Errorf("peerEndpointFromCandidate(%q) = %v, %v; want %s", c.in, got, err, c.want)
		}
	}
	for _, bad := range []string{"", "ep1:srflx=0.0.0.0:1", "garbage"} {
		if _, err := peerEndpointFromCandidate(bad); err == nil {
			t.Errorf("peerEndpointFromCandidate(%q) succeeded, want an error", bad)
		}
	}
}
