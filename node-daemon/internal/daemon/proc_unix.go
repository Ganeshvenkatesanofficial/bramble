//go:build unix

package daemon

import "syscall"

// signalGroup signals every process in the group led by pid: brambled and
// the sidecar it spawned.
func signalGroup(pid int, sig syscall.Signal) { _ = syscall.Kill(-pid, sig) }
