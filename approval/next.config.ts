import type { NextConfig } from 'next'

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@bramble/hedera-audit', '@bramble/join-ui'],
  // The real signer imports admincli and sidecar sources from sibling workspace packages.
  experimental: { externalDir: true },
}

export default config
