package daemon

import (
	"errors"
	"testing"
)

func mustPhase(t *testing.T, m *Machine, want Phase) {
	t.Helper()
	if got := m.Phase(); got != want {
		t.Fatalf("phase = %q, want %q (problem %+v)", got, want, m.Problem())
	}
}

func TestNewMachineRestoresPhase(t *testing.T) {
	mustPhase(t, NewMachine("", nil), PhaseSetup)
	mustPhase(t, NewMachine("laptop", nil), PhaseReady)
	m := NewMachine("laptop", &JoinRecord{Tailnet: "demo.eth", JoinID: "j1"})
	mustPhase(t, m, PhasePending)
	if !m.WantsPolling() || m.WantsNode() {
		t.Fatalf("a restored join must poll and must not start the node before approval")
	}
	// A join record without a name cannot be acted on; setup comes first.
	mustPhase(t, NewMachine("", &JoinRecord{Tailnet: "demo.eth", JoinID: "j1"}), PhaseSetup)
}

func TestHappyPathSetupJoinApproveConnect(t *testing.T) {
	m := NewMachine("", nil)
	if err := m.CanJoin(); !errors.Is(err, ErrBusy) {
		t.Fatalf("join before setup: err = %v, want ErrBusy", err)
	}
	if err := m.Setup("laptop"); err != nil {
		t.Fatal(err)
	}
	mustPhase(t, m, PhaseReady)
	if err := m.CanJoin(); err != nil {
		t.Fatal(err)
	}
	m.JoinSent("demo.eth", "j1")
	mustPhase(t, m, PhasePending)

	m.JoinUpdate(Join{ID: "j1", Status: JoinPending})
	mustPhase(t, m, PhasePending)

	m.JoinUpdate(Join{ID: "j1", Status: JoinApproved, MeshIP: "10.77.0.9/24"})
	mustPhase(t, m, PhaseApproved)
	if m.MeshIP() != "10.77.0.9/24" || !m.WantsNode() || !m.WantsPolling() {
		t.Fatalf("approved: meshIP=%q wantsNode=%v wantsPolling=%v", m.MeshIP(), m.WantsNode(), m.WantsPolling())
	}

	// Peers known but none reachable yet: still approved.
	m.PeersUpdate([]Peer{{Label: "gateway", Path: "none"}})
	mustPhase(t, m, PhaseApproved)

	m.PeersUpdate([]Peer{{Label: "gateway", Path: "relay"}})
	mustPhase(t, m, PhaseConnected)

	// Path lost: back to approved, not error.
	m.PeersUpdate([]Peer{{Label: "gateway", Path: "none"}})
	mustPhase(t, m, PhaseApproved)
}

func TestSetupValidatesNameAndRefusesWhileJoined(t *testing.T) {
	m := NewMachine("", nil)
	for _, bad := range []string{"", "Laptop", "-x", "x-", "a_b", "a.b"} {
		if err := m.Setup(bad); err == nil {
			t.Fatalf("Setup(%q) accepted an invalid name", bad)
		}
	}
	if err := m.Setup("laptop-1"); err != nil {
		t.Fatal(err)
	}
	m.JoinSent("demo.eth", "j1")
	if err := m.Setup("other"); !errors.Is(err, ErrBusy) {
		t.Fatalf("rename while pending: err = %v, want ErrBusy", err)
	}
	var info *ErrorInfo
	if err := m.Setup("other"); !errors.As(err, &info) || info.NextStep == "" {
		t.Fatalf("busy error must carry a next step, got %v", err)
	}
}

func TestDeniedAllowsRenameAndRejoin(t *testing.T) {
	m := NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j1")
	m.JoinUpdate(Join{ID: "j1", Status: JoinDenied})
	mustPhase(t, m, PhaseDenied)
	if m.WantsPolling() || m.WantsNode() || m.JoinID() != "" {
		t.Fatalf("denied must stop polling and forget the join id")
	}
	if err := m.Setup("laptop-2"); err != nil {
		t.Fatalf("rename after denial: %v", err)
	}
	if err := m.CanJoin(); err != nil {
		t.Fatalf("rejoin after denial: %v", err)
	}
}

func TestRevokeStopsNodeAndExplains(t *testing.T) {
	m := NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j1")
	m.JoinUpdate(Join{ID: "j1", Status: JoinApproved, MeshIP: "10.77.0.9/24"})
	m.PeersUpdate([]Peer{{Label: "gateway", Path: "direct"}})
	mustPhase(t, m, PhaseConnected)

	m.JoinUpdate(Join{ID: "j1", Status: JoinRevoked})
	mustPhase(t, m, PhaseError)
	if m.WantsNode() || m.WantsPolling() || len(m.Peers()) != 0 {
		t.Fatalf("revoked: the node must stop and polling must end")
	}
	p := m.Problem()
	if p == nil || p.Message == "" || p.NextStep == "" {
		t.Fatalf("revoked must explain itself, got %+v", p)
	}
	if m.Base() != PhaseReady || m.CanJoin() != nil {
		t.Fatalf("after revoke the person can ask to join again")
	}
	m.JoinSent("demo.eth", "j2")
	mustPhase(t, m, PhasePending)
}

func TestUpdatesForOtherRequestsAreIgnored(t *testing.T) {
	m := NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j2")
	m.JoinUpdate(Join{ID: "j1", Status: JoinApproved})
	mustPhase(t, m, PhasePending)

	// After leaving, a late poll result for the old request changes nothing.
	m.Leave()
	m.JoinUpdate(Join{ID: "", Status: JoinApproved})
	mustPhase(t, m, PhaseReady)
}

func TestTransientProblemRecovers(t *testing.T) {
	m := NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j1")
	m.SetProblem(ErrorInfo{Message: "unreachable", NextStep: "wait"})
	mustPhase(t, m, PhaseError)
	if !m.WantsPolling() {
		t.Fatalf("a transient problem must not stop polling")
	}
	m.JoinUpdate(Join{ID: "j1", Status: JoinPending})
	mustPhase(t, m, PhasePending)
}

func TestJoinLost(t *testing.T) {
	m := NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j1")
	m.JoinLost()
	mustPhase(t, m, PhaseError)
	if m.Base() != PhaseReady || m.WantsPolling() || m.CanJoin() != nil {
		t.Fatalf("a lost pending request returns to ready with a problem")
	}

	// Once approved, ENS decides membership, so a lost request id changes
	// nothing and the node keeps running.
	m = NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j1")
	m.JoinUpdate(Join{ID: "j1", Status: JoinApproved})
	m.JoinLost()
	mustPhase(t, m, PhaseApproved)
	if !m.WantsNode() {
		t.Fatalf("approved node must keep running after the join id is lost")
	}
}

func TestNodeDownKeepsRetrying(t *testing.T) {
	m := NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j1")
	m.JoinUpdate(Join{ID: "j1", Status: JoinApproved})
	m.PeersUpdate([]Peer{{Label: "gateway", Path: "relay"}})
	m.NodeDown(ErrorInfo{Message: "stopped", NextStep: "wait"})
	mustPhase(t, m, PhaseError)
	if !m.WantsNode() || m.Base() != PhaseApproved {
		t.Fatalf("a crashed node must be restarted")
	}
	m.PeersUpdate([]Peer{{Label: "gateway", Path: "relay"}})
	mustPhase(t, m, PhaseConnected)

	// NodeDown outside approved/connected is ignored.
	m = NewMachine("laptop", nil)
	m.NodeDown(ErrorInfo{Message: "x", NextStep: "y"})
	mustPhase(t, m, PhaseReady)
}

func TestLeaveKeepsIdentity(t *testing.T) {
	m := NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j1")
	m.JoinUpdate(Join{ID: "j1", Status: JoinApproved, MeshIP: "10.77.0.9/24"})
	m.Leave()
	mustPhase(t, m, PhaseReady)
	if m.Name() != "laptop" || m.Tailnet() != "" || m.MeshIP() != "" || m.WantsNode() {
		t.Fatalf("leave must keep the name and forget the tailnet")
	}
}

func TestUnknownStatusIsAProblem(t *testing.T) {
	m := NewMachine("laptop", nil)
	m.JoinSent("demo.eth", "j1")
	m.JoinUpdate(Join{ID: "j1", Status: "weird"})
	mustPhase(t, m, PhaseError)
	if m.Base() != PhasePending {
		t.Fatalf("an unknown status must not move the base phase")
	}
}
