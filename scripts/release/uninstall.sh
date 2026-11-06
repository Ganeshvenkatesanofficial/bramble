#!/bin/sh
# Bramble uninstaller. Usage:
#   curl -fsSL https://@@BRAMBLE_INSTALL_HOST@@/uninstall.sh | sh
#   curl -fsSL https://@@BRAMBLE_INSTALL_HOST@@/uninstall.sh | sh -s -- --yes
#
# Stops bramble, removes the WireGuard interface if one exists (sudo, only then),
# and deletes BRAMBLE_HOME (default ~/.bramble). That deletes the device key: the
# device must be enrolled again to rejoin. Bramble installs no system service and
# edits no shell profile, so there is nothing else to undo.
#   --yes        do not ask for confirmation (needed when there is no terminal)
#   --keep-data  remove the binaries but keep the device key, join record and logs
set -eu

HOME_DIR="${BRAMBLE_HOME:-$HOME/.bramble}"
IFACE=bramble0
ASSUME_YES=0
KEEP_DATA=0

say() { printf '%s\n' "$*"; }
warn() { printf 'bramble uninstall: %s\n' "$*" >&2; }
die() { warn "$*"; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --yes | -y) ASSUME_YES=1 ;;
    --keep-data) KEEP_DATA=1 ;;
    --help | -h)
      say "Usage: curl -fsSL https://@@BRAMBLE_INSTALL_HOST@@/uninstall.sh | sh -s -- [--yes] [--keep-data]"
      exit 0 ;;
    *) die "unknown argument $arg (try --help)" ;;
  esac
done

# Resolve dot segments, repeated slashes and symlinks before comparing or deleting.
if [ ! -d "$HOME_DIR" ]; then
  say "Nothing to remove: $HOME_DIR does not exist."
  exit 0
fi
case "$HOME_DIR" in /*) ;; *) HOME_DIR="$PWD/$HOME_DIR" ;; esac
HOME_DIR="$(CDPATH= cd -P "$HOME_DIR" && pwd -P)" || die "cannot resolve BRAMBLE_HOME"
USER_HOME="$(CDPATH= cd -P "$HOME" && pwd -P)" || die "cannot resolve HOME"
case "$USER_HOME/" in
  "$HOME_DIR/"*) die "refusing to remove a home directory or its ancestor; set BRAMBLE_HOME to a directory dedicated to Bramble" ;;
esac
[ "$HOME_DIR" != / ] || die "refusing to remove /"
BIN_DIR="$HOME_DIR/bin"
[ ! -L "$BIN_DIR" ] || die "refusing a symlinked bin directory"
[ ! -L "$HOME_DIR/.bramble-install" ] || die "refusing a symlinked installation marker"
# Current installs have a marker. Accept the earlier installer's known layout
# too, so the safety fix does not strand an existing installation.
if [ -f "$HOME_DIR/.bramble-install" ] &&
   [ "$(cat "$HOME_DIR/.bramble-install")" = bramble-install-v1 ]; then
  :
elif [ -f "$HOME_DIR/config.url" ] && [ ! -L "$HOME_DIR/config.url" ] &&
     [ -x "$BIN_DIR/bramble" ] && [ ! -L "$BIN_DIR/bramble" ]; then
  :
else
  die "refusing to remove a directory without evidence of a Bramble installation"
fi

say "This will:"
say "  - stop bramble and its helper processes"
[ "$(uname -s)" = Linux ] && say "  - remove the WireGuard interface $IFACE if it exists (uses sudo only then)"
if [ "$KEEP_DATA" = 1 ]; then
  say "  - delete $BIN_DIR and keep the rest of $HOME_DIR"
else
  say "  - delete $HOME_DIR, including the device key (the device must be enrolled again to rejoin)"
fi

if [ "$ASSUME_YES" != 1 ]; then
  # Probe in a subshell: dash and busybox exit the whole script when a redirect on the
  # `:` special builtin fails, which would skip the --yes hint below.
  if [ -r /dev/tty ] && (: < /dev/tty) 2>/dev/null; then
    printf 'Continue? [y/N] ' > /dev/tty
    read -r answer < /dev/tty || answer=
    case "$answer" in y | Y | yes | YES) ;; *) say "Cancelled; nothing removed."; exit 0 ;; esac
  else
    die "no terminal to ask on; rerun with: sh -s -- --yes"
  fi
fi

# --- Stop. Recheck ownership before every signal, including escalation. ---
owned_process() {
  case "$1" in '' | *[!0-9]* | 0*) return 1 ;; esac
  [ "$1" != "$$" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  if [ -d /proc ]; then
    executable="$(readlink "/proc/$1/exe" 2>/dev/null || true)"
    case "$executable" in
      "$BIN_DIR/"*) [ -f "$executable" ] && return 0 ;;
    esac
    # Shell-script bundles are used by the public-host smoke test. A shell must
    # have our script as its first argument; an arbitrary argument is not proof.
    case "$executable" in
      /bin/sh | /usr/bin/sh | /bin/dash | /usr/bin/dash | /bin/bash | /usr/bin/bash | /bin/busybox | /usr/bin/busybox)
        script="$(tr '\000' '\n' < "/proc/$1/cmdline" 2>/dev/null | sed -n '2p')"
        case "$script" in
          "$BIN_DIR/"*)
            script_name="${script#"$BIN_DIR/"}"
            case "$script_name" in '' | */* | . | ..) return 1 ;; esac
            [ -f "$script" ] && [ ! -L "$script" ] && return 0
            ;;
        esac
        ;;
    esac
  else
    # On macOS, comm is the executable path (args can contain unrelated paths).
    executable="$(ps -p "$1" -o comm= 2>/dev/null || true)"
    case "$executable" in "$BIN_DIR/"*) [ -f "$executable" ] && return 0 ;; esac
  fi
  return 1
}
pid="$(cat "$HOME_DIR/bramble.pid" 2>/dev/null || true)"
pids="$pid $(ps -e -o pid= 2>/dev/null || ps -o pid= 2>/dev/null || true)"
stopped=0
stopping=
for p in $pids; do
  case " $stopping " in *" $p "*) continue ;; esac
  if owned_process "$p" && kill -TERM "$p" 2>/dev/null; then
    stopped=$((stopped + 1))
    stopping="$stopping $p"
  fi
done
if [ "$stopped" -gt 0 ]; then
  i=0
  while [ $i -lt 20 ]; do
    alive=0
    for p in $stopping; do if owned_process "$p"; then alive=1; fi; done
    [ "$alive" = 0 ] && break
    sleep 0.5 2>/dev/null || sleep 1
    i=$((i + 1))
  done
  for p in $stopping; do
    if owned_process "$p"; then kill -KILL "$p" 2>/dev/null || true; fi
  done
  say "Stopped $stopped process(es)."
else
  say "bramble was not running."
fi

# --- Interface (TUN mode only; the default user-space stack leaves none). ---
if [ "$(uname -s)" = Linux ] && [ -d "/sys/class/net/$IFACE" ]; then
  say "Removing the WireGuard interface $IFACE. This needs root, so sudo may ask for your password."
  if sudo ip link delete "$IFACE"; then say "Removed $IFACE."; else warn "could not remove $IFACE; run: sudo ip link delete $IFACE"; fi
fi

# --- Files. ---
if [ "$KEEP_DATA" = 1 ]; then
  # Retain evidence so a later full uninstall can remove the preserved data.
  printf '%s\n' bramble-install-v1 > "$HOME_DIR/.bramble-install"
  rm -rf "$BIN_DIR"
  rm -f "$HOME_DIR/ui.url" "$HOME_DIR/bramble.pid"
  say "Removed $BIN_DIR. Kept the rest of $HOME_DIR."
else
  rm -rf "$HOME_DIR"
  say "Removed $HOME_DIR."
fi
say "Bramble is uninstalled. If you added $BIN_DIR to your PATH, remove that line yourself."
