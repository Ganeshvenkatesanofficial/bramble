package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Ganeshvenkatesanofficial/bramble/brambled/wgnode"
)

// Store owns every file the daemon keeps under its data directory
// (default ~/.bramble, mode 0700). It holds identity only: the device key,
// the chosen name, the pending join id and the admin token. Peer
// authorization, ACLs and grants never touch disk; brambled reads them from
// ENS on every sync (invariant 3, docs/adr/0010).
type Store struct {
	Dir string
}

// Identity is this device's own key and name.
type Identity struct {
	Name          string    `json:"name,omitempty"`
	PrivateKeyHex string    `json:"privateKey"`
	CreatedAt     time.Time `json:"createdAt"`
}

// PublicKeyHex derives the WireGuard public key from the stored private key.
func (i Identity) PublicKeyHex() (string, error) {
	return wgnode.PublicKeyFromPrivateHex(i.PrivateKeyHex)
}

// JoinRecord remembers which join request this device is waiting on. Its
// status is never stored: the daemon asks the join API again after every
// restart.
type JoinRecord struct {
	Tailnet string `json:"tailnet"`
	JoinID  string `json:"joinId"`
}

const (
	identityFile   = "identity.json"
	joinFile       = "join.json"
	adminTokenFile = "admin.token"
	configURLFile  = "config.url"
	uiURLFile      = "ui.url"
	pidFile        = "bramble.pid"
	logDir         = "logs"
)

// DefaultDir is $BRAMBLE_HOME, or ~/.bramble.
func DefaultDir() (string, error) {
	if v := os.Getenv("BRAMBLE_HOME"); v != "" {
		return v, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("finding the home directory: %w", err)
	}
	return filepath.Join(home, ".bramble"), nil
}

// Ensure creates the data directory with mode 0700.
func (s *Store) Ensure() error {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return fmt.Errorf("creating %s: %w", s.Dir, err)
	}
	return os.Chmod(s.Dir, 0o700)
}

func (s *Store) path(name string) string { return filepath.Join(s.Dir, name) }

// writeFile writes atomically (temp file, then rename) with mode 0600.
func (s *Store) writeFile(name string, data []byte) error {
	if err := s.Ensure(); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.Dir, "."+name+".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.path(name))
}

func (s *Store) readJSON(name string, v any) (bool, error) {
	data, err := os.ReadFile(s.path(name))
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(data, v); err != nil {
		return false, fmt.Errorf("reading %s: %w", s.path(name), err)
	}
	return true, nil
}

func (s *Store) writeJSON(name string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return s.writeFile(name, append(data, '\n'))
}

func (s *Store) remove(name string) error {
	err := os.Remove(s.path(name))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// LoadOrCreateIdentity returns the stored identity, generating and saving a
// fresh WireGuard key on first run.
func (s *Store) LoadOrCreateIdentity() (Identity, error) {
	var id Identity
	ok, err := s.readJSON(identityFile, &id)
	if err != nil {
		return Identity{}, err
	}
	if ok && id.PrivateKeyHex != "" {
		if _, err := id.PublicKeyHex(); err != nil {
			return Identity{}, fmt.Errorf("the device key in %s is unreadable: %w", s.path(identityFile), err)
		}
		return id, nil
	}
	priv, _, err := wgnode.GenerateKeyPair()
	if err != nil {
		return Identity{}, err
	}
	id = Identity{PrivateKeyHex: priv, CreatedAt: time.Now().UTC()}
	return id, s.writeJSON(identityFile, id)
}

// SaveIdentity overwrites the identity file.
func (s *Store) SaveIdentity(id Identity) error { return s.writeJSON(identityFile, id) }

// LoadJoin returns the remembered join request, if any.
func (s *Store) LoadJoin() (*JoinRecord, error) {
	var j JoinRecord
	ok, err := s.readJSON(joinFile, &j)
	if err != nil || !ok || j.JoinID == "" {
		return nil, err
	}
	return &j, nil
}

// SaveJoin remembers a join request.
func (s *Store) SaveJoin(j JoinRecord) error { return s.writeJSON(joinFile, j) }

// ClearJoin forgets the join request.
func (s *Store) ClearJoin() error { return s.remove(joinFile) }

// AdminToken returns the saved admin token, or "" when there is none.
func (s *Store) AdminToken() string {
	data, err := os.ReadFile(s.path(adminTokenFile))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// SaveAdminToken stores the admin token with mode 0600.
func (s *Store) SaveAdminToken(token string) error {
	return s.writeFile(adminTokenFile, []byte(strings.TrimSpace(token)+"\n"))
}

// ClearAdminToken removes the admin token.
func (s *Store) ClearAdminToken() error { return s.remove(adminTokenFile) }

// ConfigURL returns the saved node-config URL, or "".
func (s *Store) ConfigURL() string {
	data, err := os.ReadFile(s.path(configURLFile))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// SaveConfigURL remembers where the node config comes from.
func (s *Store) SaveConfigURL(u string) error { return s.writeFile(configURLFile, []byte(u+"\n")) }

// UIURL returns the URL a running daemon wrote, or "".
func (s *Store) UIURL() string {
	data, err := os.ReadFile(s.path(uiURLFile))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// SaveRuntime records the running daemon's UI URL and process id.
func (s *Store) SaveRuntime(uiURL string, pid int) error {
	if err := s.writeFile(uiURLFile, []byte(uiURL+"\n")); err != nil {
		return err
	}
	return s.writeFile(pidFile, []byte(fmt.Sprintf("%d\n", pid)))
}

// ClearRuntime removes the UI URL and pid files.
func (s *Store) ClearRuntime() {
	_ = s.remove(uiURLFile)
	_ = s.remove(pidFile)
}

// PID returns the running daemon's process id, or 0.
func (s *Store) PID() int {
	data, err := os.ReadFile(s.path(pidFile))
	if err != nil {
		return 0
	}
	var pid int
	if _, err := fmt.Sscanf(strings.TrimSpace(string(data)), "%d", &pid); err != nil {
		return 0
	}
	return pid
}

// OpenLog truncates and opens a log file under logs/.
func (s *Store) OpenLog(name string) (*os.File, error) {
	dir := s.path(logDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
}

// RemoveAll deletes the whole data directory (bramble uninstall).
func (s *Store) RemoveAll() error { return os.RemoveAll(s.Dir) }
