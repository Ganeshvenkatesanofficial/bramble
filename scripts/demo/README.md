# Demo launcher, preflight and reset

Three commands run the live demo: `pnpm demo` starts what the current machine needs, `pnpm demo:preflight` checks that the demo can run, and `pnpm demo:reset` returns the demo to its initial state on the real chain.

**Evidence labels.** Unit tests are **Verified** (`pnpm --filter @bramble/demo-ops test`). Every run against real machines, the real chain, Hedera, Tor or a STUN server is **needs human verification**. Items marked **Read from source** were checked in code that is not merged into `hackathon` yet. Items marked **Open** have no source in the repository.

## How to start the demo

1. On each machine, run the installer from the deploy runbook (`deploy/README.md`, ETH-49). It seeds `/etc/bramble/<role>.env`.
2. Fill in the env files. Set `SEPOLIA_RPC_URL` to a dedicated endpoint if you have one. If it is unset, the default public endpoint works, but reads can occasionally be stale.
3. On the machine you drive from, set how to reach the others (see [Connection settings](#connection-settings)).
4. Run `pnpm demo` on every machine, relays first:

   ```sh
   pnpm demo                   # roles come from /etc/bramble
   pnpm demo --role gateway    # or name them
   pnpm demo --dry-run         # print the plan, start nothing
   ```

   The command starts this machine's systemd units in order, checks that each is active, prints the command to run on the other machines, then runs the preflight and waits up to 120 seconds for Tor to finish starting.

5. Read the preflight report. Every line must be `PASS` or `WARN` before you start the demo.

If a unit fails to start, the launcher stops at that unit, because later units depend on it. It shows the exit code or unit state, never the command's own error output: run `journalctl -u <unit>` for the cause.

## How to run only the checks

```sh
pnpm demo:preflight --role admin --wait 90
```

The command exits `0` when nothing failed (warnings are allowed), `1` when a check failed, and `2` when it could not run. Checks that can pass without help, such as "starting Tor", are retried every 5 seconds for `--wait` seconds.

## How to reset the demo

Run this on the admin machine before each take. It returns the agent device to enrolled, not revoked, with an empty `acl` record (any non-empty record is cleared, even one that holds no digest):

```sh
pnpm demo:reset --dry-run        # read the chain, list what would change, send nothing
pnpm demo:reset                  # send the transactions
```

The reset uses `admincli`'s importable functions (ETH-28), so it sends the same transactions as `admincli revoke-acl` and `admincli revoke`. A second run sends nothing. It does not enrol a device: a device with no `pubkey` is an error. It signs with `SEPOLIA_PRIVATE_KEY`. It loads the granter key from `BRAMBLE_GRANTER_PRIVATE_KEY` or the Key Ring file, and only when a grant needs removing.

## Reference

### Roles and units

| Role      | Machine        | Units, in start order                                          |
| --------- | -------------- | -------------------------------------------------------------- |
| `relays`  | Relays machine | `bramble-relay@<instance>` for each instance                   |
| `gateway` | Gateway node   | `[bramble-nat-box]`, `bramble-demo-service`, `bramble-gateway` |
| `worker`  | Worker node    | `[bramble-nat-box]`, `bramble-worker`                          |
| `admin`   | Admin machine  | `bramble-approval`, `bramble-console-tunnel`                   |

Unit names are **Read from source** (`deploy/REFERENCE.md`, unmerged ETH-49). The relays machine also needs `rpc-proxy` (unit file from ETH-44, unmerged), `caddy` and `coturn`. The launcher does not start them, because the installer does not enable them yet. It prints `sudo systemctl enable --now rpc-proxy caddy coturn`, and the preflight check `services:relays` fails on the relays machine until all three are active. Whether those three units exist on a real machine is **needs human verification**.

### Connection settings

Set these in the repo `.env` or the shell. The launcher and preflight print only their names.

| Variable                                  | Meaning                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DEMO_GATEWAY_SSH`, `DEMO_WORKER_SSH`     | ssh target (`user@host` or a Host alias) for a node this machine does not run                 |
| `DEMO_GATEWAY_NETNS`, `DEMO_WORKER_NETNS` | Network namespace of a remote node inside the NAT box                                         |
| `DEMO_NAT_BOX`                            | `1` when this machine's nodes run in the NAT box: starts `bramble-nat-box`, probes inside it  |
| `NATBOX_NS`                               | NAT box namespace name, default `bramble-node`                                                |
| `DEMO_RELAY_INSTANCES`                    | Comma list of relay instance names, default from `/etc/bramble/relay-*.env`                   |
| `DEMO_AGENT_LABEL`                        | Agent device label. Also checked against the device registry                                  |
| `DEMO_GRANTER_LABEL`                      | Granter device label (reset)                                                                  |
| `DEMO_PAYER_ACCOUNT_IDS`                  | Comma list of Hedera accounts to check. Default: each local node's `HEDERA_CLIENT_ACCOUNT_ID` |
| `DEMO_MIN_PAYER_USDC_ATOMIC`              | Minimum payer balance in atomic USDC, default `500000` (0.5 USDC)                             |
| `HEDERA_MIRROR_URL`                       | Mirror node base URL, default the public testnet mirror                                       |

The sidecar (port 7890) and the node status API (port 7899) bind to loopback, so the preflight reaches another machine's node with `ssh <target> curl http://127.0.0.1:<port>/...`, wrapped in `sudo -n ip netns exec <ns>` for the NAT box. ssh runs with `BatchMode=yes` and `StrictHostKeyChecking=yes`: connect once by hand first. A node the preflight cannot reach is a `FAIL`, never a skip.

### Preflight checks

| Check id          | What it verifies                                                                                                                                                             | Status of the endpoint it reads                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `env:<role>`      | Required variable **names** are set for each local role. Values are never printed. Admin also needs the granter key (env or Key Ring file) and a `HEDERA_SERVER_*` variable  | Names: Read from source. The exact `HEDERA_SERVER_*` names are **Open** |
| `sepolia-rpc`     | `SEPOLIA_RPC_URL` is set (value hidden) → `PASS`. Unset → `WARN` that reads may be stale                                                                                     | Verified (unit test)                                                    |
| `sidecar:<node>`  | `GET /health` is `ok` and serves the expected tailnet                                                                                                                        | Read from source                                                        |
| `tor:<node>`      | `GET /tor/status` reports `ready`                                                                                                                                            | Read from source (ETH-59, unmerged)                                     |
| `stun:<node>`     | `GET /endpoint` on the status API reports `discovered`                                                                                                                       | Read from source (ETH-36, merged into `hackathon`)                      |
| `registry:<node>` | `GET /devices` resolves and lists the agent device                                                                                                                           | Read from source                                                        |
| `relay`           | At least one rendezvous relay accepts a TCP connection **and** at least one payment sidecar answers `/health`, or it fails. A down redundant relay is a `WARN` that names it | Read from source                                                        |
| `services:relays` | On the relays machine only: `rpc-proxy`, `caddy` and `coturn` are active (`systemctl is-active`)                                                                             | Read from source (ETH-49, ETH-44, unmerged)                             |
| `hedera:<id>`     | The payer account is associated with USDC `0.0.429274` and holds at least the minimum, from the mirror node                                                                  | Read from source                                                        |

`pnpm demo` and `pnpm demo:preflight` are **Verified** only as far as the unit tests and a local dry run: no real run has happened. A real run needs the machines, so it is **needs human verification**.

### Secrets

The scripts never print an env value, an RPC URL, or a key. Every check detail and every error is scrubbed before it is shown: URLs (to the end of the token), 32-byte hex and Hedera DER keys, and every value of a secret-named variable (`*KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*RPC_URL*`, `*_PK`) in the process env, the repo `.env` and `/etc/bramble/*.env`. Text that a remote node reports (Tor, STUN and registry errors) is replaced by a fixed message. Output of the commands the launcher runs is read and dropped, not forwarded. The reset prints transaction hashes and ENS names only.
