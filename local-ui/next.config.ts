import type { NextConfig } from 'next'

const config: NextConfig = {
  // The export lands in `out/`; `pnpm embed` copies it to `node-daemon/ui/dist/` for go:embed.
  output: 'export',
  poweredByHeader: false,
  images: { unoptimized: true },
  // Shares the approval console's Button and stylesheet instead of copying them.
  experimental: { externalDir: true },
}

export default config
