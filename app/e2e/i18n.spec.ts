import { test, expect, type Page } from '@playwright/test'
import { signIn } from './support/auth'
import { mockBrowserApis } from './support/mock-api'
import { expectNoHorizontalOverflow } from './support/layout'

// The stub Supabase remembers user_settings.language per access token. Tests run in parallel
// (across projects and within one), so every test gets its own token and never shares state.
// The `e2e-plan-` prefix makes the stub serve the plan fixtures (plan, sessions, linked activities).
const tokenFor = (project: string, title: string) => `e2e-plan-lang-${project}-${title.replace(/\W+/g, '-')}`

test.beforeEach(async ({ context, page, baseURL }, testInfo) => {
  await signIn(context, baseURL!, tokenFor(testInfo.project.name, testInfo.title))
  await mockBrowserApis(page)
})

async function chooseLanguage(page: Page, label: 'Language' | 'Langue', value: 'en' | 'fr') {
  // Wait for hydration: a select changed before React attaches its handler just snaps back.
  await page.waitForLoadState('networkidle')
  await page.getByLabel(label, { exact: true }).selectOption(value)
}

test('English by default, French after choosing it in Settings, persisted across reloads', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await chooseLanguage(page, 'Language', 'fr')
  await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page.getByLabel('Langue', { exact: true })).toHaveValue('fr')

  // Persisted (stored setting + cookie): a fresh navigation is still French.
  await page.goto('/coach')
  await expect(page.getByRole('heading', { name: 'Coach IA', level: 1 })).toBeVisible()
  await expect(page.getByPlaceholder('Posez une question à votre coach, ou touchez le micro…')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Coach IA', level: 1 })).toBeVisible()

  // Back to English, so the next run of this spec starts from the default.
  await page.goto('/settings')
  await chooseLanguage(page, 'Langue', 'en')
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
})

test('first visit follows Accept-Language on the login page', async ({ browser, baseURL }, testInfo) => {
  const fr = await browser.newContext({ ...testInfo.project.use, baseURL, locale: 'fr-FR' })
  const frPage = await fr.newPage()
  await frPage.goto('/login')
  await expect(frPage.getByRole('button', { name: 'Se connecter avec Google' })).toBeVisible()
  await expect(frPage.locator('html')).toHaveAttribute('lang', 'fr')
  await fr.close()

  const de = await browser.newContext({ ...testInfo.project.use, baseURL, locale: 'de-DE' })
  const dePage = await de.newPage()
  await dePage.goto('/login')
  await expect(dePage.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await expect(dePage.locator('html')).toHaveAttribute('lang', 'en')
  await de.close()
})

test('voice (Whisper): sends the saved language only as a hint and shows editable text', async ({ page }) => {
  let sent: { language: string | null; audio: boolean } | null = null
  await page.route('**/api/ai/voice/transcribe', async (route) => {
    const body = route.request().postDataBuffer()?.toString('latin1') ?? ''
    sent = { language: /name="language"\r\n\r\n(\w+)/.exec(body)?.[1] ?? null, audio: body.includes('name="audio"') }
    await route.fulfill({ json: { text: 'Je suis allé courir ce matin', language: 'fr' } })
  })
  // Headless Chromium has no microphone: fake the recorder inputs.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => new MediaStream()
    class FakeRecorder {
      state = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((e: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      static isTypeSupported() {
        return true
      }
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)], { type: 'audio/webm' }) })
        this.onstop?.()
      }
    }
    ;(window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder
  })
  await page.goto('/coach')
  await page.getByRole('button', { name: 'Record voice' }).click()
  await page.getByRole('button', { name: 'Stop recording' }).click()
  const box = page.getByPlaceholder('Ask your coach, or tap the mic…')
  await expect(box).toHaveValue('Je suis allé courir ce matin')
  expect(sent).toEqual({ language: 'en', audio: true })
  // The transcript stays editable before sending.
  await box.fill('Je suis allé courir hier')
  await expect(box).toHaveValue('Je suis allé courir hier')
})

// Headless Chromium cannot run the real Web Speech API (no speech service, no microphone),
// so a fake SpeechRecognition checks our wiring only: the language passed in and the text handoff.
test('voice (Web Speech, opt-in): uses the saved language and hands editable text to the composer', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = ''
      continuous = false
      interimResults = false
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      start() {
        ;(window as unknown as { __srLang: string }).__srLang = this.lang
        setTimeout(() => {
          const result = Object.assign([{ transcript: 'Bonjour coach' }], { isFinal: true })
          this.onresult?.({ resultIndex: 0, results: [result] })
        }, 20)
      }
      stop() {
        setTimeout(() => this.onend?.(), 10)
      }
      abort() {}
    }
    // Replace both names: the headless browser may ship a real (non-working) one under either.
    const w = window as unknown as Record<string, unknown>
    w.SpeechRecognition = FakeRecognition
    w.webkitSpeechRecognition = FakeRecognition
    localStorage.setItem('voice:engine', 'browser')
  })
  let transcribeCalls = 0
  await page.route('**/api/ai/voice/transcribe', (r) => {
    transcribeCalls++
    return r.fulfill({ json: { text: 'unused' } })
  })

  await page.goto('/settings')
  await chooseLanguage(page, 'Language', 'fr')
  await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible()
  await page.goto('/coach')
  await page.getByRole('button', { name: 'Enregistrer la voix' }).click()
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: "Arrêter l'enregistrement" }).click()
  const box = page.getByPlaceholder('Posez une question à votre coach, ou touchez le micro…')
  await expect(box).toHaveValue('Bonjour coach')
  expect(await page.evaluate(() => (window as unknown as { __srLang: string }).__srLang)).toBe('fr-FR')
  expect(transcribeCalls).toBe(0)

  await page.goto('/settings')
  await chooseLanguage(page, 'Langue', 'en')
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
})

// French assertions for the screens translated in the follow-up pass: dashboard, plan and activities.
const ACTIVITY_ID = '00000000-0000-4000-8000-000000000101'

test('French: dashboard, plan and activities show translated text, French dates and decimal commas', async ({ page }) => {
  await page.goto('/settings')
  await chooseLanguage(page, 'Language', 'fr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')

  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Salut Alex 👋' })).toBeVisible()
  await expect(page.getByText('Objectif : Run a sub-4h marathon')).toBeVisible()
  await expect(page.getByText('Cette semaine', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Activités récentes' })).toBeVisible()
  await expect(page.getByText('Demandez à votre coach IA')).toBeVisible()
  // Distances use the decimal comma, never the English point.
  await expect(page.getByText(/\d+,\d{2} km/).first()).toBeVisible()
  await expect(page.getByText(/\d+\.\d{2} km/)).toHaveCount(0)

  await page.goto('/plan')
  await expect(page.getByRole('heading', { name: "Plan d'entraînement", level: 1 })).toBeVisible()
  await expect(page.getByText(/Semaine \d+ sur \d+/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Régénérer le plan' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Calendrier du plan' })).toBeVisible()
  // Session cards: translated type and status, French weekday in the day label.
  await expect(page.getByRole('article', { name: /Tempo, .*(lun|mar|mer|jeu|ven|sam|dim)\.?.*, Prévue/ })).toBeVisible()
  await expect(page.getByText('Sortie longue').first()).toBeVisible()
  await expect(page.getByText('Faite', { exact: true })).toBeVisible()
  await expect(page.getByText('Terminée', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/\d+,\d{2} km/).first()).toBeVisible()
  await expect(page.getByText('Zone 2').first()).toBeVisible()
  await expect(page.getByText(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)).toHaveCount(0)

  // Regenerate form.
  await page.getByRole('button', { name: 'Régénérer le plan' }).click()
  await expect(page.getByLabel('Objectif', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Distance de la course')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'mardi' })).toBeChecked()
  await expect(page.getByLabel('Autres contraintes (facultatif)')).toHaveValue('1 leisure session per week')
  await expect(page.getByRole('button', { name: 'Générer le plan' }).or(page.getByRole('button', { name: 'Régénérer le plan' }).last())).toBeVisible()

  await page.goto('/activities')
  await expect(page.getByRole('heading', { name: 'Activités', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Importer', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toutes' })).toBeVisible()
  await expect(page.getByText('Vélo').first()).toBeVisible()
  await expect(page.getByText(/Charge \d+/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Importer', exact: true }).click()
  await expect(page.getByText('Déposez vos fichiers .FIT, .GPX ou .TCX ici')).toBeVisible()

  await page.goto(`/activities/${ACTIVITY_ID}`)
  await expect(page.getByText('Allure moy.')).toBeVisible()
  await expect(page.getByText('Durée', { exact: true })).toBeVisible()
  await expect(page.getByText('Analyse du coach')).toBeVisible()
  await expect(page.getByText('Notes de séance')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Supprimer' })).toBeVisible()
  // Long date in French (this activity is dated on Monday of the current week in the plan fixtures).
  await expect(page.getByText(/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d{1,2} \S+ \d{4}$/)).toBeVisible()

  await page.goto('/settings')
  await chooseLanguage(page, 'Langue', 'en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

// Screenshots in both languages for the screens that are translated or share the shell.
// They land in e2e-screenshots/<project>/i18n-<lang>-<page>.png (gitignored); the overflow
// check is the automated part, the images are reviewed by eye.
const SCREENS = [
  ['dashboard', '/dashboard'],
  ['coach', '/coach'],
  ['plan', '/plan'],
  ['settings', '/settings'],
  ['activities', '/activities'],
  ['activity-detail', `/activities/${ACTIVITY_ID}`],
] as const

for (const lang of ['en', 'fr'] as const) {
  test(`screenshots and no horizontal overflow (${lang})`, async ({ page }, testInfo) => {
    await page.goto('/settings')
    await chooseLanguage(page, 'Language', lang)
    await expect(page.locator('html')).toHaveAttribute('lang', lang)
    const style = 'nextjs-portal { display: none !important }'
    const dir = `e2e-screenshots/${testInfo.project.name}`
    for (const [name, path] of SCREENS) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `${dir}/i18n-${lang}-${name}.png`, style })
    }
    // The longest French strings live in the generate form and the activity upload panel.
    await page.goto('/plan')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: lang === 'fr' ? 'Régénérer le plan' : 'Regenerate plan' }).click()
    await page.getByLabel(lang === 'fr' ? 'Distance de la course' : 'Race distance').selectOption('other')
    await page.getByRole('button', { name: lang === 'fr' ? 'Ajuster les limites' : 'Adjust limits' }).click()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${dir}/i18n-${lang}-plan-form.png`, style, fullPage: true })

    await page.goto('/activities')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: lang === 'fr' ? 'Importer' : 'Upload', exact: true }).click()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${dir}/i18n-${lang}-activities-upload.png`, style })
    if (lang === 'fr') {
      await page.goto('/coach')
      await page.getByRole('button', { name: 'Discussions' }).click()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `${dir}/i18n-fr-coach-sessions.png`, style })
      await page.goto('/settings')
      await chooseLanguage(page, 'Langue', 'en')
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    }
  })
}

test('login screenshots in both languages', async ({ browser, baseURL }, testInfo) => {
  for (const [locale, lang] of [['en-US', 'en'], ['fr-FR', 'fr']] as const) {
    const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, locale })
    const page = await ctx.newPage()
    await page.goto('/login')
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}/i18n-${lang}-login.png` })
    await ctx.close()
  }
})
