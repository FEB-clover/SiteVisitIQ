import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { sql, ensureSchema } from '../../../../../lib/db';
import { currentUser } from '../../../../../lib/auth';
import { buildReport } from '../../../../../lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function fetchBytes(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// POST /api/site-reports/<id>/save — render the PDF, store it, stamp last-walked on issues
export async function POST(req, { params }) {
  const me = currentUser();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
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
      const bytes = (await Promise.all(urls.map(fetchBytes))).filter(Boolean);
      photoSets[it.id] = bytes;
    }

    const anyPinned = items.some((i) => i.map_x != null && i.map_y != null);
    const mapBytes = anyPinned ? await fetchBytes(report.site_map_url) : null;

    const property = { id: report.property_id, name: report.property_name, address: report.property_address };
    const pdf = await buildReport({
      type: 'sitevisit', property, items, photoSets, mapBytes,
      date: report.walk_date,
      report: { name: report.name, walker_name: report.walker_name, walk_date: report.walk_date },
    });

    const slug = String(report.property_name || 'property').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    const key = `site-reports/${report.property_id}/${id}-${slug}.pdf`;
    const blob = await put(key, Buffer.from(pdf), {
      access: 'public', addRandomSuffix: true, contentType: 'application/pdf',
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
