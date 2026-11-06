# ENS deployment configuration

`BRAMBLE_ENS_DEPLOYMENT` selects the Sepolia contract set in `sidecar/src/ens/config.ts`. The node sidecar, admin CLI, approval service, relay sidecar and provisioning scripts use this module. The chain ID stays `11155111`.

| Value | Deployment | Default |
| --- | --- | --- |
| `hackathon-test` | September hackathon test deployment; existing tailnet | Yes, until the new lifecycle passes |
| `sepolia-v2` | Official ENSv2 Sepolia deployment, October 1, 2026 | No; opt in before starting the process |

An empty value uses the default. An unknown value stops startup. Export the selector before invoking a command; set it in each service's environment file. Generated node configs carry it as `ensDeployment`. Existing node configs without that field select `hackathon-test`.

## Official contract set

Read from source, November 7, 2026: the [ENS deployment docs](https://docs.ens.domains/learn/deployments/) link the deployed ABIs to [contracts-v2 revision `07e55a0`](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/docs/addresses/sepolia.md). Its deployment timestamp is `2026-10-01T07:55:02.016Z`. Mutable branch address lists can describe a different deployment; use the immutable revision.

| Contract | Address |
| --- | --- |
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` |
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` |
| MockUSDC | `0x240b0316df57887dbbe58b586508b19e633a14aa` |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` |
| UserRegistryImpl | `0x9bd8a88719068d09ecee662f36c0e3856708366a` |
| UpgradableUniversalResolverProxy | `0xeeeeeeee14d718c2b47d9923deab1335e144eeee` |

The resolver proxy is the public resolution entry point. `UniversalResolverV2` at `0x24e1d8e068620b647ca097f961a61055f4f42d72` is its implementation, not the configured entry point.

Verified on Sepolia, November 7, 2026: all seven configured contracts have bytecode. The registrar's `ETH_REGISTRY()` returns the configured ETHRegistry. `MIN_COMMITMENT_AGE()` is 60 seconds; `MIN_REGISTER_DURATION()` is 2,419,200 seconds.

## ABI and roles

Read from source at the immutable revision: parent `register` takes label, owner, secret, subregistry, resolver, duration, payment token and referrer. Subregistry `register` takes label, owner, subregistry, resolver, role bitmap and expiry. The resolver initializer takes `Grant[]` plus `bytes[]`; the user registry initializer takes `Grant[]` alone.

`getState` returns the static tuple `(status, expiry, latestOwner, tokenId, resource)`; the existing flattened read ABI has the same wire encoding. `setText(bytes,string,string)` and `grantSetterRoles(bytes,address)` retain their signatures. `ROLE_REGISTRAR = 1 << 0` is a root registry role. `ROLE_SET_TEXT = 1 << 4` supports the independent per-setter permissions used by ADR 0004 and ADR 0005. No role or record-schema change is required for this deployment.

## Environment consistency

These values describe one deployment and must move together:

- `BRAMBLE_ENS_DEPLOYMENT`
- `BRAMBLE_TAILNET_NAME`, `BRAMBLE_TAILNET_REGISTRY`, `BRAMBLE_TAILNET_REGISTRY_DEPLOY_BLOCK`
- `BRAMBLE_RELAY_REGISTRY`, `BRAMBLE_RELAY_REGISTRY_DEPLOY_BLOCK`
- Approval's `APPROVAL_ENS_PARENT`, equal to `BRAMBLE_TAILNET_NAME`

Contract selection does not translate records between deployments. Retain the old values for rollback. The provisioning command's `--parent-only --name <label>` mode emits the new public parent configuration and saves it to ignored `.tmp/<deployment>-parent.json`. It does not overwrite `sidecar/test/fixtures/dev-tailnet.json` or enroll a placeholder device.

Open: official-tailnet cloud cutover and demo beats 1, 2, 3 and 5 require live evidence before changing the default or retiring the old configuration.
