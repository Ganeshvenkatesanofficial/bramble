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

## What you see

The same sequence as the Claude Code path: `denied: no grant`, then the request waits
for a human, then `granted`, then `task result: ...`, and `denied: no grant` again after Revoke.

## How the setup limits the agent

- The launcher starts Pi with `--no-builtin-tools`. The model sees only the two Bramble
  tools. It has no shell, so it cannot read the key files.
- A command in `mcp.json` reads the token when Pi starts `agent-mcp`. The token is in
  no config file and not in Pi's environment.
- `mcp.json` sets the MCP request timeout to 180 s. Pi's default is 60 s, shorter than
  the 120 s approval wait.
- The shared demo token still authorizes approve and revoke (see [README.md](./README.md#know-the-limits)).
  A process running as `agent` with a shell could read it. Keep the agent shell-less.

## Model

The launcher uses `deepseek/deepseek-flash` (override with `PI_AGENT_MODEL`). List the
models Pi knows with `DEEPSEEK_API_KEY=... pi --list-models deepseek`.
