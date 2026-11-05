import type { NextConfig } from 'next'

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@bramble/hedera-audit'],
}

export default config
