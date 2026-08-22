/**
 * Thin fetch wrapper for calling our own API routes from the browser.
 *
 * Adds `ngrok-skip-browser-warning` so that when the app is accessed through an
 * ngrok free-tier tunnel, ngrok proxies the request instead of returning its
 * HTML interstitial warning page. Without this, POST/fetch calls (e.g. file
 * upload, chat) receive HTML instead of JSON and fail — but only via ngrok, not
 * on localhost. See: https://ngrok.com/abuse
 *
 * Harmless on localhost / production (the header is simply ignored).
 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('ngrok-skip-browser-warning', 'true')
  return fetch(input, { ...init, headers })
}
