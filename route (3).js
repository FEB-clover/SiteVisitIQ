import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../lib/db';
import { currentUser } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const me = currentUser();
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'admin' }, { status: 403 });
  try {
    await ensureSchema();
    const { rows } = await sql`SELECT id, name, role, pin, active FROM users ORDER BY id`;
    return NextResponse.json({ users: rows });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}

export async function POST(req) {
  const me = currentUser();
  if (!me || me.role !== 'admin') return NextResponse.json({ error: 'admin' }, { status: 403 });
  let b = {};
  try { b = await req.json(); } catch {}
  try {
    await ensureSchema();
    if (b.id) {
      // update existing: name/pin/active/role
      const { rows } = await sql`UPDATE users SET
          name = COALESCE(${b.name ?? null}, name),
          pin = COALESCE(${b.pin ?? null}, pin),
          role = COALESCE(${b.role ?? null}, role),
          active = COALESCE(${b.active ?? null}, active)
        WHERE id = ${Number(b.id)} RETURNING id, name, role, pin, active`;
      return NextResponse.json({ user: rows[0] });
    }
    const name = String(b.name || '').trim();
    const pin = String(b.pin || '').trim();
    if (!name || !/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: 'name and 4–8 digit pin required' }, { status: 400 });
    const { rows } = await sql`INSERT INTO users (name, role, pin) VALUES (${name}, ${b.role || 'walker'}, ${pin})
      RETURNING id, name, role, pin, active`;
    return NextResponse.json({ user: rows[0] });
  } catch (e) {
    const msg = /duplicate/.test(String(e.message)) ? 'That passcode is already in use' : String(e.message || e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
