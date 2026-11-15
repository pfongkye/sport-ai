// Copies MapLibre's ESM worker into public/ so the app can point
// maplibregl.setWorkerUrl() at a same-origin URL (see AGENTS.md #39).
// Runs from predev/prebuild; the output is gitignored (derived from node_modules).
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')
const dest = resolve(root, 'public/maplibre-gl-worker.mjs')
mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log('[maplibre] worker copied to public/maplibre-gl-worker.mjs')
