import type { NextConfig } from 'next'

/**
 * allowedDevOrigins: hosts allowed to request Next.js dev resources (/_next/*).
 * Next.js blocks cross-origin dev-resource requests by default, which breaks
 * tunneled access (ngrok) with 403s on chunk/HMR requests.
 *
 * We allow:
 *  - localhost (default dev)
 *  - any *.ngrok-free.app / *.ngrok.app / *.ngrok.io host (mobile testing)
 *  - anything listed in NEXT_ALLOWED_DEV_ORIGINS (comma-separated), so the
 *    ngrok-sync script can inject the exact rotating app host if needed.
 */
const extraOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '*.ngrok-free.app',
    '*.ngrok.app',
    '*.ngrok.io',
    ...extraOrigins,
  ],
}

export default nextConfig
