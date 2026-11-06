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
BIN_DIR="$HOME_DIR/bin"
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

# Refuse a path that could delete something that is not ours.
case "$HOME_DIR" in
  / | "$HOME" | "$HOME/" | "") die "refusing to remove $HOME_DIR; set BRAMBLE_HOME to a directory dedicated to Bramble" ;;
esac
if [ ! -d "$HOME_DIR" ]; then
  say "Nothing to remove: $HOME_DIR does not exist."
  exit 0
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
  if [ -r /dev/tty ] && : < /dev/tty 2>/dev/null; then
    printf 'Continue? [y/N] ' > /dev/tty
    read -r answer < /dev/tty || answer=
    case "$answer" in y | Y | yes | YES) ;; *) say "Cancelled; nothing removed."; exit 0 ;; esac
  else
    die "no terminal to ask on; rerun with: sh -s -- --yes"
  fi
fi

# --- Stop. Only processes whose command is inside our bin dir, never a bare name match. ---
pid="$(cat "$HOME_DIR/bramble.pid" 2>/dev/null || true)"
pids=
case "$pid" in '' | *[!0-9]*) ;; *) kill -0 "$pid" 2>/dev/null && pids="$pid" ;; esac
if command -v pgrep >/dev/null 2>&1; then
  pids="$pids $(pgrep -f "^$BIN_DIR/" 2>/dev/null || true)"
fi
stopped=0
for p in $pids; do
  [ "$p" = "$$" ] && continue
  if kill "$p" 2>/dev/null; then stopped=$((stopped + 1)); fi
done
if [ "$stopped" -gt 0 ]; then
  i=0
  while [ $i -lt 20 ]; do
    alive=0
    for p in $pids; do [ "$p" = "$$" ] || { kill -0 "$p" 2>/dev/null && alive=1; }; done
    [ "$alive" = 0 ] && break
    sleep 0.5 2>/dev/null || sleep 1
    i=$((i + 1))
  done
  for p in $pids; do [ "$p" = "$$" ] || kill -9 "$p" 2>/dev/null || true; done
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
  rm -rf "$BIN_DIR"
  rm -f "$HOME_DIR/ui.url" "$HOME_DIR/bramble.pid"
  say "Removed $BIN_DIR. Kept the rest of $HOME_DIR."
else
  rm -rf "$HOME_DIR"
  say "Removed $HOME_DIR."
fi
say "Bramble is uninstalled. If you added $BIN_DIR to your PATH, remove that line yourself."
