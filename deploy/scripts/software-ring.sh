#!/usr/bin/env bash
# Software stand-in for `wallet-cli ring encrypt|decrypt -k <name>`. Reads stdin, writes stdout.
# Point BRAMBLE_RING_CLI at this script. The wrapping key is a file readable only by the admin user,
# so this protects the granter key at rest from other users, not from root on the admin machine.
# Usage: software-ring.sh ring <encrypt|decrypt> -k <name>
set -euo pipefail

key_file="${BRAMBLE_SOFTWARE_RING_KEY_FILE:-$HOME/.config/bramble/software-ring.key}"

if [ "${1:-}" != "ring" ] || [ "${3:-}" != "-k" ] || [ -z "${4:-}" ]; then
  echo "usage: software-ring.sh ring <encrypt|decrypt> -k <name>" >&2
  exit 2
fi
mode="$2"

if [ ! -f "$key_file" ]; then
  if [ "$mode" = "decrypt" ]; then
    echo "software-ring: no wrapping key at $key_file" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$key_file")"
  (umask 077 && openssl rand -hex 32 >"$key_file")
fi

case "$mode" in
  encrypt) exec openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$key_file" ;;
  decrypt) exec openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$key_file" ;;
  *) echo "software-ring: unknown mode $mode" >&2; exit 2 ;;
esac
