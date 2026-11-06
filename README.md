# Bramble

Bramble gives devices and automated workers private network access without making a coordination server the authority. Device identities, revocation, and scoped service grants live in an ENSv2 subname registry. Every WireGuard peer resolves that registry independently before accepting another peer. Public relay operators can be discovered through ENS and paid for rendezvous or byte allotments through x402 on Hedera.

The hackathon demo is one concrete access lifecycle: a thin health-check worker reaches an internal HTTP task API through a Bramble forward, an ungranted request is denied, a human-approved on-chain ACL expansion makes the identical request succeed without a restart, and revoking the service grant makes the identical request fail again.

## Pre-existing vs new

The Mumbai continuity entry separates work that existed before the hackathon from work built during it.

- **Baseline:** commit `28e2a8f`, tagged `pre-mumbai`. Everything in this repository at that commit is pre-existing.
- **New work:** every commit after `28e2a8f`. List it with `git log pre-mumbai..HEAD`.
- **Not new work:** polish, bug fixes and documentation of pre-existing behavior.

### Pre-existing at `pre-mumbai`

The pre-existing system includes `brambled/`, `sidecar/`, `relay/`, `relay-sidecar/`, `admincli/` and `dashboard/`. The sponsor sections below distinguish this baseline from the Mumbai additions. Older runbooks remain historical evidence, not proof of the current deployment.

### New since `pre-mumbai`

This table is the index of new work. Each agent adds or updates its row in the same pull request as the work. A status other than `planned` needs a link to the pull request or commit that backs it.

| Workstream | New work                                                                                                                                            | Status                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1         | Approval service and web UI: service-access requests plus device join, enrollment and revocation                                                    | partial: enrollment and two cloud grant/revoke passes reported at [970461c](https://github.com/WhyAsh5114/bramble/commit/970461c); [acceptance log](docs/measurements/2026-11-06-onboarding-acceptance.md). Fresh-device service access remains Open.                                  |
| W2         | Agent protagonist: MCP server that lets a coding agent request private access and call the private service                                          | planned                                                                                                                                                                                                                                                                                |
| W3         | Agent payments in the flow: spend, cap and HashScan link per agent                                                                                  | planned                                                                                                                                                                                                                                                                                |
| W4         | Live activity feed in the approval UI                                                                                                               | partial: approval feed reported working at [970461c](https://github.com/WhyAsh5114/bramble/commit/970461c); gateway and Hedera sources reported `not_configured` ([acceptance log](docs/measurements/2026-11-06-onboarding-acceptance.md)).                                            |
| W5         | Self-contained device bundle, curl installer, embedded local UI and launcher                                                                        | partial: real [970461c](https://github.com/WhyAsh5114/bramble/commit/970461c) release installed and enrolled on non-cloud Linux amd64; [installer PR #33](https://github.com/WhyAsh5114/bramble/pull/33). Fresh-device connectivity and other-platform runtime acceptance remain Open. |
| W8         | STUN endpoint discovery, hole punching and automatic relay fallback                                                                                 | planned                                                                                                                                                                                                                                                                                |
| W9         | Control plane over Tor: sidecar ENS reads and payment requests                                                                                      | partial, [PR #17](https://github.com/WhyAsh5114/bramble/pull/17): ENS and payment fetches routed, Tor-exit check Verified 6 Nov, revocation over Tor measured                                                                                                                          |
| W10        | One new Hedera service on testnet: HCS audit trail with a salted commitment per grant, revoke and settled payment, posted by the approval service   | in review ([PR #22](https://github.com/WhyAsh5114/bramble/pull/22))                                                                                                                                                                                                                    |
| W11        | Demo infrastructure: cloud nodes, logging RPC proxy, public console, preflight                                                                      | partial: two cloud lifecycle passes reported at [970461c](https://github.com/WhyAsh5114/bramble/commit/970461c); [rehearsal harness PR #55](https://github.com/WhyAsh5114/bramble/pull/55) merged, live harness result Open.                                                           |
| ETH-177e   | Local web UI: setup, join, status, peers, connection test and admin view                                                                            | partial: real embedded UI startup and approved enrollment reported at [970461c](https://github.com/WhyAsh5114/bramble/commit/970461c); completed browser flow and connected/service result remain Open.                                                                                |
| ETH-177 T6 | Relay-first forwarding for a device without a payer key; operator-sponsored capped sessions ([ADR 0018](docs/adr/0018-sponsored-relay-sessions.md)) | partial: [relay fix PR #53](https://github.com/WhyAsh5114/bramble/pull/53) deployed at `970461c`; fresh-device relay-only service acceptance failed ([acceptance log](docs/measurements/2026-11-06-onboarding-acceptance.md)).                                                         |

W6 (this documentation) is a deliverable and not a feature. W7 (Ledger approval signing) is out of scope.

## Mumbai sponsor integrations

These sections support demo beats 1–6. **Read from source** describes implementation; **Verified (reported)** attributes a recorded run to its operator; **Open** requires acceptance evidence. This documentation task does not run cloud nodes. Use the [one-page demo checklist](docs/DEMO_CHECKLIST.md), [operator script](docs/DEMO_SCRIPT.md) and [Mumbai submission draft](docs/13_SUBMISSION_DRAFT.md) together.

### ENS: tailnet naming and authorization

**Read from source.** A tailnet is an ENSv2 Permissioned Registry on Sepolia. A device is a subname such as `worker.<tailnet>.eth`, with its own Permissioned Resolver. Enhanced Access Control separates enrollment, key rotation, revocation and access-rule writes. Each peer reads the registry independently; the approval service writes grants but does not enforce them. Device access records contain capability digests. Public relay service addresses live in a separate registry, while mesh members' public endpoints stay off-chain.

**New for Mumbai:** the node sidecar routes ENS reads through `torFetch('ens')`, with CCIP-Read disabled to prevent off-chain lookups bypassing that transport ([client](sidecar/src/ens/client.ts)). This protects the node's source IP from the RPC provider; names, requested records and timing remain visible. It does not cover every admin or console read. Beats 1, 2 and 5 show the authorization lifecycle; beat 6 needs provider-log evidence of the privacy change.

**Deployment (reported).** The demo tailnet is `bramble-dev-c91e55e9.eth` on Sepolia (chain ID `11155111`). The operator's ETH-244 comment of 6 November, 12:14 UTC, reports the device registry at `0xEdA4b78CcA4472522bf2b521A6D2987306579058` and the relay registry at `0x3276eA61D05001586d6eE450F982312B345746a6`. This author has not queried either contract.

**Prize entry:** Bramble enters ENS for ENSv2 in an existing project, on the Sepolia tailnet above.

### Hedera: x402 payments, relay metering and HCS

**Read from source.** The baseline uses x402 HTTP payment challenges and Blocky402 settlement on Hedera testnet. Rendezvous tokens cost a fixed session fee; data-relay sessions sell explicit byte allotments. They are purchases for relay service, not a charge for every private API call. Retries can incur spend while service access is denied. Operator-sponsored sessions also do not establish that each device pays individually.

The node payer uses `HEDERA_CLIENT_ACCOUNT_ID` and its software signer; the relay has a separate payee account. Both use testnet USDC token `0.0.429274`. The client allows this asset on `hedera:testnet` and caps each payment with `HEDERA_MAX_PAYMENT_ATOMIC` (default `100000`, or 0.10 USDC). This is a per-payment ceiling, not an aggregate budget. Follow the [relay payment runbook](relay-sidecar/README.md) for account association, funding and metering. A historical settlement is `0.0.7162784@1788941365.961612782` ([HashScan](https://hashscan.io/testnet/transaction/0.0.7162784@1788941365.961612782)); it is **Verified (reported), 9 September 2026**, pre-existing evidence, not a Mumbai result.

**New for Mumbai:** W10 adds Hedera Consensus Service (HCS) audit commitments for grant, revoke and payment events ([module](hedera-audit/README.md), [record format](docs/16_HCS_AUDIT_RECORD_FORMAT.md)); W9 routes node payment HTTP through `torFetch('pay')`. HCS publishes salted commitments with public kind and timing, while retaining event details and salts off-chain. The approval service needs `HEDERA_AUDIT_TOPIC_ID` and payer configuration. A payment receipt proves settlement separately from an HCS receipt. Beat 3's fresh, mirror-verified cloud HCS record remains **Open** at the [demo script's evidence cutoff](docs/DEMO_SCRIPT.md#choose-what-you-can-show); fixtures are synthetic.

### Ethereum Foundation: the new privacy property

**Read from source.** The continuity upgrade protects Ethereum-native authorization reads and payment HTTP with Tor. Before W9, the node sent them directly. After W9, `torFetch('ens')` and `torFetch('pay')` use separate isolation keys. The protected requests fail closed until Tor is ready. This changes what the RPC and payment endpoints observe without replacing ENS as the authorization source ([Tor design](docs/adr/0013-tor-transport.md)).

**Verified (reported):** the [6 November measurement](docs/measurements/2026-11-06-revocation-over-tor.md) records two 600-second Tor runs on one machine, with replayed median detection times of 7.0–11.5 seconds and a worst observation of 29 seconds. It excludes chain confirmation and is not a live cloud revoke. The [operator script](docs/DEMO_SCRIPT.md#budget-for-the-measured-waits) separately reports cloud revoke-to-first-failure observations of 36.6 and 37.0 seconds on build `4928612`. This author has not rerun either experiment. Beat 6's current-build before/after provider-log comparison remains **Open**.

The [CROPS analysis](#crops) records the remaining dependencies and disclosures. Tor protects these control-plane requests; WireGuard, STUN and relay UDP still expose addresses to their counterparties. The RPC provider sees names and timing, payments expose payer accounts, and the admin and payer use software keys. The entry targets [Best CROPS Upgrade to an Existing Project](https://ethglobal.com/events/mumbai/prizes); it requires evidence of the new property, not just the prior mesh.

## CROPS

Bramble targets the Ethereum Foundation's CROPS properties: censorship resistance, open source, privacy and security. The claim is "no trusted coordinator", not "no infrastructure": each letter below says what still depends on a third party. Labels: **Verified** (we ran it), **Read from source**, **Open** (not tested).

**C (censorship resistance).** Admission never depends on our relay. A peer is admitted only after it resolves the device's ENS record itself, so a relay cannot admit, block or revoke anyone (Read from source: `brambled/admission/loop.go`).

- If a relay disappears, tunnels that already run peer to peer keep running. Nodes that cannot reach each other directly lose that path unless another relay is in the relay registry: relay discovery is on-chain, and `brambled` buys a session from another relay when a data relay stalls (`watchDataRelayFailover`; Gate 4.3 in the [build plan](docs/05_BUILD_PLAN.md) records a live kill-and-failover run on 10 Sept 2026). New endpoint exchange needs a reachable rendezvous relay (Read from source).
- If the RPC provider disappears, ENS reads fail. The sidecar uses one RPC URL (`SEPOLIA_RPC_URL`, default a public Sepolia endpoint) and has no second provider. `brambled` keeps admitted peers for `-max-stale` (default 2 minutes) and then removes them, which drops their tunnels. The only remedy is to point `SEPOLIA_RPC_URL` at another provider and restart. Revocation, enrollment and ACL changes cannot take effect while ENS is unreachable (Read from source).
- Tor adds a dependency. The node has no clear-net fallback by design: `brambled` fails to start if the sidecar's Tor client is not ready within its wait (a sidecar that predates Tor and answers 404 on `/tor/status` is treated as ready), and the sidecar's data routes answer 503 until then ([ADR 0013](docs/adr/0013-tor-transport.md)). If the Tor network is blocked where a node runs, that node cannot read ENS (Read from source; Open: no test from a network that blocks Tor).
- Hedera testnet and the Blocky402 facilitator are required to buy relay sessions, so a node without them cannot buy a new one.

**O (open source).** Bramble is MIT-licensed ([LICENSE](LICENSE)). The Tor client, tor-js 0.4.4, is MIT OR Apache-2.0 (Read from source: its `package.json`). Anyone can build and check it: `pnpm install --frozen-lockfile`, `pnpm verify` and `pnpm test:access-flow` need Node 22, pnpm 10, Bun and Go 1.27, and no account or key. Services we do not host stay outside this claim: the public Sepolia RPC endpoint, the hackathon ENSv2 deployment, Hedera testnet and the Blocky402 facilitator. We have not checked their licences (Open).

**P (privacy).** Each row is what that party learns.

| Party                                         | What it learns                                                                                                                                                                                                                                                                                              | Label                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| RPC provider                                  | A Tor exit address, not the node's IP address. It still sees the tailnet name, the device labels and the records read, and the polling rhythm. It cannot tie them to one machine unless the node's traffic pattern or payments give that away.                                                              | Read from source. The exit-address check ran against the Tor Project's check service, not this provider (Verified, 6 Nov 2026) |
| Payment endpoint (relay-sidecar)              | A Tor exit address, on a circuit separate from the ENS reads. It also learns the payer's Hedera account, which is public on the ledger with the amount.                                                                                                                                                     | Read from source                                                                                                               |
| Rendezvous relay                              | The node's IP address, its WireGuard key, its peer's key, the paid token and the node's public endpoint. The relay and relay-sidecar run on one machine, so the operator can link the payer's Hedera account to the node's IP address and key.                                                              | Read from source (inference from source, untested)                                                                             |
| Data relay                                    | Each participant's source IP address on the session's UDP port. The operator can associate the payer with that session.                                                                                                                                                                                     | Read from source (inference from source, untested)                                                                             |
| Data-relay price quote (`GET /price`)         | The node's IP address. `brambled` sends it directly, not through Tor.                                                                                                                                                                                                                                       | Read from source                                                                                                               |
| STUN server                                   | The address and port of whoever asks. STUN uses UDP and shares the WireGuard socket, so it cannot use Tor. Discovery stays in memory and does not publish topology to ENS. A STUN result does not prove a direct path works across a NAT. See [STUN reference](brambled/README.md#stun-endpoint-discovery). | Read from source                                                                                                               |
| Peers                                         | Each other's IP addresses, because WireGuard is UDP and Tor carries TCP only.                                                                                                                                                                                                                               | Read from source                                                                                                               |
| Tor guard relay and the node's network        | That this host uses Tor. They do not see the RPC request.                                                                                                                                                                                                                                                   | Read from source                                                                                                               |
| DNS for `-rendezvous` and `-data-relay` names | The system resolver sees the relay host names.                                                                                                                                                                                                                                                              | Open                                                                                                                           |

The sidecar sends its ENS reads and x402 payment HTTP through Tor under separate isolation keys, so they never share a circuit (Verified, 5 Nov 2026 spike; two requests left through two different exits on 6 Nov). The Hedera signer made no call on the network paths our test guards ([audit](docs/W9a_NETWORK_CALL_AUDIT.md); the guard cannot see native addons or every Bun import, so this does not prove no packet was sent). tor-js is marked experimental by its authors, and we claim only that requests leave through Tor exits.

**S (security).** Every key is held in software today.

- The node's WireGuard key (`BRAMBLE_PRIVATE_KEY`) is an ordinary software key and can be copied while the device is authorized. Revoking the device on ENS is the remedy.
- The payer's Hedera key (`HEDERA_CLIENT_PRIVATE_KEY`) is a software key. `HEDERA_MAX_PAYMENT_ATOMIC` caps each payment.
- Enrollment transactions are software-signed with `SEPOLIA_PRIVATE_KEY`. `admincli` has an opt-in Ledger signing path (`LEDGER_SIGN=1`), but Ledger signing is out of scope for this build and the demo does not use it, so the Ledger paragraphs further down describe that path and not the default.
- The access-rule (ACL) write is software-signed. Key Ring encrypts the granter's key at rest, and `admincli` decrypts it briefly on the admin's machine for each grant, without a device confirmation per grant ([ADR 0001](docs/adr/0001-ledger-ring-vs-send-split.md)).
- Administrator authority over the ENS registry remains. A compromised admin key can enroll or revoke devices.

## Why the integrations matter

- **ENSv2** is the authorization source. Permissioned registries, per-name resolvers, and Enhanced Access Control separate enrollment, rotation, revocation, ACL, and relay-registration rights.
- **Ledger** serves two distinct roles: an operator's device signs the four new-device enrollment transactions through `@ledgerhq/hw-app-eth` (since `wallet-cli send` doesn't support Sepolia), while a Key Ring encrypts the administrator's ACL-granting key at rest. The latter is decrypted briefly in the admin process per grant, without a per-grant device confirmation; the ACL write is software-signed. Full status, hardware findings, and Ledger DX feedback are documented in [ADR 0001](docs/adr/0001-ledger-ring-vs-send-split.md) and [Ledger DX feedback](docs/12_LEDGER_DX_FEEDBACK.md).
- **Hedera** settles x402 payments through Blocky402 for relay access. Rendezvous uses a fixed session fee; data relays sell explicit byte allotments at a published price.

## Architecture

```mermaid
flowchart TD
    client["ordinary client / worker"] --> forward["localhost forward"]
    forward --> mesh["WireGuard encrypted mesh"]
    mesh --> gateway["gateway CONNECT + ACL"]
    gateway --> service["private localhost service"]
    gateway -. "reads device/granter state" .-> ens["ENSv2 Sepolia"]

    peerA["peer A"] --> relay["paid rendezvous or data relay"] --> peerB["peer B"]
    relay --> payment["x402 + Blocky402 + Hedera"]
```

The relay can affect availability but does not decide admission: a peer only configures a WireGuard public key after resolving an authorized ENS record. Device records contain public keys, authorization state, and each device's own mesh address (`mesh-ip`, written once at enroll time — see [ADR 0009](docs/adr/0009-mesh-ip-allocation.md)). Relay endpoints live in a separate relay registry.

The runtime is split into five small programs:

- `brambled/`: per-node WireGuard daemon, admission loop, gateway, local forwards, relay selection and recovery.
- `sidecar/`: loopback-only ENS and payment client used by one node.
- `relay/` and `relay-sidecar/`: rendezvous/data forwarding plus public x402 resource server.
- `admincli/`: ENSv2 enrollment, role, key, ACL, and relay-registry writes.
- `dashboard/`: read-only device and relay view. Its server exposes only explicit GET routes and cannot forward payment calls.

See [the architecture document](docs/03_ARCHITECTURE.md) and [ADRs](docs/adr/) for trust boundaries and rejected alternatives.

## Quick start: install a device

```sh
curl -fsSL https://console.13-233-181-104.sslip.io/install.sh | sh
```

The installer verifies the archive checksum, installs `bramble`, `brambled` and `bramble-sidecar` under `~/.bramble/bin/`, and starts the local UI. Open the printed loopback address (normally `http://127.0.0.1:7777`). Name the device, join the prefilled `bramble-dev-c91e55e9.eth` tailnet, and ask the operator to approve enrollment in the console. A service grant is a separate approval. No Go, Bun, Node.js, pnpm or sudo is needed on the device in default userspace mode. On a headless device, append `-s -- --no-open` to `sh` and open the printed URL manually.

**Read from recorded acceptance, 6 November 2026:** public release `970461c` installs and enrolls on non-cloud Linux amd64. The fresh device stays `approved` with no peer path; its service test returns `ok:false,status:0,ms:95000`. Working second-device service access remains **Open** on ETH-293. Automatic browser opening and the completed screen sequence remain unverified. Linux arm64 and both macOS targets are build-only. See the [acceptance log](docs/measurements/2026-11-06-onboarding-acceptance.md), [join-test guide](deploy/JOIN-TEST.md) and [release reference](docs/reference/node-release.md).

## Build and verify from source

Requirements: Node.js 22, pnpm 10, Bun, and Go 1.27.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:access-flow
```

`test:access-flow` runs a rootless, deterministic integration test with real userspace WireGuard nodes and real TCP proxying. It exercises an allowed private task, denial outside scope, a live capability expansion, the identical newly-allowed task, and device revocation. Its resolver is in-memory; live ENS transactions and two-machine behavior are separately recorded in the [node runbook](brambled/README.md).

The dashboard is part of the root pnpm workspace and Turbo graph:

```sh
pnpm dev:dashboard
pnpm --filter @bramble/dashboard verify
```

## Configuration

Copy secrets into an ignored `.env` file or the process environment. Never commit values.

| Variable                              | Used by              | Purpose                                                             |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------- |
| `BRAMBLE_TAILNET_NAME`                | node/admin tools     | Full ENS tailnet name                                               |
| `BRAMBLE_TAILNET_REGISTRY`            | node/admin tools     | ENSv2 device registry address                                       |
| `BRAMBLE_RELAY_REGISTRY`              | node/dashboard       | Separate relay registry address                                     |
| `BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK` | node/dashboard       | First block to scan for relay labels                                |
| `BRAMBLE_PRIVATE_KEY`                 | node                 | This node's WireGuard private key                                   |
| `SEPOLIA_RPC_URL`                     | ENS clients          | Optional Sepolia RPC override                                       |
| `SEPOLIA_PRIVATE_KEY`                 | admin tools          | Software signer for commands that have not yet been moved to Ledger |
| `HEDERA_CLIENT_ACCOUNT_ID`            | node payment sidecar | Testnet payer account                                               |
| `HEDERA_CLIENT_PRIVATE_KEY`           | node payment sidecar | Testnet payer key                                                   |
| `HEDERA_MAX_PAYMENT_ATOMIC`           | node payment sidecar | Per-payment ceiling; defaults to 100,000 atomic USDC (0.10 USDC)    |

`brambled serve` also applies `-max-relay-price-per-byte` and `-max-relay-session-cost` before purchasing a data-relay session. See [brambled's command reference](brambled/README.md) and the package READMEs for the full launch flags.

## Demo path

Use the [operator demo script](docs/DEMO_SCRIPT.md) for beats 1–5 and the [rehearsal guide](deploy/REHEARSAL.md) for automated beats 1, 2, 3 and 5.

1. Install and request enrollment with the quick start above. The operator approves membership. This is onboarding, separate from service authorization; fresh-device connectivity remains Open.
2. Use the existing enrolled cloud worker for the accepted lifecycle: its `task` call is denied without a grant. The operator approves its service request in the console.
3. Repeat the identical call without restarting either node. The two recorded cloud passes return HTTP 200. Show payment and new Hedera Consensus Service (HCS) evidence only when independently recorded; a successful task call does not prove either display works.
4. Show direct-path, hole-punch and relay-fallback results only from a separately accepted run. The cloud pair's direct endpoint does not establish traversal across separate NATs or fresh-device relay acceptance.
5. Revoke the service grant and repeat the call. The recorded cloud calls fail 46.1 and 50.8 seconds after revoke starts, including confirmation and call completion. Enrollment revocation is a separate operation.

The new demo uses software signing, including enrollment. The pre-existing optional Ledger path is not used. The [dated acceptance log](docs/measurements/2026-11-06-onboarding-acceptance.md) records builds, conditions, failures and follow-up tickets. These are reported runs, not a claim that the public demo is running now: the gateway and worker were confirmed stopped at 16:10 UTC on 6 November.

## Payment flow

1. A node discovers relay labels and public payment URLs from the ENS relay registry.
2. It requests a rendezvous token or data-relay byte allotment from a relay-sidecar.
3. The relay-sidecar responds with x402 payment requirements.
4. The node sidecar signs a Hedera testnet USDC payment, subject to its configured atomic cap, and retries the request.
5. Blocky402 verifies and settles the payment. The resource server returns a one-use rendezvous token or ephemeral UDP relay session and Bramble prints the settlement ID.

## Evidence and limitations

The [build plan](docs/05_BUILD_PLAN.md) links the adversarial tests, live Sepolia transactions, two-machine runs, physical Ledger findings, and Hedera settlement IDs. The measured already-connected revocation time was 3.7 seconds with a five-second poll interval and a responsive resolver. Over Tor, the sidecar's ENS poll took a median of 7.0 to 11.5 seconds across two 10-minute runs on 6 November 2026, against 3.9 to 4.4 seconds without Tor on the same machine, with a worst case of 29 seconds. The Tor figures come from replaying a timed trace on one machine, not from a live revocation. See the [measurement note](docs/measurements/2026-11-06-revocation-over-tor.md).

This is a hackathon prototype. STUN endpoint discovery is available through `-stun-servers` or `BRAMBLE_STUN_SERVERS`; `GET /endpoint` on the node status API reports the observation. Separate-NAT hole punching and relay-fallback acceptance remain Open on ETH-39; the latest cloud passes use a direct endpoint, and the fresh-device relay/service test fails. See the [onboarding acceptance log](docs/measurements/2026-11-06-onboarding-acceptance.md). Mesh IPs are auto-assigned at enroll time and peer discovery is full-mesh-by-default when no `-peer` flags are given (`docs/adr/0009-mesh-ip-allocation.md`, `docs/adr/0010-full-mesh-peer-discovery.md`) — network-layer admission only, ACL still gates service access independently. The default public Sepolia RPC endpoint is a load-balanced pool with observed multi-thousand-block sync lag between backends; **export** `SEPOLIA_RPC_URL` to a dedicated endpoint before launching admin commands and nodes for a live demo. Relay sessions use first-two-source UDP learning, do not handle NAT remapping, and expire after five minutes. A node key is an ordinary software key and can be copied while authorized. The payer is likewise a software key. ENS/RPC availability, administrator authority, host security, and relay availability remain dependencies.

## Open source and AI usage

Licensed under the MIT License. Third-party libraries and starter code retain their own licenses. AI assistance and the human-directed design trail are disclosed in [AI usage](docs/AI_USAGE.md).
