---
name: bramble-private-service
description: Fetch data from the private "__SERVICE__" service through the Bramble forward. Use when asked to get the task or any data from the private staging service. Handles the denied, request access, wait for a human, retry flow.
---

# Private service access

The private service is reachable only through two tools. You hold no credential for it.

1. Call `call_private_service` with `path` `/task`.
2. If it returns `task result: ...`, report that result and stop.
3. If it returns `denied: no grant`, you have no access. Call `request_private_access` with `service` `__SERVICE__` and a one-line `reason`. This call waits for a human to decide, up to two minutes.
4. If it returns `granted`, call `call_private_service` again. The gateway can take a few seconds to see a new grant, so retry up to three times.
5. If it returns `denied: a human rejected ...`, report that and stop. Do not ask again.
6. If it returns `pending`, a human has not decided yet. Report that and stop.

Report each step in one short line. Never guess the result.
