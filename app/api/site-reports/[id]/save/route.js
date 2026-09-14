import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fetchPhoto, fetchPlan, reportName } from '../../../../../lib/img';
import { sql, ensureSchema } from '../../../../../lib/db';
import { access, allowed } from '../../../../../lib/auth';
import { buildReport } from '../../../../../lib/report';


// resolve the property a report belongs to, for the access check
async function reportProperty(id) {
  const { rows } = await sql`SELECT property_id FROM site_reports WHERE id = ${Number(id)} LIMIT 1`;
  return rows[0]?.property_id || null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;


// POST /api/site-reports/<id>/save — render the PDF, store it, stamp last-walked on issues
export async function POST(req, { params }) {
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
    const report = rr[0];

    const { rows: items } = await sql`
      SELECT i.* FROM site_report_items sri JOIN items i ON i.id = sri.item_id
       WHERE sri.report_id = ${id} ORDER BY sri.sort, sri.added_at`;
    if (!items.length) return NextResponse.json({ error: 'Add at least one issue before saving' }, { status: 400 });

    // all photos for every included issue
    const ids = items.map((i) => i.id);
    const { rows: ph } = await sql`SELECT item_id, url FROM item_photos WHERE item_id = ANY(${ids}) ORDER BY id`;
    const photoSets = {};
    for (const it of items) {
      const urls = ph.filter((p) => p.item_id === it.id).map((p) => p.url);
      const bytes = (await Promise.all(urls.map((u) => fetchPhoto(u)))).filter(Boolean);
      photoSets[it.id] = bytes;
    }

    const anyPinned = items.some((i) => i.map_x != null && i.map_y != null);
    const mapBytes = anyPinned ? await fetchPlan(report.site_map_url) : null;

    const property = { id: report.property_id, name: report.property_name, address: report.property_address };
    const pdf = await buildReport({
      type: 'sitevisit', property, items, photoSets, mapBytes,
      date: report.walk_date,
      report: { name: report.name, walker_name: report.walker_name, walk_date: report.walk_date },
    });

    // The blob pathname IS the filename people see when the link is shared, so
    // it gets the readable name. Uniqueness comes from the report id in the
    // folder, which lets us drop the random suffix entirely — and means
    // re-saving the same report overwrites it instead of piling up copies.
    const nice = reportName({
      property: report.property_name, walker: report.walker_name, date: report.walk_date,
    });
    const key = `site-reports/${report.property_id}/${id}/${nice}.pdf`;
    const blob = await put(key, Buffer.from(pdf), {
      access: 'public', addRandomSuffix: false, contentType: 'application/pdf',
    });

    const { rows: saved } = await sql`
      UPDATE site_reports SET status = 'saved', pdf_url = ${blob.url}, updated_at = now()
       WHERE id = ${id} RETURNING *`;

    // stamp "last walked" — never roll backwards to an older walk
    await sql`
      UPDATE items SET last_walked_by = ${report.walker_name}, last_walked_date = ${report.walk_date}
       WHERE id = ANY(${ids})
         AND (last_walked_date IS NULL OR last_walked_date <= ${report.walk_date})`;

    for (const it of items) {
      await sql`INSERT INTO activity (item_id, who, what)
                VALUES (${it.id}, ${me.name}, ${`included in Site Visit report "${report.name}"`})`;
    }

    return NextResponse.json({ report: saved[0] });
  } catch (e) {
    return NextResponse.json({ error: 'save failed', detail: String((e && e.message) || e) }, { status: 500 });
  }
}
