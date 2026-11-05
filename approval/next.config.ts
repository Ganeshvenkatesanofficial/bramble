import type { NextConfig } from 'next'

const config: NextConfig = {
  poweredByHeader: false,
  // The real signer imports admincli and sidecar sources from sibling workspace packages.
  experimental: { externalDir: true },
}

export default config
