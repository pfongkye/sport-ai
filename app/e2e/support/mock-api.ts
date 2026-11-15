import type { Page } from '@playwright/test'
import { SUGGESTED_ROUTE } from './fixtures.mjs'

// 1x1 transparent PNG, used for map tiles so screenshots are deterministic and offline.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

/** Browser-side mocks: our own /api/* routes (AI, ORS, Strava) and external tiles. */
export async function mockBrowserApis(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  )
  await page.route('**/api/ai/chat/history*', (r) =>
    r.fulfill({
      json: {
        messages: [
          { id: 'm1', role: 'user', content: 'How was my week?', created_at: '2025-06-20T08:00:00Z' },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Solid week: **3 sessions**, 31 km. Keep tomorrow easy.',
            created_at: '2025-06-20T08:00:05Z',
          },
        ],
      },
    })
  )
  await page.route('**/api/ai/chat', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'Mocked reply' }))
  await page.route('**/api/routes/suggest', (r) => r.fulfill({ json: { routes: [SUGGESTED_ROUTE] } }))
  await page.route('**/api/integrations/strava/**', (r) => r.fulfill({ json: { activities: [] } }))
}
