#!/bin/sh
# Bramble installer. Usage:
#   curl -fsSL https://@@BRAMBLE_INSTALL_HOST@@/install.sh | sh
#   curl -fsSL https://@@BRAMBLE_INSTALL_HOST@@/install.sh | sh -s -- --no-open
#
# Flags (or the BRAMBLE_* variable in brackets):
#   --no-start   install only; do not start bramble       [BRAMBLE_NO_START=1]
#   --no-open    start bramble but do not open a browser  [BRAMBLE_NO_OPEN=1]
#   --tun        Linux: grant brambled cap_net_admin with sudo so it can create a
#                real WireGuard interface (asks once; default is no root) [BRAMBLE_INSTALL_TUN=1]
#   --help
# Other variables: BRAMBLE_HOME (default ~/.bramble), BRAMBLE_INSTALL_BASE (override
# the base URL, for tests; https only unless the host is 127.0.0.1 or localhost).
#
# The publisher (deploy/scripts/publish-release.sh) replaces the host placeholder below.
set -eu

HOST="@@BRAMBLE_INSTALL_HOST@@"
BASE="${BRAMBLE_INSTALL_BASE:-https://$HOST}"
BASE="${BASE%/}"
HOME_DIR="${BRAMBLE_HOME:-$HOME/.bramble}"
BIN_DIR="$HOME_DIR/bin"

NO_START="${BRAMBLE_NO_START:-0}"
NO_OPEN="${BRAMBLE_NO_OPEN:-0}"
WANT_TUN="${BRAMBLE_INSTALL_TUN:-0}"
USE_TUN=0

say() { printf '%s\n' "$*"; }
warn() { printf 'bramble install: %s\n' "$*" >&2; }
die() { warn "$*"; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --no-start) NO_START=1 ;;
    --no-open) NO_OPEN=1 ;;
    --tun) WANT_TUN=1 ;;
    --help | -h)
      say "Usage: curl -fsSL $BASE/install.sh | sh -s -- [--no-start] [--no-open] [--tun]"
      exit 0 ;;
    *) die "unknown argument $arg (try --help)" ;;
  esac
done

case "$HOST" in
  @@* | "") [ -n "${BRAMBLE_INSTALL_BASE:-}" ] || die "this script has no install host baked in; fetch it from your install host's /install.sh" ;;
esac
case "$BASE" in
  https://*) ;;
  http://*)
    authority="${BASE#http://}"
    case "$authority" in
      127.0.0.1 | localhost) ;;
      127.0.0.1:* | localhost:*)
        port="${authority#*:}"
        case "$port" in
          '' | *[!0-9]*) die "refusing a non-https install URL; HTTP requires a loopback host and numeric port" ;;
        esac
        [ "${#port}" -le 5 ] && [ "$port" -gt 0 ] && [ "$port" -le 65535 ] ||
          die "refusing a non-https install URL; HTTP port must be 1-65535"
        ;;
      *) die "refusing a non-https install URL; HTTP requires a loopback host" ;;
    esac
    ;;
  *) die "refusing a non-https install URL" ;;
esac

# --- What this machine is. ---
case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) die "unsupported operating system $(uname -s); Bramble supports Linux and macOS" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "unsupported CPU $(uname -m); Bramble supports amd64 and arm64" ;;
esac
TARBALL="bramble_${OS}_${ARCH}.tar.gz"

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v tar >/dev/null 2>&1 || die "tar is required"
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "sha256sum or shasum is required to verify the download"
fi

# --- Say what will happen before doing any of it. ---
say "Bramble installer for $OS/$ARCH"
say "  download   $BASE/dl/$TARBALL (checked against $BASE/dl/SHA256SUMS)"
say "  install to $BIN_DIR (as $(id -un), no root)"
say "  data in    $HOME_DIR (device key and logs; removed by uninstall)"
if [ "$NO_START" = 1 ]; then
  say "  start      no (--no-start)"
elif [ "$NO_OPEN" = 1 ]; then
  say "  start      bramble in the background; prints the local UI address"
else
  say "  start      bramble in the background and open its local UI in your browser"
fi
if [ "$WANT_TUN" = 1 ]; then
  say "  root       one sudo call to grant cap_net_admin (--tun)"
else
  say "  root       not needed; bramble uses a user-space network stack"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/bramble-install.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT INT TERM HUP

fetch() { curl -fsSL --retry 2 --connect-timeout 15 --max-time 300 -o "$2" "$1" || die "download failed: $1"; }

# --- Node config: proves the host serves a tailnet before we install anything. ---
fetch "$BASE/.well-known/bramble.json" "$TMP/bramble.json"
json_field() { sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP/bramble.json" | head -n1; }
TAILNET="$(json_field tailnet)"
[ -n "$TAILNET" ] || die "$BASE/.well-known/bramble.json has no tailnet name; the host is not serving a Bramble tailnet"
say ""
say "This host serves the tailnet $TAILNET (version $(json_field version), join API $(json_field joinApi))."

# --- Download and verify. Nothing is installed if the checksum does not match. ---
fetch "$BASE/dl/SHA256SUMS" "$TMP/SHA256SUMS"
fetch "$BASE/dl/$TARBALL" "$TMP/$TARBALL"
WANT="$(awk -v f="$TARBALL" '{n=$2; sub(/^\*/, "", n)} n == f {print $1; exit}' "$TMP/SHA256SUMS")"
[ -n "$WANT" ] || die "SHA256SUMS has no entry for $TARBALL; nothing installed"
GOT="$(sha256 "$TMP/$TARBALL")"
if [ "$GOT" != "$WANT" ]; then
  die "checksum mismatch for $TARBALL (expected $WANT, got $GOT); nothing installed"
fi
say "Checksum verified for $TARBALL."

# Accept only plain file names, so a tampered archive cannot write outside the staging dir.
tar -tzf "$TMP/$TARBALL" > "$TMP/list" || die "$TARBALL is not a readable archive"
if sed 's|^\./||' "$TMP/list" | grep -E '(^/|\.\.|/)' >/dev/null; then
  die "$TARBALL contains paths outside its top level; refusing to unpack"
fi
mkdir "$TMP/stage"
tar -xzf "$TMP/$TARBALL" -C "$TMP/stage"
[ -f "$TMP/stage/bramble" ] || die "$TARBALL has no bramble binary"
[ -f "$TMP/stage/brambled" ] || die "$TARBALL has no brambled binary"

# --- Stop a previous run so its binaries can be replaced. ---
daemon_pid() {
  pid="$(cat "$HOME_DIR/bramble.pid" 2>/dev/null || true)"
  case "$pid" in '' | *[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  comm="$(cat "/proc/$pid/comm" 2>/dev/null || ps -p "$pid" -o comm= 2>/dev/null || true)"
  case "$comm" in *bramble*) printf '%s' "$pid" ;; *) return 1 ;; esac
}
if old="$(daemon_pid)"; then
  say "Stopping the running bramble (pid $old) to replace it."
  kill "$old" 2>/dev/null || true
  i=0; while [ $i -lt 20 ] && kill -0 "$old" 2>/dev/null; do sleep 0.5 2>/dev/null || sleep 1; i=$((i + 1)); done
fi

# --- Install as the user. Rename into place so a failure never leaves half a binary. ---
umask 077
mkdir -p "$BIN_DIR" "$HOME_DIR/logs"
chmod 700 "$HOME_DIR"
umask 022
for f in "$TMP/stage"/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  cp "$f" "$BIN_DIR/.$name.new"
  chmod 755 "$BIN_DIR/.$name.new"
  mv -f "$BIN_DIR/.$name.new" "$BIN_DIR/$name"
done
printf '%s\n' "$BASE/.well-known/bramble.json" > "$HOME_DIR/config.url"
chmod 600 "$HOME_DIR/config.url"
printf '%s\n' bramble-install-v1 > "$TMP/install-marker"
mv -f "$TMP/install-marker" "$HOME_DIR/.bramble-install"
say "Installed to $BIN_DIR: $(cd "$BIN_DIR" && ls | tr '\n' ' ')"

# --- The one place root is used, and only on request. ---
if [ "$WANT_TUN" = 1 ]; then
  CAP_TARGET="$BIN_DIR/brambled"
  [ -f "$CAP_TARGET" ] || CAP_TARGET="$BIN_DIR/bramble"
  if [ "$OS" != linux ]; then
    warn "--tun only applies on Linux; macOS keeps the user-space network stack"
  elif ! command -v setcap >/dev/null 2>&1; then
    warn "setcap is not installed; keeping the user-space network stack"
  else
    say ""
    say "Granting cap_net_admin to $CAP_TARGET so it can create the WireGuard interface bramble0."
    say "This is the only step that uses sudo; it changes that one file and nothing else."
    if sudo setcap cap_net_admin+ep "$CAP_TARGET"; then USE_TUN=1; say "Capability granted."; else warn "setcap failed; keeping the user-space network stack"; fi
  fi
fi

# --- Start and open the UI. ---
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) PATH_HINT=1 ;;
esac

if [ "$NO_START" = 1 ]; then
  say ""
  say "Installed. Start it with: $BIN_DIR/bramble up"
else
  rm -f "$HOME_DIR/ui.url"
  set -- up -open=false
  [ "$USE_TUN" = 0 ] || set -- "$@" -tun
  BRAMBLE_HOME="$HOME_DIR" nohup "$BIN_DIR/bramble" "$@" > "$HOME_DIR/logs/bramble.out" 2>&1 < /dev/null &
  BPID=$!
  say ""
  say "Starting bramble (pid $BPID)..."
  URL=
  i=0
  while [ $i -lt 40 ]; do
    if [ -s "$HOME_DIR/ui.url" ]; then URL="$(head -n1 "$HOME_DIR/ui.url" | tr -d '\r\n')"; break; fi
    kill -0 "$BPID" 2>/dev/null || break
    sleep 0.5 2>/dev/null || sleep 1
    i=$((i + 1))
  done
  if [ -z "$URL" ]; then
    warn "bramble did not report its UI address. Last log lines:"
    tail -n 15 "$HOME_DIR/logs/bramble.out" >&2 2>/dev/null || true
    die "see $HOME_DIR/logs/bramble.out"
  fi
  say "Bramble is running. Open $URL"
  if [ "$NO_OPEN" != 1 ]; then
    if [ "$OS" = darwin ] && command -v open >/dev/null 2>&1; then
      open "$URL" >/dev/null 2>&1 || true
    elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$URL" >/dev/null 2>&1 || true
    else
      say "(No browser could be opened from here; open the address above yourself.)"
    fi
  fi
fi

say ""
if [ "${PATH_HINT:-0}" = 1 ]; then
  say "To run bramble from any shell: export PATH=\"$BIN_DIR:\$PATH\"  (not written to your shell profile)"
fi
say "Uninstall: curl -fsSL $BASE/uninstall.sh | sh"
