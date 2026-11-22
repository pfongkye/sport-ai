// Minimal stub of the Supabase endpoints the app touches, so Next.js SERVER code
// (server components, proxy.ts) can run without a real Supabase. Playwright's
// page.route() cannot intercept server-side fetches, hence a real HTTP server.
//
//   GET /auth/v1/user      -> fixture user (any bearer token is accepted)
//   POST /auth/v1/logout   -> 204
//   GET /rest/v1/<table>   -> rows from fixtures.TABLES (filters are ignored;
//                             single/maybeSingle -> first row, `limit` honoured)
//   DELETE /rest/v1/planned_sessions -> removes the matching fixture rows (per access token)
//   PATCH /rest/v1/user_settings {language} -> remembered per access token (GET returns it back)
//   other /rest/v1 writes  -> 201 with an empty body
//
// Plan state is opt-in and per bearer token: tokens starting with `e2e-plan-` see an active plan
// (planFixtures) and their deletes are remembered in memory; every other token sees no plan.
// Filters are still ignored for all other tables. For planned_sessions the stub applies
// `col=eq.x`, `col=in.(a,b)` and `col=is.null` so the app's delete guards behave like PostgREST.
import http from 'node:http'
import { USER, TABLES, planFixtures, planActivities } from './fixtures.mjs'

const port = Number(process.env.STUB_SUPABASE_PORT || 54321)

const PLAN_TOKEN_PREFIX = 'e2e-plan-'
/** token -> { deleted: Set<sessionId> } */
const planState = new Map()
const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
const isPlanToken = (t) => t.startsWith(PLAN_TOKEN_PREFIX)

function applyFilters(rows, params) {
  return rows.filter((row) => {
    for (const [col, expr] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(col)) continue
      if (!(col in row)) continue
      if (expr.startsWith('eq.') && String(row[col]) !== expr.slice(3)) return false
      if (expr.startsWith('in.(') && !expr.slice(4, -1).split(',').includes(String(row[col]))) return false
      if (expr === 'is.null' && row[col] != null) return false
    }
    return true
  })
}

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
    if (p === '/__e2e/reveal-activities' && req.method === 'POST') {
      // Test control: make the token's hidden activities visible (simulates a Strava import).
      const token = url.searchParams.get('token') ?? ''
      const st = planState.get(token) ?? { deleted: new Set() }
      st.revealed = true
      planState.set(token, st)
      return send(res, 200, { ok: true })
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length)
      const token = tokenOf(req)
      const plan = isPlanToken(token) ? planFixtures() : null
      const state = planState.get(token) ?? { deleted: new Set() }
      planState.set(token, state)
      const liveSessions = () => (plan?.planned_sessions ?? []).filter((r) => !state.deleted.has(r.id))
      if (req.method === 'DELETE' && table === 'planned_sessions') {
        const hit = applyFilters(liveSessions(), url.searchParams)
        hit.forEach((r) => state.deleted.add(r.id))
        const single = (req.headers.accept || '').includes('vnd.pgrst.object')
        if (single && !hit.length) {
          return send(res, 406, { code: 'PGRST116', message: 'no rows', details: null, hint: null })
        }
        return send(res, 200, single ? hit[0] : hit)
      }
      if (req.method === 'PATCH' && table === 'user_settings') {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          try {
            const { language } = JSON.parse(raw || '{}')
            if (typeof language === 'string') state.language = language
          } catch {
            // ignore malformed bodies, like any other stubbed write
          }
          if ((req.headers.prefer || '').includes('return=representation')) {
            return send(res, 200, [{ user_id: USER.id }])
          }
          send(res, 204)
        })
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 201)
      let rows = TABLES[table] ?? []
      if (table === 'user_settings' && state.language) {
        rows = [{ user_id: USER.id, language: state.language, timezone: 'UTC' }]
      }
      if (plan && table === 'training_plans') rows = plan.training_plans
      if (plan && table === 'activities') rows = planActivities().filter((a) => !a.hidden || state.revealed)
      if (plan && table === 'planned_sessions') rows = applyFilters(liveSessions(), url.searchParams)
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
