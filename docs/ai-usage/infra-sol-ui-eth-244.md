# Infra-Sol-UI: ETH-244 and ETH-255

Demo beats: 1, 2, 3 and 5; fresh-device enrollment supports beats 2 and 3.

Paths written:

- `scripts/release.sh`
- `scripts/release/install.sh`
- `scripts/release/install.test.sh`
- `scripts/release-smoke.mjs`
- `docs/reference/node-release.md`
- `docs/ai-usage/infra-sol-ui-eth-244.md`

Continues the uncommitted ETH-255 release integration fix from Infra-Claude.
The release bundles the node daemon, its helper and the compiled sidecar.
The installer starts `bramble up` and the daemon embeds the local UI.
