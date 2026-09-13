import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../../../lib/db';
import { currentUser } from '../../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function touch(id) {
  await sql`UPDATE site_reports SET updated_at = now() WHERE id = ${id}`;
}

// POST /api/site-reports/<id>/items  { item_id }  — add an issue to the report
export async function POST(req, { params }) {
  const me = currentUser();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const reportId = Number(params.id);
  let b = {};
  try { b = await req.json(); } catch {}
  const itemId = Number(b.item_id);
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });
  try {
    await ensureSchema();
    const { rows: rr } = await sql`SELECT id, property_id, name FROM site_reports WHERE id = ${reportId}`;
    if (!rr.length) return NextResponse.json({ error: 'report not found' }, { status: 404 });
    const { rows: ir } = await sql`SELECT id, property_id FROM items WHERE id = ${itemId}`;
    if (!ir.length) return NextResponse.json({ error: 'item not found' }, { status: 404 });
    if (ir[0].property_id !== rr[0].property_id) {
      return NextResponse.json({ error: 'item belongs to a different property' }, { status: 400 });
    }
    const { rows: mx } = await sql`SELECT COALESCE(MAX(sort), 0) AS m FROM site_report_items WHERE report_id = ${reportId}`;
    await sql`INSERT INTO site_report_items (report_id, item_id, sort)
              VALUES (${reportId}, ${itemId}, ${Number(mx[0].m) + 1})
              ON CONFLICT (report_id, item_id) DO NOTHING`;
    await touch(reportId);
    const { rows: c } = await sql`SELECT count(*)::int AS n FROM site_report_items WHERE report_id = ${reportId}`;
    return NextResponse.json({ ok: true, item_count: c[0].n });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}

// DELETE /api/site-reports/<id>/items?item=<itemId>  — remove an issue
export async function DELETE(req, { params }) {
  if (!currentUser()) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const reportId = Number(params.id);
  const itemId = Number(new URL(req.url).searchParams.get('item') || 0);
  if (!itemId) return NextResponse.json({ error: 'item required' }, { status: 400 });
  try {
    await ensureSchema();
    await sql`DELETE FROM site_report_items WHERE report_id = ${reportId} AND item_id = ${itemId}`;
    await touch(reportId);
    const { rows: c } = await sql`SELECT count(*)::int AS n FROM site_report_items WHERE report_id = ${reportId}`;
    return NextResponse.json({ ok: true, item_count: c[0].n });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
