import { describe, it, expect, afterEach } from 'vitest'
import { resolvePublicOrigin } from './public-origin'

const h = (o: Record<string, string>) => new Headers(o)
const URL_ = 'http://localhost/dashboard'

describe('resolvePublicOrigin', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('uses Host (with port) when no forwarded headers', () => {
    expect(resolvePublicOrigin(h({ host: 'localhost:3000' }), URL_)).toBe('http://localhost:3000')
  })
  it('prefers Host over NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://x.ngrok-free.app'
    expect(resolvePublicOrigin(h({ host: 'localhost:3000' }), URL_)).toBe('http://localhost:3000')
  })
  it('keeps a port already in x-forwarded-host', () => {
    expect(resolvePublicOrigin(h({ 'x-forwarded-host': 'localhost:3000' }), URL_)).toBe('http://localhost:3000')
  })
  it('handles forwarded host without port', () => {
    expect(
      resolvePublicOrigin(h({ 'x-forwarded-host': 'app.example.com', 'x-forwarded-proto': 'https' }), URL_),
    ).toBe('https://app.example.com')
  })
  it('honours x-forwarded-proto http', () => {
    expect(
      resolvePublicOrigin(h({ 'x-forwarded-host': 'lan.local:8080', 'x-forwarded-proto': 'http' }), URL_),
    ).toBe('http://lan.local:8080')
  })
  it('ngrok host', () => {
    expect(
      resolvePublicOrigin(
        h({ host: 'localhost:3000', 'x-forwarded-host': 'd508.ngrok-free.app', 'x-forwarded-proto': 'https' }),
        URL_,
      ),
    ).toBe('https://d508.ngrok-free.app')
  })
  it('Cloud Run host', () => {
    expect(
      resolvePublicOrigin(
        h({ host: 'sportai-abc.a.run.app', 'x-forwarded-host': 'sportai-abc.a.run.app', 'x-forwarded-proto': 'https' }),
        URL_,
      ),
    ).toBe('https://sportai-abc.a.run.app')
  })
  it('takes the first value of a comma list', () => {
    expect(
      resolvePublicOrigin(h({ 'x-forwarded-host': 'a.com, b.com', 'x-forwarded-proto': 'https, http' }), URL_),
    ).toBe('https://a.com')
  })
  it('falls back to NEXT_PUBLIC_APP_URL then request URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://pub.example.com'
    expect(resolvePublicOrigin(h({}), URL_)).toBe('https://pub.example.com')
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(resolvePublicOrigin(h({}), 'http://localhost:3000/x')).toBe('http://localhost:3000')
  })
})
