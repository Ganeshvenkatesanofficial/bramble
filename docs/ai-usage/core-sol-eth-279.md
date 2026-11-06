# Core-Sol ETH-279 path record

Demo beat 4: sponsored relay bootstrap and failover.

Paths written:

- `brambled/datarelay_endpoint_test.go`
- `docs/ai-usage/core-sol-eth-279.md`

Verified: the bootstrap regression fails before the fix. Delaying cloud admission
for 12 seconds causes a second sponsored session before any WireGuard handshake.
