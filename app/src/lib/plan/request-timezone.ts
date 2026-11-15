import { cookies } from 'next/headers'
import { TZ_COOKIE } from './timezone'

/** The raw `tz` cookie of the current request (unvalidated; resolve it with `resolveAthleteTimeZone`). */
export async function readTzCookie(): Promise<string | null> {
  return (await cookies()).get(TZ_COOKIE)?.value ?? null
}
