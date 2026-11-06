# Local web UI reference

The local web UI is the member and admin face of `bramble` (ETH-177e). It serves demo beats 2 (request and approve), 4 (direct path) and 5 (revoke). The `bramble` binary embeds the static export and serves it at `/` on `127.0.0.1:7777`.

The UI reads one endpoint, `GET /api/state`, every second. It writes only through the contract's POST endpoints. It holds no state of its own, and the page writes nothing to disk or to `localStorage`.

## Commands

Run these from the repository root.

| Command                                                                                 | What it does                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @bramble/local-ui build`                                                 | Writes the static export to `local-ui/out/`.                                                            |
| `pnpm --filter @bramble/local-ui embed`                                                 | Copies `out/` into `node-daemon/ui/dist/`, which Go embeds. Run it after `build` and before `go build`. |
| `pnpm --filter @bramble/local-ui dev`                                                   | Serves `out/` and a mock `bramble` API on `http://127.0.0.1:7788/`.                                     |
| `pnpm --filter @bramble/local-ui test`                                                  | Unit tests for the copy helpers, parsers and the mock.                                                  |
| `pnpm --filter @bramble/local-ui test:ui`                                               | Playwright run at 1280 px and 390 px wide. Needs `build` first.                                         |
| `SCREENSHOT_DIR=$PWD/docs/screenshots/local-ui pnpm --filter @bramble/local-ui test:ui` | Writes a screenshot of every screen to that folder.                                                     |

## Screens

| Phase       | Screen                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `setup`     | Name this device. Shows the device fingerprint.                                                       |
| `ready`     | Enter the network name and request to join.                                                           |
| `pending`   | Waiting for approval, with Cancel.                                                                    |
| `approved`  | Approved, setting up the address.                                                                     |
| `denied`    | Not approved, with Start over.                                                                        |
| `connected` | Address, Private services with Open links, peers with a Direct or Relayed badge, Test connection, Leave. |
| `error`     | The error message and next step from `state.error`, with Check again and Leave network or Start over. |
| (no answer) | "Bramble is not running". A failed poll after a first answer keeps the last state and shows a banner. |

When `isAdmin` is true, an Admin tab appears with a count of waiting requests. It lists join requests (Approve, Deny), devices on the network (Revoke, with a confirm) and closed requests. It calls `/api/admin/*` only.

## Admin calls

The UI assumes `/api/admin/<path>` forwards to `<joinApi>/api/<path>` with the admin token attached.

| UI call                                           | Join API                                    |
| ------------------------------------------------- | ------------------------------------------- |
| `GET /api/admin/joins`                            | `GET /api/joins`                            |
| `GET /api/admin/members`                          | `GET /api/members`                          |
| `POST /api/admin/joins/:id/approve\|deny\|revoke` | `POST /api/joins/:id/approve\|deny\|revoke` |

The contract does not fix the response bodies of the two GET calls. The UI accepts `{ joins: [...] }` and `{ members: [...] }` (or a bare array). Each row needs `id`, `label`, `tailnet` and `status`. `pubkey`, `meshIp` and `createdAt` are optional. A `401` or `403` from the proxy shows fixed copy that names `bramble admin login`. A `5xx` shows fixed copy that tells the admin to check their internet connection. Other error bodies show `error.message`.

`services[]` lists `{ peer, service, url }` for each service in the node config once the device is approved. `url` is the loopback forward, for example `http://127.0.0.1:41873/task`. The UI drops any link that is not plain `http` to `127.0.0.1`, and opens the rest in a new tab. The link only says where the forward listens; the gateway still decides each connection. Daemons without the field show no services section.

`peers[].lastHandshake` may be an ISO 8601 string or a Unix time in seconds or milliseconds. A zero value reads as "Not yet".

## Mock server

`mock/model.ts` implements the local API and the admin proxy in memory. `mock/server.ts` serves it with `out/`. Test hooks under `/__test/*` (`reset`, `flags`, `state`, `joins`) exist only in the mock. Reset scenarios are `fresh`, `ready`, `pending`, `approved`, `denied`, `connected`, `connected-empty`, `error` and `error-first-join`.

## Reuse

The package imports the approval console's `Button` and `globals.css` through the `@approval/*` path alias (Next `experimental.externalDir`). The join cards use the console's `request-card` styles. The agent request card itself is not reused, because a join request has different fields.
