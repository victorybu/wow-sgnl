import { sql } from '@/lib/db';
import { CLIENT_COOKIE, getCurrentClient, listClients } from '@/lib/clients';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// GET /api/clients — returns full list + which one is currently active.
export async function GET() {
  const [clients, current] = await Promise.all([listClients(), getCurrentClient()]);
  return NextResponse.json({
    ts: new Date().toISOString(),
    clients,
    current_id: current?.id ?? null,
  });
}

// POST /api/clients — switch the active client. Body: { client_id: number }
// Sets cookie `signal_client_id` so all subsequent server-side reads scope by it.
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }

  const id = Number(body.client_id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'client_id required' }, { status: 400 });
  }

  // Validate the id exists before setting the cookie
  const r = await sql`SELECT id FROM clients WHERE id = ${id}`;
  if (r.rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'unknown client' }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true, client_id: id });
  res.cookies.set(CLIENT_COOKIE, String(id), {
    path: '/',
    httpOnly: false,           // client component might read for instant feedback
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  return res;
}
