package sponsor

import (
	"testing"
	"time"
)

// A poller that asks every second for two hours must never take more than
// perHour minus the reserve in any one-hour window, so first connects and
// renewals still find tokens left at the relay.
func TestPollLimiterStaysUnderHourlyLimitWithReserve(t *testing.T) {
	for _, perHour := range []int{3, 10, 30, 100} {
		lim, err := PollLimiter(perHour)
		if err != nil {
			t.Fatalf("perHour %d: %v", perHour, err)
		}
		reserve := max(1, perHour/5)
		start := time.Unix(0, 0)
		var allowed []time.Time
		for s := 0; s < 2*3600; s++ {
			now := start.Add(time.Duration(s) * time.Second)
			if lim.AllowN(now, 1) {
				allowed = append(allowed, now)
			}
		}
		if len(allowed) == 0 {
			t.Fatalf("perHour %d: nothing allowed", perHour)
		}
		for i := range allowed {
			n := 0
			for _, a := range allowed[i:] {
				if a.Sub(allowed[i]) >= time.Hour {
					break
				}
				n++
			}
			if n > perHour-reserve {
				t.Fatalf("perHour %d: %d polls in the hour from %s, limit with reserve is %d", perHour, n, allowed[i].Sub(start), perHour-reserve)
			}
		}
	}
}

func TestPollLimiterRejectsTooSmallLimit(t *testing.T) {
	for _, perHour := range []int{0, 1, 2} {
		if _, err := PollLimiter(perHour); err == nil {
			t.Fatalf("perHour %d: expected an error", perHour)
		}
	}
}
