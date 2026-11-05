//go:build nattest

package nattest_test

import (
	"net"
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
