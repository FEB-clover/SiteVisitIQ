import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../lib/db';
import { access, allowed } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIORITIES = ['High', 'Low', 'Monitor', 'Status', 'Medium'];

export async function GET(req) {
  const acc = await access();
  if (!acc) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const url = new URL(req.url);
  const pid = url.searchParams.get('property');
  if (pid && !allowed(acc, pid)) return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
  try {
    await ensureSchema();
    // an unscoped list is still limited to the properties this person holds
    const { rows } = pid
      ? await sql`SELECT * FROM items WHERE property_id = ${pid} ORDER BY
          (status='Complete'), CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, created_at DESC`
      : acc.properties === null
        ? await sql`SELECT * FROM items ORDER BY (status='Complete'),
            CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, created_at DESC`
        : await sql`SELECT * FROM items WHERE property_id = ANY(${acc.properties}) ORDER BY (status='Complete'),
            CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, created_at DESC`;
    const ids = rows.map((r) => r.id);
    let photos = [];
    if (ids.length) {
      const { rows: pr } = await sql`SELECT item_id, url FROM item_photos WHERE item_id = ANY(${ids}) ORDER BY id`;
      photos = pr;
    }
    const items = rows.map((r) => ({ ...r, photos: photos.filter((p) => p.item_id === r.id).map((p) => p.url) }));
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}

export async function POST(req) {
  const me = await access();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  let b = {};
  try { b = await req.json(); } catch {}
  const property_id = String(b.property_id || '');
  const title = String(b.title || '').trim();
  if (!property_id || !title) return NextResponse.json({ error: 'property and title required' }, { status: 400 });
  if (!allowed(me, property_id)) return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'Low';
  const notes = String(b.notes || '');
  const category = String(b.category || '');
  const source = String(b.source || '');
  const life_safety = !!b.life_safety;
  const send_todo = !!b.send_todo;
  const on_agenda = !!b.on_agenda;
  const map_x = b.map_x == null ? null : Number(b.map_x);
  const map_y = b.map_y == null ? null : Number(b.map_y);
  try {
    await ensureSchema();
    const { rows } = await sql`INSERT INTO items
      (property_id, title, notes, priority, category, source, life_safety, send_todo, on_agenda, map_x, map_y, walk_date, walker_id, walker_name)
      VALUES (${property_id}, ${title}, ${notes}, ${priority}, ${category}, ${source}, ${life_safety}, ${send_todo}, ${on_agenda},
              ${map_x}, ${map_y}, CURRENT_DATE, ${me.id}, ${me.name}) RETURNING *`;
    const item = rows[0];
    await sql`INSERT INTO activity (item_id, who, what) VALUES (${item.id}, ${me.name}, ${'created on walk'})`;
    return NextResponse.json({ item: { ...item, photos: [] } });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
