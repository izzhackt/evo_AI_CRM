import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  FIRST_LAUNCH_DISABLED_STATUS,
  firstLaunchDisabledPayload,
  resolveLocale,
  resolveFirstLaunchDisabledPath,
} from '@/lib/first-launch-disabled'
import { LOCALE_STORAGE_KEY, translate } from '@/lib/i18n'

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/readiness') {
    return NextResponse.next({ request: { headers: request.headers } })
  }

  const incomingId = request.headers.get('x-request-id')
  const requestId =
    incomingId && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(incomingId)
      ? incomingId
      : crypto.randomUUID()
  request.headers.set('x-request-id', requestId)
  console.info(JSON.stringify({
    event: 'http_request',
    request_id: requestId,
    method: request.method,
    path: request.nextUrl.pathname,
    service: 'evo-inbox',
  }))

  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId)
    return response
  }

  if (request.nextUrl.pathname === '/api/health') {
    return withRequestId(
      NextResponse.next({ request: { headers: request.headers } }),
    )
  }

  const disabled = resolveFirstLaunchDisabledPath(request.nextUrl.pathname)
  if (disabled) {
    const locale = resolveLocale(request.cookies.get(LOCALE_STORAGE_KEY)?.value)
    if (disabled.surface === 'api') {
      return withRequestId(NextResponse.json(firstLaunchDisabledPayload(disabled.feature, locale), {
        status: FIRST_LAUNCH_DISABLED_STATUS,
      }))
    }

    const payload = firstLaunchDisabledPayload(disabled.feature, locale)
    return withRequestId(new NextResponse(
      `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>EVO Inbox</title></head><body><main style="font-family:system-ui,sans-serif;max-width:720px;margin:64px auto;padding:0 24px;line-height:1.5"><p style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b">${translate(locale, 'firstLaunch.eyebrow')}</p><h1 style="font-size:28px;margin:0 0 12px">${translate(locale, 'firstLaunch.title')}</h1><p>${payload.message}</p><p><a href="/inbox">${translate(locale, 'firstLaunch.return')}</a></p></main></body></html>`,
      {
        status: FIRST_LAUNCH_DISABLED_STATUS,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      },
    ))
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    response.headers.set('x-request-id', requestId)
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/settings', '/agents']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return withRequestId(supabaseResponse)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
