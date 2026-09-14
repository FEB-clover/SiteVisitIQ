import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../lib/db';
import { access } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await access();
  if (!me?.isAdmin) return NextResponse.json({ error: 'admin' }, { status: 403 });
  try {
    await ensureSchema();
    const { rows } = await sql`
      SELECT id, name, role, pin, active, can_field, can_dash, all_properties FROM users ORDER BY id`;
    const { rows: grants } = await sql`SELECT user_id, property_id FROM user_properties`;
    const users = rows.map((u) => ({
      ...u, properties: grants.filter((g) => g.user_id === u.id).map((g) => g.property_id),
    }));
    const { rows: props } = await sql`SELECT id, name FROM properties ORDER BY sort`;
    return NextResponse.json({ users, properties: props, meId: me.id });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}

export async function POST(req) {
  const me = await access();
  if (!me?.isAdmin) return NextResponse.json({ error: 'admin' }, { status: 403 });
  let b = {};
  try { b = await req.json(); } catch {}
  try {
    await ensureSchema();
    if (b.id) {
      const uid = Number(b.id);
      // you cannot strip your own admin rights or switch yourself off — that is
      // the one change that could leave the account with no way back in
      if (uid === me.id && (b.role === 'walker' || b.active === false)) {
        return NextResponse.json({ error: 'You cannot remove your own admin access' }, { status: 400 });
      }
      const { rows } = await sql`UPDATE users SET
          name = COALESCE(${b.name ?? null}, name),
          pin = COALESCE(${b.pin ?? null}, pin),
          role = COALESCE(${b.role ?? null}, role),
          active = COALESCE(${b.active ?? null}, active),
          can_field = COALESCE(${b.can_field ?? null}, can_field),
          can_dash = COALESCE(${b.can_dash ?? null}, can_dash),
          all_properties = COALESCE(${b.all_properties ?? null}, all_properties)
        WHERE id = ${uid} RETURNING id, name, role, pin, active, can_field, can_dash, all_properties`;
      if (Array.isArray(b.properties)) {
        await sql`DELETE FROM user_properties WHERE user_id = ${uid}`;
        for (const pid of b.properties) {
          await sql`INSERT INTO user_properties (user_id, property_id) VALUES (${uid}, ${String(pid)})
                    ON CONFLICT DO NOTHING`;
        }
      }
      const { rows: g } = await sql`SELECT property_id FROM user_properties WHERE user_id = ${uid}`;
      return NextResponse.json({ user: { ...rows[0], properties: g.map((x) => x.property_id) } });
    }
    const name = String(b.name || '').trim();
    const pin = String(b.pin || '').trim();
    if (!name || !/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: 'name and 4–8 digit pin required' }, { status: 400 });
    const { rows } = await sql`INSERT INTO users (name, role, pin, can_field, can_dash, all_properties)
      VALUES (${name}, ${b.role || 'walker'}, ${pin},
              ${b.can_field !== false}, ${b.can_dash !== false}, ${b.all_properties === true})
      RETURNING id, name, role, pin, active, can_field, can_dash, all_properties`;
    const u = rows[0];
    if (Array.isArray(b.properties)) {
      for (const pid of b.properties) {
        await sql`INSERT INTO user_properties (user_id, property_id) VALUES (${u.id}, ${String(pid)})
                  ON CONFLICT DO NOTHING`;
      }
    }
    return NextResponse.json({ user: { ...u, properties: b.properties || [] } });
  } catch (e) {
    const msg = /duplicate/.test(String(e.message)) ? 'That passcode is already in use' : String(e.message || e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// Remove a person entirely. Their grants go with them (ON DELETE CASCADE).
// Issues and reports they logged keep their name, because those are records of
// who did the work and must not change.
export async function DELETE(req) {
  const me = await access();
  if (!me?.isAdmin) return NextResponse.json({ error: 'admin' }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get('id') || 0);
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (id === me.id) return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 400 });
  try {
    await ensureSchema();
    await sql`DELETE FROM users WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
