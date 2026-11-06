# ADR 0010 — Full-mesh peer discovery by default

**Status:** Decided and implemented, Sept 12 2026. Builds directly on `adr/0009-mesh-ip-allocation.md` — this is the second half of the same conversation: mesh-ip allocation solved "what address does a peer get," this solves "which peers does a node even try to reach."

## Context

Even after ADR 0009, `-peer <label>` still had to be typed once per peer, by hand, on every node. That's not how Tailscale (or Headscale) behaves: every device in your tailnet is reachable from every other device by default, and an ACL policy narrows that down if you want it narrower. This project's own `brambled/README.md` already flagged the gap honestly: "`serve`'s peer *list* is still static CLI config... Discovering 'which labels belong to my tailnet' automatically... is a real design question, not just a scan." The scan part turned out to already exist — `sidecar/src/ens/devices.ts`'s `listDeviceLabels()`, built for ADR 0009's mesh-ip allocation — so the remaining design question was just: should a node default to tracking *every* registered device, and is that safe.

It's safe because admission and ACL are two separate boundaries, and this only touches the first one. Being in `-peer` (or now, auto-discovered) only gets a device a WireGuard peer-table entry and a candidate address — the same "tunnel exists" outcome Tailscale's full mesh gives every device by default. It does not grant it access to any *service*: `gateway.CheckACL` still independently checks a real, requester-bound ECDH digest before proxying anything (`docs/adr/0005`). A revoked or expired device auto-discovered into the peer list is still just never authorized by `admission.Loop`'s existing per-sync check — exactly the same outcome as if an operator had hand-typed `-peer that-device` themselves.

## Decision

**No `-peer` flags at all ⇒ auto-discover and track every other registered device on the tailnet.** Any `-peer` flag given at all disables this entirely and uses exactly what was typed — the same "explicit config beats discovery" precedent already used for `-rendezvous`/`-data-relay` (ADR 0003) and `-local-addr` (ADR 0009). This is additive: every existing documented runbook that hand-lists `-peer` is untouched.

**Mechanism**: `sidecar/src/routes/devices.ts` exposes `listDeviceLabels()` over the sidecar's loopback HTTP API (`GET /devices`) — a thin wrapper, mirroring `relaysRoute`'s existing shape exactly. `brambled/sidecar/client.go`'s new `Manager.ListDevices()` calls it. `brambled/main.go`'s `discoverAllPeers` calls that, drops `ownLabel`, and hands the rest to `resolvePeerMeshIPs` (ADR 0009) as bare peers — no new code path for the actual mesh-ip resolution, just a new way to arrive at an unresolved peer list.

**A peer that can't be resolved is skipped, not fatal — but only when auto-discovered.** `resolvePeerMeshIPs` gained a `skipUnresolvable` argument: false (an operator explicitly typed `-peer that-label`) hard-errors on a missing mesh-ip or address collision, since silently dropping something the operator asked for by name would hide a real misconfiguration. true (auto-discovered) logs a warning and drops just that one peer. This matters in practice, immediately: this dev tailnet has real devices enrolled before ADR 0009 existed (`device1`, `device2`, `ledger-granter-test`, `ledger-signed-demo`, `laptop-demo`) with no `mesh-ip` record at all. Full-mesh-by-default would otherwise refuse to start on a tailnet with one old device on it.

**Revoked/expired devices are intentionally not filtered out at discovery time.** `discoverAllPeers` includes them; `admission.Loop`'s existing authorization check (`pubkey != nil && expiry in future && !revoked`) is what actually excludes them, per-sync-cycle, the same as it always has for a hand-listed `-peer`. Filtering earlier would only be able to get it wrong in one direction — freezing a peer's exclusion for the life of the process even after it gets re-enrolled or un-revoked.

## Rediscovery (amended 6 Nov 2026, ETH-189)

The peer list is no longer fixed at startup. With auto-discovery on, `brambled serve` re-lists the tailnet every `-rediscover` interval (default `15s`, `0` turns it off) and starts tracking each new label without a restart. Before this, a gateway started before a device was approved never admitted that device (found by Keystone for demo beat 2).

- `peerTracker.discoverNew` (`brambled/rediscover.go`) resolves each untracked label's `mesh-ip` with the same `resolveMeshIPPrefix` as startup and gives it a `/32`. A label with no `mesh-ip` yet, or with one that collides with a tracked address, is skipped and retried on the next pass. Each skip reason is logged once.
- `admission.Loop.AddPeers` adds the new peers and asks the loop for an immediate sync pass. The new peer is admitted only if that pass finds its ENS record authorized, exactly like a startup peer. The gateway still checks the ACL (ADR 0005) on every CONNECT; it maps tunnel addresses through the tracker, so a new peer's address resolves to its label.
- Peers are never removed by rediscovery. A revoked or expired device stays tracked and `admission.Loop` keeps it out of the WireGuard table.
- An explicit `-peer` list is unchanged: no rediscovery.
- The sidecar's `GET /devices` now scans incrementally (`incrementalDeviceLabels` in `sidecar/src/ens/devices.ts`). The first call scans from the deploy block. Later calls scan from 8,000 blocks behind the last head, which is one `getLogs` call. The margin covers reorgs and a lagging pool backend of up to 8,000 blocks. `enroll.ts` still uses the full scan.

## Verification

Live against the real Sepolia dev tailnet, Sept 12 2026:

- Enrolled two fresh devices (`mesh-e2e-a`, `mesh-e2e-b`) and started both with **zero `-peer` flags on either side**. Log: `no -peer flags given — auto-discovered 5 other device(s) on the tailnet` on both. Each correctly admitted the other (`admission: mesh-e2e-b: authorized`, real matching pubkey, status API confirming a synthesized `/32` route) with no static peer config at all.
- Devices with a real, revoked-status `mesh-ip` record (four disposable test devices left over from ADR 0009's own live verification, revoked as part of this session's cleanup) correctly appeared in the tracked table but as `"authorized": false` — proving the revoked-device path works identically whether the peer came from `-peer` or auto-discovery.
- Devices with **no** `mesh-ip` record at all (`device1`, `device2`, `ledger-granter-test`, `ledger-signed-demo`, `laptop-demo`) did not appear in the tracked table and did not abort startup — the `skipUnresolvable` path worked as designed.
- `go test ./brambled/...` — new unit tests for `discoverAllPeers` (self-exclusion, bare-peer output, propagated list errors, empty-tailnet case) and `resolvePeerMeshIPs`'s two new skip-vs-error tests (unresolvable peer, colliding peer), both confirming an auto-discovered failure is logged and dropped rather than fatal.
- `sidecar/test/devices.test.ts` — originally a real, live `listDeviceLabels()` call against Sepolia, asserting non-empty and deduplicated output (see the RPC caveat below for why it doesn't pin a specific label). Since 6 November 2026 (ETH-86), the default suite runs against a fixture-backed RPC client instead, because public Sepolia nodes prune the registry's old logs (error 4444). The live call is opt-in with `BRAMBLE_LIVE_SEPOLIA=1`.

## A real reliability gap this surfaced, not introduced

The default RPC endpoint this repo falls back to (`https://ethereum-sepolia-rpc.publicnode.com`, used whenever `SEPOLIA_RPC_URL` is unset) is a load-balanced pool of independently-syncing backend nodes, not one consistent node. During this session's live verification, `eth_getLogs` calls against the exact same registry address, seconds apart, were served by backends whose synced head differed by **over 17,000 blocks** — and a `getEnsText` read landed on a backend that hadn't yet seen a write from a `setText` transaction confirmed moments earlier, causing `enroll.ts`'s mesh-ip allocation to hand out an address (`10.77.0.6/24`) already just assigned to another device (`agent-1`) by a manual backfill run immediately before it. Caught and fixed by hand this time (`set-mesh-ip.ts mesh-e2e-a 10.77.0.8/24`); a genuinely concurrent enrollment could hit the identical race un-observed.

This is not a bug in `listDeviceLabels`, `discoverAllPeers`, or the allocation logic in ADR 0009 — all three do the right thing with whatever the RPC returns. It's a property of the specific public endpoint this repo defaults to, one this session's live full-mesh test also hit directly: `discoverAllPeers` on a real running node found only 5 of the ~12 actually-registered labels on one call, because the backend it happened to land on was lagging. **For a live demo recording, set `SEPOLIA_RPC_URL` to a single dedicated endpoint** (Alchemy/Infura free tier, or any single non-load-balanced RPC) rather than relying on the default — this removes the inconsistency entirely, since the flakiness is specifically the *pool*, not any individual backend. Left as an explicit, disclosed limitation rather than worked around with retries/quorum logic this session, since the actual fix (a consistent RPC) is a one-line config change, not a code problem.

## Explicitly out of scope

- **Role-based subset discovery** (e.g., "only mesh with devices tagged X") — full-mesh-or-explicit-list is the whole policy surface for now; ACL already gates service access, which is the dimension that actually matters for the demo's story.
- ~~Retrying a peer that failed discovery-time resolution~~ — done by rediscovery (above): a skipped peer is retried on every pass.
- **Changing a tracked peer's mesh IP** — rediscovery only adds labels. A device whose `mesh-ip` changes after it is tracked keeps its old `/32` until restart.
