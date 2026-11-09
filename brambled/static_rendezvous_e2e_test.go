package main

import (
	"net/netip"
	"sync"
	"testing"
	"time"

	"github.com/Ganeshvenkatesanofficial/bramble/brambled/sidecar"
	"github.com/Ganeshvenkatesanofficial/bramble/brambled/sponsor"
	"github.com/Ganeshvenkatesanofficial/bramble/brambled/wgnode"
)

// ETH-301: a curl-installed device gets -rendezvous from the public node config
// and BRAMBLE_RENDEZVOUS_PAYMENT_URL only from its rendezvousPaymentUrl field.
// Against the real -meter relay, the device's exchange must carry a token from
// that relay's sidecar, or neither side ever learns the other's relay endpoint.
func TestStaticRendezvous_MeteredRelayNeedsPaymentURL(t *testing.T) {
	rdvAddr, sidecarURL := startRealSponsoringRelay(t, "device1,cloud1", 65536)
	// The cloud node is configured correctly in both cases.
	cloudRelays := []sidecar.RendezvousRelay{{Label: "relay1", Address: rdvAddr, SidecarURL: sidecarURL}}
	pool := dataRelayFlag{"mumbai-relay": sidecarURL}

	exchange := func(t *testing.T, devicePaymentURL string) (deviceErr, cloudErr error) {
		t.Helper()
		devicePriv, devicePub, err := wgnode.GenerateKeyPair()
		if err != nil {
			t.Fatal(err)
		}
		_, cloudPub, err := wgnode.GenerateKeyPair()
		if err != nil {
			t.Fatal(err)
		}
		device, err := wgnode.New(wgnode.Config{PrivateKeyHex: devicePriv, LocalAddress: netip.MustParseAddr("10.99.0.7"), Netstack: true})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { device.Close() })

		deviceRelays := staticRendezvousRelays(rdvAddr, devicePaymentURL)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _, deviceErr = relayRoutedEndpoint(device, &sponsor.Payer{Label: "device1"}, pool, 10_000,
				unrestrictedDataRelayPurchasePolicy, deviceRelays, devicePub, cloudPub, 8*time.Second, nil)
		}()
		go func() {
			defer wg.Done()
			_, _, cloudErr = exchangeAnyMetered(cloudRelays, &sponsor.Payer{Label: "cloud1"}, cloudPub, devicePub, "", 8*time.Second)
		}()
		wg.Wait()
		return deviceErr, cloudErr
	}

	t.Run("no rendezvousPaymentUrl, as published at 970461c", func(t *testing.T) {
		deviceErr, cloudErr := exchange(t, "")
		t.Logf("device: %v", deviceErr)
		t.Logf("cloud: %v", cloudErr)
		if deviceErr == nil || cloudErr == nil {
			t.Fatalf("expected both sides to fail without a device token; device=%v cloud=%v", deviceErr, cloudErr)
		}
	})

	t.Run("rendezvousPaymentUrl set to the relay sidecar", func(t *testing.T) {
		deviceErr, cloudErr := exchange(t, sidecarURL)
		if deviceErr != nil || cloudErr != nil {
			t.Fatalf("device: %v; cloud: %v", deviceErr, cloudErr)
		}
	})
}
