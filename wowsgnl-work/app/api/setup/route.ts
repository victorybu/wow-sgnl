import { initSchema } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    await initSchema();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
