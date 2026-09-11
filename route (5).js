import { NextResponse } from 'next/server';
import { currentUser } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const me = currentUser();
  if (!me) return NextResponse.json({ user: null }, { status: 200 });
  return NextResponse.json({ user: me });
}
