package sidecar

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), mode); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
}

func TestResolveCommand_PrefersExplicitBinary(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	explicit := filepath.Join(dir, "custom-sidecar")
	writeFile(t, explicit, 0o755)
	writeFile(t, filepath.Join(dir, BinaryName), 0o755)

	name, args, cwd, err := resolveCommand(Config{Binary: explicit, Dir: "../sidecar"}, filepath.Join(dir, "bramble"))
	if err != nil {
		t.Fatalf("resolveCommand: %v", err)
	}
	if name != explicit || len(args) != 0 || cwd != "" {
		t.Fatalf("got %q %v %q, want the explicit binary with no args and no dir", name, args, cwd)
	}
}

func TestResolveCommand_UsesRelativeExplicitBinaryWithoutPATH(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "custom-sidecar"), 0o755)
	t.Chdir(dir)
	t.Setenv("PATH", "/nonexistent")
	name, _, _, err := resolveCommand(Config{Binary: "custom-sidecar"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(name) {
		t.Fatalf("relative override %q would require a PATH lookup", name)
	}
}

func TestResolveCommand_RejectsMissingExplicitBinary(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, BinaryName), 0o755)

	_, _, _, err := resolveCommand(Config{Binary: filepath.Join(dir, "nope")}, filepath.Join(dir, "bramble"))
	if err == nil {
		t.Fatal("a wrong explicit path must be an error, not a silent fallback")
	}
}

func TestResolveCommand_FindsSidecarBesideExecutable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	beside := filepath.Join(dir, BinaryName)
	writeFile(t, beside, 0o755)

	name, args, cwd, err := resolveCommand(Config{Dir: "../sidecar"}, filepath.Join(dir, "bramble"))
	if err != nil {
		t.Fatalf("resolveCommand: %v", err)
	}
	if name != beside || len(args) != 0 || cwd != "" {
		t.Fatalf("got %q %v %q, want %q", name, args, cwd, beside)
	}
}

func TestResolveCommand_FallsBackToBunInDevLayout(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	name, args, cwd, err := resolveCommand(Config{Dir: "../sidecar"}, filepath.Join(dir, "brambled"))
	if err != nil {
		t.Fatalf("resolveCommand: %v", err)
	}
	if name != "bun" || len(args) != 2 || args[0] != "run" || args[1] != "src/index.ts" || cwd != "../sidecar" {
		t.Fatalf("got %q %v %q, want bun run src/index.ts in ../sidecar", name, args, cwd)
	}
}

func TestResolveCommand_IgnoresNonExecutableSidecarBesideExecutable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, BinaryName), 0o644)

	name, _, _, err := resolveCommand(Config{Dir: "../sidecar"}, filepath.Join(dir, "brambled"))
	if err != nil {
		t.Fatalf("resolveCommand: %v", err)
	}
	if name != "bun" {
		t.Fatalf("got %q, want the bun fallback for a file without the execute bit", name)
	}
}
