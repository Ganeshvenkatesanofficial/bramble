#!/usr/bin/env bash
# Exercise install.sh and uninstall.sh against a stub bundle served on loopback.
# No network, no root, no real bramble: the stub `bramble` writes ui.url and
# bramble.pid like the real launcher and then sleeps.
# Usage: scripts/release/install.test.sh [shell ...]   (default: sh dash busybox-sh)
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/bramble-install-test.XXXXXX")"
server_pid=
daemon_pids=()
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null
  for p in "${daemon_pids[@]}"; do kill "$p" 2>/dev/null || true; done
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
# Like the real launcher, refuse to run without a subcommand.
[ "$1" = up ] || { echo "usage: bramble up ..." >&2; exit 2; }
d="${BRAMBLE_HOME:?}"
mkdir -p "$d"
printf '%s\n' "$*" > "$d/start-args"
echo $$ > "$d/bramble.pid"
echo "http://127.0.0.1:7777/" > "$d/ui.url"
while :; do sleep 1; done
EOF
printf '#!/bin/sh\nexit 0\n' > "$work/stub/bramble-sidecar"
printf '#!/bin/sh\nexit 0\n' > "$work/stub/brambled"
chmod 755 "$work/stub/bramble" "$work/stub/brambled" "$work/stub/bramble-sidecar"
tar -C "$work/stub" -czf "$work/site/dl/$tarball" bramble brambled bramble-sidecar
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
  [ -x "$home/bin/bramble" ] && [ -x "$home/bin/brambled" ] && [ -x "$home/bin/bramble-sidecar" ] && ok "$sh: binaries installed and executable" || bad "$sh: binaries missing"
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
  [ -z "$newpid" ] || daemon_pids+=("$newpid")
  if [ "$rc" -eq 0 ] && [ "$newpid" != "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then ok "$sh: reinstall stops the old process and starts a new one"; else bad "$sh: reinstall misbehaved (rc=$rc old=$pid new=$newpid)"; echo "$out2"; fi

  # A stale PID must not stop an unrelated process, even while our daemon runs.
  sleep 60 &
  unrelated=$!
  printf '%s\n' "$unrelated" > "$home/bramble.pid"
  HOME="$work" BRAMBLE_HOME="$home" $sh "$here/uninstall.sh" --yes >/dev/null 2>&1; rc=$?
  for _ in {1..20}; do kill -0 "$newpid" 2>/dev/null || break; sleep 0.1; done
  if [ "$rc" -eq 0 ] && [ ! -e "$home" ] && ! kill -0 "$newpid" 2>/dev/null; then ok "$sh: uninstall removes the data dir and stops bramble"; else bad "$sh: uninstall left state (rc=$rc)"; fi
  if kill -0 "$unrelated" 2>/dev/null; then ok "$sh: stale PID leaves an unrelated process alive"; else bad "$sh: stale PID stopped an unrelated process"; fi
  kill "$unrelated" 2>/dev/null || true
  wait "$unrelated" 2>/dev/null || true
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
mkdir -p "$work/home-yes/bin"
cp "$work/stub/bramble" "$work/home-yes/bin/bramble"
echo "$base/.well-known/bramble.json" > "$work/home-yes/config.url"
# setsid drops the controlling terminal so this also holds when the test is run by hand.
detach=; command -v setsid >/dev/null 2>&1 && detach=setsid
for sh in sh dash; do
  command -v "$sh" >/dev/null 2>&1 || continue
  out="$(HOME="$work" BRAMBLE_HOME="$work/home-yes" $detach "$sh" "$here/uninstall.sh" </dev/null 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && [ -d "$work/home-yes" ] && echo "$out" | grep -q -- "--yes"; then ok "$sh: uninstall without --yes and without a terminal removes nothing and says to use --yes"; else bad "$sh: uninstall without a terminal gave rc=$rc: $out"; fi
done

# Uninstall refuses HOME itself.
out="$(HOME="$work" BRAMBLE_HOME="$work" sh "$here/uninstall.sh" --yes 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && [ -d "$work/site" ] && ok "uninstall refuses to delete \$HOME" || bad "uninstall accepted \$HOME as BRAMBLE_HOME"

echo '{"version":"test","tailnet":"demo-net.eth"}' > "$work/site/.well-known/bramble.json"
for sh in "${shells[@]}"; do
  home="$work/keep-data"
  run_install "$sh" "$home" --no-start >/dev/null 2>&1
  echo identity > "$home/device-key.fixture"
  HOME="$work" BRAMBLE_HOME="$home" $sh "$here/uninstall.sh" --yes --keep-data >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 0 ] && [ ! -e "$home/bin" ] && [ -f "$home/device-key.fixture" ]; then ok "$sh: keep-data preserves identity and removes binaries"; else bad "$sh: keep-data failed"; fi
  HOME="$work" BRAMBLE_HOME="$home" $sh "$here/uninstall.sh" --yes >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 0 ] && [ ! -e "$home" ]; then ok "$sh: full uninstall after keep-data removes remaining installation"; else bad "$sh: full uninstall after keep-data failed"; fi
done

# TUN startup follows the capability result; these fixtures never call real sudo.
if [ "$os" = linux ]; then
  mkdir -p "$work/fake-cap"
  printf '#!/bin/sh\nexec "$@"\n' > "$work/fake-cap/sudo"
  printf '#!/bin/sh\nexit "${FAKE_CAP_EXIT:-0}"\n' > "$work/fake-cap/setcap"
  chmod +x "$work/fake-cap/sudo" "$work/fake-cap/setcap"
  for cap_exit in 0 1; do
    home="$work/tun-$cap_exit"
    PATH="$work/fake-cap:$PATH" FAKE_CAP_EXIT="$cap_exit" run_install sh "$home" --tun >/dev/null 2>&1
    daemon_pids+=("$(cat "$home/bramble.pid")")
    expected='up -open=false'
    [ "$cap_exit" -ne 0 ] || expected="$expected -tun"
    if [ "$(cat "$home/start-args")" = "$expected" ]; then ok "TUN capability result $cap_exit selects correct startup mode"; else bad "TUN capability result $cap_exit selects wrong startup mode"; fi
  done
fi

# Every alias of the user's home is protected, including physical symlinks.
for suffix in / // /. /child/..; do
  guard="$work/guard-home"
  mkdir -p "$guard/child" "$guard/bin"
  cp "$work/stub/bramble" "$guard/bin/bramble"
  printf '%s\n' "$base/.well-known/bramble.json" > "$guard/config.url"
  echo keep > "$guard/document"
  out="$(HOME="$guard" BRAMBLE_HOME="$guard$suffix" sh "$here/uninstall.sh" --yes 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && [ -f "$guard/document" ]; then ok "uninstall protects HOME$suffix"; else bad "uninstall removed HOME$suffix"; fi
done

guard="$work/unrelated-directory"
mkdir -p "$guard"
echo keep > "$guard/document"
HOME="$work" BRAMBLE_HOME="$guard" sh "$here/uninstall.sh" --yes >/dev/null 2>&1; rc=$?
if [ "$rc" -ne 0 ] && [ -f "$guard/document" ]; then ok "uninstall refuses directories without installation evidence"; else bad "uninstall removed an unrelated directory"; fi
ln -s "$work/guard-home" "$work/home-alias"
HOME="$work/guard-home" BRAMBLE_HOME="$work/home-alias" sh "$here/uninstall.sh" --yes >/dev/null 2>&1; rc=$?
if [ "$rc" -ne 0 ] && [ -f "$work/guard-home/document" ]; then ok "uninstall protects a symlink alias of HOME"; else bad "uninstall removed a HOME symlink target"; fi

# Refuse ambiguous HTTP authorities before curl can make any request.
mkdir -p "$work/fake-curl"
printf '#!/bin/sh\nexit 91\n' > "$work/fake-curl/curl"
chmod +x "$work/fake-curl/curl"
for url in 'http://localhost:80@example.com' 'http://127.0.0.1:80@example.com' 'http://localhost:80.evil.example' 'http://localhost:abc' 'http://localhost:80/path' 'http://localhost:80?redirect=x'; do
  out="$(PATH="$work/fake-curl:$PATH" BRAMBLE_INSTALL_BASE="$url" sh "$here/install.sh" --no-start 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && echo "$out" | grep -q 'non-https'; then ok "installer refuses ambiguous HTTP authority: $url"; else bad "installer accepted ambiguous HTTP authority: $url"; fi
done

# Discover a real executable inside bin even when the PID file is invalid.
# This also exercises paths with spaces and regex metacharacters.
for invalid_pid in 0 -1 000; do
  home="$work/native install.[test]"
  mkdir -p "$home/bin"
  cp "$(command -v sh)" "$home/bin/bramble"
  echo "$base/.well-known/bramble.json" > "$home/config.url"
  "$home/bin/bramble" -c 'while :; do sleep 1; done' &
  native_pid=$!
  daemon_pids+=("$native_pid")
  sleep 0.1
  kill -0 "$native_pid" 2>/dev/null || bad "native executable fixture did not start"
  echo "$invalid_pid" > "$home/bramble.pid"
  HOME="$work" BRAMBLE_HOME="$home" sh "$here/uninstall.sh" --yes >/dev/null 2>&1; rc=$?
  for _ in {1..20}; do kill -0 "$native_pid" 2>/dev/null || break; sleep 0.1; done
  if [ "$rc" -eq 0 ] && ! kill -0 "$native_pid" 2>/dev/null && [ ! -e "$home" ]; then ok "uninstall ignores PID $invalid_pid and stops the installed executable"; else bad "uninstall mishandled PID $invalid_pid or the installed executable"; fi
  wait "$native_pid" 2>/dev/null || true
done

# A daemon that outlives an update runs from a replaced (deleted) binary. Install
# replaces files with cp then mv -f, so mimic that. Linux-only: needs /proc.
if [ -d /proc ]; then
  home="$work/deleted-binary"
  mkdir -p "$home/bin"
  cp "$(command -v sh)" "$home/bin/bramble"
  echo "$base/.well-known/bramble.json" > "$home/config.url"
  "$home/bin/bramble" -c 'while :; do sleep 1; done' &
  deleted_pid=$!
  daemon_pids+=("$deleted_pid")
  sleep 0.1
  cp "$(command -v sh)" "$home/bin/bramble.new" && mv -f "$home/bin/bramble.new" "$home/bin/bramble"
  case "$(readlink "/proc/$deleted_pid/exe" 2>/dev/null)" in
    *" (deleted)") ;;
    *) bad "deleted-binary fixture precondition: exe link was not marked deleted" ;;
  esac
  echo "$deleted_pid" > "$home/bramble.pid"
  # An unrelated process whose PID is not under bin/ must survive the same run.
  sh -c 'while :; do sleep 1; done' &
  bystander_pid=$!
  daemon_pids+=("$bystander_pid")
  HOME="$work" BRAMBLE_HOME="$home" sh "$here/uninstall.sh" --yes >/dev/null 2>&1; rc=$?
  for _ in {1..20}; do kill -0 "$deleted_pid" 2>/dev/null || break; sleep 0.1; done
  if [ "$rc" -eq 0 ] && ! kill -0 "$deleted_pid" 2>/dev/null && [ ! -e "$home" ]; then ok "uninstall stops a daemon running from a replaced (deleted) binary"; else bad "uninstall left a daemon running from a replaced (deleted) binary"; fi
  if kill -0 "$bystander_pid" 2>/dev/null; then ok "uninstall leaves an unrelated process alone in the deleted-binary case"; else bad "uninstall killed an unrelated process in the deleted-binary case"; fi
  kill "$deleted_pid" "$bystander_pid" 2>/dev/null || true
  wait "$deleted_pid" "$bystander_pid" 2>/dev/null || true
fi

home="$work/script-ownership"
run_install sh "$home" --no-start >/dev/null 2>&1
printf '#!/bin/sh\nwhile :; do sleep 1; done\n' > "$work/outside-helper"
sh "$home/bin/../../outside-helper" &
outside_pid=$!
daemon_pids+=("$outside_pid")
sleep 0.1
HOME="$work" BRAMBLE_HOME="$home" sh "$here/uninstall.sh" --yes >/dev/null 2>&1
if kill -0 "$outside_pid" 2>/dev/null; then ok "uninstall preserves a script outside bin reached through dot segments"; else bad "uninstall stopped a script outside bin"; fi
kill "$outside_pid" 2>/dev/null || true
wait "$outside_pid" 2>/dev/null || true

exit "$fail"
