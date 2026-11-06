// Package sponsor lets a device with no Hedera key reach a relay: instead of
// paying through the local sidecar's x402 client, it asks the relay's
// operator-sponsored routes for a rendezvous token and a capped data-relay
// session by naming its own enrolled label (docs/adr/0018, spec D11).
//
// The call goes straight from brambled to the relay's sidecar, not through
// Tor, so the relay sees this device's source IP. The relay checks that the
// label is enrolled in the tailnet registry; the label is public, so this is
// an enrollment check, not proof of key ownership.
package sponsor

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/WhyAsh5114/bramble/brambled/sidecar"
)

const callTimeout = 30 * time.Second

// Payer satisfies the same two calls brambled makes on *sidecar.Manager for
// the paid path, so the relay code does not know which one it holds.
type Payer struct {
	Label  string
	Client *http.Client
}

func (p *Payer) client() *http.Client {
	if p.Client != nil {
		return p.Client
	}
	return &http.Client{Timeout: callTimeout}
}

func (p *Payer) post(sidecarURL, path string, out any) error {
	body, err := json.Marshal(struct {
		Label string `json:"label"`
	}{Label: p.Label})
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}
	resp, err := p.client().Post(strings.TrimRight(sidecarURL, "/")+path, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("calling relay sidecar: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return fmt.Errorf("reading relay response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("relay returned %d: %s", resp.StatusCode, raw)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decoding relay response: %w", err)
	}
	return nil
}

// RendezvousToken asks the relay at sidecarURL for a sponsored rendezvous
// token. Nothing is settled on-chain.
func (p *Payer) RendezvousToken(sidecarURL string) (*sidecar.RendezvousTokenResponse, error) {
	var out sidecar.RendezvousTokenResponse
	if err := p.post(sidecarURL, "/sponsored/rendezvous-token", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DataRelaySession asks the relay for a sponsored session. The relay grants
// its own cap (-sponsor-bytes) whatever sessionBytes asks for; the grant is
// in the response's Bytes field.
func (p *Payer) DataRelaySession(sidecarURL string, _ int64) (*sidecar.DataRelaySessionResponse, error) {
	var out sidecar.DataRelaySessionResponse
	if err := p.post(sidecarURL, "/sponsored/data-relay-session", &out); err != nil {
		return nil, err
	}
	return &out, nil
}
