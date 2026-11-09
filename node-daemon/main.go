// bramble is the on-device Bramble daemon (ETH-177): it owns the device key
// and local state under ~/.bramble, serves the local web UI and control API
// on 127.0.0.1, runs the join flow against the tailnet's approval service,
// and supervises brambled serve once the device is approved.
//
// It lives outside brambled/ on purpose: invariant 3 forbids local-state
// writes in brambled and the sidecar, and the daemon is where the device's
// identity files live (ETH-177 spec D1). Peer authorization still comes
// only from ENS, read by brambled on every sync.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/Ganeshvenkatesanofficial/bramble/node-daemon/internal/daemon"
	"github.com/Ganeshvenkatesanofficial/bramble/node-daemon/ui"
)

// version is set by the release build with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "up":
		err = runUp(os.Args[2:])
	case "down":
		err = runDown()
	case "status":
		err = runStatus()
	case "open":
		err = runOpen()
	case "admin":
		err = runAdmin(os.Args[2:])
	case "uninstall":
		err = runUninstall(os.Args[2:])
	case "version":
		fmt.Println(version)
	case "help", "-h", "--help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "bramble:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `usage:
  bramble up [-config <install host or URL>] [-port 7777] [-d] [-open=true] [-tun]
  bramble down
  bramble status
  bramble open
  bramble admin login | logout
  bramble uninstall [-y]
  bramble version
`)
}

func store() (*daemon.Store, error) {
	dir, err := daemon.DefaultDir()
	if err != nil {
		return nil, err
	}
	return &daemon.Store{Dir: dir}, nil
}

// running returns the UI URL of a daemon that answers, or "".
func running(s *daemon.Store) string {
	u := s.UIURL()
	if u == "" {
		return ""
	}
	c := &http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(u + "/api/state")
	if err != nil {
		return ""
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	return u
}

func runUp(args []string) error {
	fs := flag.NewFlagSet("up", flag.ContinueOnError)
	configURL := fs.String("config", os.Getenv("BRAMBLE_CONFIG_URL"), "install host (https://host) or full node-config URL; saved for later runs")
	port := fs.Int("port", 7777, "preferred local UI port; the next free port is used if taken")
	detach := fs.Bool("d", false, "run in the background and return once the UI answers")
	openUI := fs.Bool("open", true, "open the UI in a browser")
	tun := fs.Bool("tun", false, "use a real WireGuard interface (needs root or cap_net_admin on brambled) instead of the default userspace mode")
	if err := fs.Parse(args); err != nil {
		return err
	}
	s, err := store()
	if err != nil {
		return err
	}
	if err := s.Ensure(); err != nil {
		return err
	}
	if u := running(s); u != "" {
		fmt.Printf("Bramble is already running: %s\n", u)
		if *openUI {
			openBrowser(u)
		}
		return nil
	}
	if *configURL != "" {
		if err := s.SaveConfigURL(daemon.NormalizeConfigURL(*configURL)); err != nil {
			return err
		}
	}
	if *detach {
		return detachUp(s, args, *openUI)
	}

	brambled, err := daemon.FindBrambled()
	if err != nil {
		return fmt.Errorf("%w; reinstall Bramble", err)
	}
	logger := log.New(os.Stderr, "bramble: ", log.LstdFlags)
	d := &daemon.Daemon{Store: s, ConfigURL: s.ConfigURL(), Brambled: brambled, TUN: *tun, Logger: logger}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := d.Init(ctx); err != nil {
		return err
	}
	ln, boundPort, err := daemon.Listen(*port)
	if err != nil {
		return err
	}
	srv := &daemon.Server{Daemon: d, UI: ui.FS(), Port: boundPort}
	httpSrv := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	uiURL := fmt.Sprintf("http://127.0.0.1:%d", boundPort)
	if err := s.SaveRuntime(uiURL, os.Getpid()); err != nil {
		return err
	}
	defer s.ClearRuntime()

	go func() {
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Printf("UI server stopped: %v", err)
			stop()
		}
	}()
	fmt.Printf("Bramble is running: %s\n", uiURL)
	if !ui.Built() {
		logger.Printf("serving the placeholder page (no UI build embedded)")
	}
	if *openUI {
		openBrowser(uiURL)
	}
	d.Run(ctx)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
	return nil
}

// detachUp starts `bramble up` in its own session with output in
// logs/bramble.log, then waits for its UI to answer.
func detachUp(s *daemon.Store, args []string, openUI bool) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	var childArgs []string
	for _, a := range args {
		if a != "-d" && a != "--d" && a != "-d=true" {
			childArgs = append(childArgs, a)
		}
	}
	childArgs = append([]string{"up", "-open=false"}, childArgs...)
	logFile, err := s.OpenLog("bramble.log")
	if err != nil {
		return err
	}
	defer logFile.Close()
	cmd := exec.Command(self, childArgs...)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if u := running(s); u != "" {
			fmt.Printf("Bramble is running: %s\n", u)
			if openUI {
				openBrowser(u)
			}
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("bramble did not start; see %s/logs/bramble.log", s.Dir)
}

func openBrowser(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", u)
	case "linux":
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return
		}
		cmd = exec.Command("xdg-open", u)
	default:
		return
	}
	_ = cmd.Start()
}

func runDown() error {
	s, err := store()
	if err != nil {
		return err
	}
	pid := s.PID()
	if pid == 0 {
		fmt.Println("Bramble is not running.")
		return nil
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := p.Signal(syscall.SIGTERM); err != nil {
		s.ClearRuntime()
		fmt.Println("Bramble is not running.")
		return nil
	}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if p.Signal(syscall.Signal(0)) != nil {
			fmt.Println("Bramble stopped.")
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("bramble (pid %d) did not stop within 30 s", pid)
}

func runStatus() error {
	s, err := store()
	if err != nil {
		return err
	}
	u := running(s)
	if u == "" {
		fmt.Println("Bramble is not running. Start it with `bramble up`.")
		return nil
	}
	resp, err := http.Get(u + "/api/state")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var st daemon.State
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		return err
	}
	fmt.Printf("UI:          %s\n", u)
	fmt.Printf("Device:      %s (%s)\n", orDash(st.Name), st.Fingerprint)
	fmt.Printf("Status:      %s\n", st.Phase)
	if st.Tailnet != "" {
		fmt.Printf("Tailnet:     %s\n", st.Tailnet)
	}
	if st.MeshIP != "" {
		fmt.Printf("Mesh IP:     %s\n", st.MeshIP)
	}
	for _, p := range st.Peers {
		fmt.Printf("Peer:        %-20s %-15s %s\n", p.Label, p.MeshIP, p.Path)
	}
	if st.Error != nil {
		fmt.Printf("Problem:     %s\nNext step:   %s\n", st.Error.Message, st.Error.NextStep)
	}
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

func runOpen() error {
	s, err := store()
	if err != nil {
		return err
	}
	u := running(s)
	if u == "" {
		return fmt.Errorf("bramble is not running; start it with `bramble up`")
	}
	fmt.Println(u)
	openBrowser(u)
	return nil
}

func runAdmin(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: bramble admin login | logout")
	}
	s, err := store()
	if err != nil {
		return err
	}
	switch args[0] {
	case "logout":
		if err := s.ClearAdminToken(); err != nil {
			return err
		}
		fmt.Println("Admin access removed from this device.")
		return nil
	case "login":
	default:
		return fmt.Errorf("usage: bramble admin login | logout")
	}
	token, err := readSecret("Admin token: ")
	if err != nil {
		return err
	}
	if token == "" {
		return fmt.Errorf("no token entered")
	}
	if src := s.ConfigURL(); src != "" {
		if cfg, err := daemon.FetchNodeConfig(context.Background(), src); err == nil {
			switch checkAdminToken(cfg.JoinAPI, token) {
			case http.StatusOK:
			case http.StatusUnauthorized, http.StatusForbidden:
				return fmt.Errorf("the approval service did not accept that token; check it and try again")
			default:
				fmt.Fprintln(os.Stderr, "Could not check the token with the approval service; saving it anyway.")
			}
		}
	}
	if err := s.SaveAdminToken(token); err != nil {
		return err
	}
	fmt.Println("Admin access saved on this device. The Bramble page now shows the admin view.")
	return nil
}

// checkAdminToken asks the join API's token-gated list route. It returns
// the HTTP status, or 0 if the service could not be reached.
func checkAdminToken(joinAPI, token string) int {
	req, err := http.NewRequest(http.MethodGet, joinAPI+"/api/joins", nil)
	if err != nil {
		return 0
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return 0
	}
	resp.Body.Close()
	return resp.StatusCode
}

// readSecret reads one line without echo when stdin is a terminal.
func readSecret(prompt string) (string, error) {
	isTTY := false
	if st, err := os.Stdin.Stat(); err == nil && st.Mode()&os.ModeCharDevice != 0 {
		isTTY = true
	}
	if isTTY {
		fmt.Fprint(os.Stderr, prompt)
		off := exec.Command("stty", "-echo")
		off.Stdin = os.Stdin
		if off.Run() == nil {
			defer func() {
				on := exec.Command("stty", "echo")
				on.Stdin = os.Stdin
				_ = on.Run()
				fmt.Fprintln(os.Stderr)
			}()
		}
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return strings.TrimSpace(line), nil
}

func runUninstall(args []string) error {
	fs := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	yes := fs.Bool("y", false, "do not ask for confirmation")
	if err := fs.Parse(args); err != nil {
		return err
	}
	s, err := store()
	if err != nil {
		return err
	}
	if !*yes {
		fmt.Printf("This stops Bramble and deletes %s, including this device's key. Continue? [y/N] ", s.Dir)
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		if a := strings.ToLower(strings.TrimSpace(line)); a != "y" && a != "yes" {
			fmt.Println("Nothing removed.")
			return nil
		}
	}
	if err := runDown(); err != nil {
		return err
	}
	if err := s.RemoveAll(); err != nil {
		return err
	}
	fmt.Printf("Removed %s.\n", s.Dir)
	fmt.Println("The device stays enrolled in its tailnet until an admin revokes it there.")
	return nil
}
