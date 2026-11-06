#!/usr/bin/env bash
# Publish a release to the relays machine, which serves it through Caddy.
# Run on the operator's machine (it needs ssh access to the relays alias).
#
# Usage: publish-release.sh --release DIR --version V --env FILE [--env FILE ...]
#          [--install-sh FILE] [--uninstall-sh FILE] [--ssh ALIAS] [--caddy] [--init] [--dry-run]
#
# DIR holds bramble_<os>_<arch>.tar.gz files and SHA256SUMS (scripts/release.sh writes ./release).
# Each --env file supplies public values only (deploy/env/public.env.example); the generator
# reads a fixed list of names and ignores the rest, so a node env file is safe to pass.
# --init   create /var/lib/bramble-dist on the machine (one sudo, first run only).
# --caddy  render deploy/caddy/Caddyfile with the two public names, validate it on the
#          machine, install it as /etc/caddy/Caddyfile and reload (restores the old file on failure).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
dist=/var/lib/bramble-dist
ssh_alias=bramble-relays
release= version= install_sh="$repo/scripts/release/install.sh" uninstall_sh="$repo/scripts/release/uninstall.sh"
envs=() do_caddy=0 do_init=0 dry=0

die() { echo "publish-release: $*" >&2; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --release) release="${2:?}"; shift 2;;
    --version) version="${2:?}"; shift 2;;
    --env) envs+=("${2:?}"); shift 2;;
    --install-sh) install_sh="${2:?}"; shift 2;;
    --uninstall-sh) uninstall_sh="${2:?}"; shift 2;;
    --ssh) ssh_alias="${2:?}"; shift 2;;
    --caddy) do_caddy=1; shift;;
    --init) do_init=1; shift;;
    --dry-run) dry=1; shift;;
    *) die "unknown argument $1";;
  esac
done
[ -n "$release" ] && [ -d "$release" ] || die "--release DIR is required"
[[ "$version" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || die "--version is required (letters, digits, . _ -)"
[ "${#envs[@]}" -gt 0 ] || die "at least one --env FILE is required"
[ -f "$release/SHA256SUMS" ] || die "$release/SHA256SUMS is missing"
[ -f "$install_sh" ] || die "install script not found: $install_sh (pass --install-sh)"

# Read the two public names the same way the generator does: fixed names only, no sourcing.
env_get() { # env_get NAME: last value across the --env files
  local f v=
  for f in "${envs[@]}"; do
    local line
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$f" | tail -n1 || true)"
    [ -n "$line" ] && v="${line#*=}"
  done
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}
console_host="$(env_get BRAMBLE_CONSOLE_HOST)"
rpc_host="$(env_get BRAMBLE_RPC_HOST)"
[[ "$console_host" =~ ^[A-Za-z0-9.-]+$ ]] || die "BRAMBLE_CONSOLE_HOST is missing or not a DNS name"
[[ "$rpc_host" =~ ^[A-Za-z0-9.-]+$ ]] || die "BRAMBLE_RPC_HOST is missing or not a DNS name"

echo "Checking tarball checksums in $release"
(cd "$release" && sha256sum -c SHA256SUMS) || die "checksum mismatch in $release"
ls "$release"/bramble_*.tar.gz >/dev/null 2>&1 || die "no bramble_*.tar.gz in $release"

stage="$(mktemp -d "${TMPDIR:-/tmp}/bramble-publish.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/dl" "$stage/.well-known"
cp "$release"/bramble_*.tar.gz "$release/SHA256SUMS" "$stage/dl/"

envargs=(); for f in "${envs[@]}"; do envargs+=(--env "$f"); done
node "$here/gen-node-config.mjs" --version "$version" "${envargs[@]}" --out "$stage/.well-known/bramble.json"
name="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tailnet)' "$stage/.well-known/bramble.json")"

bake() { # bake <src> <dest>: put the install host into a script
  grep -q '@@BRAMBLE_INSTALL_HOST@@' "$1" || echo "warning: $1 has no @@BRAMBLE_INSTALL_HOST@@ placeholder; it must already know its host" >&2
  sed "s/@@BRAMBLE_INSTALL_HOST@@/$console_host/g; s/@@BRAMBLE_VERSION@@/$version/g" "$1" > "$2"
  chmod 0644 "$2"
}
bake "$install_sh" "$stage/install.sh"
[ -f "$uninstall_sh" ] && bake "$uninstall_sh" "$stage/uninstall.sh"

# Last check before anything leaves this machine. SHA256SUMS and the tarballs are excluded:
# they hold 64-digit hashes by design.
secret_re='(^|[^0-9a-fA-F])[0-9a-fA-F]{64}([^0-9a-fA-F]|$)|BEGIN [A-Z ]*PRIVATE|PRIVATE_KEY=|Bearer [A-Za-z0-9]|api[_-]?key='
checked=("$stage/install.sh" "$stage/.well-known")
[ -f "$stage/uninstall.sh" ] && checked+=("$stage/uninstall.sh")
if grep -rIEn "$secret_re" "${checked[@]}" >/dev/null 2>&1; then
  die "staged files contain a secret-looking string; nothing was uploaded"
fi

echo "Staged for https://$console_host/:"
(cd "$stage" && find . -type f | sort | sed 's/^\.\//  /')
if [ "$dry" -eq 1 ]; then echo "dry run: nothing uploaded"; exit 0; fi

rsh=(ssh -o BatchMode=yes "$ssh_alias")
if [ "$do_init" -eq 1 ]; then
  "${rsh[@]}" "sudo install -d -m 0755 -o \"\$(id -un)\" -g \"\$(id -gn)\" $dist"
fi
"${rsh[@]}" "test -d $dist && test -w $dist" || die "$dist is missing or not writable on $ssh_alias; run once with --init"

# Order matters: tarballs first, install.sh last, so the entry point never names a missing file.
# /dl is flat and holds only the current release, so --delete drops the previous one. A device
# that downloads while the new tarball and SHA256SUMS land one after the other sees a checksum
# mismatch and refuses; it succeeds on retry.
rsync_opts=(-rt --chmod=D755,F644 -e "ssh -o BatchMode=yes")
rsync "${rsync_opts[@]}" --delete --exclude=/SHA256SUMS "$stage/dl/" "$ssh_alias:$dist/dl/"
rsync "${rsync_opts[@]}" "$stage/dl/SHA256SUMS" "$ssh_alias:$dist/dl/SHA256SUMS"
rsync "${rsync_opts[@]}" "$stage/.well-known/" "$ssh_alias:$dist/.well-known/"
[ -f "$stage/uninstall.sh" ] && rsync "${rsync_opts[@]}" "$stage/uninstall.sh" "$ssh_alias:$dist/uninstall.sh"
rsync "${rsync_opts[@]}" "$stage/install.sh" "$ssh_alias:$dist/install.sh"
echo "Uploaded to $ssh_alias:$dist"

if [ "$do_caddy" -eq 1 ]; then
  sed "s/rpc\.example\.com/$rpc_host/g; s/console\.example\.com/$console_host/g" "$repo/deploy/caddy/Caddyfile" > "$stage/Caddyfile"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  "${rsh[@]}" 'cat > /tmp/Caddyfile.bramble-new' < "$stage/Caddyfile"
  "${rsh[@]}" "set -e
    sudo caddy validate --config /tmp/Caddyfile.bramble-new --adapter caddyfile >/dev/null
    sudo cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$ts
    sudo install -m 0644 /tmp/Caddyfile.bramble-new /etc/caddy/Caddyfile
    if ! sudo systemctl reload caddy; then sudo cp -p /etc/caddy/Caddyfile.bak-$ts /etc/caddy/Caddyfile; sudo systemctl reload caddy; echo 'reload failed; restored the old Caddyfile' >&2; exit 1; fi
    rm -f /tmp/Caddyfile.bramble-new"
  echo "Caddy reloaded (old file kept as /etc/caddy/Caddyfile.bak-$ts)"
fi

echo "Next: deploy/scripts/smoke-public.sh https://$console_host $name"
