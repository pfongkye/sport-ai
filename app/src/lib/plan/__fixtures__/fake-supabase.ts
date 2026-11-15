/**
 * Tiny in-memory Supabase stand-in for unit tests (no network, no DB).
 * Supports the chain used by the plan code: select / insert / update / delete +
 * eq / in / gte / lte / order / limit + single / maybeSingle / await.
 * `failOn` makes a given `table.op` return an error; `ownerId` simulates RLS
 * (rows whose user_id differs are invisible).
 */
type Row = Record<string, unknown>
type Op = 'select' | 'insert' | 'update' | 'delete'

export interface FakeOptions {
  tables?: Record<string, Row[]>
  failOn?: string[] // e.g. 'planned_sessions.insert'
  /** When set, only rows with this user_id are visible/writable (RLS). */
  rlsUserId?: string
}

export function makeFakeSupabase(opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(opts.tables ?? {})) tables[k] = v.map((r) => ({ ...r }))
  const calls: { table: string; op: Op; payload?: unknown }[] = []
  let idCounter = 0

  function from(table: string) {
    tables[table] ??= []
    let op: Op = 'select'
    let payload: unknown
    const filters: ((r: Row) => boolean)[] = []
    let orderBy: { col: string; asc: boolean } | null = null
    let limitN: number | null = null
    let returning = false

    const visible = () =>
      tables[table].filter(
        (r) => !opts.rlsUserId || r.user_id === undefined || r.user_id === opts.rlsUserId
      )

    function run(): { data: unknown; error: { message: string } | null } {
      calls.push({ table, op, payload })
      if (opts.failOn?.includes(`${table}.${op}`)) {
        return { data: null, error: { message: `${table}.${op} failed` } }
      }
      const match = (r: Row) => filters.every((f) => f(r))
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const inserted = rows.map((r) => ({ id: `id-${++idCounter}`, ...r }))
        tables[table].push(...inserted)
        return { data: inserted, error: null }
      }
      if (op === 'update') {
        const hit = visible().filter(match)
        hit.forEach((r) => Object.assign(r, payload as Row))
        return { data: hit, error: null }
      }
      if (op === 'delete') {
        const hit = new Set(visible().filter(match))
        tables[table] = tables[table].filter((r) => !hit.has(r))
        return { data: [...hit], error: null }
      }
      let rows = visible().filter(match)
      if (orderBy) {
        const { col, asc } = orderBy
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
      }
      if (limitN != null) rows = rows.slice(0, limitN)
      return { data: rows, error: null }
    }

    const chain: Record<string, unknown> = {
      select() {
        if (op !== 'select') returning = true
        return chain
      },
      insert(p: unknown) {
        op = 'insert'
        payload = p
        return chain
      },
      update(p: unknown) {
        op = 'update'
        payload = p
        return chain
      },
      delete() {
        op = 'delete'
        return chain
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v)
        return chain
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]))
        return chain
      },
      is(col: string, v: null) {
        filters.push((r) => (v === null ? r[col] == null : r[col] === v))
        return chain
      },
      gte(col: string, v: string) {
        filters.push((r) => String(r[col]) >= v)
        return chain
      },
      lte(col: string, v: string) {
        filters.push((r) => String(r[col]) <= v)
        return chain
      },
      order(col: string, o?: { ascending?: boolean }) {
        orderBy = { col, asc: o?.ascending !== false }
        return chain
      },
      limit(n: number) {
        limitN = n
        return chain
      },
      async maybeSingle() {
        const r = run()
        const rows = (r.data as Row[] | null) ?? []
        return { data: r.error ? null : (rows[0] ?? null), error: r.error }
      },
      async single() {
        const r = run()
        const rows = (r.data as Row[] | null) ?? []
        if (r.error) return { data: null, error: r.error }
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } }
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        void returning
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return chain
  }

  return { client: { from } as never, tables, calls }
}
