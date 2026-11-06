//go:build !linux

package daemon

import "syscall"

// childProcAttr has no parent-death signal outside Linux; the daemon stops
// brambled itself on a normal shutdown.
func childProcAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{} }
