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

Validation recovery on 6 November 2026:

- Updated only the public `APPROVAL_ENS_PARENT` setting in `/home/anonjr/.config/bramble/approval.env` and restarted the existing console service to enable real-tailnet enrollment (ETH-269).
- Wrote validation drivers and evidence under `/home/anonjr/bramble-work/status/eth-244/`: `w2-beats.py`, `w2-install.py`, `w2-join.py`, `sol-w2-*.log`, `sol-w2-*.json`, `sol-w2-public.env`, `sol-w2-public-SHA256SUMS`, `sol-w2-pr.md`, `sol-w2-report.md`, and the isolated `w2-public-device/` runtime.
- Built the ignored `release/bramble_{linux,darwin}_{amd64,arm64}.tar.gz` archives and `release/SHA256SUMS` from committed revision `0368f81`; published them to the existing console distribution host under ETH-244 operator authorization.
- Wrote task evidence and PR #50 work-product metadata through Paperclip.

ETH-270 publisher fix paths:

- `deploy/scripts/gen-node-config.mjs`
- `deploy/scripts/gen-node-config.test.mjs`
- `deploy/env/public.env.example`
