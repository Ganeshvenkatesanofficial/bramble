package sponsor

import (
	"fmt"
	"time"

	"golang.org/x/time/rate"
)

// PollLimiter paces the rendezvous polling a sponsored node runs for peers it
// adopts (watchDataRelayAdopt in brambled/main.go). Every poll cycle takes
// one sponsored token from each relay, and the relay allows one label
// perHour tokens per hour (relay -sponsor-max-per-hour, default 30), shared
// by all of the node's peers.
//
// The limiter leaves a fifth of perHour unused, for first connects and
// session renewals, and allows a burst of another fifth so a renewal is
// caught quickly. In any hour it allows at most perHour minus that reserve:
// at the default of 30, a burst of 6 and then one cycle every 200 s, 24 in
// all, leaving 6.
func PollLimiter(perHour int) (*rate.Limiter, error) {
	reserve := max(1, perHour/5)
	burst := max(1, perHour/5)
	steady := perHour - reserve - burst
	if steady < 1 {
		return nil, fmt.Errorf("sponsored tokens per hour must be at least 3, got %d", perHour)
	}
	return rate.NewLimiter(rate.Every(time.Hour/time.Duration(steady)), burst), nil
}
