# W9a network-call audit: Hedera signer and `brambled`

Reference note for ticket ETH-40, 6 November 2026. It answers two questions from `docs/15_MUMBAI_HANDOFF.md` section 5.1:

1. Does `@x402/hedera`'s `createClientHederaSigner` reach the network outside the `fetch` it is wrapped by?
2. Does `brambled` make direct RPC calls?

Evidence labels follow the handoff: **Verified** (ran it), **Read from source** (code only), **Open** (not tested).

## Summary

| Question | Answer | Label |
| --- | --- | --- |
| Does `createClientHederaSigner` open a socket, DNS lookup, UDP send or WebSocket of its own? | No. Signing is local. | Verified (test) and Read from source |
| Does the full sidecar payment path (`payForRendezvousToken`, `payForDataRelaySession`) use any network except the global `fetch`? | No. Every byte goes through `fetch`, so `torFetch('pay')` carries all of it. | Verified (test) |
| Does `brambled` make direct blockchain RPC calls? | No. It has no RPC client, and it reads ENS only through the sidecar's loopback API. | Verified (static) and Read from source |
| Which calls from a node cannot go over Tor? | See "Calls that cannot go over Tor". | Read from source |

No follow-up ticket is required by the done condition, because `brambled` has no direct RPC. The audit found two direct relay calls that the handoff did not list. See "Findings that need a decision".

## 1. Hedera signer

### Read from source

Versions: `@x402/hedera` 2.25.0, `@hiero-ledger/sdk` 2.85.0, `@x402/core` 2.25.0, `@x402/fetch` 2.25.0.

- `createClientHederaSigner` returns an object whose only method is `createPartiallySignedTransferTransaction`. The method builds a `TransferTransaction`, sets an explicit transaction ID from the `feePayer` in the payment requirements, calls `Client.forTestnet()`, `freezeWith(client)` and `sign(privateKey)`, then calls `client.close()` in a `finally` block.
- `Client.forTestnet()` builds the node table from a bundled address book. The SDK opens gRPC channels lazily, on the first query or execute.
- `freezeWith` takes the node account IDs from that bundled table (`client._network.getNodeAccountIdsForExecute()`). It makes no network call.
- The SDK schedules an address-book refresh with `setTimeout` 24 hours after construction (`Client._scheduleNetworkUpdate`). `client.close()` clears that timer. The signer always closes the client, so the refresh never runs.
- `@x402/fetch` `wrapFetchWithPayment` calls only the `fetch` it receives: the first request, an optional hook request, and the paid retry.
- `@x402/core` calls `fetch` itself only in `HTTPFacilitatorClient` (`/verify`, `/settle`, `/supported`). That class belongs to the resource server, not the payer. `relay-sidecar/src/index.ts` is the only Bramble user.
- `@x402/hedera` also exports server-side helpers that do network I/O: `createHederaVerifyPayerSignature` and `createHederaPreflightTransfer` call the Hedera mirror node with the global `fetch`, and `createHederaSignAndSubmitTransaction` sends to consensus nodes over gRPC. Bramble's sidecar does not import any of them. Do not import them into `sidecar/`.
- Settlement happens at the facilitator (Blocky402), not at the payer. The payer's node never talks to the facilitator or to a Hedera node.

### Verified (test)

`sidecar/test/hedera-signer-network.test.ts`, with the guard in `sidecar/test/helpers/network-guard.ts`.

The guard replaces `net.Socket#connect` (every TCP and TLS client, including `http`, `http2`, gRPC and undici), `dgram` send, bind and connect, every `dns` lookup and resolve function, `WebSocket`, and the Bun equivalents. Each blocked call is recorded and throws. The global `fetch` becomes a stub that records the request. The test fails if the guard records anything.

| Test | What it proves |
| --- | --- |
| `createClientHederaSigner signs a transfer with no socket, DNS or UDP call` | The signer produces a signed `TransferTransaction` (payer to `payTo`, USDC `0.0.429274`) with zero guard hits, zero `fetch` calls, and no leftover network handle or timer. |
| `payForRendezvousToken reaches the network only through fetch` | The production function makes exactly two `fetch` calls (the 402, then the paid retry carrying `PAYMENT-SIGNATURE`), and zero guard hits. |
| `payForDataRelaySession reaches the network only through fetch` | Same, for the data-relay session purchase. |
| Guard self-check: TCP, DNS, UDP | The guard records `net.connect`, `dns.lookup` and `dgram` `send`. |
| Guard self-check: Hedera SDK | The guard records the SDK's gRPC connect when a real `AccountBalanceQuery` runs. A guard that never fires would also pass the signer tests, so this test shows the guard can see SDK traffic. |

The tests use a generated throwaway ECDSA key and fixed fake account IDs. They read no credential and send no packet.

Run on 6 November 2026 from `sidecar/`, all 5 tests passing under each runtime:

```sh
npx vitest run test/hedera-signer-network.test.ts            # Node 24.15.0, vitest 5.0.0
bun --bun x vitest run test/hedera-signer-network.test.ts    # Bun 1.4.0 (the sidecar's runtime)
```

Limits of this evidence:

- The test covers the `network: 'hedera:testnet'` path with no `nodeUrl`, which is the path `sidecar/src/payments/` uses. Mainnet is the same code path but untested.
- Under Bun, the guard does not check for leftover handles, because Bun has no `process.getActiveResourcesInfo`. The Node run does.
- The Bun run used 1.4.0. The 5 November spike used 1.3.14.
- The test stubs the relay. It does not prove the live relay-sidecar, facilitator or Hedera network accept the payment. Gate 0.4 covers that.
- When W9 changes `payForRendezvousToken` to use `torFetch('pay')`, update the stub target in this test. The assertion stays the same: nothing but the injected fetch touches the network.

## 2. `brambled`

### Verified (static)

Commands run from `brambled/` on 6 November 2026 with Go 1.27.3:

```sh
go list -deps ./... | grep -iE 'ethereum|jsonrpc|rpc|web3|grpc|viem'   # no output
go build -o "$BIN" . && strings "$BIN" | grep -c -E 'eth_|jsonrpc|infura|alchemy|sepolia'   # 0
```

`go.mod` requires only `golang.org/x/{crypto,net,time,sys}`, `golang.zx2c4.com/wireguard`, `gvisor.dev/gvisor` and `github.com/google/btree`. There is no Ethereum, JSON-RPC or gRPC client in the module graph, and no JSON-RPC method name in the built binary. This shows that `brambled` has no RPC client. It does not exclude a hand-written request over `net/http`, so the call-site review below covers that.

### Read from source: every outbound call in non-test code

| Call site | Destination | Over the network? | Goes through the sidecar? |
| --- | --- | --- | --- |
| `sidecar/client.go`, `sidecar/manager.go` | `localhost:<sidecar port>` (ENS device, devices, relays; payment routes; `/health`) | Loopback only | Yes. This is the only path to ENS and Hedera. |
| `sidecar/manager.go` `Start` | Runs `bun run src/index.ts`. It passes `SEPOLIA_RPC_URL` to the child as an environment variable and never uses it itself. | None | n/a |
| `main.go` `quoteDataRelay` | `GET <relay-sidecar URL>/price`, from the `-data-relay` flag | **Direct, from the node's IP** | **No** |
| `rendezvous/client.go` `Exchange` | TCP to the `-rendezvous host:port` relay. It sends the node's public key, the peer's public key, a candidate endpoint and the payment token. | **Direct, from the node's IP** | **No** |
| `wgnode/node.go` (`conn.NewDefaultBind`) | WireGuard UDP to peers and data relays | Direct UDP | No |
| `main.go` `net.Dial` (non-netstack mode), `wgnode` `DialTCP`/`ListenTCP`, `gateway/forward.go` | Mesh IPs, inside the WireGuard tunnel | Inside the tunnel | n/a |
| `gateway/server.go` | `127.0.0.1:<service port>` | Loopback only | n/a |
| `statusapi/server.go` | `ping` of a tracked peer's mesh IP | Inside the tunnel | n/a |

`cmd/demo-agent` and `cmd/demo-service` are demo tools, not part of the node. `live_demo.go` only calls the sidecar and builds a HashScan link string.

Open: Go resolves host names in `-rendezvous` and `-data-relay` with the system resolver, so those lookups leave the node directly. Not tested.

## Calls that cannot go over Tor

| Call | Why | Who learns what | Label |
| --- | --- | --- | --- |
| WireGuard UDP to peers and data relays | Tor carries TCP only | Peers and relays see each other's IP addresses | Read from source |
| STUN binding requests (W8) | UDP | The STUN server sees the address of whoever asks | Read from source (handoff 5.4) |
| `rendezvous.Exchange` TCP to the relay | Opened by Go with `net.DialTimeout`, not by the sidecar. Whether tor-js can carry a raw TCP stream is untested. | The relay sees the node's IP, its WireGuard key, its peer's key and the payment token | Read from source; Tor support Open |
| `quoteDataRelay` `GET /price` | Opened by Go with `net/http`. It can move to the sidecar and `torFetch('pay')` because it is plain HTTP. | The relay-sidecar sees the node's IP | Read from source |
| DNS for `-rendezvous` and `-data-relay` host names | System resolver in the Go process | The node's DNS resolver sees the relay host names | Open |
| The payer's Hedera account ID and the amount | Public on the ledger (HashScan) | Anyone | Read from source |

Nothing in the Hedera signer or in the sidecar's payment HTTP appears in this table. That path is all `fetch`.

## Findings that need a decision

These go to Atlas as comments on ETH-40. None changes a handoff invariant.

1. **Payer-to-IP linkage at the relay (inference from source, untested).** Once the payment goes over Tor, relay-sidecar still mints a token whose nonce it knows, and the node presents that token at the relay over the direct `rendezvous.Exchange` connection (`relay/token.go`, `rendezvous/client.go`). The relay and relay-sidecar run on the same machine (ADR 0008), so one operator can link the payer's Hedera account to the node's IP address and WireGuard key. The handoff's claim that the relay operator "cannot link a node's reads to its payments" stays true for ENS reads. It does not cover payments to rendezvous. The README must say so. Closing the gap needs the rendezvous exchange to go through Tor (Open) or a token that the relay cannot link to the payment.
2. **Optional follow-up.** Route `quoteDataRelay` through the sidecar (for example a loopback route that calls `torFetch('pay')`). It removes one direct call and is small. It does not remove finding 1. Priority: after the W9 core work.
3. **No RPC follow-up needed.** `brambled` has no direct RPC, so the handoff's "route any found through the sidecar" has nothing to route.

## Exact wording for the README CROPS "P" line

Use this once W9 and W8 are merged. If W9 is not merged, drop the first sentence and say "over the public internet".

> **P (privacy).** The sidecar sends its ENS reads and its x402 payments through Tor on separate circuits, so the RPC provider sees only Tor exit addresses and cannot tie a node's reads to its payments; the Hedera signer makes no network calls of its own. Tor does not cover WireGuard traffic or STUN, which use UDP: peers and relays see each other's IP addresses, and a STUN server sees the address of whoever asks. The rendezvous exchange also connects to the relay directly, so the relay operator can link a node's IP address and WireGuard key to the Hedera account that paid for its token. A payer's Hedera account and payment amount are public on the ledger.

## AI usage

Written by Tor-Claude (Claude Sonnet 5.5). Paths: `docs/W9a_NETWORK_CALL_AUDIT.md`, `sidecar/test/hedera-signer-network.test.ts`, `sidecar/test/helpers/network-guard.ts`.
