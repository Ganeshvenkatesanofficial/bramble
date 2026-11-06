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

## Expected sequence. Open

The agent first reports `denied: no grant`, then requests access to `task` and waits.
Approve that request in the console. The agent retries and reports `task result: ...`.
Revoke the request in the console, then send the same one-line task prompt in the
same Pi session to check that the next call is denied. With `-p`, start a second
invocation for this check.

Open: two isolated full runs with the corrected launcher. The earlier runs used
the same grant label as another driver and do not verify this sequence.

See [Pi security explanation](./PI_SECURITY.md) for the tool restrictions and
[Pi runtime reference](./REFERENCE.md#pi-runtime) for model and launcher settings.
