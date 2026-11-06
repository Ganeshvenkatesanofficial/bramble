# Run the alternate HCS experiment offline

**Kind:** How-to. Scope: ETH-66, demo beat 3. The [evidence note](../../docs/spikes/0014-hcs-audit-trail.md) describes limits. This experiment uses an unselected alternative to the merged record format.

1. Install the pinned Hedera software development kit and Bun into a temporary directory:

   ```sh
   npm install --prefix /tmp/eth-66-hcs-tools --no-package-lock --ignore-scripts @hiero-ledger/sdk@2.90.1 bun@1.3.14
   ```

2. From the repository root, run both commands. They freeze a transaction against a loopback client and use injected mirror fixtures. They do not sign or submit:

   ```sh
   node scripts/spikes/hcs-audit.mjs /tmp/eth-66-hcs-tools/node_modules/@hiero-ledger/sdk/lib/index.js
   /tmp/eth-66-hcs-tools/node_modules/@oven/bun-linux-x64/bin/bun scripts/spikes/hcs-audit.mjs /tmp/eth-66-hcs-tools/node_modules/@hiero-ledger/sdk/lib/index.js
   ```

3. Check that both exit 0 and print `Verified offline:`. The evidence note records the exact tested behavior. These commands do not establish production compatibility, live submission or explorer rendering.
