# Why the Pi agent has two tools

The demo agent needs to request access and call the private service. The launcher
disables Pi's built-in tools so the model has no shell or file-reading tool. The
installed Bramble MCP server exposes `request_private_access` and
`call_private_service`.

Pi normally loads a skill when the model reads `SKILL.md`. With file reading
disabled, the launcher must append the installed workflow using
`--append-system-prompt`. Without those instructions the model guessed `staging`
and `staging-api` instead of the service name `task` in the earlier worker runs
(recorded 6 November 2026).

A command in `mcp.json` loads the demo token into the MCP process. The token value
is absent from that config file and Pi's environment. Both the launcher and the
MCP config use `~/.config/bramble`. The launcher passes the DeepSeek API key to
Pi through its environment.

This is a tool restriction, not an operating-system credential boundary. The
shared demo token also authorizes approve and revoke. Any process with the
`agent` user's file access can read it. See [known limits](./README.md#know-the-limits).

The 180-second MCP timeout exceeds the tool's 120-second approval wait. The
forward timeout is also 120 seconds because a gateway decision over Tor takes
longer than the server's default 10-second timeout in the recorded cloud runs.
