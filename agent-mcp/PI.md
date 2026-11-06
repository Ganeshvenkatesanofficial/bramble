# How to run the Bramble agent on Pi with DeepSeek

This how-to runs the same two tools (`request_private_access`, `call_private_service`)
under Pi (npm package `@earendil-works/pi-coding-agent`) instead of Claude Code. Pi has native MCP
support, so it loads `agent-mcp` as is. There is no separate command-line wrapper.
Use it on the worker machine as the unprivileged `agent` user. Machine setup is in
`deploy/README.md`, step F4. Tool and setting details are in [REFERENCE.md](./REFERENCE.md).

Demo beats served: 1 (denied), 2 (request), 3 (works after approval) and 5 (denied after revoke).

## Before you start

- The worker node runs and its forward listens on `127.0.0.1:8080`.
- The approval API is reachable from the worker (reverse tunnel or public console URL).
- You have a DeepSeek API key and the shared demo token. Store them only in the two
  files named below. Never put them in the repository or a log.

## Steps

1. Install, as `agent`:

   ```sh
   BRAMBLE_AGENT_LABEL=<agent-label> BRAMBLE_GATEWAY_LABEL=<gateway-label> \
     deploy/scripts/install-pi-agent.sh
   ```

   The script installs Pi 1.5.0, copies `agent-mcp`, writes `~/.pi/agent/mcp.json`
   and the skill `~/.pi/agent/skills/bramble-private-service/SKILL.md`, and installs the
   launcher as `~/bin/pi-agent`.

2. Create `~/.config/bramble/deepseek.key` and `~/.config/bramble/approval.token`
   (mode `0600`, owner `agent`). Each holds one value.

3. Check the connection:

   ```sh
   ~/pi-runtime/node_modules/.bin/pi mcp list
   ```

   `bramble-agent` shows as connected with two tools.

4. Run the agent with one line:

   ```sh
   ~/bin/pi-agent -p "Fetch the task from the private staging service"
   ```

## Expected sequence

The agent first reports `denied: no grant`, then requests access to `task` and waits.
Approve that request in the console. The agent retries and reports `task result: ...`.
Revoke the request in the console, then send the same one-line task prompt in the
same Pi session to check that the next call is denied. With `-p`, start a second
invocation for this check.

Two isolated access-lifecycle runs pass on 6 November 2026; measurements follow below.
Full beat 3 payment/feed acceptance remains Open on ETH-294. The earlier overlapping
runs still do not count as isolated evidence.

Verified, worker, 6 November 2026 at 15:05–15:06 UTC: the corrected launcher
created a request for `task`. The operator approval POST returned HTTP 401
(`unauthorized`) using the supplied worker token file. The gateway recorded
`no matching granted digest` for the initial call. Neither approval nor the full
sequence passed in that attempt. Both nodes and the worker tunnel were stopped after that attempt. The shared-slot
operator route below supersedes worker-token repair as a prerequisite.

Verified after the operator released the cloud pair, 6 November 2026 at
15:18–15:20 UTC: the worker tunnel reaches the same pending request on the
live approval API at admin port 3011. A protected `GET /api/members` and a
`POST /api/eth243-auth-probe-not-a-route` both return HTTP 401 with the worker
token file passed directly into the Authorization header. Read from source:
the nonexistent route returns HTTP 404 when authenticated and changes no request or grant.
The failure occurs before approval or signing. Both node services remain
inactive with MainPID 0; neither was started. The temporary tunnel is closed.
The shared-slot operator route below supersedes worker-token repair as a prerequisite.
This does not establish that the worker token was corrected.

## Shared-slot measurements, 6 November 2026

Verified on the worker at 15:51–15:57 UTC, with Pi 1.5.0,
`deepseek/deepseek-flash`, and the reviewed launcher hash
`c56cf85efb4a4a5a5297284333d98d39df51a09613cc85b2c2d5c0aabc922728`.
Operator approval/revoke uses the existing zephyrus approval runtime configuration
passed directly into the operator process against the public console. The harmless
nonexistent POST returns authenticated HTTP 404. No admin credential is transferred
to Pi, and no worker credential file is changed. The MCP tunnel maps worker
`127.0.0.1:3001` to zephyrus `127.0.0.1:3011` during these runs.

| Measurement                            | Run 1        | Run 2        |
| -------------------------------------- | ------------ | ------------ |
| Initial operator denial probe          | 29.60 s      | 29.59 s      |
| Pi start UTC                           | 15:51:55.939 | 15:54:44.494 |
| Pi start to fresh `task` request       | 32.76 s      | 30.59 s      |
| Operator approval confirmation         | 9.80 s       | 13.52 s      |
| Pi allowed tool call                   | 40.782 s     | 40.360 s     |
| Pi start to returned task and exit     | 86.26 s      | 87.13 s      |
| Operator revoke confirmation           | 20.54 s      | 16.38 s      |
| Revoke confirmed to Pi denial and exit | 32.14 s      | 32.31 s      |
| Revoked Pi tool call                   | 28.370 s     | 27.993 s     |

Each first prompt is `Fetch the task from the private staging service`. Each
revoked check is a separate Pi invocation instructed to call `/task` once without
requesting access. The revoke-to-denial measurements include that invocation's
startup and completion; they do not isolate ENS propagation. Gateway logs confirm
denial, allow, then denial in both runs. Both task results contain
`report-private-service-health`. Both requests have confirmed Sepolia revocations.

Verified at cleanup: Pi/MCP processes and the temporary worker tunnel are absent.
Both node services retain their 15:32:37Z/15:32:38Z start times. The same running
pair is handed to ETH-271, which owns final shutdown under the shared-slot order.

Full beat 3 remains Open: public activity at 15:57:53.512Z reports
`approval: ok`, `gateway: not_configured`, `hedera: not_configured` (ETH-294).
The feed contains the Sepolia grant/revoke receipts. These access-lifecycle runs
establish no new Hedera payment settlement or HashScan event. They also do not
resolve the separate fresh-public-device relay failure on ETH-293.

See [Pi security explanation](./PI_SECURITY.md) for the tool restrictions and
[Pi runtime reference](./REFERENCE.md#pi-runtime) for model and launcher settings.
