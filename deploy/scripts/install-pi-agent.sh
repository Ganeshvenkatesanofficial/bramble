#!/usr/bin/env bash
# Install the Pi agent for the CURRENT user on the worker machine (run it as the
# unprivileged `agent` user, not as root). It installs a pinned Pi release,
# copies agent-mcp from the repository checkout, and writes Pi's MCP config and
# the Bramble skill. It never reads or writes a secret.
# Usage (as agent): BRAMBLE_AGENT_LABEL=<label> BRAMBLE_GATEWAY_LABEL=<label> \
#   deploy/scripts/install-pi-agent.sh
# Environment:
#   BRAMBLE_REPO          repository checkout to copy from (default /opt/bramble)
#   BRAMBLE_APPROVAL_URL  approval API base URL (default http://127.0.0.1:3001)
#   BRAMBLE_SERVICE       service name the skill tells the agent to ask for (default task)
set -euo pipefail

PI_PACKAGE="@earendil-works/pi-coding-agent"
PI_VERSION="1.5.0"

[ "$(id -u)" -ne 0 ] || { echo "run as the agent user, not root" >&2; exit 1; }
: "${BRAMBLE_AGENT_LABEL:?set BRAMBLE_AGENT_LABEL (the worker node's ENS label)}"
: "${BRAMBLE_GATEWAY_LABEL:?set BRAMBLE_GATEWAY_LABEL (the gateway's ENS label)}"
repo="${BRAMBLE_REPO:-/opt/bramble}"
approval_url="${BRAMBLE_APPROVAL_URL:-http://127.0.0.1:3001}"
service="${BRAMBLE_SERVICE:-task}"
[ -f "$repo/agent-mcp/src/index.ts" ] || { echo "no agent-mcp under $repo" >&2; exit 1; }

rt="$HOME/pi-runtime"
mcp="$HOME/agent-mcp"
mkdir -p "$rt" "$mcp" "$HOME/.pi/agent/skills/bramble-private-service" "$HOME/.config/bramble"
chmod 700 "$HOME/.config/bramble"

# 1. Pinned Pi release, local to this user.
(cd "$rt" && { [ -f package.json ] || npm init -y >/dev/null; } \
  && npm install --no-audit --no-fund "$PI_PACKAGE@$PI_VERSION")

# 2. agent-mcp: copy the sources and install only its two runtime dependencies,
#    at the versions the repository pins.
rm -rf "$mcp/src"
cp -r "$repo/agent-mcp/src" "$mcp/src"
node -e '
  const pkg = require(process.argv[1] + "/agent-mcp/package.json")
  const out = { name: "bramble-agent-mcp-runtime", private: true, type: "module", dependencies: pkg.dependencies }
  require("fs").writeFileSync(process.argv[2] + "/package.json", JSON.stringify(out, null, 2) + "\n")
' "$repo" "$mcp"
(cd "$mcp" && bun install)

# 3. Pi's MCP config. A command reads the token when Pi starts agent-mcp, so the
#    token is never in this file and never in Pi's own environment. A missing
#    file gives the placeholder "unset", which the approval API refuses: calls
#    still work and only request_private_access fails.
node -e '
  const [home, agent, gateway, url] = process.argv.slice(1)
  const cfg = { mcpServers: { "bramble-agent": {
    command: "bun", args: ["run", home + "/agent-mcp/src/index.ts"],
    env: {
      BRAMBLE_AGENT_LABEL: agent, BRAMBLE_GATEWAY_LABEL: gateway, BRAMBLE_APPROVAL_URL: url,
      BRAMBLE_FORWARD_TIMEOUT_MS: "120000", BRAMBLE_DECISION_TIMEOUT_MS: "120000",
      APPROVAL_DEMO_TOKEN: "!cat " + home + "/.config/bramble/approval.token 2>/dev/null || echo unset",
    },
    timeout: 180, exposure: "direct",
    description: "Ask a human for access to a private service and call it through the Bramble forward",
  } } }
  require("fs").writeFileSync(home + "/.pi/agent/mcp.json", JSON.stringify(cfg, null, 2) + "\n")
' "$HOME" "$BRAMBLE_AGENT_LABEL" "$BRAMBLE_GATEWAY_LABEL" "$approval_url"

# 4. The skill that tells the agent when to use the two tools.
sed "s/__SERVICE__/$service/g" "$repo/agent-mcp/pi/SKILL.md" \
  > "$HOME/.pi/agent/skills/bramble-private-service/SKILL.md"

# 5. The launcher.
mkdir -p "$HOME/bin"
install -m 0755 "$repo/deploy/scripts/pi-agent.sh" "$HOME/bin/pi-agent"

echo "installed Pi $PI_VERSION, agent-mcp, MCP config and skill for $(id -un)"
echo "next: put the DeepSeek key in ~/.config/bramble/deepseek.key and the demo token in ~/.config/bramble/approval.token (mode 600)"
