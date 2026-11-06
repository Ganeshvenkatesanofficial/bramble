package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"time"
)

// paySidecar spawns relay-sidecar (relay-sidecar/, Hono on Bun) as a child
// process when -meter is set, adapted from brambled/sidecar.Manager's
// spawn+health-check pattern — not shared code with that package: this one
// is smaller and has no tailnet identity to match, just liveness (see
// docs/adr/0007).
type paySidecar struct {
	port   int
	secret []byte
	cmd    *exec.Cmd
}

type paySidecarConfig struct {
	Dir   string // relay-sidecar's project directory (contains package.json)
	Port  int
	Payee string // Hedera account id, HEDERA_RELAY_OPERATOR_ACCOUNT_ID

	// Data-relay config (docs/adr/0008) — all zero values unless -data-relay
	// is set, in which case relay-sidecar mounts the /data-relay-session and
	// /price routes and knows where to call back for allocation.
	DataRelay      bool
	InternalAPIURL string // e.g. http://127.0.0.1:7895 — loopback allocation API
	PricePerByte   string // atomic USDC per byte, DynamicPrice input

	// Operator-sponsored sessions (ETH-177 D11) — zero unless
	// -sponsor-enrolled is set. relay-sidecar then mounts the unpaid
	// /sponsored/* routes and checks enrollment against the tailnet registry
	// using BRAMBLE_TAILNET_NAME / BRAMBLE_TAILNET_REGISTRY / SEPOLIA_RPC_URL
	// from this process's own environment.
	Sponsor           bool
	SponsorBytes      int64
	SponsorMaxPerHour int
}

// startPaySidecar generates a fresh HMAC secret, spawns relay-sidecar with
// it, and blocks until /health responds. The secret never leaves this
// process pair — it's not chain state and not operator-configured, see
// docs/adr/0007's "Decision" section.
func startPaySidecar(cfg paySidecarConfig) (*paySidecar, error) {
	if cfg.Port == 0 {
		cfg.Port = 7891
	}

	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("generating token secret: %w", err)
	}
	secretHex := hex.EncodeToString(secret)

	env := append(os.Environ(),
		fmt.Sprintf("PORT=%d", cfg.Port),
		fmt.Sprintf("RENDEZVOUS_TOKEN_SECRET=%s", secretHex),
		fmt.Sprintf("HEDERA_RELAY_OPERATOR_ACCOUNT_ID=%s", cfg.Payee),
	)
	if cfg.DataRelay {
		env = append(env,
			"DATA_RELAY_ENABLED=1",
			fmt.Sprintf("DATA_RELAY_INTERNAL_API_URL=%s", cfg.InternalAPIURL),
			fmt.Sprintf("DATA_RELAY_PRICE_PER_BYTE=%s", cfg.PricePerByte),
		)
	}

	if cfg.Sponsor {
		env = append(env,
			"SPONSOR_ENROLLED=1",
			fmt.Sprintf("SPONSOR_BYTES=%d", cfg.SponsorBytes),
			fmt.Sprintf("SPONSOR_MAX_PER_HOUR=%d", cfg.SponsorMaxPerHour),
		)
	}

	cmd := exec.Command("bun", "run", "src/index.ts")
	cmd.Dir = cfg.Dir
	cmd.Env = env
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting relay-sidecar: %w", err)
	}

	p := &paySidecar{port: cfg.Port, secret: secret, cmd: cmd}
	if err := p.waitHealthy(5 * time.Second); err != nil {
		_ = p.Stop()
		return nil, err
	}
	return p, nil
}

func (p *paySidecar) waitHealthy(timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	url := fmt.Sprintf("http://127.0.0.1:%d/health", p.port)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("relay-sidecar did not become healthy within %s", timeout)
		case <-ticker.C:
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
			if err != nil {
				continue
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				continue
			}
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
	}
}

func (p *paySidecar) Stop() error {
	if p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Kill()
}

const (
	defaultSponsorBytes      int64 = 1 << 20 // 1 MiB
	defaultSponsorMaxPerHour       = 30
)

// validateSponsorFlags fails fast, at startup, on a -sponsor-enrolled
// configuration that could not work: enrollment is read from the tailnet
// registry, so the three names below must be set, and the unpaid routes live
// in relay-sidecar, so -meter and -data-relay must be on. Reports names only;
// never a value.
func validateSponsorFlags(meter, dataRelay bool, bytes int64, maxPerHour int, getenv func(string) string) error {
	if !meter || !dataRelay {
		return fmt.Errorf("-sponsor-enrolled requires -meter and -data-relay (the sponsored routes live in relay-sidecar)")
	}
	if bytes <= 0 || maxPerHour <= 0 {
		return fmt.Errorf("-sponsor-bytes and -sponsor-max-per-hour must be positive")
	}
	for _, name := range []string{"BRAMBLE_TAILNET_NAME", "BRAMBLE_TAILNET_REGISTRY"} {
		if getenv(name) == "" {
			return fmt.Errorf("-sponsor-enrolled needs %s in the environment (the tailnet whose devices are sponsored)", name)
		}
	}
	return nil
}
