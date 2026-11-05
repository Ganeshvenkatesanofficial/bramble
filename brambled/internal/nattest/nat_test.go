//go:build nattest

package nattest_test

import (
	"errors"
	"net"
	"os"
	"testing"
	"time"

	"github.com/WhyAsh5114/bramble/brambled/internal/nattest"
)

func server(t *testing.T, ip string) *net.UDPConn {
	t.Helper()
	c, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP(ip)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c
}

func client(t *testing.T, kind nattest.Type, ip string) (*nattest.NAT, net.PacketConn) {
	t.Helper()
	n, err := nattest.New(kind, net.ParseIP(ip))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { n.Close() })
	c, err := n.ListenPacket()
	if err != nil {
		t.Fatal(err)
	}
	return n, c
}

func send(t *testing.T, c net.PacketConn, to net.Addr, body string) {
	t.Helper()
	if n, err := c.WriteTo([]byte(body), to); err != nil || n != len(body) {
		t.Fatalf("send %q: n=%d err=%v", body, n, err)
	}
}

func receive(t *testing.T, c net.PacketConn, want string) net.Addr {
	t.Helper()
	if err := c.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	defer c.SetReadDeadline(time.Time{})
	b := make([]byte, 2048)
	n, from, err := c.ReadFrom(b)
	if err != nil || string(b[:n]) != want {
		t.Fatalf("receive: got %q from %v err=%v, want %q", b[:n], from, err, want)
	}
	return from
}

func TestFullCone(t *testing.T) {
	_, inside := client(t, nattest.FullCone, "127.0.0.2")
	stun := server(t, "127.0.0.10")
	peer := server(t, "127.0.0.11")
	send(t, inside, stun.LocalAddr(), "discover")
	public := receive(t, stun, "discover")
	send(t, stun, public, "binding response")
	if from := receive(t, inside, "binding response"); from.String() != stun.LocalAddr().String() {
		t.Fatalf("reply source = %v, want STUN address %v", from, stun.LocalAddr())
	}
	// The private socket has never contacted this peer.
	send(t, peer, public, "unsolicited")
	receive(t, inside, "unsolicited")
	send(t, inside, peer.LocalAddr(), "probe")
	if other := receive(t, peer, "probe"); other.String() != public.String() {
		t.Fatalf("cone mapping changed: %v -> %v", public, other)
	}
}

func expectTimeout(t *testing.T, c net.PacketConn) {
	t.Helper()
	if err := c.SetReadDeadline(time.Now().Add(60 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	defer c.SetReadDeadline(time.Time{})
	buf := make([]byte, 2048)
	if n, from, err := c.ReadFrom(buf); !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatalf("expected dropped datagram: got %q from %v err=%v", buf[:n], from, err)
	}
}

func TestRestrictedCone(t *testing.T) {
	_, inside := client(t, nattest.RestrictedCone, "127.0.0.2")
	stun := server(t, "127.0.0.10")
	peer := server(t, "127.0.0.11")
	peerOtherPort := server(t, "127.0.0.11")
	stranger := server(t, "127.0.0.12")
	send(t, inside, stun.LocalAddr(), "discover")
	public := receive(t, stun, "discover")
	send(t, peer, public, "unsolicited")
	expectTimeout(t, inside)
	send(t, inside, peer.LocalAddr(), "open")
	if mapped := receive(t, peer, "open"); mapped.String() != public.String() {
		t.Fatalf("restricted-cone mapping changed: %v -> %v", public, mapped)
	}
	// Restricted cone authorizes an IP, not just the contacted port.
	send(t, peerOtherPort, public, "other port")
	if from := receive(t, inside, "other port"); from.String() != peerOtherPort.LocalAddr().String() {
		t.Fatalf("source = %v, want %v", from, peerOtherPort.LocalAddr())
	}
	send(t, stranger, public, "still unsolicited")
	expectTimeout(t, inside)
	send(t, stun, public, "STUN remains authorized")
	receive(t, inside, "STUN remains authorized")
}

func TestSymmetric(t *testing.T) {
	_, inside := client(t, nattest.Symmetric, "127.0.0.2")
	stun := server(t, "127.0.0.10")
	stunOtherPort := server(t, "127.0.0.10")
	peer := server(t, "127.0.0.11")
	send(t, inside, stun.LocalAddr(), "discover")
	stunMapping := receive(t, stun, "discover")
	send(t, stun, stunMapping, "binding response")
	receive(t, inside, "binding response")
	send(t, stunOtherPort, stunMapping, "wrong port")
	send(t, peer, stunMapping, "wrong IP")
	expectTimeout(t, inside)

	send(t, inside, stunOtherPort.LocalAddr(), "second destination")
	portMapping := receive(t, stunOtherPort, "second destination")
	send(t, inside, peer.LocalAddr(), "third destination")
	peerMapping := receive(t, peer, "third destination")
	if stunMapping.String() == portMapping.String() || stunMapping.String() == peerMapping.String() || portMapping.String() == peerMapping.String() {
		t.Fatalf("symmetric mappings must differ per destination: %v %v %v", stunMapping, portMapping, peerMapping)
	}
	send(t, peer, peerMapping, "peer reply")
	receive(t, inside, "peer reply")
	// Contacting a peer does not authorize it on the STUN mapping.
	send(t, peer, stunMapping, "wrong mapping")
	expectTimeout(t, inside)
	send(t, inside, stun.LocalAddr(), "repeat discovery")
	if repeated := receive(t, stun, "repeat discovery"); repeated.String() != stunMapping.String() {
		t.Fatalf("same destination did not reuse mapping: %v -> %v", stunMapping, repeated)
	}
}
