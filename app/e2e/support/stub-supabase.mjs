// Minimal stub of the Supabase endpoints the app touches, so Next.js SERVER code
// (server components, proxy.ts) can run without a real Supabase. Playwright's
// page.route() cannot intercept server-side fetches, hence a real HTTP server.
//
//   GET /auth/v1/user      -> fixture user (any bearer token is accepted)
//   POST /auth/v1/logout   -> 204
//   GET /rest/v1/<table>   -> rows from fixtures.TABLES (filters are ignored;
//                             single/maybeSingle -> first row, `limit` honoured)
//   other /rest/v1 writes  -> 201 with an empty body
import http from 'node:http'
import { USER, TABLES } from './fixtures.mjs'

const port = Number(process.env.STUB_SUPABASE_PORT || 54321)

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`)
    const p = url.pathname
    if (p === '/__health') return send(res, 200, { ok: true })
    if (p === '/auth/v1/user') return send(res, 200, USER)
    if (p === '/auth/v1/logout') return send(res, 204)
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length)
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 201)
      let rows = TABLES[table] ?? []
      const limit = Number(url.searchParams.get('limit'))
      if (limit > 0) rows = rows.slice(0, limit)
      if ((req.headers.accept || '').includes('vnd.pgrst.object')) {
        return rows.length
          ? send(res, 200, rows[0])
          : send(res, 406, { code: 'PGRST116', message: 'no rows', details: null, hint: null })
      }
      return send(res, 200, rows, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` })
    }
    send(res, 404, { message: `stub: unhandled ${req.method} ${p}` })
  })
  .listen(port, () => console.log(`[stub-supabase] listening on :${port}`))
