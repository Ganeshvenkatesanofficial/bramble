package main

import (
	"net"
	"testing"
	"time"
)

// A gateway has one WireGuard key and simultaneous endpoint exchanges for
// multiple enrolled peers. Registering the second exchange must not steal
// offers intended for the first one.
func TestConcurrentExchangesForOneGateway(t *testing.T) {
	srv := NewServer()
	device := dialTestServer(t, srv)
	gatewayForDevice := dialTestServer(t, srv)
	gatewayForOfflinePeer := dialTestServer(t, srv)
	for _, registration := range []struct {
		conn   net.Conn
		pubkey string
		to     string
	}{
		{device, "fresh-device", "gateway"},
		{gatewayForDevice, "gateway", "fresh-device"},
		{gatewayForOfflinePeer, "gateway", "offline-peer"},
	} {
		send(t, registration.conn, message{Type: "hello", Pubkey: registration.pubkey, To: registration.to})
		// An error from this deliberately absent target is a wire barrier:
		// this connection's hello has been processed before the next opens.
		send(t, registration.conn, message{Type: "offer", To: "absent-barrier"})
		if got := recvWithTimeout(t, registration.conn, time.Second); got.Type != "error" {
			t.Fatalf("registration barrier: got %s, want error", got.Type)
		}
	}
	send(t, device, message{Type: "offer", To: "gateway", Candidate: "203.0.113.1:40001"})
	got := recvWithTimeout(t, gatewayForDevice, 200*time.Millisecond)
	if got.Type != "offer" || got.From != "fresh-device" || got.Candidate != "203.0.113.1:40001" {
		t.Fatalf("fresh device offer reached the wrong exchange: %+v", got)
	}
}
