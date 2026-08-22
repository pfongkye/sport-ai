/**
 * Browser HTTP helper for calling our own API routes.
 *
 * In normal operation this is just `fetch`. When the app is being accessed
 * through a dev tunnel (ngrok free tier), it adds `ngrok-skip-browser-warning`
 * so the tunnel proxies the request instead of returning its HTML interstitial
 * — but ONLY when NEXT_PUBLIC_TUNNEL_MODE is set, so production traffic never
 * carries any tunnel-specific headers.
 *
 * Why here and not in ngrok config: ngrok decides the interstitial at its edge
 * before the agent runs, so the header must come from the browser. This is the
 * only reliable free-tier bypass. It is gated by env so it's a dev-only concern
 * that leaves production fetches pristine.
 *
 * Set NEXT_PUBLIC_TUNNEL_MODE=ngrok in app/.env.local only while tunnelling
 * (ngrok-sync.sh sets it automatically). Leave it unset everywhere else.
 */
const TUNNEL_MODE = process.env.NEXT_PUBLIC_TUNNEL_MODE

export function http(input: string, init: RequestInit = {}): Promise<Response> {
  if (TUNNEL_MODE !== 'ngrok') {
    return fetch(input, init)
  }
  const headers = new Headers(init.headers)
  headers.set('ngrok-skip-browser-warning', 'true')
  return fetch(input, { ...init, headers })
}
