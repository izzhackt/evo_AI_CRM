import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function reachable(url: string, headers?: HeadersInit): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const wahaUrl = process.env.WAHA_BASE_URL?.replace(/\/$/, '')

  const [supabase, waha] = await Promise.all([
    supabaseUrl && supabaseKey
      ? reachable(`${supabaseUrl}/auth/v1/health`, { apikey: supabaseKey })
      : false,
    wahaUrl ? reachable(`${wahaUrl}/health`) : false,
  ])
  const ready = supabase && waha

  return NextResponse.json(
    {
      ok: ready,
      status: ready ? 'ready' : 'not_ready',
      service: 'evo-inbox-companion',
      checks: { supabase, waha },
    },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
