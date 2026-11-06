package daemon

import (
	"errors"
	"fmt"
)

// Phase is the device's onboarding phase, as GET /api/state reports it.
type Phase string

const (
	PhaseSetup     Phase = "setup"
	PhaseReady     Phase = "ready"
	PhasePending   Phase = "pending"
	PhaseApproved  Phase = "approved"
	PhaseDenied    Phase = "denied"
	PhaseConnected Phase = "connected"
	PhaseError     Phase = "error"
)

// ErrorInfo is a problem in plain words plus what the person should do next.
type ErrorInfo struct {
	Message  string `json:"message"`
	NextStep string `json:"nextStep"`
}

func (e *ErrorInfo) Error() string { return e.Message }

// Peer is one row of GET /api/state's peers list.
type Peer struct {
	Label         string  `json:"label"`
	MeshIP        string  `json:"meshIp"`
	Path          string  `json:"path"` // direct, relay or none
	LastHandshake *string `json:"lastHandshake"`
	RTTMs         *int64  `json:"rttMs,omitempty"`
}

// Machine is the setup and join state machine. It is pure: it never does
// I/O. The daemon feeds it events (a POST from the UI, a join status, a node
// health report) and acts on what it reports (WantsNode, WantsPolling).
//
// The reported phase is the base phase, unless a problem is set; then it is
// "error" with that problem. Every successful event clears the problem, so a
// transient failure (the approval service is unreachable for a minute)
// recovers on its own.
type Machine struct {
	base    Phase
	name    string
	tailnet string
	joinID  string
	meshIP  string
	peers   []Peer
	problem *ErrorInfo
}

// ErrBusy rejects a command that does not fit the current phase.
var ErrBusy = errors.New("busy")

// NewMachine restores the machine from the stored identity and join record.
// A stored join always restarts as pending: its real status is asked again.
func NewMachine(name string, join *JoinRecord) *Machine {
	m := &Machine{base: PhaseSetup, name: name}
	if name != "" {
		m.base = PhaseReady
	}
	if name != "" && join != nil {
		m.base = PhasePending
		m.tailnet = join.Tailnet
		m.joinID = join.JoinID
	}
	return m
}

// Phase is the phase GET /api/state reports.
func (m *Machine) Phase() Phase {
	if m.problem != nil {
		return PhaseError
	}
	return m.base
}

// Base is the phase underneath any problem.
func (m *Machine) Base() Phase { return m.base }

func (m *Machine) Name() string        { return m.name }
func (m *Machine) Tailnet() string     { return m.tailnet }
func (m *Machine) JoinID() string      { return m.joinID }
func (m *Machine) MeshIP() string      { return m.meshIP }
func (m *Machine) Problem() *ErrorInfo { return m.problem }

// Peers returns a copy of the current peer list.
func (m *Machine) Peers() []Peer {
	out := make([]Peer, len(m.peers))
	copy(out, m.peers)
	return out
}

func busy(msg, next string) error {
	return fmt.Errorf("%w: %w", ErrBusy, &ErrorInfo{Message: msg, NextStep: next})
}

// Setup sets the device name. Allowed before joining and after a denial.
func (m *Machine) Setup(name string) error {
	if !LabelRE.MatchString(name) {
		return &ErrorInfo{
			Message:  fmt.Sprintf("%q cannot be used as a device name.", name),
			NextStep: "Use 1 to 63 lowercase letters, digits or hyphens, starting and ending with a letter or digit.",
		}
	}
	switch m.base {
	case PhaseSetup, PhaseReady, PhaseDenied:
	default:
		return busy("This device already belongs to a tailnet or is waiting to join one.", "Leave the tailnet first, then rename the device.")
	}
	m.name = name
	if m.base == PhaseSetup {
		m.base = PhaseReady
	}
	m.problem = nil
	return nil
}

// CanJoin reports whether a join request may be sent now.
func (m *Machine) CanJoin() error {
	switch m.base {
	case PhaseSetup:
		return busy("This device has no name yet.", "Choose a name for this device first.")
	case PhasePending:
		return busy("This device is already waiting for approval.", "Wait for the admin, or leave to cancel the request.")
	case PhaseApproved, PhaseConnected:
		return busy("This device already belongs to a tailnet.", "Leave the tailnet first.")
	}
	return nil
}

// JoinSent records a join request the approval service accepted.
func (m *Machine) JoinSent(tailnet, joinID string) {
	m.base = PhasePending
	m.tailnet = tailnet
	m.joinID = joinID
	m.meshIP = ""
	m.peers = nil
	m.problem = nil
}

// JoinUpdate applies a status from GET /api/joins/:id. Updates for another
// request id, or in a phase that is not waiting on a request, are ignored.
func (m *Machine) JoinUpdate(j Join) {
	if j.ID != m.joinID {
		return
	}
	switch m.base {
	case PhasePending, PhaseApproved, PhaseConnected:
	default:
		return
	}
	m.problem = nil
	switch j.Status {
	case JoinPending:
		// still waiting
	case JoinApproved:
		if j.MeshIP != "" {
			m.meshIP = j.MeshIP
		}
		if m.base == PhasePending {
			m.base = PhaseApproved
		}
	case JoinDenied:
		m.base = PhaseDenied
		m.joinID = ""
		m.meshIP = ""
		m.peers = nil
	case JoinRevoked:
		tailnet := m.tailnet
		m.base = PhaseReady
		m.joinID = ""
		m.meshIP = ""
		m.peers = nil
		m.problem = &ErrorInfo{
			Message:  fmt.Sprintf("An admin removed this device from %s.", tailnet),
			NextStep: fmt.Sprintf("Ask the admin of %s to let it back in, then press Join again.", tailnet),
		}
	default:
		m.problem = &ErrorInfo{
			Message:  fmt.Sprintf("The approval service sent an unknown status %q.", j.Status),
			NextStep: "Update Bramble, or ask the tailnet admin which version to use.",
		}
	}
}

// JoinLost handles a join id the approval service no longer knows. While
// pending the request is gone, so the person must ask again. Once approved,
// the device is enrolled on chain, and ENS, not the join API, decides
// whether peers admit it, so the node keeps running.
func (m *Machine) JoinLost() {
	if m.base != PhasePending {
		return
	}
	m.base = PhaseReady
	m.joinID = ""
	m.problem = &ErrorInfo{
		Message:  "The approval service no longer has this join request. It most likely restarted.",
		NextStep: "Press Join to send the request again.",
	}
}

// SetProblem sets a problem without changing the base phase.
func (m *Machine) SetProblem(p ErrorInfo) { m.problem = &p }

// ClearProblem removes the current problem.
func (m *Machine) ClearProblem() { m.problem = nil }

// PeersUpdate applies a node health report. A reachable peer (path other
// than "none") means connected; otherwise the device is approved and still
// waiting for a peer to answer.
func (m *Machine) PeersUpdate(peers []Peer) {
	if m.base != PhaseApproved && m.base != PhaseConnected {
		return
	}
	m.problem = nil
	m.peers = append([]Peer(nil), peers...)
	m.base = PhaseApproved
	for _, p := range peers {
		if p.Path != "none" {
			m.base = PhaseConnected
			break
		}
	}
}

// NodeDown records that the local node stopped or is not answering. The
// base phase drops back to approved so the supervisor keeps retrying.
func (m *Machine) NodeDown(p ErrorInfo) {
	if m.base != PhaseApproved && m.base != PhaseConnected {
		return
	}
	m.base = PhaseApproved
	m.peers = nil
	m.problem = &p
}

// Leave forgets the tailnet. The device keeps its key and name.
func (m *Machine) Leave() {
	m.base = PhaseReady
	if m.name == "" {
		m.base = PhaseSetup
	}
	m.tailnet = ""
	m.joinID = ""
	m.meshIP = ""
	m.peers = nil
	m.problem = nil
}

// WantsNode reports whether the local node (brambled) should be running.
func (m *Machine) WantsNode() bool {
	return m.base == PhaseApproved || m.base == PhaseConnected
}

// WantsPolling reports whether the join status should be polled. Polling
// continues after approval so a revocation shows up in the UI.
func (m *Machine) WantsPolling() bool {
	if m.joinID == "" {
		return false
	}
	return m.base == PhasePending || m.base == PhaseApproved || m.base == PhaseConnected
}
