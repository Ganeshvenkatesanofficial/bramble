# Public console QA evidence, 6 November 2026

This reference records the ETH-249 read-only browser pass for demo beats 1, 2,
3 and 5. The console responds, but the pass does not establish full demo
readiness. One P1 deployment finding and one P2 theme finding remain.

## Conditions

- Operator: QA-Sol.
- Observation window: 2026-11-06, approximately 12:33–12:38 UTC.
- Public URL: `https://console.13-233-181-104.sslip.io/`.
- Browser: `agent-browser`, launched with `AGENT_BROWSER_ARGS="--no-sandbox"`.
- Viewports: 1280 × 900 and 390 × 844 CSS pixels, device scale 1.
- Themes: emulated `prefers-color-scheme: light` and `dark`.
- The public console stayed open for more than 60 seconds before the final
  history and source-health observations. No token was entered. No request,
  approval, denial, grant, revoke, join or setup action was submitted.
- No cloud-node shell, service, configuration or deployment was accessed.
- Local reference checkout: `5724e2f` from `origin/hackathon`. **Open:** the
  deployed commit SHA is unavailable from the UI; this checkout SHA does not
  identify the deployed build.

## Coverage

| Segment | Evidence and verdict |
| --- | --- |
| Queue, beat 2 | **Verified:** live refresh label, 0 pending requests, explicit empty state. A populated pending queue remains **Open**. |
| Request cards, beat 2 | **Verified:** eight closed requests render identity labels, public-key/revocation/expiry summaries, service, duration, missing-quote copy and history status. |
| Approve and grant, beats 2–3 | **Verified:** existing history displays confirmed grant transaction links. **Open:** approve controls, confirmation transitions and populated active-grant list; no eligible current requests or active grants exist. No action was submitted. |
| Revoke, beat 5 | **Verified:** history displays revoked status and separate confirmed revoke transaction links. **Open:** active revoke controls and actual enforcement/cutoff. Receipt text is UI evidence, not independent chain or gateway verification. |
| Activity, beats 1–3 and 5 | **Verified:** existing request, deny, grant and revoke events render. Approvals reports live; gateway and payments report not configured. P1 finding below. **Open:** arrival of a new event, payment settlement and gateway cutoff. |
| HCS/HashScan, beat 3 | **Verified:** live panel explicitly requires unlocking. `/audit/fixtures` displays grant, payment and revoke records with commitment-match labels, topic, sequence, timestamp and HashScan URLs. The page explicitly labels synthetic events and URL-format examples. **Open:** authenticated retained records, live mirror matching and actual HashScan transaction existence. No synthetic link is counted as a live receipt. |
| Layout | **Verified:** captured public pages and local mock setup remain within the viewport at both widths. Dark preference retains the light palette. P2 finding below. |
| Local join/status/peers, beats 2 and 4 | **Verified:** loopback ports 7777 and 7778 refuse connections. Existing mock UI at `http://127.0.0.1:7788/` displays “Name this device” at both widths/themes. **Read from source:** `local-ui/README.md` identifies 7788 as the mock and 7777 as the embedded daemon UI. **Open:** join, connected status, peers and admin views. The existing mock was not advanced or reset. |

## Ranked defects

No P0 was observed within the inspected read-only states. Uninspected actions
and live integrations are not covered by that statement.

### P1: gateway and payment evidence is absent from the public feed

**Verified.** Filed as [ETH-254](/ETH/issues/ETH-254). This prevents the feed
from presenting gateway allow/deny, settlement and cutoff evidence for demo
beats 1, 3 and 5. The infrastructure cause remains **Open**.

Exact reproduction:

1. Open the public URL at 1280 × 900 or 390 × 844.
2. Wait at least 60 seconds and read `Live activity` → feed sources.
3. Observe `Approvals: live`, `Gateway: not configured` and
   `Payments: not configured`.
4. Inspect the existing events. Request/deny/grant/revoke events are present;
   gateway/payment/cutoff events are absent.

Expected: the intended public-demo sources supply existing gateway and payment
evidence, with source-health labels preserved. Reproduces with either theme
preference. Evidence: `1280-light-top.png`, `390-light-top.png` and
`live-snapshot.txt` in the evidence directory.

### P2: dark preference retains the light palette

**Verified.** Both public pages and the local mock setup render a white
background with dark text when the browser requests dark colors. Readability
remains intact; this is a theme-coverage gap.

Exact reproduction:

1. Open the public root or `/audit/fixtures`.
2. Set viewport to 1280 × 900 or 390 × 844.
3. Run `agent-browser --session <session> set media dark`.
4. Evaluate `matchMedia('(prefers-color-scheme: dark)').matches` and
   `getComputedStyle(document.body).backgroundColor`.
5. Observe `true` and `oklch(1 0 0)` respectively. The screenshots retain the
   light palette. Switching to `set media light` retains the same background.

Expected for a dark-theme pass: a dark palette follows the requested color
scheme. Evidence: each `*-dark-*.png` and its corresponding light capture.
Dark theme support as a product requirement remains **Open**; this report
records the requested test condition without choosing a new visual design.

## Screenshot paths

The evidence directory is `artifacts/eth-249/` under
`/home/anonjr/bramble-work/wt/qa-sol/eth-249-public-qa/`. Images are delivered
through the Paperclip evidence bundle; they are not committed as source.

| Page/state | 1280 light | 1280 dark | 390 light | 390 dark |
| --- | --- | --- | --- | --- |
| Public live console, full page | `1280-light-live.png` | `1280-dark-live.png` | `390-light-live.png` | `390-dark-live.png` |
| Public HCS offline fixtures, full page | `1280-light-fixtures.png` | `1280-dark-fixtures.png` | `390-light-fixtures.png` | `390-dark-fixtures.png` |
| Local mock setup, full page | `1280-light-local-mock.png` | `1280-dark-local-mock.png` | `390-light-local-mock.png` | `390-dark-local-mock.png` |

Focused captures: `1280-light-top.png`, `390-light-top.png` and
`1280-light-hcs-locked.png`. Text evidence: `live-snapshot.txt`,
`live-text.json`, `local-mock-observations.json` and `matrix-observations.json`.

## Approval boundaries

**Open:** ETH-51 H4 human approval, deployed commit identity, authenticated live
HCS evidence and the uninspected action states listed above. ETH-249 provides
the requested read-only evidence; it does not replace those checks or authorize
new live actions.
