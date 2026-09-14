import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../../lib/db';
import { access, allowed } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIORITIES = ['High', 'Low', 'Monitor', 'Status', 'Medium'];
const STATUSES = ['Open', 'In progress', 'Complete'];

export async function PATCH(req, { params }) {
  const me = await access();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  {
    const { rows: own } = await sql`SELECT property_id FROM items WHERE id = ${Number(params.id)} LIMIT 1`;
    if (own[0] && !allowed(me, own[0].property_id)) {
      return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
    }
  }
  const id = Number(params.id);
  let b = {};
  try { b = await req.json(); } catch {}
  try {
    await ensureSchema();
    const { rows: cur } = await sql`SELECT * FROM items WHERE id = ${id}`;
    if (!cur.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const it = cur[0];
    const priority = PRIORITIES.includes(b.priority) ? b.priority : it.priority;
    const status = STATUSES.includes(b.status) ? b.status : it.status;
    const title = b.title != null ? String(b.title) : it.title;
    const notes = b.notes != null ? String(b.notes) : it.notes;
    const detail = b.detail != null ? String(b.detail) : it.detail;
    const office_note = b.office_note != null ? String(b.office_note) : it.office_note;
    const life_safety = b.life_safety != null ? !!b.life_safety : it.life_safety;
    const send_todo = b.send_todo != null ? !!b.send_todo : it.send_todo;
    const discussed = b.discussed != null ? !!b.discussed : it.discussed;
    const on_agenda = b.on_agenda != null ? !!b.on_agenda : it.on_agenda;
    const archived = b.archived != null ? !!b.archived : it.archived;
    const category = b.category != null ? String(b.category) : it.category;
    const map_x = b.map_x !== undefined ? (b.map_x == null ? null : Number(b.map_x)) : it.map_x;
    const map_y = b.map_y !== undefined ? (b.map_y == null ? null : Number(b.map_y)) : it.map_y;
    const { rows } = await sql`UPDATE items SET
        title=${title}, notes=${notes}, detail=${detail}, office_note=${office_note}, category=${category},
        priority=${priority}, status=${status}, life_safety=${life_safety}, send_todo=${send_todo},
        discussed=${discussed}, on_agenda=${on_agenda}, archived=${archived},
        map_x=${map_x}, map_y=${map_y}, updated_at=now()
      WHERE id=${id} RETURNING *`;
    // log meaningful changes
    const changes = [];
    if (status !== it.status) changes.push(`status → ${status}`);
    if (priority !== it.priority) changes.push(`priority → ${priority}`);
    if (archived !== it.archived) changes.push(archived ? 'archived' : 'unarchived');
    if (send_todo !== it.send_todo) changes.push(send_todo ? 'sent to manager to-do' : 'removed from to-do');
    if (changes.length) await sql`INSERT INTO activity (item_id, who, what) VALUES (${id}, ${me.name}, ${changes.join(', ')})`;
    const { rows: ph } = await sql`SELECT url FROM item_photos WHERE item_id=${id} ORDER BY id`;
    return NextResponse.json({ item: { ...rows[0], photos: ph.map((p) => p.url) } });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}

export async function DELETE(req, { params }) {
  const me = await access();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  try {
    await ensureSchema();
    const { rows: own } = await sql`SELECT property_id FROM items WHERE id = ${Number(params.id)} LIMIT 1`;
    if (own[0] && !allowed(me, own[0].property_id)) {
      return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
    }
    await sql`DELETE FROM items WHERE id = ${Number(params.id)}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
