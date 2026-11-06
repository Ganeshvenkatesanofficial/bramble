# How to dry-run demo beats 1, 2, 3 and 5 by hand

Goal: run the access lifecycle once, by hand, on the cloud nodes: denied (beat 1), request and approve (beat 2), the call works and pays (beat 3), revoke (beat 5). A person who can SSH to the three machines and open the public console can follow this page without reading source. For the machines, ports and variable names, see `REFERENCE.md`. For first-time setup, see `README.md`.

**This costs money while the nodes are up.** Each node buys a rendezvous token about every 37 s, which cost the Hedera payer `0.0.11334961` about 2.4 to 4 USDC per hour with both nodes up (measured on 6 Nov 2026; see "Cost"). Start the nodes in step 3 and stop them in step 9.

**One driver at a time.** Two people or agents calling the worker's `:8080` forward, or restarting the node units, at once ruin each other's timings and ACL state. Before you start, make sure nobody else (including an agent ticket such as ETH-243 or ETH-244) owns the nodes.

## Evidence labels

State on 6 Nov 2026, build `4928612` (merge of PR #39) on all three machines.

| Label      | Meaning                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| Verified   | The author ran it, or read its live output, on the real machines on 6 Nov 2026       |
| Cited      | Run by another ticket; the note names the log or the page. The author did not run it |
| UNVERIFIED | Not run by anyone on these machines. Check the output yourself and report a mismatch |

The author could not start or stop the nodes while writing this page: the nodes belonged to another ticket's run (ETH-244, 12:20Z to about 13:05Z). Steps that start and stop them are Cited, not Verified.

## Where to run each command

Run everything from the **operator workstation** (`zephyrus`). It has three things you need:

- the SSH aliases `bramble-gateway`, `bramble-worker` and `bramble-relays` (user `ubuntu`, tailnet-only, no public port 22). Verified: `ssh bramble-gateway hostname` works from `zephyrus`.
- the approval service and the console tunnel (user units `bramble-approval` and `bramble-console-tunnel`).
- the demo token.

If you work from another tailnet device, the aliases and the token file are not there. Copy the aliases and fetch the token as in step 2. UNVERIFIED from any other device.

| Name            | Value                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Console URL     | `https://console.13-233-181-104.sslip.io`                                                                                |
| Agent label     | `mumbai-worker`                                                                                                          |
| Gateway label   | `mumbai-gateway`                                                                                                         |
| Service         | `task`                                                                                                                   |
| Node units      | gateway: `bramble-demo-service`, `bramble-gateway`; worker: `bramble-worker`                                             |
| Always-on units | relays: `bramble-relay@relay1`, `rpc-proxy`, `caddy`, `coturn`; `zephyrus`: `bramble-approval`, `bramble-console-tunnel` |

## 1. Check the always-on pieces

These cost nothing. Run:

```sh
ssh bramble-relays 'systemctl is-active bramble-relay@relay1 rpc-proxy caddy coturn'
systemctl --user is-active bramble-approval bramble-console-tunnel
curl -sS -o /dev/null -w 'console HTTP %{http_code}\n' https://console.13-233-181-104.sslip.io/api/requests
curl -sS -X POST -o /dev/null -w 'POST without token HTTP %{http_code}\n' https://console.13-233-181-104.sslip.io/api/requests
```

Expected: `active` four times, `active` twice, `console HTTP 200`, `POST without token HTTP 401`. Verified on 6 Nov 2026.

Then check that the nodes are stopped, so you start from a known state:

```sh
ssh bramble-gateway 'systemctl is-active bramble-gateway'
ssh bramble-worker  'systemctl is-active bramble-worker'
```

Expected: `inactive` twice. If a node is `active`, someone is running it. Ask who, or stop it in step 9 and start clean. Verified that the command works (both returned `active` on 6 Nov 2026 during another ticket's run).

Then check the starting chain state. The console must show no active grant for `mumbai-worker`: open the console URL and read "Active grants". Expected: "No active grants in this queue." If a grant is listed, click **Revoke access** and wait for "Revoke confirmed" before you continue. Verified: the console serves the page and the request list.

## 2. Get the demo token without displaying it

The console and the write API need the demo token (`APPROVAL_DEMO_TOKEN`). The write routes return `401 unauthorized` without it. Verified.

The token lives in `~/.config/bramble/approval.env` on `zephyrus`. **That file also holds `SEPOLIA_PRIVATE_KEY`. Never `cat`, `less`, `echo` or `source` it in a shell you share or record.** Load only the token into a shell variable:

```sh
TOKEN=$(. ~/.config/bramble/approval.env && printf %s "$APPROVAL_DEMO_TOKEN")
echo "token length: ${#TOKEN}"
```

Expected: `token length: 48`. Verified (the length was checked; the value was not displayed). Use `"$TOKEN"` in the commands below. Close the terminal when you finish.

To paste the token into the console, copy it to the clipboard without printing it: `printf %s "$TOKEN" | wl-copy` (Wayland), `... | xclip -selection clipboard` (X11) or `... | pbcopy` (macOS). UNVERIFIED: none of the three tools is installed on the machine where this page was written. If you have none, paste the value from a password manager.

Set the shared variables once per shell:

```sh
BASE=https://console.13-233-181-104.sslip.io
AUTH="Authorization: Bearer $TOKEN"
```

## 3. Start the nodes

Start the gateway first, then the worker:

```sh
ssh bramble-gateway 'sudo systemctl start bramble-demo-service bramble-gateway'
ssh bramble-worker  'sudo systemctl start bramble-worker'
```

Cited (ETH-205 and ETH-244 runs started the units this way; the gateway unit's start time on 6 Nov 2026 was 12:02:27 UTC).

Wait about 2 minutes. A node needs 40 to 60 s to log `serving on` because relay discovery reads the registry over Tor. Check readiness:

```sh
ssh bramble-gateway "sudo journalctl -u bramble-gateway --no-pager -o cat | grep -E 'serving on|adopted new candidate' | tail -3"
ssh bramble-worker  "sudo journalctl -u bramble-worker  --no-pager -o cat | grep -E 'serving on|adopted new candidate' | tail -3"
```

Expected on each node, two lines like:

```text
serving on 10.77.0.2:51820 (pubkey 6364ee19…), tracking 1 peer(s), ttl=30s, rediscover=15s (Ctrl+C to stop)
data-relay: mumbai-worker adopted new candidate 13.233.32.174:51820
```

The gateway shows `mumbai-worker adopted …` and the worker shows `mumbai-gateway adopted …`. Both lines on both nodes mean the nodes found each other. Verified (read from the live journals on 6 Nov 2026).

Do not continue until both nodes show `adopted new candidate`. If they do not after 3 minutes, see "When a step fails".

## 4. Beat 1: denied

Call the private service as the `agent` user on the worker:

```sh
ssh bramble-worker "sudo -u agent curl -sS -m 150 -w '\nHTTP %{http_code} after %{time_total}s\n' http://127.0.0.1:8080/task"
```

Expected: the call fails with `curl: (56) Recv failure: Connection reset by peer` and `HTTP 000`. It takes 15 to 84 s: the gateway resolves three ENS records over Tor before it decides (the first call after a start is the slowest). Cited (README Part G measured 83.7 s and 15.6 s on 6 Nov 2026).

Check why it was denied:

```sh
ssh bramble-gateway "sudo journalctl -u bramble-gateway --no-pager -o cat | grep 'denied for service' | tail -2"
ssh bramble-worker  "sudo journalctl -u bramble-worker  --no-pager -o cat | grep 'denied by gateway' | tail -2"
```

Expected:

```text
gateway: mumbai-worker denied for service "task" (no matching granted digest)
forward: 127.0.0.1:<port>: "task" denied by gateway
```

Verified (both lines read from the live journals at 12:14 to 12:16 UTC on 6 Nov 2026).

If the call returns the task JSON instead, a grant still exists. Stop and fix it (see "When a step fails").

## 5. Beat 2: request and approve

A request is a suggestion. Only the human's click authorizes it. Create the request:

```sh
curl -sS -X POST "$BASE/api/requests" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"agentLabel":"mumbai-worker","gatewayLabel":"mumbai-gateway","service":"task","note":"manual dry-run"}'
```

Expected: HTTP 201 and JSON with `"status":"pending"` and an `id`. It takes under 1 s. Keep the id: `ID=<the id>`. Cited (ETH-244's driver script created requests this way; the live request list shows them).

Approve in the console:

1. Open `https://console.13-233-181-104.sslip.io`.
2. In "Operator authorization", paste the token into the "Demo token" field.
3. The request appears under "Awaiting decision" ("Human approval required"). Read the agent, gateway and service.
4. Click **Approve**.

Expected: the card shows the pending transaction, then "Grant confirmed" with a Sepolia transaction hash that links to Etherscan. Approval confirms in 12 to 15 s. Cited (README Part G: 12.2 s and 12.5 s on 6 Nov 2026; ETH-244 run 1 measured 15.3 s at 12:06 UTC).

Or approve from the shell, which makes the same API call as the button:

```sh
curl -sS -m 120 -X POST "$BASE/api/requests/$ID/approve" -H "$AUTH"
```

Expected: HTTP 200, `"status":"approved"` and a `grantTransaction.transactionHash`. Cited (ETH-244 run 1).

## 6. Beat 3: the call works and pays

Repeat the call from step 4. Do not restart anything:

```sh
ssh bramble-worker "sudo -u agent curl -sS -m 150 -w '\nHTTP %{http_code} after %{time_total}s\n' http://127.0.0.1:8080/task"
```

Expected: HTTP 200 and a JSON body like `{"host":"ip-172-31-41-92","observedAt":"…","status":"healthy","task":"report-private-service-health"}`. The first successful call comes 24 to 43 s after the approval was confirmed: the gateway must see the new ENS record through Tor, and a call lasts 27 to 32 s. If the first call after approval is still denied, repeat it up to four times. Cited (README Part G: 24.1 s and 43.1 s).

The gateway's own endpoint returns the same JSON body, which shows what the private service looks like. Verified on 6 Nov 2026:

```sh
ssh bramble-gateway 'curl -sS http://127.0.0.1:9100/task'
```

**Payment evidence.** Each node's journal prints a HashScan link for every payment: `rendezvous: paid mumbai-relay for a rendezvous token (tx 0.0.…)` followed by `https://hashscan.io/testnet/transaction/…`. Verified. Show one:

```sh
ssh bramble-worker "sudo journalctl -u bramble-worker --no-pager -o cat | grep -A1 'paid mumbai-relay' | tail -2"
```

**The Hedera audit record does not show up yet.** The console's "HCS audit trail" panel needs `HEDERA_AUDIT_TOPIC_ID`, `HEDERA_CLIENT_ACCOUNT_ID` and `HEDERA_CLIENT_PRIVATE_KEY` in `~/.config/bramble/approval.env`, and the file has none of them. Every approve and revoke therefore adds an audit row with `"status":"failed","error":"audit_not_configured"`. Verified: `curl -sS "$BASE/api/audit"` on 6 Nov 2026 at 12:16 UTC showed three such rows, and the file's variable names were listed (names only). The grant and revoke themselves work. A human must supply the topic id and the payer key and restart `bramble-approval`; this page does not cover that.

## 7. Beat 5: revoke

Time it: note the clock when you click.

In the console, click **Revoke access** on the active grant. Expected: "Revoke confirmed" with a Sepolia hash, in 7 to 16 s. Or from the shell:

```sh
curl -sS -m 120 -X POST "$BASE/api/grants/mumbai-worker/revoke" -H "$AUTH"
```

Expected: HTTP 200 and `"status":"revoked"`. Cited (README Part G: 11.4 s and 15.8 s; ETH-244 run 1: 6.8 s).

Then call again until it fails:

```sh
ssh bramble-worker "sudo -u agent curl -sS -m 150 -w '\nHTTP %{http_code} after %{time_total}s\n' http://127.0.0.1:8080/task"
```

Expected: `Connection reset by peer` and `HTTP 000`. The first failed call comes 27 to 46 s after the revoke started. Cited (README Part G: 27.5 s and 45.6 s). A call that started before the revoke confirmed can still succeed; call again.

Record two numbers for the demo log: revoke confirmed at, and first failed call at.

## 8. Run it again

Repeat steps 4 to 7 without restarting the nodes. Creating a second request for the same agent works after the first is `revoked`. Cited (README Part G: two runs in a row).

## 9. Stop the nodes (always)

```sh
ssh bramble-worker  'sudo systemctl stop bramble-worker'
ssh bramble-gateway 'sudo systemctl stop bramble-gateway'
ssh bramble-gateway 'systemctl is-active bramble-gateway; systemctl is-enabled bramble-gateway'
ssh bramble-worker  'systemctl is-active bramble-worker;  systemctl is-enabled bramble-worker'
```

Expected: `inactive` on both. UNVERIFIED: the author did not run `stop` (the nodes were in use). `bramble-demo-service` can stay up; it costs nothing.

Both node units are **enabled** (Verified, 6 Nov 2026), so a reboot of either machine starts them and the spend restarts. After the demo, a human may run `sudo systemctl disable bramble-gateway` and `sudo systemctl disable bramble-worker`. This page does not do it for you.

Confirm that spending stopped. Run twice, 45 s apart; the second number must equal the first:

```sh
curl -s https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.11334961 | python3 -c "
import json,sys
b=json.load(sys.stdin)['balance']
print('HBAR', int(b['balance'])/1e8, 'USDC', [int(t['balance'])/1e6 for t in b['tokens'] if t['token_id']=='0.0.429274'])"
```

Verified (command ran on 6 Nov 2026; mirror node data lags a few seconds).

## Cost

| Item                                   | Value on 6 Nov 2026                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Payer `0.0.11334961` USDC `0.0.429274` | 8.59 USDC at about 12:14 UTC and 8.36 at 12:17, so about 0.05 USDC per 45 s (about 4 USDC per hour) with both nodes up in a retry loop |
| Payer HBAR                             | 9.27 HBAR                                                                                                                              |
| Operator ETH (Sepolia)                 | 3.64 ETH. A grant uses about 374,000 gas and a revoke about 63,000 gas at 18 to 27 wei per gas, so ETH is not a constraint             |

Verified (mirror node and Blockscout, 6 Nov 2026). Budget at most 15 minutes of node uptime for one dry-run: about 1 USDC. Do not leave the nodes up while you read logs.

## When a step fails

| Symptom                                                                                                                                          | Cause                                                                                                                                                                                            | What to do                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 3: no `adopted new candidate` after 3 minutes; journals repeat `rendezvous: … exchange failed: timed out waiting for … candidate via relay` | The two nodes do not reach each other through the relay. Seen on 6 Nov 2026, 12:14 to 12:17 UTC, with both nodes up; the cause was under investigation in ETH-244. Each retry buys another token | Stop both nodes (step 9). Start the gateway, wait 30 s, start the worker, wait 2 minutes. If it repeats, stop and tell Atlas. Do not keep the nodes up to wait it out: it costs about 4 USDC per hour                 |
| Worker journal: `dial tcp 10.77.0.2:7892: connect: connection timed out`                                                                         | Same as above: the worker cannot reach the gateway's listener over the mesh                                                                                                                      | Same as above                                                                                                                                                                                                         |
| Call prints `Failed to connect to 127.0.0.1 port 8080`                                                                                           | The worker node is stopped, or is still starting                                                                                                                                                 | `ssh bramble-worker 'systemctl is-active bramble-worker'`; if `active`, wait for `serving on` in the journal (step 3)                                                                                                 |
| Call hangs, then `curl: (28) Operation timed out` after 150 s                                                                                    | The gateway decision or the rendezvous is stuck                                                                                                                                                  | Look at the gateway journal for the last 20 lines. Retry once. If it repeats, treat it as the rendezvous failure above                                                                                                |
| Beat 1 returns the task JSON                                                                                                                     | A grant from an earlier run still exists                                                                                                                                                         | Open the console, click **Revoke access**, wait for "Revoke confirmed", wait 45 s, repeat beat 1                                                                                                                      |
| Beat 3 is still denied after four calls and 2 minutes                                                                                            | The grant did not confirm, or the gateway reads an old ENS record                                                                                                                                | Check the console card says "Grant confirmed" and open the Sepolia hash. Check `"$BASE/api/requests"` for `status`. Check `denied for service` lines in the gateway journal. Do not approve a second time             |
| Approve or revoke returns `401 unauthorized`                                                                                                     | Wrong or missing token                                                                                                                                                                           | Repeat step 2. The console accepts the token in the "Demo token" field; reload the page and paste it again                                                                                                            |
| Approve or revoke returns `503 signer_not_configured`                                                                                            | The approval service has no signer configured                                                                                                                                                    | `systemctl --user status bramble-approval`; read `approval/README.md`, "Real signer runbook". Stop and report                                                                                                         |
| HTTP 202 with `"status":"approving"` (or `revoking`), or `409 write_unresolved`                                                                  | The transaction was sent but its receipt is unknown                                                                                                                                              | Open `unresolvedWrite.transactionHash` on Sepolia. Wait: the service re-checks every 5 s. Do not approve or revoke again                                                                                              |
| `409 request_not_pending`                                                                                                                        | The request was already approved or denied                                                                                                                                                       | Not an error. Read `"$BASE/api/requests/$ID"`                                                                                                                                                                         |
| `identity_not_active`                                                                                                                            | The agent or gateway identity is revoked, expired or unpublished                                                                                                                                 | Stop and report. No transaction was sent                                                                                                                                                                              |
| Console shows HTTP 502                                                                                                                           | The reverse tunnel is down                                                                                                                                                                       | `systemctl --user restart bramble-console-tunnel`, wait 10 s, retry. Check on the relays machine: `ssh bramble-relays 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/requests'` must print `200` |
| Console loads but "Awaiting decision" stays empty after step 5                                                                                   | The request went to another service or label                                                                                                                                                     | `curl -sS "$BASE/api/requests"`: check `agentLabel`, `gatewayLabel`, `service`                                                                                                                                        |
| `Permission denied (publickey)` or the alias does not resolve                                                                                    | You are not on the tailnet, or you are on a machine without the aliases                                                                                                                          | Join the tailnet (`tailscale status` must list `bramble-gateway`). Use `ssh ubuntu@<tailnet-ip>` with the demo key; the tailnet addresses are in the status file `infra.json`                                         |
| Spend does not stop after step 9                                                                                                                 | A node is still active                                                                                                                                                                           | `ssh <alias> 'systemctl is-active bramble-gateway bramble-worker'`; stop what is `active`                                                                                                                             |

If a step fails in a way this table does not cover: stop the nodes (step 9) first, then write down the step, the command, the output and the time, and report it on the ticket. Do not retry blindly: every retry with the nodes up spends USDC.

## What this page does not cover

- Beat 4 (direct path) and beat 6 (what the provider sees). See `nat-lab/README.md` and `rpc-proxy/README.md`.
- Running the agent. The commands above call the forward as the `agent` user with `curl`. The Pi agent on the worker (ETH-243, PR #42) and the Claude Code agent (`agent-mcp/README.md`) make the same calls through MCP tools. UNVERIFIED: the author did not run either agent.
- Installing a new device with `curl | sh` (README Part H).
