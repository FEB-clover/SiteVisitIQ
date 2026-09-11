import { NextResponse } from 'next/server';
import { userByPin, setSession } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  let pin = '';
  try { ({ pin } = await req.json()); } catch {}
  pin = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: 'Enter your passcode' }, { status: 400 });
  try {
    const user = await userByPin(pin);
    if (!user) return NextResponse.json({ error: 'Passcode not recognized' }, { status: 401 });
    setSession(user);
    return NextResponse.json({ user: { id: user.id, name: user.name, role: user.role } });
  } catch (e) {
    return NextResponse.json({ error: 'Backend not connected yet', detail: String(e.message || e) }, { status: 503 });
  }
}
