# Core-Sol: ETH-214

Demo beats: 2 (request and approve), 5 (revoke).

Paths written:

- `approval/src/lib/service.ts`
- `deploy/systemd/user/bramble-approval.service`
- `deploy/systemd/user/bramble-console-tunnel.service`
- `deploy/env/admin.env.example`
- `deploy/APPROVAL-USER-SERVICE.md`
- `docs/ai-usage/core-sol-eth-214.md`

Signer logging reuses the identical change proposed by Infra-Claude in PR #39.
Runtime configuration stays outside git under the admin user's persistent home.

Operational files written outside git:

- `/home/anonjr/.config/bramble/approval.env` (authorized migration; secret values stay private)
- `/home/anonjr/.config/systemd/user/bramble-approval.service`
- `/home/anonjr/.config/systemd/user/bramble-console-tunnel.service`
- `/home/anonjr/bramble-work/approval-runtime/` (independent clone and build)
- `/home/anonjr/bramble-work/status/eth-214-verify.log`
- `/home/anonjr/bramble-work/status/eth-214-runtime-build.log`
- `/home/anonjr/bramble-work/status/eth-214-public-verification.json`
- `/home/anonjr/bramble-work/status/eth-214-console-revoked.png`
- `/home/anonjr/bramble-work/status/eth-214-report.md`
