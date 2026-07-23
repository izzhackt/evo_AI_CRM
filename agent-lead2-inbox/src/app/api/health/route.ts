import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json(
    { ok: true, status: 'live', service: 'evo-inbox-companion' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
