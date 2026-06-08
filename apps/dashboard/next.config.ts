import type { NextConfig } from 'next'

const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:7001'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['hq.narluga-climb.ts.net'],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/:path*` },
    ]
  },
}

export default nextConfig
