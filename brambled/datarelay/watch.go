package datarelay

import (
	"context"
	"time"

	"golang.org/x/time/rate"

	"github.com/Ganeshvenkatesanofficial/bramble/brambled/wgnode"
)

// PeerLister is satisfied by *wgnode.Node — narrowed to what WaitForStall
// actually needs.
type PeerLister interface {
	Peers() ([]wgnode.PeerInfo, error)
}

// WaitForStall blocks until pubkey's received-byte counter (wireguard-go's
// own rx_bytes, confirmed against its UAPI source in wgnode.PeerInfo's doc
// comment) stops growing for stallTimeout, checked every pollInterval, or
// until ctx is cancelled (returning ctx.Err()).
//
// This can't distinguish "the relay died" from "nothing to send right
// now" — a deliberate, scoped simplification (docs/adr/0008). It's valid
// for what it's used for: Gate 4.3's own test is "kill the relay
// mid-transfer," so there's always traffic in flight exactly when this
// signal needs to fire. Outside an active transfer, a false-positive
// failover just costs one extra session purchase, not a correctness bug.
func WaitForStall(ctx context.Context, node PeerLister, pubkey string, pollInterval, stallTimeout time.Duration) error {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	lastRx := int64(-1)
	var lastChange time.Time

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			peers, err := node.Peers()
			if err != nil {
				continue // transient IpcGet error — try again next tick
			}
			var rx int64
			found := false
			for _, p := range peers {
				if p.PublicKeyHex == pubkey {
					rx, found = p.RxBytes, true
					break
				}
			}
			if !found {
				continue // not in the peer table yet — nothing to judge stalled
			}
			if lastRx < 0 || rx != lastRx {
				lastRx = rx
				lastChange = time.Now()
				continue
			}
			if time.Since(lastChange) >= stallTimeout {
				return nil
			}
		}
	}
}

// WaitForStallWithToken returns once pubkey's traffic has stalled and lim
// has a token for a poll, and takes that token. If no token is free when
// the stall is seen, it waits for one without taking it, then checks for
// the stall again from the start. A link that recovered during that wait
// therefore takes no token and is not polled.
func WaitForStallWithToken(ctx context.Context, node PeerLister, pubkey string, pollInterval, stallTimeout time.Duration, lim *rate.Limiter) error {
	for {
		if err := WaitForStall(ctx, node, pubkey, pollInterval, stallTimeout); err != nil {
			return err
		}
		if lim.Allow() {
			return nil
		}
		r := lim.Reserve()
		delay := r.Delay()
		r.Cancel()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
}
