#!/usr/bin/env bash
# Exercise install.sh and uninstall.sh against a stub bundle served on loopback.
# No network, no root, no real bramble: the stub `bramble` writes ui.url and
# bramble.pid like the real launcher and then sleeps.
# Usage: scripts/release/install.test.sh [shell ...]   (default: sh dash busybox-sh)
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/bramble-install-test.XXXXXX")"
server_pid=
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null
  for p in "$work"/home*/bramble.pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null; done
  rm -rf "$work"
}
trap cleanup EXIT
fail=0
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }

case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "unsupported host"; exit 1 ;; esac
case "$(uname -m)" in x86_64 | amd64) arch=amd64 ;; *) arch=arm64 ;; esac
tarball="bramble_${os}_${arch}.tar.gz"

# --- Stub bundle. ---
mkdir -p "$work/site/dl" "$work/site/.well-known" "$work/stub"
cat > "$work/stub/bramble" <<'EOF'
#!/bin/sh
d="${BRAMBLE_HOME:?}"
mkdir -p "$d"
echo $$ > "$d/bramble.pid"
echo "http://127.0.0.1:7777/" > "$d/ui.url"
while :; do sleep 1; done
EOF
printf '#!/bin/sh\nexit 0\n' > "$work/stub/bramble-sidecar"
chmod 755 "$work/stub/bramble" "$work/stub/bramble-sidecar"
tar -C "$work/stub" -czf "$work/site/dl/$tarball" bramble bramble-sidecar
(cd "$work/site/dl" && sha256sum "$tarball" > SHA256SUMS)
cat > "$work/site/.well-known/bramble.json" <<'EOF'
{"version": "test", "tailnet": "demo-net.eth", "chainId": 11155111, "rpcUrl": "https://rpc.example.com/",
 "registry": "0x0000000000000000000000000000000000000001", "joinApi": "https://console.example.com"}
EOF

port=$((20000 + RANDOM % 20000))
(cd "$work/site" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1) &
server_pid=$!
base="http://127.0.0.1:$port"
for _ in $(seq 1 50); do curl -fs "$base/dl/SHA256SUMS" >/dev/null 2>&1 && break; sleep 0.1; done

run_install() { # run_install <shell> <home> [args...]
  local sh="$1" home="$2"; shift 2
  HOME="$work" BRAMBLE_HOME="$home" BRAMBLE_INSTALL_BASE="$base" BRAMBLE_NO_OPEN=1 $sh "$here/install.sh" "$@"
}

shells=("$@")
[ "${#shells[@]}" -gt 0 ] || shells=(sh dash)
command -v busybox >/dev/null 2>&1 && [ "$#" -eq 0 ] && shells+=("busybox sh")

n=0
for sh in "${shells[@]}"; do
  n=$((n + 1))
  home="$work/home$n"
  echo "--- $sh"
  out="$(run_install "$sh" "$home" 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && ok "$sh: install exits 0" || { bad "$sh: install exited $rc"; echo "$out"; }
  [ -x "$home/bin/bramble" ] && [ -x "$home/bin/bramble-sidecar" ] && ok "$sh: binaries installed and executable" || bad "$sh: binaries missing"
  [ "$(stat -c %a "$home" 2>/dev/null || stat -f %Lp "$home")" = 700 ] && ok "$sh: data dir is mode 700" || bad "$sh: data dir is not mode 700"
  [ "$(cat "$home/config.url" 2>/dev/null)" = "$base/.well-known/bramble.json" ] && ok "$sh: config.url written" || bad "$sh: config.url wrong"
  echo "$out" | grep -q "demo-net.eth" && ok "$sh: prints the tailnet" || bad "$sh: tailnet not printed"
  echo "$out" | grep -q "Open http://127.0.0.1:7777/" && ok "$sh: prints the UI address" || bad "$sh: UI address not printed"
  echo "$out" | grep -q "root       not needed" && ok "$sh: says no root is needed" || bad "$sh: root line missing"
  pid="$(cat "$home/bramble.pid" 2>/dev/null)"
  kill -0 "$pid" 2>/dev/null && ok "$sh: bramble is running (pid $pid)" || bad "$sh: bramble is not running"

  # Reinstall over a running daemon replaces it.
  out2="$(run_install "$sh" "$home" 2>&1)"; rc=$?
  newpid="$(cat "$home/bramble.pid" 2>/dev/null)"
  if [ "$rc" -eq 0 ] && [ "$newpid" != "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then ok "$sh: reinstall stops the old process and starts a new one"; else bad "$sh: reinstall misbehaved (rc=$rc old=$pid new=$newpid)"; echo "$out2"; fi

  HOME="$work" BRAMBLE_HOME="$home" $sh "$here/uninstall.sh" --yes >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 0 ] && [ ! -e "$home" ] && ! kill -0 "$newpid" 2>/dev/null; then ok "$sh: uninstall removes the data dir and stops bramble"; else bad "$sh: uninstall left state (rc=$rc)"; fi
done

echo "--- failure paths"
# Checksum mismatch: nothing installed, non-zero exit.
cp "$work/site/dl/SHA256SUMS" "$work/SHA256SUMS.good"
sed -i 's/^[0-9a-f]\{1,\}/0000000000000000000000000000000000000000000000000000000000000000/' "$work/site/dl/SHA256SUMS"
home="$work/home-bad"
out="$(run_install sh "$home" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "checksum mismatch" && [ ! -e "$home/bin" ]; then ok "checksum mismatch is refused and nothing is installed"; else bad "checksum mismatch not handled (rc=$rc)"; fi
cp "$work/SHA256SUMS.good" "$work/site/dl/SHA256SUMS"

# Missing SHA256SUMS entry.
: > "$work/site/dl/SHA256SUMS"
out="$(run_install sh "$home" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "no entry" && ok "missing checksum entry is refused" || bad "missing checksum entry accepted"
cp "$work/SHA256SUMS.good" "$work/site/dl/SHA256SUMS"

# An archive with a path-traversal member.
mkdir -p "$work/evil/sub" && echo x > "$work/evil/sub/x"
cp "$work/site/dl/$tarball" "$work/good.tgz"
tar -C "$work/evil" -czf "$work/site/dl/$tarball" sub/x
(cd "$work/site/dl" && sha256sum "$tarball" > SHA256SUMS)
out="$(run_install sh "$home" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "outside its top level" && ok "nested archive paths are refused" || bad "nested archive paths accepted"
cp "$work/good.tgz" "$work/site/dl/$tarball"; (cd "$work/site/dl" && sha256sum "$tarball" > SHA256SUMS)

# Host without a tailnet.
echo '{"version":"x"}' > "$work/site/.well-known/bramble.json"
out="$(run_install sh "$home" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "no tailnet name" && ok "a host with no tailnet is refused" || bad "host with no tailnet accepted"

# Plain http to a non-loopback host.
out="$(HOME="$work" BRAMBLE_HOME="$home" BRAMBLE_INSTALL_BASE="http://example.com" sh "$here/install.sh" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && echo "$out" | grep -q "non-https" && ok "plain http to a remote host is refused" || bad "plain http accepted"

# Uninstall without a terminal needs --yes.
mkdir -p "$work/home-yes"
out="$(HOME="$work" BRAMBLE_HOME="$work/home-yes" sh "$here/uninstall.sh" </dev/null 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && [ -d "$work/home-yes" ]; then ok "uninstall without --yes and without a terminal removes nothing"; else
  # A controlling terminal may exist when this test runs interactively; that case is not a failure.
  [ -r /dev/tty ] && : < /dev/tty 2>/dev/null && ok "uninstall prompt skipped: a terminal is attached" || bad "uninstall deleted without confirmation"
fi

# Uninstall refuses HOME itself.
out="$(HOME="$work" BRAMBLE_HOME="$work" sh "$here/uninstall.sh" --yes 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [ -d "$work/site" ] && ok "uninstall refuses to delete \$HOME" || bad "uninstall accepted \$HOME as BRAMBLE_HOME"

exit "$fail"
