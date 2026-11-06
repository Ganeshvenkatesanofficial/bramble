# Approval console network reference

**Kind:** Reference. **Demo beats:** 2 (approve), 4 (direct and relay paths), 5 (revoke).

## Authorization and data

The approval console uses the existing operator bearer token for both network
routes. The browser holds the token in tab memory. Lock and reload clear it.
`dashboard/` remains read-only. Grant and revoke services are unchanged.

`GET /api/network` reads `/peers` and `/relays` from the gateway at the existing
server-side `BRAMBLED_STATUS_URL`. It merges those observations with device joins,
ENS members and service requests. All responses use `Cache-Control: no-store`.

The response contains `state`, `relayState`, `membershipState`, `observedAt`,
`nodes` and `links`. Source states are `ok`, `not_configured` or `unavailable`.
Node fields include `id`, `label`, `kind`, `admission`, optional `membership`,
`grants`, `lastHandshake`, `path` and `pingable`. Each grant entry identifies a
request, service, gateway and request state. Pending requests do not replace
active grants. Tunnel admission and service grants are separate facts.

The topology response omits public keys, private member endpoints,
allowed IPs and relay URLs. Unauthenticated callers receive `401`; missing token
configuration returns `503`. Upstream errors use fixed messages.

## Path interpretation

The graph shows the configured gateway's perspective. It includes observed
devices, known joins and members, the gateway, and data relays in that gateway's
relay pool. It does not discover rendezvous-only relays or links between other
members that the gateway cannot observe.

An admitted peer whose endpoint host matches a configured relay host has a
`relayed` link through that relay. With a complete relay table, an unmatched
observed endpoint is `direct`. Missing endpoints or unavailable relay discovery
produce `unknown`. Non-admitted or unobserved devices have no observed link.
The server resolves relay DNS names with bounded A/AAAA lookups. Failed relay
resolution keeps unmatched paths `unknown`.
Host matching cannot distinguish a direct peer colocated on a relay host from
a relay allocation. A line never proves reachability. Handshake timestamps are
the gateway's last recorded WireGuard handshake, not a freshness guarantee.

The UI polls every five seconds. Failed refreshes label the last snapshot stale
and pause probes. Lock removes private node details. The diagram shows up to 24
nodes; the labeled node list retains every returned node. Solid, dashed and
dotted links distinguish paths without relying on color. The node list provides
state, timestamps and keyboard-operated probe buttons.

## Probes

`POST /api/network/ping` takes `{"id":"peer:<label>"}` or
`{"id":"relay:<label>"}`. It rejects arbitrary addresses and unknown identifiers.

For admitted tracked devices, the approval server forwards the exact tracked
label to the gateway's existing `/ping` probe. This runs an ICMP echo over the
gateway's tunnel. Unobserved members have a disabled button and an explanation.

For configured data relays, the server measures the HTTP `/health` request and
bounded JSON response, from the approval server. The relay must return
`{"ok":true}`. This measurement is labeled **HTTP RTT**. It measures health API
latency, not WireGuard forwarding or device-to-relay latency.

Both responses contain `reachable`, `rttMs` (nullable), `method` (`icmp` or
`http`), `measuredAt` and a fixed `detail`. No reply or a timed-out probe is a
failure, not proof of revoked access. ICMP can be blocked independently of access.
The UI records the measurement timestamp and clears the prior result on retry.

## Verification scope

The browser tests use the real approval HTTP handler with an in-memory chain and
synthetic status responses. They perform no live network transactions. They
cover keyboard unlock, approve and revoke; graph authentication; device and relay
probe success and failure; stale data; theme contrast; and horizontal overflow.
The axe scans cover WCAG 2/2.1 A and AA at 1280 and 390 CSS pixels in both themes.
Separate palette assertions require 4.5:1 text and 3:1 control/focus contrast.
Screenshots and axe JSON are task attachments. Automated scans and fixtures do
not establish live cloud connectivity or complete manual WCAG conformance.

Run the package build, then `pnpm --filter @bramble/approval test:ui`. Alternate
ports use `BRAMBLE_TEST_UI_PORT` and `BRAMBLE_TEST_API_PORT`. The Playwright
browser path can use `PLAYWRIGHT_BROWSERS_PATH` when supplied by the environment.
