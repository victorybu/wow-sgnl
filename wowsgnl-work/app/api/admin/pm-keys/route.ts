import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/admin/pm-keys
//
// Reports presence (NOT value) of the env vars pm-ingest depends on.
// Lets us verify that a Vercel env-var add has actually propagated to
// the running deployment without leaking secret material.
export async function GET() {
  const keys = ['FEC_API_KEY', 'CONGRESS_API_KEY', 'SERPAPI_KEY', 'TWITTERAPI_KEY', 'ANTHROPIC_API_KEY'];
  const status: Record<string, { present: boolean; length: number }> = {};
  for (const k of keys) {
    const v = process.env[k] || '';
    const trimmed = v.trim();
    // Char codes of last 3 raw + last 3 trimmed for whitespace detection.
    const tail = (s: string) => Array.from(s.slice(-3)).map(c => c.charCodeAt(0));
    status[k] = {
      present: v.length > 0,
      length: v.length,
      trimmed_length: trimmed.length,
      raw_tail_codes: tail(v),
      trimmed_tail_codes: tail(trimmed),
    } as any;
  }
  return NextResponse.json({ ok: true, env: status });
}
