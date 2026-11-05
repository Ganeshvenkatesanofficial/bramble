package stun

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"net/netip"
	"sync"
	"testing"
	"time"

	"golang.zx2c4.com/wireguard/conn"
)

func bindingReply(req []byte, mapped netip.AddrPort) []byte {
	raw := mapped.Addr().AsSlice()
	b := make([]byte, 28+len(raw))
	copy(b, req[:20])
	binary.BigEndian.PutUint16(b, 0x101)
	binary.BigEndian.PutUint16(b[2:], uint16(len(b)-20))
	binary.BigEndian.PutUint16(b[20:], 0x20)
	binary.BigEndian.PutUint16(b[22:], uint16(4+len(raw)))
	b[25] = 1
	if len(raw) == 16 {
		b[25] = 2
	}
	binary.BigEndian.PutUint16(b[26:], mapped.Port()^0x2112)
	for i := range raw {
		b[28+i] = raw[i] ^ req[4+i]
	}
	return b
}

func startBind(t *testing.T) (*Bind, uint16) {
	t.Helper()
	b := NewBind(conn.NewDefaultBind())
	b.rto = 5 * time.Millisecond
	fns, port, err := b.Open(0)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, fn := range fns {
		wg.Add(1)
		go func() {
			defer wg.Done()
			packets := make([][]byte, b.BatchSize())
			for i := range packets {
				packets[i] = make([]byte, 2048)
			}
			sizes, eps := make([]int, len(packets)), make([]conn.Endpoint, len(packets))
			for {
				if _, err := fn(packets, sizes, eps); err != nil {
					return
				}
			}
		}()
	}
	t.Cleanup(func() { b.Close(); wg.Wait() })
	return b, port
}

func fakeServer(t *testing.T, handle func(*net.UDPConn, []byte, netip.AddrPort)) *net.UDPConn {
	t.Helper()
	s, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 2048)
		for {
			n, src, err := s.ReadFromUDPAddrPort(buf)
			if err != nil {
				return
			}
			handle(s, buf[:n], src)
		}
	}()
	t.Cleanup(func() { s.Close(); <-done })
	return s
}

func TestBindingSameSocketRetransmitAndValidation(t *testing.T) {
	b, port := startBind(t)
	var requests int
	var first []byte
	observed := make(chan netip.AddrPort, 1)
	server := fakeServer(t, func(s *net.UDPConn, req []byte, src netip.AddrPort) {
		requests++
		if requests == 1 {
			first = append([]byte(nil), req...)
			return
		} // lost request
		if string(first) != string(req) {
			t.Error("retransmission changed transaction")
		}
		reply := bindingReply(req, src)
		wrong := append([]byte(nil), reply...)
		wrong[8] ^= 1
		s.WriteToUDPAddrPort(wrong, src)
		malformed := append([]byte(nil), reply...)
		malformed[3]++
		s.WriteToUDPAddrPort(malformed, src)
		impostor, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
		if err != nil {
			t.Error(err)
			return
		}
		impostor.WriteToUDPAddrPort(bindingReply(req, netip.MustParseAddrPort("192.0.2.99:9999")), src)
		impostor.Close()
		s.WriteToUDPAddrPort(reply, src)
		select {
		case observed <- src:
		default:
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	endpoint, err := b.Binding(ctx, server.LocalAddr().(*net.UDPAddr).AddrPort())
	if err != nil {
		t.Fatal(err)
	}
	if endpoint != <-observed || endpoint.Port() != port {
		t.Fatalf("wrong mapping: %v, bind port %d", endpoint, port)
	}
}

func TestBindingCancellationCloseAndFallback(t *testing.T) {
	b, _ := startBind(t)
	gotRequest := make(chan struct{}, 1)
	silent := fakeServer(t, func(_ *net.UDPConn, _ []byte, _ netip.AddrPort) {
		select {
		case gotRequest <- struct{}{}:
		default:
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Millisecond)
	_, err := b.Binding(ctx, silent.LocalAddr().(*net.UDPAddr).AddrPort())
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancellation: %v", err)
	}
	live := fakeServer(t, func(s *net.UDPConn, req []byte, src netip.AddrPort) {
		s.WriteToUDPAddrPort(bindingReply(req, src), src)
	})
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	endpoint, server, err := b.Discover(ctx, []string{silent.LocalAddr().String(), live.LocalAddr().String()})
	if err != nil || !endpoint.IsValid() || server != live.LocalAddr().String() {
		t.Fatalf("fallback: %v %s %v", endpoint, server, err)
	}
	for len(gotRequest) > 0 {
		<-gotRequest
	}
	done := make(chan error, 1)
	go func() {
		_, err := b.Binding(context.Background(), silent.LocalAddr().(*net.UDPAddr).AddrPort())
		done <- err
	}()
	<-gotRequest
	b.Close()
	select {
	case err := <-done:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("close left transaction waiting")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.pending) != 0 {
		t.Fatal("leaked transaction")
	}
}

func TestResponseAddressesAndMalformed(t *testing.T) {
	id := transactionID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}
	req := request(id)
	for _, value := range []string{"198.51.100.4:54321", "[2001:db8::1234]:54321"} {
		want := netip.MustParseAddrPort(value)
		wire := bindingReply(req, want)
		got, err := response(wire)
		if err != nil || got != want {
			t.Fatalf("%s: %v %v", value, got, err)
		}
		for length := 0; length < len(wire); length++ {
			if _, err := response(wire[:length]); err == nil {
				t.Fatalf("accepted truncation %d", length)
			}
		}
		wire[25] = 3
		if _, err := response(wire); err == nil {
			t.Fatal("accepted unknown address family")
		}
	}
	// Legacy MAPPED-ADDRESS is accepted when XOR-MAPPED-ADDRESS is absent.
	wire := bindingReply(req, netip.MustParseAddrPort("198.51.100.4:54321"))
	binary.BigEndian.PutUint16(wire[20:], 1)
	binary.BigEndian.PutUint16(wire[26:], 54321)
	copy(wire[28:], []byte{198, 51, 100, 4})
	if got, err := response(wire); err != nil || got.String() != "198.51.100.4:54321" {
		t.Fatalf("mapped: %v %v", got, err)
	}
}

func FuzzResponse(f *testing.F) {
	f.Add(bindingReply(request(transactionID{}), netip.MustParseAddrPort("198.51.100.4:54321")))
	f.Fuzz(func(t *testing.T, packet []byte) { _, _ = response(packet) })
}
