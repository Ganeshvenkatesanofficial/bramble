package daemon

import "syscall"

// childProcAttr puts brambled in its own process group, so stopping it also
// stops its sidecar, and asks the kernel to send it SIGTERM if the daemon
// dies without cleaning up.
func childProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGTERM}
}
