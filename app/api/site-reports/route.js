import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../lib/db';
import { currentUser } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function defaultName(d) {
  const dt = d ? new Date(d + 'T12:00:00') : new Date();
  return 'Site Visit — ' + dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// GET /api/site-reports?property=<id>&status=draft|saved&mine=1
export async function GET(req) {
  const me = currentUser();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const url = new URL(req.url);
  const pid = url.searchParams.get('property');
  const status = url.searchParams.get('status');
  const mine = url.searchParams.get('mine') === '1';
  try {
    await ensureSchema();
    const { rows } = await sql`
      SELECT r.*, p.name AS property_name, p.address AS property_address,
             (SELECT count(*) FROM site_report_items sri WHERE sri.report_id = r.id)::int AS item_count
        FROM site_reports r
        JOIN properties p ON p.id = r.property_id
       WHERE (${pid}::text IS NULL OR r.property_id = ${pid})
         AND (${status}::text IS NULL OR r.status = ${status})
         AND (${mine} = false OR r.walker_id = ${me.id})
       ORDER BY r.updated_at DESC`;
    return NextResponse.json({ reports: rows });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}

// POST /api/site-reports  { property_id, name?, walk_date? }
export async function POST(req) {
  const me = currentUser();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  let b = {};
  try { b = await req.json(); } catch {}
  const property_id = String(b.property_id || '');
  if (!property_id) return NextResponse.json({ error: 'property_id required' }, { status: 400 });
  const walk_date = b.walk_date ? String(b.walk_date).slice(0, 10) : null;
  const name = String(b.name || '').trim() || defaultName(walk_date);
  try {
    await ensureSchema();
    const { rows } = await sql`
      INSERT INTO site_reports (property_id, name, walk_date, walker_id, walker_name, status)
      VALUES (${property_id}, ${name},
              COALESCE(${walk_date}::date, CURRENT_DATE),
              ${me.id}, ${me.name}, 'draft')
      RETURNING *`;
    return NextResponse.json({ report: { ...rows[0], item_count: 0 } });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
