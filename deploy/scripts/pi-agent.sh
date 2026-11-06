#!/usr/bin/env bash
# Start the Pi demo agent as the current (agent) user. Reads the DeepSeek key
# from a file and passes it to Pi as DEEPSEEK_API_KEY. The agent gets only the
# two Bramble tools (no bash, read, edit or write), so it cannot read the key
# files. Pi loads a skill by letting the model read SKILL.md, and the agent has
# no read tool, so the launcher appends the skill text to the system prompt.
# Never prints a secret.
# Usage: pi-agent [pi options] ["prompt"]
#   example: pi-agent -p "Fetch the task from the private staging service"
# Environment: PI_AGENT_MODEL (default deepseek/deepseek-flash),
#   PI_AGENT_SKILL (default ~/.pi/agent/skills/bramble-private-service/SKILL.md).
set -euo pipefail

cfg="$HOME/.config/bramble"
pi="${PI_BIN:-$HOME/pi-runtime/node_modules/.bin/pi}"
model="${PI_AGENT_MODEL:-deepseek/deepseek-flash}"
skill="${PI_AGENT_SKILL:-$HOME/.pi/agent/skills/bramble-private-service/SKILL.md}"

[ -r "$skill" ] || { echo "missing $skill (run install-pi-agent.sh)" >&2; exit 1; }
[ -r "$cfg/deepseek.key" ] || { echo "missing $cfg/deepseek.key" >&2; exit 1; }
[ -r "$cfg/approval.token" ] || echo "warning: no $cfg/approval.token; request_private_access will fail (denied calls still work)" >&2
DEEPSEEK_API_KEY="$(cat "$cfg/deepseek.key")"
export DEEPSEEK_API_KEY

mkdir -p "$HOME/work"
cd "$HOME/work"
exec "$pi" --model "$model" --no-builtin-tools --no-context-files --offline --append-system-prompt "$skill" "$@"
