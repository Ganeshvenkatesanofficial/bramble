import type { NextConfig } from 'next'

const config: NextConfig = {
  // The `bramble` binary embeds the static export in `out/` and serves it at `/`.
  output: 'export',
  poweredByHeader: false,
  images: { unoptimized: true },
  // Shares the approval console's Button and stylesheet instead of copying them.
  experimental: { externalDir: true },
}

export default config
