# Tailnet config and install host

Reference for the files the relays machine serves so a new device can install Bramble and look up a tailnet. Decisions D4 and D8 of the ETH-177 spec define them. Code: `deploy/scripts/gen-tailnet-config.mjs` (generator), `deploy/scripts/publish-release.sh` (upload), `deploy/caddy/Caddyfile` (routes).

## URLs

The host is the public console name (for example `console.13-233-181-104.sslip.io`). Caddy serves these paths as static files from `/var/lib/bramble-dist`. Every other path keeps going to the approval console.

| Path                              | Content                                            | Cache-Control | Content-Type                         |
| --------------------------------- | -------------------------------------------------- | ------------- | ------------------------------------ |
| `/install.sh`                     | Installer, with the install host baked in          | `no-cache`    | `text/x-shellscript; charset=utf-8`  |
| `/uninstall.sh`                   | Uninstaller (served only when published)           | `no-cache`    | `text/x-shellscript; charset=utf-8`  |
| `/dl/<version>/bramble-<os>-<arch>.tar.gz` | Release bundle (`linux`, `darwin`; `amd64`, `arm64`) | `no-cache`    | `application/gzip`                   |
| `/dl/<version>/SHA256SUMS`        | `sha256sum` lines for the bundles in that version  | `no-cache`    | `application/octet-stream`           |
| `/tailnets/<name>.json`           | Public tailnet config (below)                      | `no-cache`    | `application/json`                   |

A directory under `/dl/` returns 404 (no listing). The trust anchor is the HTTPS certificate. `SHA256SUMS` guards against a corrupt or truncated download, not against a compromised host.

## `/tailnets/<name>.json`

Public values only. No private key, no credentialed RPC URL. `<name>` is the lower-case ENS name.

| Field                 | Type     | Meaning                                                                         | Source variable                                         |
| --------------------- | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `name`                | string   | Tailnet ENS name, ends in `.eth`                                                | `BRAMBLE_TAILNET_NAME`                                  |
| `registry`            | string   | Device registry address (20-byte hex)                                           | `BRAMBLE_TAILNET_REGISTRY`                              |
| `registryDeployBlock` | number   | First block to scan                                                             | `BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK`                 |
| `relayRegistry`       | string   | Relay registry address                                                          | `BRAMBLE_RELAY_REGISTRY`                                |
| `relayDeployBlock`    | number   | First block to scan                                                             | `BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK`                   |
| `rpcUrl`              | string   | The logging RPC proxy URL, no credential                                        | `BRAMBLE_PUBLIC_RPC_URL`, default `https://<BRAMBLE_RPC_HOST>/` |
| `stunServers`         | string[] | `host:port` list                                                                | `BRAMBLE_STUN_SERVERS`                                  |
| `rendezvous`          | string[] | `host:port` list of rendezvous relays                                           | `BRAMBLE_RENDEZVOUS`                                    |
| `dataRelays`          | string[] | Sidecar base URLs of the data relays                                            | `BRAMBLE_DATA_RELAYS`                                   |
| `approvalUrl`         | string   | Approval service base URL, no trailing slash                                    | `BRAMBLE_APPROVAL_URL`, default `https://<BRAMBLE_CONSOLE_HOST>` |
| `services`            | string[] | Service names shown in the device UI; may be empty                              | `BRAMBLE_PUBLIC_SERVICES`                               |

Example (the values are placeholders):

```json
{
  "name": "demo-net.eth",
  "registry": "0x0000000000000000000000000000000000000001",
  "registryDeployBlock": 1,
  "relayRegistry": "0x0000000000000000000000000000000000000002",
  "relayDeployBlock": 1,
  "rpcUrl": "https://rpc.example.com/",
  "stunServers": ["203.0.113.5:3478"],
  "rendezvous": ["203.0.113.5:9420"],
  "dataRelays": ["http://203.0.113.5:7891"],
  "approvalUrl": "https://console.example.com",
  "services": []
}
```

## What the generator refuses

`gen-tailnet-config.mjs` reads a fixed list of variable names from the env files you pass and ignores every other line. It never reads `SEPOLIA_RPC_URL`, because on the admin machine that variable is the credentialed endpoint. It exits non-zero when:

- a required variable is missing or malformed (names must end in `.eth`, registries must be 20-byte hex, blocks must be integers, endpoints must be `host:port`);
- a URL has user info, a query string, a fragment, or a path segment of 24 or more URL-safe characters (the shape of an API key);
- the output holds a 64-digit hex string, `PRIVATE`, `Bearer` or `api_key`.

`publish-release.sh` runs the same style of check over `install.sh`, `uninstall.sh` and `tailnets/` before it uploads anything.

## Install-script placeholders

`publish-release.sh` replaces these literal strings in `install.sh` and `uninstall.sh` while it stages the upload:

| Placeholder                | Replaced with                                          |
| -------------------------- | ------------------------------------------------------ |
| `@@BRAMBLE_INSTALL_HOST@@` | The console DNS name, for example `console.example.com` |
| `@@BRAMBLE_VERSION@@`      | The `--version` value                                  |
