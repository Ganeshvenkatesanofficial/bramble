# Demo checklist: run the Bramble access lifecycle

One-page runbook for the finalist slot (4 minutes of demo, 3 minutes of questions). It gives the beat order and timings from [handoff section 4](15_MUMBAI_HANDOFF.md#4-the-demo). Exact commands, fallbacks and the sixty-second sponsor scripts live in the [operator script](DEMO_SCRIPT.md). Evidence labels: **Verified (reported)** is another operator's recorded run; **Read from source**; **Open** is not yet shown.

Deadline: Saturday 7 November 2026, 09:00 IST. Cloud nodes cost testnet USDC while running. Use the one shared slot coordinated through ETH-244, and stop the nodes when you finish.

## Before the slot

- [ ] ETH-244 releases the cloud pair to you. Nobody restarts units, edits grants or calls the forward during the take.
- [ ] Start the nodes at least 3 minutes early (more if a full rehearsal needs it). Wait for `serving on` and `adopted new candidate` on both nodes.
- [ ] Public console loads and `GET /api/requests` returns 200. A human unlocks it with the demo token. Keep the token and any `.env` off screen.
- [ ] Remove any old `mumbai-worker` grant. Warm the denied path once off stage.
- [ ] Testnet balances are enough: Sepolia ETH for the admin, Hedera testnet HBAR and USDC (token `0.0.429274`) for the payer.
- [ ] A dated recording of a full run exists as the fallback.
- [ ] One request for `mumbai-worker` → `mumbai-gateway`, service `task`, is pending.

## Beat order and timings

The target schedule is the handoff's 2:50 run. The measured waits are longer: Tor-backed calls took about 27 s to deny and 37–44 s to succeed in the 6 November cloud runs. Use the six-minute table in the operator script if your rehearsal does not fit.

| Beat | Target | Show | Evidence at the cutoff |
| --- | --- | --- | --- |
| 0. Framing | 0:00–0:10 | "AI agents need your private services, not your credentials." | none needed |
| 1. Denied | 0:10–0:25 | The same worker curl is refused; the gateway logs "no matching granted digest" | Verified (reported): ETH-244 runs A and B |
| 2. Request and approve | 0:25–0:50 | Request card, one click on **Approve**, Sepolia receipt | Verified (reported): ETH-244 runs A and B |
| 3. Works and pays | 0:50–1:20 | Same curl returns the task JSON; HashScan payment; new HCS record | Payment: Verified (reported). HCS: **Open** until the console shows a fresh, mirror-verified receipt |
| 4. Direct path | 1:20–1:40 | STUN discovery, hole-punched path, relay fallback | **Open**: leave out of the live run unless rehearsed |
| 5. Revoke | 1:40–2:00 | Click **Revoke access**; the next call fails; the feed shows the time | Verified (reported): first failed call 36.6 s and 37.0 s after revoke began |
| 6. What the provider sees | 2:00–2:35 | Provider log before Tor (node IPs, 5 s polls) and after (Tor exits only) | **Open**: the current-build comparison is not recorded |
| 7. Close | 2:35–2:50 | "Scoped. Revocable. Paid. Private. Enforced by every peer from ENS." | none needed |

## During the take

- [ ] Use the identical worker curl for beats 1, 3 and 5. Do not restart anything between them.
- [ ] Say "worker", not "agent", unless a separate rehearsal proves an agent session. Curl as Unix user `agent` is not an autonomous agent.
- [ ] Show a payment from this run, with its payer and time. Label an earlier one as earlier. Approval does not trigger a payment.
- [ ] Show HCS only if a new receipt exists. Otherwise say: "The HCS integration exists in source, but this deployment has no configured recorder."
- [ ] Confirmation and first failed call are separate timestamps. Never say "instant revoke".
- [ ] A timeout or tunnel error is not a denial. Check the gateway journal before you call a result.
- [ ] At a stage deadline (deny 35 s, success 55 s, revoke-to-failure 50 s), switch to the labeled recording. Never describe a recording as live.

## Questions to prepare

- **Is Tor slow?** The Tor measurement replays a real RPC trace: median detection 7.0–11.5 s, worst 29 s, excluding chain confirmation. Live cloud calls include Tor but we have not isolated its share.
- **What do relays and STUN still see?** Peer IP addresses. WireGuard is UDP and bypasses Tor. The upgrade protects ENS reads and payment HTTP.
- **Does the RPC provider learn nothing?** It still sees names, requested records and timing.
- **Is a public Hedera log a leak?** HCS carries salted commitments only; kind and timing are public.
- **Is there infrastructure?** Yes: relays, RPC and an administrator. No coordinator decides access; each peer reads ENS.

## After the take

- [ ] Remove any remaining `mumbai-worker` grant and confirm the next call is denied.
- [ ] Stop the paid nodes, then check both units report `inactive` (commands in the operator script).
- [ ] Record build, times, request ID, transaction hashes, payment reference and HCS sequence (or its failure) in ETH-244.

## Submit

- [ ] Choose "Finalist and Partner Prizes". Partners: ENS, Hedera, Ethereum Foundation.
- [ ] Paste the form text from the [submission draft](13_SUBMISSION_DRAFT.md). Replace each bracket, and delete any claim marked Open that stayed Open.
- [ ] Video: 2–4 minutes, at least 720p, human narrated, not sped up. Link it in the form.
- [ ] No secrets, authenticated RPC URLs or private IPs in the repository.
