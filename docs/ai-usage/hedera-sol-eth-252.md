# Hedera-Sol AI usage — ETH-252

Demo beats: 1–5. Swept committed `origin/hackathon` at `4928612` with local
value-redacted pattern and entropy checks. Inspected deployment units, the
installer, approval authentication, signer diagnostics, and MCP provisioning.
No external scanning service or live credential file was used.

Verified: signer diagnostics can expose a synthetic credential; the regression
fails before the logging fix and passes after it. A synthetic key generator
reproduces mode 644 output before the permission fix and mode 600 after it.
The key CLI check also covers public-only output and overwrite refusal.

Read from source: one shared approval token authorizes all POST routes. Removed
the general agent recipe that exports and persists it. The assignment's Pi
token-file exception remains explicit; live file isolation is Open.

Paths written:

- `package.json`
- `.gitignore`
- `agent-mcp/README.md`
- `agent-mcp/REFERENCE.md`
- `approval/src/lib/service.ts`
- `approval/test/api.test.ts`
- `deploy/scripts/gen-node-key.sh`
- `deploy/scripts/gen-node-key.test.sh`
- `docs/ai-usage/hedera-sol-eth-252.md`
