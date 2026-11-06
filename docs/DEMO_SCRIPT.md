# How to present the Bramble access lifecycle

Use the three-minute script for the main pitch and the six-minute script for a walkthrough. Run beats 1 (denied), 2 (request and approve), 3 (works and pays) and 5 (revoke), in that order. Use curl-install for enrollment where time permits; use the accepted cloud worker for service calls until fresh-device connectivity passes. This is the ETH-251 operator script for handoff section 4.

**Evidence cutoff: 6 November 2026, 16:30 UTC; tested release `970461c`.** The [acceptance log](measurements/2026-11-06-onboarding-acceptance.md) reconciles ETH-179, ETH-250, ETH-244 and ETH-287. Read from source: this script uses the cloud curl flow. The author has not executed these instructions or timed a spoken rehearsal. All stage schedules below are **Open / unverified budgets**, not measured full-demo durations.

## Choose what you can show

Use these evidence labels when rehearsing: **Verified (reported)** means the named issue records a real run by another operator; **Read from source** means code or documentation supports the behavior; **Open / unverified** means acceptance remains outstanding. Do not describe another operator's run as your own.

| Segment                                                                   | Evidence at the cutoff                                                                                                                                          | Stage choice                                                                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deny, approve, task JSON, revoke                                          | Read from recorded evidence: ETH-244 POSTFIX-A/B on `970461c`                                                                                                   | Use the live cloud flow below.                                                                                                                                        |
| Real AI agent making those calls                                          | Open: ETH-244 validates curl as Unix user `agent`, not an autonomous agent session                                                                              | Say “worker” for this script. Use an agent only after a separate rehearsal proves it.                                                                                 |
| Human approval boundary                                                   | Read from source: the MCP demo token also permits approve/revoke; ETH-244 reports that token present in the Pi agent setup                                      | Keep operator authorization outside the agent session. Do not claim the deployed agent cannot self-approve. See [MCP limits](../agent-mcp/README.md#know-the-limits). |
| x402 USDC settlement                                                      | Verified (reported): node journals contain paid rendezvous transactions and HashScan URLs in the ETH-204 runbook; payment trigger is Read from source           | Show a real settlement with its time and payer. A service call or approval does not itself cause a payment.                                                           |
| New Hedera Consensus Service (HCS) record                                 | Open: ETH-244 reports Hedera activity `not_configured` at 15:42:43 UTC; no new display acceptance                                                               | Claim a live record only after the console shows a new receipt and mirror verification. Otherwise disclose the missing configuration.                                 |
| Curl-install and enrollment                                               | Read from recorded evidence: real `970461c` release installs and enrolls on non-cloud Linux amd64; fresh-device service test fails after 95 s with no peer path | Show enrollment in the optional segment. State the connection failure; use the existing cloud worker for beats 1, 3 and 5.                                            |
| Automated rehearsal                                                       | Read from source and ETH-287: [harness](../deploy/REHEARSAL.md) merged; offline checks only                                                                     | Use in a coordinated slot. Missing payment/HCS evidence fails beat 3 even when service access works.                                                                  |
| Direct path / NAT traversal (beat 4) and provider-log comparison (beat 6) | Open for this script; not established by the cited lifecycle runs                                                                                               | Keep them out of the live sequence. Explain Tor's scope without claiming a demonstrated log comparison or direct path.                                                |

The HCS panel and the payment panel are separate evidence. A successful USDC transfer does not prove an HCS post succeeded. The read-only `/audit/fixtures` page labels its synthetic entries; never show those as submitted messages.

## Budget for the measured waits

Use the newest cloud timings when selecting a script. These are individual observations, not guarantees or a percentile distribution.

| Measurement                                              | ETH-244 POSTFIX-A | ETH-244 POSTFIX-B |
| -------------------------------------------------------- | ----------------- | ----------------- |
| Beat 1: denied call                                      | 121.0 s           | 26.4 s            |
| Beat 2: approval confirmed                               | 19.5 s            | 17.0 s            |
| Beat 3: first successful call after approve              | 40.9 s            | 39.1 s            |
| Beat 5: revoke transaction confirmed                     | 16.9 s            | 20.2 s            |
| Beat 5: first failed call, measured from starting revoke | 46.1 s            | 50.8 s            |

Read from recorded evidence: both passes use `970461c`, begin at 15:38:09 and 15:41:57 UTC, and run without a node restart between them. Services started at 15:32:36–15:32:38 UTC. The first denial includes transport startup delay; the cause of rendezvous timeouts is not isolated. These call-completion bounds include ENS reads over Tor. They do not isolate Tor overhead or warm decision latency. The cloud peers use a direct endpoint, which does not prove separate-NAT traversal or relay-only public-device access.

Do not add revoke confirmation to revoke-started-to-denial: the latter already includes it. One denial warmup does not establish a warm successful call. The 121-second first denial does not fit either short stage window below. Even the later revoke observation exceeds the three-minute script's 50-second window. Keep those schedules as unverified budgets, and switch to labeled evidence at their deadlines.

The separate [Tor measurement](measurements/2026-11-06-revocation-over-tor.md) replays a real RPC trace on one machine. Its 7.0–11.5 s median range and 29 s worst observation exclude transaction confirmation. Do not substitute them for the live cloud revoke figures. Sources, exact request IDs and cleanup are in the [acceptance log](measurements/2026-11-06-onboarding-acceptance.md) and [ETH-244 post-fix report](/ETH/issues/ETH-244#document-validation-postfix).

## Prepare before the audience arrives

The commands below are **Read from source / unverified by this author**. Run them on the operator workstation with the existing SSH aliases. Do not run them during another operator's slot. Keep a browser and one terminal visible. The latest recorded gateway and worker state is stopped (16:10 UTC). Obtain a new operator slot before starting them. Prepare a recording with its date, build and evidence limits; the recording's existence is **Open** until the operator checks it.

- [ ] Reserve exclusive use of the cloud pair and `mumbai-worker` grants. Agree that nobody restarts units, changes grants or calls the forward during the take. ETH-244 discarded an overlapping pass.
- [ ] Confirm the deployed build and open the public console at `https://console.13-233-181-104.sslip.io`. Confirm `GET /api/requests` returns 200. On the workstation, check `systemctl --user is-active bramble-approval bramble-console-tunnel`. On relays, check `systemctl is-active bramble-relay@relay1 rpc-proxy caddy coturn` through SSH.
- [ ] Have the human enter the existing demo token in the console's password field and click **Unlock**, before recording. Reloading locks the console. Keep secret files, headers, shell tracing and agent configuration off screen. Do not give the operator token to an agent to perform this script.
- [ ] Remove any previous grant through the existing operator revoke-by-label flow for `mumbai-worker`, even if no console card exists. Requests live in process memory; a restart can hide the card while ENS keeps the grant. HTTP 409 `not_granted` means no grant to remove. Verify the next denied call against a new gateway journal line.
- [ ] Check current Sepolia ETH, Hedera testnet HBAR and USDC balances through the existing operator balance check. Historical balances are not current funds. Testnet USDC is token `0.0.429274`; the reported payer is `0.0.11334961`. Confirm the actual payer mapping before attributing spend to a worker.
- [ ] Plan for roughly 2.5 USDC/hour in ETH-244 and up to about 4 USDC/hour in the ETH-204 retry-loop observation, both with two nodes up. Nine minutes (three-minute warmup plus six-minute presentation) is about 0.38–0.60 testnet USDC at those rates; fifteen minutes is about 0.63–1.00. Budget the rehearsals separately: 17 minutes of node uptime, as in the two ETH-205 runs, costs an estimated 0.71–1.13 testnet USDC at 2.5–4 USDC/hour. Add the presentation and any extra warmup time. ETH-244 also reports a burst of token purchases at startup. These estimates are not caps and exclude HCS fees. Check the configured per-payment cap against the sidecar; the displayed demo budget is advisory and does not stop payments.
- [ ] Check HCS readiness before promising it: a real topic, payer configuration and a fresh mirror-verified record must exist. If missing, report the missing names `HEDERA_AUDIT_TOPIC_ID`, `HEDERA_CLIENT_ACCOUNT_ID`, `HEDERA_CLIENT_PRIVATE_KEY` to the operator; never inspect their values. Use the disclosure line below until resolved.
- [ ] Rehearse twice before the presentation slot. Record build, warmup, start/end times, request ID, approve/revoke hashes, each curl result, payment reference, and HCS sequence/consensus time or its failure. After each run, check the final grant is gone. Two prior cloud runs do not verify your spoken timing or current deployment.

### Start at least three minutes early and rehearse the full path

Reserve time for a full off-stage lifecycle before T−3:00 when possible. The later pass follows a full lifecycle; three minutes and one denied call do not establish the same conditions. Start the nodes no later than T−3:00, after the slot owner releases the machines:

```sh
ssh bramble-gateway 'sudo systemctl start bramble-demo-service bramble-gateway'
ssh bramble-worker 'sudo systemctl start bramble-worker'
```

Wait for current-start `serving on` and peer `adopted new candidate` messages on both nodes. Use the unit start times to bound any journal view. `pnpm demo:preflight` is available with role/connection settings in the [launcher how-to](../scripts/demo/README.md); investigate any failure. The five-second checks probe direct TCP connectivity to rendezvous relays and HTTP `/health` on payment sidecars. They do not measure a Tor read. Investigate a failed probe before using the paid path; the separate `/relays` query uses `CURL_TIMEOUT_SECONDS`.

Once ready, call beat 1 once off stage to warm the denied path:

```sh
ssh bramble-worker "sudo -u agent curl -sS -m 150 -w '\nHTTP %{http_code} after %{time_total}s\n' http://127.0.0.1:8080/task"
```

Expect a reset and HTTP 000, with a matching new gateway `denied for service "task" (no matching granted digest)` line. A timeout or reset without that denial line is not proof of enforcement. If readiness and the warmup do not finish before the slot, delay the start or use the labeled recording. Three minutes is a preparation target, not a cold-start guarantee. The post-fix first denial takes 121 s after startup.

When time allows, continue off stage through approve, successful call, revoke and a fresh denied call, using the operator actions below. Record each duration and remove the rehearsal grant. If you only warm beat 1, warn that beat 3 may still run cold: one denial does not establish the next call duration. Use the six-minute script or labeled recording unless your own full rehearsal fits the short schedule.

### Set up the operator actions

Use this exact same worker curl for beats 1, 3 and 5. Do not change the endpoint or restart nodes between them. The command runs curl as Unix user `agent`; it does not demonstrate an AI agent session.

For beat 2, the operator submits one pending request through the existing authenticated request flow, with this JSON body. In the three-minute script, create it off stage after warmup and leave it pending; inspect and approve it on stage. In the six-minute script, create it on stage:

```json
{
  "agentLabel": "mumbai-worker",
  "gatewayLabel": "mumbai-gateway",
  "service": "task",
  "note": "live access lifecycle"
}
```

The route is `POST /api/requests`. Keep its Authorization header off screen. Expect HTTP 201 and `pending`, then select this request in the console and click **Approve** once. See the [API reference](reference/approval-api.md) for the request schema. No duration in this body means “Until revoked.” If you choose a duration in rehearsal, disclose that it uses a server-side revoke timer that needs the approval process to keep running. The card's price field currently says “Estimate unavailable”; do not invent a quote.

For beat 3, keep a journal payment URL ready from this run, with its timestamp, and open `/payments` if the deployed payer mapping works. Label an earlier payment as earlier. For beat 5, note the clock when clicking **Revoke access**, wait for confirmation, then repeat the curl and verify a new gateway denial. The console transaction link is Sepolia Etherscan; payment and HCS links are HashScan.

## Present in three minutes

Use this schedule only after a full rehearsal fits it, with the request already pending. The times include the waits and operator actions. Start the next action as soon as its preceding result appears. The four action windows allow 35 / 30 / 55 / 50 seconds; the latest first denial takes 121 s and one revoke takes 50.8 s, exceeding their windows. This schedule has not passed a timed rehearsal. Show payment evidence during the successful-call wait. If a window ends with the result still pending, switch to labeled evidence; keep the closing five seconds even if an action started late.

| Clock     | Operator action                                                                                                                                           | Say                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:05 | Show worker terminal and console.                                                                                                                         | “Bramble gives a worker scoped access to a private service. The gateway checks authorization from ENS.”                                                                                                                                                                                                                                                                                                                                  |
| 0:05–0:40 | Run the warmed curl. Show the reset and matching denial.                                                                                                  | “This worker is enrolled, but it has no grant for `task`. The gateway reads ENS over Tor before deciding.” When denial arrives: “Denied. The private task stays behind the gateway.”                                                                                                                                                                                                                                                     |
| 0:40–1:10 | Inspect the pending request's identity, gateway and `task`; click Approve once. Show the Sepolia receipt.                                                 | “The worker requested access before we started. I approve it now for this service, until I revoke it. The grant is written on Sepolia.”                                                                                                                                                                                                                                                                                                  |
| 1:10–2:05 | Repeat the same curl without restarting anything. Keep its pending state visible while opening the prepared settlement; then show HTTP 200 and task JSON. | “Same worker, same call; the gateway reads the changed authorization through Tor. While it checks, this is a real relay settlement with its payer and time. x402 charges testnet USDC for rendezvous tokens or data allotments; approval is not a payment trigger.” If HCS is ready, point to the new receipt; otherwise: “The new HCS audit record is not configured here yet.” On success: “The private service now returns its task.” |
| 2:05–2:55 | Click Revoke access; time from click. After confirmation, repeat curl and show the fresh denial.                                                          | “Now I remove the grant. Confirmation and the next observed denial are separate timestamps.” On denial: “That same call is refused again. The peer enforces the changed authorization.”                                                                                                                                                                                                                                                  |
| 2:55–3:00 | Keep the denied result visible, or label the fallback if still pending.                                                                                   | “Scoped, revocable access, enforced by peers from ENS.”                                                                                                                                                                                                                                                                                                                                                                                  |

## Present in six minutes

Use the same prepared actions and evidence gates. Do not start a second lifecycle just to fill time. If an action needs more time than its slot, shorten the later explanation and optional installer segment. Use the elapsed-action deadlines below and switch to labeled evidence if needed.

| Clock     | Operator action                                                                                                        | Say                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Point to worker, private service and console.                                                                          | “A worker needs the private task API. The operator can grant a service and later remove it. We will use the identical call throughout.”                                                                                                                                                                                                                                                                                                                                                              |
| 0:15–0:45 | Beat 1: curl, then fresh denial evidence.                                                                              | “An enrolled identity is not permission to every service. The gateway finds no matching granted digest for `task`.” Narrate the Tor wait before the result.                                                                                                                                                                                                                                                                                                                                          |
| 0:45–1:20 | Beat 2: create request, inspect card, approve and show receipt.                                                        | “This is `mumbai-worker`, asking `mumbai-gateway` for `task`. ENSv2 permissioned registries and per-name resolvers supply identity and authorization. The console writes the grant; the peers make their own access checks. The service name shown here becomes a digest in the access record.”                                                                                                                                                                                                      |
| 1:20–2:10 | Beat 3: same curl, no restart, show HTTP 200 and task JSON.                                                            | “The next decision reads the changed authorization. We did not replace the worker's request.” Use wait narration. On success: “This is the private service's task response.”                                                                                                                                                                                                                                                                                                                         |
| 2:10–3:05 | Show current-run settlement, payer/time and HashScan. Show HCS evidence only if ready.                                 | “x402 pays for relay service in Hedera testnet USDC. Connection attempts buy rendezvous tokens; data relay uses explicit allotments. A service approval does not initiate payment, and retries can cost tokens even when access is denied.” If HCS works: “HCS records an ordered salted commitment for grant, revoke or payment. Kind and timing stay public. The retained event and salt let the console check the commitment against the mirror.” Otherwise state the missing-configuration line. |
| 3:05–3:50 | Beat 5: click revoke, show receipt, repeat curl, verify denial.                                                        | “Watch the same call after revoke. We measure from starting revoke to the first failed call, and keep the confirmation time separately.” On denial: “The grant no longer authorizes this service.”                                                                                                                                                                                                                                                                                                   |
| 3:50–4:40 | Keep the real results visible; explain privacy scope.                                                                  | “The sidecar sends ENS reads and payment HTTP through separate Tor isolation keys. The RPC provider still sees names, records and timing. The payment service still learns the payer account. WireGuard, STUN and data relays use UDP outside Tor; peers and relays can see IP addresses. We protect these control-plane requests, not every network observation.”                                                                                                                                   |
| 4:40–5:30 | If timed to fit, show installer/enrollment with the limitation below. Otherwise revisit the grant and revoke receipts. | Installer: “This release installs and enrolls a device. Our fresh-device service test still fails with no peer path, so these working service calls use the existing cloud worker.” Without it: “A request card is not enforcement. These confirmed chain changes and repeated calls are the evidence.”                                                                                                                                                                                              |
| 5:30–6:00 | Show denied result, real links and disclosed gaps.                                                                     | “Bramble uses ENSv2 for authorization, Tor for these control-plane requests, and Hedera for paid relays and the optional audit trail. There is infrastructure and an administrator, but no trusted coordinator deciding access for the peers. These are the results and remaining gaps of this deployment.”                                                                                                                                                                                          |

### Narrate the authorization waits

Speak these lines while a call is pending. Stop when the result arrives. The two latest successes take 40.9 and 39.1 s; the first denial takes 121 s. Never promise a 30-second ceiling.

| Elapsed | Narration                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–10 s  | “The gateway reads authorization from ENS through Tor. We leave the command visible while that check completes.”                                                     |
| 10–20 s | “The approval service writes chain state. Each peer reads that state and decides what it accepts.”                                                                   |
| 20–30 s | “The latest second-pass denial took 26.4 seconds; the first took 121. Successful calls took about 39 to 41 seconds. These are observations from today's cloud runs.” |
| 30–45 s | “This call is still pending. I will call it allowed or denied only when the result and gateway evidence agree.”                                                      |

Do not attribute the whole delay to Tor alone: chain/RPC behavior, sequential reads and the transport are included. Do not call a timeout a successful revoke.

## Use a sixty-second sponsor version

These are **unverified spoken budgets**. At the measured latencies, a full live lifecycle does not fit sixty seconds. Use one rehearsed live result with previously captured, clearly dated evidence for the other steps, or narrate over a labeled recording. Never describe a recorded result as live.

### ENS: authorization and revocation

- **0–10 s:** “Bramble uses ENSv2 as the authorization source for a private WireGuard mesh. A name identifies a device and its resolver supplies the records peers check.”
- **10–25 s:** Show request and confirmed grant. “Permissioned registries, per-name resolvers and Enhanced Access Control separate enrollment, rotation, revocation and access rights. The access record holds a digest of the service.”
- **25–45 s:** Show successful call followed by revoke receipt and failed call, labeled live or recorded. “The same call works after the grant and fails after revoke, without restarting the nodes. Each peer makes its own decision from ENS.”
- **45–60 s:** “The console writes authorization; it does not centrally enforce traffic. Today's cloud runs observed the first failed call 46.1 and 50.8 seconds after revoke began. ENS is part of access control, beyond naming.”

### Ethereum Foundation: Tor scope and ENSv2

- **0–15 s:** “Bramble combines ENSv2 authorization with a Tor control plane. Peers read names and authorization themselves, so a relay cannot grant membership.”
- **15–30 s:** Show the grant and repeated call. “The sidecar routes ENS reads and payment HTTP through Tor with separate isolation keys. We do not publish private member endpoints in ENS.”
- **30–45 s:** “Cloud calls, including ENS reads over Tor, took 26.4 or 121 seconds to deny and about 39 to 41 seconds to succeed. We have not isolated Tor’s share. The first failed call came 46.1 or 50.8 seconds after revoke started.”
- **45–60 s:** “The provider still sees queried records and timing. WireGuard and STUN stay outside Tor, and relays see peer addresses. The claim is control-plane protection and no trusted coordinator. A live before/after provider-log demonstration remains unverified here.”

### Hedera: paid relay service and HCS

- **0–15 s:** Show a real settlement with its time and payer. “Bramble uses x402 to buy relay service with Hedera testnet USDC. Rendezvous tokens and data allotments make the relay a paid service.”
- **15–30 s:** Open its HashScan settlement link. “This is a settled transfer. Relay connection attempts trigger payments; clicking Approve does not. The payer mapping determines attribution.”
- **30–45 s:** If accepted, open the fresh HCS HashScan entry. “The new HCS trail records salted commitments for grants, revokes and payments. The console checks a retained opening against a mirror message; event kind and timing remain public.” If missing, say: “The HCS integration exists in source, but this deployment has no configured recorder. I cannot show a new submitted audit record.”
- **45–60 s:** “Payment settlement and audit commitments are separate. HCS does not enforce access or prove log completeness. ENS supplies authorization; peers enforce it. HashScan lets us inspect the real Hedera evidence we have.”

## Show installation and enrollment with their limits

Read from recorded evidence: ETH-179 and ETH-250 accept public installation and enrollment for Linux amd64 at `970461c`. All four archive checksums match the real build. The non-cloud run uses the headless variant (`sh -s -- --no-open`); automatic browser opening and the completed rendered sequence remain Open. The normal human command is:

```sh
curl -fsSL https://console.13-233-181-104.sslip.io/install.sh | sh
```

1. Open the printed local URL, normally `http://127.0.0.1:7777`. On **Name this device**, choose a fresh lowercase label. Join the prefilled `bramble-dev-c91e55e9.eth` tailnet. Do not reuse revoked test label `eth244-postfix-device`.
2. Have the operator approve membership through the console. Show the assigned private address. Say: “Enrollment identifies this device. A grant for the `task` service is a separate approval.”
3. State the recorded limit: “Our latest fresh-device test stays approved with no peer path. Its service test fails after 95 seconds. Installation and enrollment work; working service access on a new device is still Open.” Do not promise `connected` or a successful test.
4. Return to the existing cloud worker for denied call, service grant, HTTP 200 and service revoke. Do not substitute this result for the new device's failed service test. Beat 4 still requires separate direct-path and relay-fallback acceptance.
5. Have the operator revoke the demonstration enrollment and confirm cleanup. Record build, platform, timings and exact observed screens. Coordinate a live slot before submitting any enrollment or service request.

If this does not fit the optional 50-second slot, show dated evidence or move it after the pitch. Linux arm64 and both macOS runtimes remain unverified. Completing the full new-device segment requires ETH-293's accepted `connected` path, `POST /api/test` with `ok:true` and target HTTP 2xx, relay-only access, and an observed working-to-denied revoke transition. See the [join-test how-to](../deploy/JOIN-TEST.md). Do not publish a release or change cloud configuration while presenting.

## Recover when a beat stalls

Use these stage deadlines as **unverified presentation budgets**, not protocol timeouts. Count deny/success from starting curl, approval from clicking Approve, and revoke-to-failure from clicking Revoke access (including confirmation and the follow-up curl). The short script also stops each action at its clock-window end if that comes first; these deadlines do not extend the three-minute take. At the deadline, leave the pending state visible and switch to the prepared evidence. Keep the 150-second curl cap for an off-stage diagnosis. Do not issue repeated approve/revoke writes to hurry a pending transaction.

| Symptom / stage deadline                                                  | Say                                                                                                              | Do                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nodes not ready by T0                                                     | “The live nodes are still starting. This recording shows the tested build and its date.”                         | Use the labeled recording. Diagnose off stage with current-start readiness/adoption logs. Do not start another take against a warming path.                                                                                                |
| Deny has no result after 35 s, or success has no result after 55 s        | “This check is still pending. Today's runs vary, so I will show the earlier measured result with its timestamp.” | Stop narrating a live outcome. Switch to recording. A timeout, tunnel dial failure or missing adoption is not an access denial. Check fresh gateway logs off stage.                                                                        |
| Initial call succeeds before approval                                     | “This worker still has access from an earlier run. We need to reset before showing denial.”                      | Stop the sequence. The operator removes the existing grant by label, waits for propagation and verifies a fresh denial before restarting. An empty console queue does not prove an empty ACL.                                              |
| Approval still pending after 30 s, HTTP 202, or `write_unresolved`        | “The transaction receipt is not confirmed. I will not claim the grant is active yet.”                            | Inspect the request and its real Sepolia hash; let the service reconcile. Do not create another request or duplicate the write. Continue with labeled evidence.                                                                            |
| Success still denied after approval                                       | “The grant is confirmed, but this check has not observed access yet.”                                            | Verify identity, service `task`, receipt and fresh gateway decision. Retry the call off stage within a bounded two-minute investigation; do not approve again. If still denied, report the failure and stop the paid nodes.                |
| Revoke has no failed-call evidence after 50 s, or a call succeeds         | “Revocation is not yet demonstrated by this call. The confirmation and enforcement timestamps differ.”           | Inspect receipt and fresh denial. A call already in flight can succeed. Recheck off stage; do not say “instant revoke” or count a timeout as denial.                                                                                       |
| Console 401 or disabled buttons                                           | “The operator console is locked.”                                                                                | Have the human unlock privately. Do not paste tokens into the shared terminal or agent session.                                                                                                                                            |
| Console unavailable or signer error                                       | “The approval path is unavailable. I will show the recorded transaction and call sequence.”                      | Check the user units/tunnel off stage. Do not restart the approval service blindly: requests and revoke timers are in memory.                                                                                                              |
| Payment feed stale, empty or HashScan slow                                | “Settlement evidence is delayed or unavailable in this view.”                                                    | Use a real earlier transaction, explicitly labeled with its time, or state the gap. Do not report zero spend from a failed feed. Never substitute an HCS link for a payment.                                                               |
| HCS `Post failed`, `Awaiting mirror`, no receipt or missing configuration | “The service-access result is separate. This HCS record has not been verified.”                                  | Show the actual state. Request missing configuration from the operator off stage. Use `/audit/fixtures` only if visibly labeled synthetic. Never call `Commitment matched` proof that the source event occurred or every event was logged. |
| Join pending or connection test fails                                     | “Installation and enrollment are recorded; fresh-device service connectivity has not passed acceptance.”         | Show the actual state and return to the existing cloud worker. Keep the failure visible in the evidence log.                                                                                                                               |

## End the take

Save the timing and evidence notes, including every skipped or failed segment. The operator revokes any remaining grant and checks that no service access remains. Stop the paid nodes when the exclusive slot ends:

```sh
ssh bramble-worker 'sudo systemctl stop bramble-worker'
ssh bramble-gateway 'sudo systemctl stop bramble-gateway'
ssh bramble-worker 'systemctl is-active bramble-worker'
ssh bramble-gateway 'systemctl is-active bramble-gateway'
```

Expect `inactive` on both. An inactive `is-active` check normally returns a nonzero exit code. Check the payer feed after mirror indexing to confirm spending no longer increases. The unit enablement can restart spend after a machine reboot; have the operator account for that between presentations. Do not leave nodes running while editing slides.

For technical backing, use the [payment feed reference](17_AGENT_PAYMENTS_REFERENCE.md), [HCS record format](16_HCS_AUDIT_RECORD_FORMAT.md), [current HCS UI](../approval/src/components/hcs-panel.tsx), [audit configuration](../approval/src/lib/audit-runtime.ts), [request card](../approval/src/components/request-card.tsx), [README privacy scope](../README.md#crops) and [demo launcher](../scripts/demo/README.md). Older documents can retain planned status; current code supports capability claims, while the cited cloud comments establish live acceptance.
