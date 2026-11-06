# ADR 0018 — Operator-sponsored relay sessions for key-less devices

**Status:** Decided 6 Nov 2026 (ETH-189, spec decision D11 of ETH-177). Builds on `adr/0007` (rendezvous token), `adr/0008` (port-per-session data relay) and `adr/0010` (auto-discovered peers).

## Context

A device that has just been enrolled through the curl-install flow has a WireGuard key and an ENS label. It has no Hedera key, and it often has no direct path to a cloud node (symmetric NAT, or a firewall that drops inbound UDP). The paid relay path cannot serve it, for three reasons (Read from source):

1. `sidecar/src/payments/client.ts` signs an x402 payment with `HEDERA_CLIENT_PRIVATE_KEY` for both the rendezvous token (`POST /rendezvous-token`) and the data-relay session (`POST /data-relay-session`). Without the key, both calls fail.
2. `brambled serve` only routes a peer through the relay if that peer is named with `-relay-peer`. There is no "all peers" form.
3. The cloud side learns the relay `ip:port` only through the rendezvous exchange, after its admission loop has authorized the device (`watchDataRelayAdopt`). That is unchanged by this ADR; see "Open" below.

## Decision

The relay operator can opt in to pay for enrolled devices. The change is small. The paid path still pays the same way, but it shares two changes to the relay loops in `brambled`: the failover renewal round, and the 3 s minimum for each adopt poll (both under Consequences).

- **Relay flag `-sponsor-enrolled`** (default off; requires `-meter` and `-data-relay`). `-sponsor-bytes` sets the cap of one session (default 1 MiB). `-sponsor-max-per-hour` sets how many sponsored tokens, and separately how many sponsored sessions, one label may take per hour (default 30).
- **Two unpaid routes in `relay-sidecar`**, outside the x402 `routes` table: `POST /sponsored/rendezvous-token` and `POST /sponsored/data-relay-session`. Each takes `{"label": "<device label>"}`.
- **The enrollment check** runs in `relay-sidecar` (`src/ens.ts`) because only the TypeScript side reads ENS. It applies the same rule as `brambled/admission/loop.go`: a non-empty `pubkey` record, a registry expiry in the future, and no `revoked=true` record. The relay reads ENS directly, not through Tor, because it sees every peer's source IP anyway.
- **The Go relay clamps the grant** to `-sponsor-bytes` itself (`allocateSponsored` in `relay/datarelay.go`), so a bug in the TypeScript side cannot grant more than the cap. A sponsored session uses the same port-per-session forwarder and byte accounting as a paid one.
- **`brambled serve -sponsored-relay`** swaps the payer. `brambled/sponsor.Payer` calls the two routes over plain HTTP from `brambled` itself and settles nothing on-chain. `-relay-first` marks every tracked peer a `-relay-peer`. The relay code takes a `relayPayer` interface, so `*sidecar.Manager` (paid) and `*sponsor.Payer` (sponsored) share every other line.

## Honest claim

- Operator-sponsored, in the demo: the operator pays nothing on-chain for a sponsored session and carries the bandwidth cost. This is a demo subsidy, not a payment mechanism.
- The relay sees the device's source IP and its label on every sponsored call. The call does not go through Tor.
- A label is public. The check proves that the label is enrolled, not that the caller owns it. The per-label hourly limit and the byte cap bound what anyone who knows a label can use. Proof of key ownership would need the device to sign the request with a key the relay can verify; WireGuard's X25519 key cannot sign, so this is Open.
- The relay still cannot read the traffic: WireGuard terminates at the two nodes.

## Consequences

- A relay without `-sponsor-enrolled` behaves exactly as before. The `/sponsored/*` routes do not exist on it.
- The sponsored routes cost the operator RPC reads. The sidecar caches an enrollment answer for 30 seconds and caps the cache at 1024 labels.
- A sponsored session ends at its cap or its 5-minute TTL, like a paid one. The relay stops forwarding, which the buying side sees as a stall. `watchDataRelayFailover` excludes the stalled relay and tries the rest of the pool. When every relay in the pool has stalled since the last round, it starts a new round over the whole pool, so with one relay it asks the same relay for a new session. Failed attempts back off from 5 s to 3 minutes after the second failure in a row. The paid path runs the same renewal round and backoff, so a paid node with one relay now also asks that relay again instead of giving up. Verified for the cap with the real relay binary (`TestSponsoredRelay_RenewsSessionAtCapWithOneRelay`: 64 KiB cap, a second session, then HTTP 200). TTL expiry takes the same path; no test waits out the TTL.
- The relay allows one label 30 sponsored tokens an hour by default, and a node that adopts peers (`watchDataRelayAdopt`) takes a token from every relay on each poll. Polling every 3 s would use the allowance in about 90 s. With `-sponsored-relay`, the adopt loop polls only while the peer's traffic has stalled, and a shared limiter (`brambled/sponsor.PollLimiter`, sized by `-sponsored-tokens-per-hour`) holds polling a fifth under the limit: a burst of 6, then one poll every 200 s. If a poll has to wait for the limiter, the loop checks for the stall again after the wait, so a link that recovered meanwhile is not polled and takes no token (`datarelay.WaitForStallWithToken`). Verified: the cloud side took no token on a healthy link for 15 s in the renewal test. The paid path keeps its earlier polling, except that a poll that fails fast now still takes 3 s.
- Errors from the registry read or the relay's allocation reach the caller as a fixed message. The reader's error can include the RPC URL, which may carry an API key; the sidecar logs only the error's class.
- `-relay-first` opens one session per tracked peer. On a tailnet with many devices, name the cloud labels with `-relay-peer` instead.

## Open

- **Cloud node tracks the device only after a restart.** The peer list is fixed at startup (`adr/0010`). A cloud node that started before the device was enrolled does not track it, so its admission loop never runs the exchange for it. Until periodic re-discovery exists (not built), restart the cloud node after enrolling a device.
- The cloud node needs a data-relay pool (`-data-relay` or the relay registry) for `watchDataRelayAdopt` to run, and a token source: its own Hedera key, or `-sponsored-relay` too.
- The live relays machine has not been run with `-sponsor-enrolled` (needs an operator deploy).
