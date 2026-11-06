#!/usr/bin/env bash
# Check the published installer from outside, over the real HTTPS name.
# Prints PASS/FAIL lines. TLS is verified (no -k), so a missing or wrong
# certificate fails the first check.
# Usage: smoke-public.sh <base-url> <tailnet-name> [--run-install]
# --run-install runs `curl -fsSL <base>/install.sh | sh` and then uninstall.sh, both
# under a throwaway HOME and BRAMBLE_HOME, with --no-open. It starts the real bramble
# if the bundle holds one, so use a box you can clean up.
set -uo pipefail

base="${1:?usage: $0 <base-url> <tailnet-name> [--run-install]}"
tailnet="${2:?}"
run_install="${3:-}"
base="${base%/}"
fail=0
tmp="$(mktemp -d "${TMPDIR:-/tmp}/bramble-smoke.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }
get() { curl -fsS --max-time 30 -o "$2" "$base$1"; } # get <path> <dest>

if get /install.sh "$tmp/install.sh"; then ok "GET /install.sh over verified TLS"; else bad "GET /install.sh"; fi
ctype="$(curl -fsSI --max-time 15 "$base/install.sh" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
case "$ctype" in text/x-shellscript*) ok "install.sh Content-Type is $ctype";; *) bad "install.sh Content-Type is '$ctype', expected text/x-shellscript";; esac
cache="$(curl -fsSI --max-time 15 "$base/install.sh" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}')"
[ "$cache" = "no-cache" ] && ok "install.sh is uncached" || bad "install.sh Cache-Control is '$cache'"
if [ -s "$tmp/install.sh" ] && head -n1 "$tmp/install.sh" | grep -q '^#!'; then ok "install.sh starts with a shebang"; else bad "install.sh is empty or has no shebang"; fi
if grep -q '@@BRAMBLE' "$tmp/install.sh" 2>/dev/null; then bad "install.sh still has an unbaked @@BRAMBLE placeholder"; else ok "install.sh has no unbaked placeholder"; fi
host="${base#*://}"
if grep -q "$host" "$tmp/install.sh" 2>/dev/null; then ok "install.sh names the install host $host"; else bad "install.sh does not name the install host $host"; fi

if get /uninstall.sh "$tmp/uninstall.sh" && head -n1 "$tmp/uninstall.sh" | grep -q '^#!'; then ok "GET /uninstall.sh"; else bad "GET /uninstall.sh"; fi

if get /dl/SHA256SUMS "$tmp/SHA256SUMS"; then ok "GET /dl/SHA256SUMS"; else bad "GET /dl/SHA256SUMS"; fi
n=0
while read -r sum file; do
  file="${file#\*}"
  [ -n "$file" ] || continue
  if get "/dl/$file" "$tmp/$file"; then
    got="$(sha256sum "$tmp/$file" | cut -d' ' -f1)"
    if [ "$got" = "$sum" ]; then ok "$file matches SHA256SUMS"; else bad "$file does not match SHA256SUMS"; fi
  else bad "GET /dl/$file"; fi
  n=$((n + 1))
done < "$tmp/SHA256SUMS"
[ "$n" -gt 0 ] && ok "$n tarball(s) checked" || bad "SHA256SUMS lists no files"

if get /.well-known/bramble.json "$tmp/bramble.json"; then
  ok "GET /.well-known/bramble.json"
  if node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const k of ["version","tailnet","chainId","rpcUrl","registry","joinApi"])if(!(k in c))throw new Error("missing "+k);if(c.tailnet!==process.argv[2])throw new Error("tailnet is "+c.tailnet)' "$tmp/bramble.json" "$tailnet" 2>/dev/null; then ok "node config has the required fields and names $tailnet"; else bad "node config is invalid, incomplete or names another tailnet"; fi
  if grep -Eq '[0-9a-fA-F]{64}|PRIVATE|api[_-]?key' "$tmp/bramble.json"; then bad "node config looks like it holds a secret"; else ok "node config has no secret-looking string"; fi
  jtype="$(curl -fsSI --max-time 15 "$base/.well-known/bramble.json" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
  case "$jtype" in application/json*) ok "node config Content-Type is $jtype";; *) bad "node config Content-Type is '$jtype'";; esac
else bad "GET /.well-known/bramble.json"; fi

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base/dl/nope.tar.gz")"
[ "$code" = 404 ] && ok "unknown file under /dl returns 404" || bad "unknown file under /dl returned $code, expected 404"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base/dl/")"
[ "$code" = 404 ] && ok "/dl/ has no directory listing" || bad "/dl/ returned $code, expected 404"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --path-as-is "$base/dl/../etc/passwd")"
case "$code" in 404|400) ok "path traversal under /dl returns $code";; *) bad "path traversal returned $code";; esac
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base/api/requests")"
case "$code" in 200|502) ok "console route still answers ($code; 502 means the admin tunnel is down)";; *) bad "console route /api/requests returned $code";; esac

if [ "$run_install" = "--run-install" ]; then
  home="$tmp/home"; mkdir -p "$home"
  echo "--- curl -fsSL $base/install.sh | sh -s -- --no-open   (HOME=$home)"
  if curl -fsSL "$base/install.sh" | HOME="$home" BRAMBLE_HOME="$home/.bramble" sh -s -- --no-open; then ok "install.sh exited 0"; else bad "install.sh exited non-zero"; fi
  [ -x "$home/.bramble/bin/bramble" ] && ok "bramble is installed" || bad "bramble is not installed"
  echo "--- curl -fsSL $base/uninstall.sh | sh -s -- --yes"
  if curl -fsSL "$base/uninstall.sh" | HOME="$home" BRAMBLE_HOME="$home/.bramble" sh -s -- --yes; then ok "uninstall.sh exited 0"; else bad "uninstall.sh exited non-zero"; fi
  [ ! -e "$home/.bramble" ] && ok "uninstall removed the data dir" || bad "uninstall left $home/.bramble"
fi
exit "$fail"
