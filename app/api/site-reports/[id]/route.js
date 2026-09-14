import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../../lib/db';
import { access, allowed } from '../../../../lib/auth';


// resolve the property a report belongs to, for the access check
async function reportProperty(id) {
  const { rows } = await sql`SELECT property_id FROM site_reports WHERE id = ${Number(id)} LIMIT 1`;
  return rows[0]?.property_id || null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/site-reports/<id> — report record + attached issues (with photos)
export async function GET(req, { params }) {
  const me = await access();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  {
    await ensureSchema();
    const pid = await reportProperty(params.id);
    if (pid && !allowed(me, pid)) return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
  }
  const id = Number(params.id);
  try {
    await ensureSchema();
    const { rows: rr } = await sql`
      SELECT r.*, p.name AS property_name, p.address AS property_address, p.site_map_url
        FROM site_reports r JOIN properties p ON p.id = r.property_id
       WHERE r.id = ${id} LIMIT 1`;
    if (!rr.length) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const { rows: items } = await sql`
      SELECT i.*, sri.sort FROM site_report_items sri
        JOIN items i ON i.id = sri.item_id
       WHERE sri.report_id = ${id}
       ORDER BY sri.sort, sri.added_at`;
    const ids = items.map((i) => i.id);
    let photos = [];
    if (ids.length) {
      const { rows: pr } = await sql`SELECT item_id, url FROM item_photos WHERE item_id = ANY(${ids}) ORDER BY id`;
      photos = pr;
    }
    return NextResponse.json({
      report: rr[0],
      items: items.map((i) => ({ ...i, photos: photos.filter((p) => p.item_id === i.id).map((p) => p.url) })),
    });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}

// PATCH /api/site-reports/<id>  { name?, walk_date? }
// Walker is intentionally NOT editable — a report always credits whoever is signed in.
export async function PATCH(req, { params }) {
  const me = await access();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  {
    await ensureSchema();
    const pid = await reportProperty(params.id);
    if (pid && !allowed(me, pid)) return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
  }
  const id = Number(params.id);
  let b = {};
  try { b = await req.json(); } catch {}
  try {
    await ensureSchema();
    const { rows: cur } = await sql`SELECT * FROM site_reports WHERE id = ${id}`;
    if (!cur.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const name = b.name != null ? String(b.name).trim() : cur[0].name;
    const walk_date = b.walk_date != null ? String(b.walk_date).slice(0, 10) : null;
    const { rows } = await sql`
      UPDATE site_reports
         SET name = ${name || cur[0].name},
             walk_date = COALESCE(${walk_date}::date, walk_date),
             updated_at = now()
       WHERE id = ${id} RETURNING *`;
    return NextResponse.json({ report: rows[0] });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}

export async function DELETE(req, { params }) {
  const me = await access();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  {
    await ensureSchema();
    const pid = await reportProperty(params.id);
    if (pid && !allowed(me, pid)) return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
  }
  try {
    await ensureSchema();
    await sql`DELETE FROM site_reports WHERE id = ${Number(params.id)}`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
