package daemon

import "syscall"

// childProcAttr makes the kernel stop brambled if the daemon dies without
// cleaning up, so no orphaned node keeps the device on the mesh.
func childProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
}
