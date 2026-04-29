import { anthropic } from '@/lib/anthropic';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function maskKey(k: string | undefined): string {
  if (!k) return '(unset)';
  if (k.length < 20) return `(short:${k.length})`;
  return `${k.slice(0, 14)}...${k.slice(-4)} (len=${k.length})`;
}

export async function GET() {
  const out: any = {
    ts: new Date().toISOString(),
    anthropic_api_key: maskKey(process.env.ANTHROPIC_API_KEY),
    twitterapi_key_set: !!process.env.TWITTERAPI_KEY,
  };

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
    });
    out.test_call = {
      ok: true,
      id: r.id,
      model: r.model,
      stop_reason: r.stop_reason,
      input_tokens: r.usage.input_tokens,
      output_tokens: r.usage.output_tokens,
      content_first: r.content[0]?.type === 'text' ? r.content[0].text : null,
    };
  } catch (e: any) {
    out.test_call = {
      ok: false,
      error: e.message,
      status: e.status,
      type: e.error?.type,
    };
  }

  return NextResponse.json(out);
}
