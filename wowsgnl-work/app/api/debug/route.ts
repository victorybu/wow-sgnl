import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function maskHost(url: string | undefined): string {
  if (!url) return '(unset)';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

export async function GET() {
  const envSeen = {
    POSTGRES_URL: maskHost(process.env.POSTGRES_URL),
    POSTGRES_URL_NON_POOLING: maskHost(process.env.POSTGRES_URL_NON_POOLING),
    POSTGRES_PRISMA_URL: maskHost(process.env.POSTGRES_PRISMA_URL),
    DATABASE_URL: maskHost(process.env.DATABASE_URL),
    DATABASE_URL_UNPOOLED: maskHost(process.env.DATABASE_URL_UNPOOLED),
  };

  const probes: any = {};

  try {
    const c = await sql`SELECT COUNT(*)::int AS n FROM clients`;
    probes.clients_count = { rowCount: c.rowCount, rows: c.rows };
  } catch (e: any) { probes.clients_count = { error: e.message }; }

  try {
    const w = await sql`SELECT COUNT(*)::int AS n FROM watchlist`;
    probes.watchlist_count = { rowCount: w.rowCount, rows: w.rows };
  } catch (e: any) { probes.watchlist_count = { error: e.message }; }

  try {
    const wj = await sql`
      SELECT w.id, w.client_id, w.kind, w.value, w.active, c.name as client_name
      FROM watchlist w JOIN clients c ON c.id = w.client_id
      WHERE w.active = TRUE
    `;
    probes.watchlist_join_active = { rowCount: wj.rowCount, length: wj.rows.length, sample: wj.rows.slice(0, 3) };
  } catch (e: any) { probes.watchlist_join_active = { error: e.message }; }

  try {
    const meta = await sql`SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS server_addr`;
    probes.server = meta.rows[0];
  } catch (e: any) { probes.server = { error: e.message }; }

  return NextResponse.json({ envSeen, probes });
}
