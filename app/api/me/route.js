import { NextResponse } from 'next/server';
import { access } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await access();
  if (!me) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({ user: me });
}
