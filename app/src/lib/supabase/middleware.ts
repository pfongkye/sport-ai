import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { SUPABASE_SERVER_URL, SUPABASE_ANON_KEY, SUPABASE_STORAGE_KEY } from './config'

/**
 * Refreshes the Supabase auth session in middleware.
 * Must be called in middleware.ts to keep session alive.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    SUPABASE_SERVER_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        storageKey: SUPABASE_STORAGE_KEY,
        flowType: 'pkce',
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — do not remove, important for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Behind a proxy/tunnel (ngrok), request.nextUrl may carry the internal host
  // (localhost:3000) instead of the public one. Build redirect URLs against the
  // forwarded host so we don't bounce users off the tunnel back to localhost.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone()
    url.pathname = path
    if (forwardedHost) {
      url.host = forwardedHost
      url.protocol = forwardedProto
      url.port = ''
    }
    return url
  }

  // Static / public assets — never gate these behind auth.
  const isPublicAsset =
    pathname === '/manifest.json' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.startsWith('/icons/') ||
    /\.(?:png|jpg|jpeg|gif|webp|svg|ico|json|txt|woff2?|ttf)$/.test(pathname)

  if (isPublicAsset) {
    return supabaseResponse
  }

  // Public routes that don't require auth.
  // /api/auth/* must be public so the OAuth callback can exchange the code
  // for a session BEFORE the user is authenticated.
  const publicRoutes = ['/login', '/api/auth', '/auth/callback']
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))

  // Redirect unauthenticated users to login
  if (!user && !isPublicRoute) {
    const url = redirectTo('/login')
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from login
  if (user && pathname === '/login') {
    return NextResponse.redirect(redirectTo('/dashboard'))
  }

  // Redirect root to dashboard or login
  if (pathname === '/') {
    return NextResponse.redirect(redirectTo(user ? '/dashboard' : '/login'))
  }

  return supabaseResponse
}
