package main

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"

	"github.com/WhyAsh5114/bramble/brambled/sidecar"
)

func TestRendezvousPoolRetriesDiscoveryAfterFailure(t *testing.T) {
	now := time.Unix(1000, 0)
	calls := 0
	fetch := func() (*sidecar.RelaysResponse, error) {
		calls++
		if calls == 1 {
			return nil, errors.New("sidecar returned 502: Invalid parameters")
		}
		return &sidecar.RelaysResponse{Rendezvous: []sidecar.RendezvousRelay{{Label: "relay1", Address: "203.0.113.5:9420", SidecarURL: "http://203.0.113.5:7891"}}}, nil
	}
	pool := newRendezvousPool(nil, fetch, 10*time.Second)
	pool.now = func() time.Time { return now }

	if _, err := pool.Get(); err == nil {
		t.Fatal("first Get: want the discovery error, got nil")
	}
	// Inside the retry gap the pool does not query again.
	now = now.Add(5 * time.Second)
	if _, err := pool.Get(); err == nil || calls != 1 {
		t.Fatalf("Get inside retry gap: err=%v calls=%d, want an error and 1 call", err, calls)
	}
	now = now.Add(6 * time.Second)
	relays, err := pool.Get()
	if err != nil || len(relays) != 1 || relays[0].Label != "relay1" || relays[0].SidecarURL == "" {
		t.Fatalf("Get after gap: relays=%v err=%v, want relay1", relays, err)
	}
	// Once found, the pool stops querying.
	if _, err := pool.Get(); err != nil || calls != 2 {
		t.Fatalf("Get after success: err=%v calls=%d, want no error and 2 calls", err, calls)
	}
}

func TestRendezvousPoolKeepsStartupRelays(t *testing.T) {
	fetch := func() (*sidecar.RelaysResponse, error) { t.Fatal("fetch must not run"); return nil, nil }
	pool := newRendezvousPool([]sidecar.RendezvousRelay{{Label: "static", Address: "x:1"}}, fetch, time.Second)
	if relays, err := pool.Get(); err != nil || len(relays) != 1 {
		t.Fatalf("relays=%v err=%v", relays, err)
	}
}

func TestRendezvousPoolEmptyRegistryIsAnError(t *testing.T) {
	pool := newRendezvousPool(nil, func() (*sidecar.RelaysResponse, error) { return &sidecar.RelaysResponse{}, nil }, time.Second)
	if _, err := pool.Get(); err == nil {
		t.Fatal("want an error when discovery finds no rendezvous relay")
	}
}

func TestExchangeBackoffDoublesAndResets(t *testing.T) {
	now := time.Unix(1000, 0)
	b := newExchangeBackoff(30*time.Second, 2*time.Minute)
	b.now = func() time.Time { return now }

	if b.Wait("peer") != 0 {
		t.Fatal("a peer with no failures must not wait")
	}
	want := []time.Duration{30 * time.Second, 60 * time.Second, 120 * time.Second, 120 * time.Second}
	for i, w := range want {
		b.Fail("peer")
		if got := b.Wait("peer"); got != w {
			t.Fatalf("after failure %d: wait %s, want %s", i+1, got, w)
		}
		now = now.Add(w) // the wait elapses
		if b.Wait("peer") != 0 {
			t.Fatalf("after failure %d: still waiting once the wait elapsed", i+1)
		}
	}
	if b.Wait("other") != 0 {
		t.Fatal("another peer must not inherit the backoff")
	}
	b.Fail("peer")
	b.Succeed("peer")
	if b.Wait("peer") != 0 {
		t.Fatal("a success must clear the backoff")
	}
	b.Fail("peer")
	if got := b.Wait("peer"); got != 30*time.Second {
		t.Fatalf("after reset the first failure waits %s, want 30s", got)
	}
}

// A rendezvous set recovered after a start-up discovery failure must reach the
// data-relay adoption watcher: the watcher keeps polling its source, and once
// the source returns the relay it exchanges with that relay.
func TestWatchDataRelayAdoptUsesRelaySetRecoveredAfterStartupFailure(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	accepted := make(chan struct{}, 1)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			select {
			case accepted <- struct{}{}:
			default:
			}
			c.Close()
		}
	}()

	var calls atomic.Int32
	source := func() ([]sidecar.RendezvousRelay, error) {
		if calls.Add(1) == 1 {
			return nil, errors.New("discovery failed at start-up")
		}
		return []sidecar.RendezvousRelay{{Label: "recovered", Address: ln.Addr().String()}}, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		watchDataRelayAdopt(ctx, nil, nil, "peer", "ownkey", "peerkey", "", netip.Prefix{}, source)
	}()

	select {
	case <-accepted:
	case <-time.After(3*dataRelayAdoptExchangeTimeout + 2*time.Second):
		t.Fatalf("adopt watcher never exchanged with the recovered relay (source calls: %d)", calls.Load())
	}
	cancel()
	<-done
}
