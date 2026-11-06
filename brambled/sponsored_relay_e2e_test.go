package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/WhyAsh5114/bramble/brambled/sidecar"
	"github.com/WhyAsh5114/bramble/brambled/sponsor"
	"github.com/WhyAsh5114/bramble/brambled/wgnode"
)

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("finding a free port: %v", err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// startRealSponsoringRelay builds and runs the real relay binary with
// -meter -data-relay -sponsor-enrolled. The relay spawns the test harness
// (relay-sidecar/test/e2e-harness) in place of relay-sidecar/src/index.ts:
// the sponsor routes, token minting and the relay's internal allocation API
// are the real code; only the registry read is a fixture, and there is no
// x402 middleware, so nothing can reach Hedera.
func startRealSponsoringRelay(t *testing.T, enrolled string, sponsorBytes int64) (rendezvousAddr, sidecarURL string) {
	t.Helper()
	if _, err := exec.LookPath("bun"); err != nil {
		t.Skip("bun not on PATH; the relay spawns its sidecar with bun")
	}
	bin := filepath.Join(t.TempDir(), "relay")
	build := exec.Command("go", "build", "-o", bin, ".")
	build.Dir = "../relay"
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("building relay: %v\n%s", err, out)
	}

	rdvPort, sidecarPort, internalPort := freePort(t), freePort(t), freePort(t)
	cmd := exec.Command(bin,
		"-addr", fmt.Sprintf("127.0.0.1:%d", rdvPort),
		"-meter", "-payee", "0.0.1",
		"-sidecar-dir", "../relay-sidecar/test/e2e-harness",
		"-sidecar-port", fmt.Sprint(sidecarPort),
		"-data-relay", "-data-host", "127.0.0.1",
		"-internal-port", fmt.Sprint(internalPort),
		"-sponsor-enrolled", "-sponsor-bytes", fmt.Sprint(sponsorBytes),
	)
	cmd.Env = append(os.Environ(),
		"BRAMBLE_TAILNET_NAME=fixture.eth",
		"BRAMBLE_TAILNET_REGISTRY=0x0000000000000000000000000000000000000001",
		"HARNESS_ENROLLED_LABELS="+enrolled,
	)
	var logs strings.Builder
	cmd.Stdout, cmd.Stderr = &logs, &logs
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting relay: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		if t.Failed() {
			t.Logf("relay output:\n%s", logs.String())
		}
	})
	sidecarURL = fmt.Sprintf("http://127.0.0.1:%d", sidecarPort)
	deadline := time.Now().Add(30 * time.Second)
	for {
		resp, err := http.Get(sidecarURL + "/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("relay sidecar not healthy within 30s\n%s", logs.String())
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Sprintf("127.0.0.1:%d", rdvPort), sidecarURL
}

func TestSponsoredRelay_RefusesUnenrolledLabel(t *testing.T) {
	_, sidecarURL := startRealSponsoringRelay(t, "device1", 65536)
	for _, label := range []string{"stranger", "Not_A_Label"} {
		p := &sponsor.Payer{Label: label}
		if _, err := p.RendezvousToken(sidecarURL); err == nil {
			t.Fatalf("token for %q: expected refusal", label)
		}
		if _, err := p.DataRelaySession(sidecarURL, 1<<30); err == nil {
			t.Fatalf("session for %q: expected refusal", label)
		}
	}
	// Asking for far more than the cap still yields exactly the cap.
	granted, err := (&sponsor.Payer{Label: "device1"}).DataRelaySession(sidecarURL, 1<<30)
	if err != nil {
		t.Fatalf("enrolled device1: %v", err)
	}
	if granted.Bytes != 65536 || granted.Port == 0 || granted.SettlementTxID != "" {
		t.Fatalf("expected a 65536-byte unpaid session, got %+v", granted)
	}
}

// TestSponsoredRelay_HTTP200ThroughRelayWithNoDirectPath is ETH-189's
// end-to-end check: a "device" node with no Hedera key and a "cloud" node,
// neither given any endpoint for the other, reach each other only through
// the real relay binary, using sponsored tokens and a sponsored session.
func TestSponsoredRelay_HTTP200ThroughRelayWithNoDirectPath(t *testing.T) {
	rdvAddr, sidecarURL := startRealSponsoringRelay(t, "device1,cloud1", 1<<20)
	relays := []sidecar.RendezvousRelay{{Label: "relay1", Address: rdvAddr, SidecarURL: sidecarURL}}
	pool := dataRelayFlag{"relay1": sidecarURL}

	devicePriv, devicePub, err := wgnode.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	cloudPriv, cloudPub, err := wgnode.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	deviceIP, cloudIP := netip.MustParseAddr("10.99.0.1"), netip.MustParseAddr("10.99.0.2")
	device, err := wgnode.New(wgnode.Config{PrivateKeyHex: devicePriv, ListenPort: 0, LocalAddress: deviceIP, Netstack: true})
	if err != nil {
		t.Fatal(err)
	}
	defer device.Close()
	cloud, err := wgnode.New(wgnode.Config{PrivateKeyHex: cloudPriv, ListenPort: 0, LocalAddress: cloudIP, Netstack: true})
	if err != nil {
		t.Fatal(err)
	}
	defer cloud.Close()

	ln, err := cloud.ListenTCP(8080)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		_ = http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprint(w, "hello through the sponsored relay")
		}))
	}()

	// Device side: the flagged -relay-peer, sponsored. Cloud side: the
	// adopting peer; it only needs a sponsored rendezvous token.
	var deviceEndpoint, cloudEndpoint *netip.AddrPort
	var deviceErr, cloudErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		deviceEndpoint, _, deviceErr = relayRoutedEndpoint(device, &sponsor.Payer{Label: "device1"}, pool, 10_000,
			unrestrictedDataRelayPurchasePolicy, relays, devicePub, cloudPub, 20*time.Second)
	}()
	go func() {
		defer wg.Done()
		candidate, _, err := exchangeAnyMetered(relays, &sponsor.Payer{Label: "cloud1"}, cloudPub, devicePub, "", 20*time.Second)
		if err != nil {
			cloudErr = err
			return
		}
		addr, err := netip.ParseAddrPort(candidate)
		if err != nil {
			cloudErr = err
			return
		}
		cloudErr = cloud.SetPersistentKeepalive(devicePub, dataRelayKeepaliveSeconds)
		cloudEndpoint = &addr
	}()
	wg.Wait()
	if deviceErr != nil || cloudErr != nil {
		t.Fatalf("device: %v; cloud: %v", deviceErr, cloudErr)
	}
	if deviceEndpoint.String() != cloudEndpoint.String() {
		t.Fatalf("endpoints differ: %s vs %s", deviceEndpoint, cloudEndpoint)
	}
	if err := device.AddPeer(cloudPub, netip.PrefixFrom(cloudIP, 32), deviceEndpoint); err != nil {
		t.Fatal(err)
	}
	if err := cloud.AddPeer(devicePub, netip.PrefixFrom(deviceIP, 32), cloudEndpoint); err != nil {
		t.Fatal(err)
	}

	client := &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return device.DialTCP(netip.AddrPortFrom(cloudIP, 8080))
		}},
	}
	var resp *http.Response
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); time.Sleep(300 * time.Millisecond) {
		if resp, err = client.Get("http://cloud1.mesh/"); err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("HTTP GET through the relay: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	t.Logf("device -> relay %s -> cloud: HTTP %d %q", deviceEndpoint, resp.StatusCode, body)
	if resp.StatusCode != http.StatusOK || string(body) != "hello through the sponsored relay" {
		t.Fatalf("unexpected response: %d %q", resp.StatusCode, body)
	}
}
