#!/usr/bin/env bash
# Builds the device release: for each target, three executables in
# release/bramble_<os>_<arch>.tar.gz, plus release/SHA256SUMS.
#   bramble          the node daemon (node-daemon/, Go) with the local web UI embedded
#   brambled         the helper the daemon supervises (brambled/, Go)
#   bramble-sidecar  the TypeScript sidecar compiled with `bun build --compile`
# Needs Go, Bun, Node.js, pnpm-installed dependencies and GNU tar. Run it on
# Linux. See docs/reference/node-release.md.
#
# Usage: scripts/release.sh [os/arch ...]
#   targets default to linux/amd64 linux/arm64 darwin/arm64 darwin/amd64
#   VERSION            label printed in the log and baked into `bramble version`
#                      (default: git describe)
#   BRAMBLE_SKIP_UI=1  skip the local UI build and embed whatever is already in
#                      node-daemon/ui/dist (CI that built it earlier)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

targets=("$@")
if [ "${#targets[@]}" -eq 0 ]; then
  targets=(linux/amd64 linux/arm64 darwin/arm64 darwin/amd64)
fi
version="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo unknown)}"
out="$root/release"
stage="$out/.stage"

for tool in go bun node pnpm tar gzip sha256sum; do
  command -v "$tool" >/dev/null || { echo "release.sh: $tool is required" >&2; exit 1; }
done
tar --version | grep -q 'GNU tar' || { echo "release.sh: GNU tar is required" >&2; exit 1; }
[ -d sidecar/node_modules ] || { echo "release.sh: run pnpm install first" >&2; exit 1; }

# The local web UI is embedded into the node daemon, so it is built once, before any target.
if [ "${BRAMBLE_SKIP_UI:-0}" != 1 ]; then
  [ -d local-ui/node_modules ] || { echo "release.sh: run pnpm install first (local-ui has no node_modules)" >&2; exit 1; }
  echo "== local UI"
  pnpm --filter @bramble/local-ui build
  pnpm --filter @bramble/local-ui embed
fi
[ -f node-daemon/ui/dist/index.html ] || { echo "release.sh: node-daemon/ui/dist has no UI build; the daemon would serve its placeholder page" >&2; exit 1; }

# Same mtime for every file, so rebuilding one commit gives the same tarball.
mtime="@$(git log -1 --format=%ct 2>/dev/null || echo 0)"

host_os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in
  x86_64) host_arch=amd64 ;;
  aarch64 | arm64) host_arch=arm64 ;;
  *) host_arch=unknown ;;
esac

mkdir -p "$out"
rm -rf "$stage"

echo "release $version"
for target in "${targets[@]}"; do
  os="${target%/*}"
  arch="${target#*/}"
  case "$os/$arch" in
    linux/amd64 | linux/arm64 | darwin/amd64 | darwin/arm64) ;;
    *) echo "release.sh: unsupported target $target" >&2; exit 1 ;;
  esac
  bun_arch="$arch"
  [ "$arch" = amd64 ] && bun_arch=x64

  dir="$stage/$os-$arch"
  mkdir -p "$dir"
  echo "== $os/$arch"

  (cd node-daemon && CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" \
    go build -trimpath -ldflags="-s -w -X main.version=$version" -o "$dir/bramble" .)
  (cd brambled && CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" \
    go build -trimpath -ldflags="-s -w" -o "$dir/brambled" .)
  bun build --compile --minify --target="bun-$os-$bun_arch" \
    sidecar/src/index.ts --outfile "$dir/bramble-sidecar" >/dev/null

  if [ "$os" = "$host_os" ] && [ "$arch" = "$host_arch" ]; then
    "$dir/bramble-sidecar" --self-test
  fi

  tarball="$out/bramble_${os}_${arch}.tar.gz"
  tar --sort=name --owner=0 --group=0 --numeric-owner --mode='u=rwx,go=rx' \
    --mtime="$mtime" -C "$dir" -cf - bramble brambled bramble-sidecar | gzip -n >"$tarball"
done
rm -rf "$stage"

(cd "$out" && sha256sum bramble_*.tar.gz >SHA256SUMS)
echo "== $out"
ls -l "$out"
cat "$out/SHA256SUMS"
