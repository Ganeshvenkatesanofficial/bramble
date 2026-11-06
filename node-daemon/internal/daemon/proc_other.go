//go:build unix && !linux

package daemon

import "syscall"

// childProcAttr puts brambled in its own process group, so stopping it also
// stops its sidecar. There is no parent-death signal outside Linux.
func childProcAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setpgid: true} }
