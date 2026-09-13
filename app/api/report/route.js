import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../lib/db';
import { currentUser } from '../../../lib/auth';
import { buildReport } from '../../../lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TYPES = ['agenda', 'critical', 'sitemap', 'floorplans', 'prewalk', 'item', 'sitevisit'];

async function fetchBytes(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

export async function GET(req) {
  const me = currentUser();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const url = new URL(req.url);
  const type = String(url.searchParams.get('type') || '');
  const pid = String(url.searchParams.get('property') || '');
  const itemId = Number(url.searchParams.get('id') || 0);
  if (!TYPES.includes(type)) return NextResponse.json({ error: 'bad type' }, { status: 400 });

  try {
    await ensureSchema();

    // ----- site visit report (named report object) -----
    if (type === 'sitevisit') {
      const rid = Number(url.searchParams.get('report') || 0);
      if (!rid) return NextResponse.json({ error: 'report id required' }, { status: 400 });
      const { rows: rr } = await sql`
        SELECT r.*, p.name AS property_name, p.address AS property_address, p.site_map_url
          FROM site_reports r JOIN properties p ON p.id = r.property_id
         WHERE r.id = ${rid} LIMIT 1`;
      if (!rr.length) return NextResponse.json({ error: 'report not found' }, { status: 404 });
      const rep = rr[0];
      const { rows: ritems } = await sql`
        SELECT i.* FROM site_report_items sri JOIN items i ON i.id = sri.item_id
         WHERE sri.report_id = ${rid} ORDER BY sri.sort, sri.added_at`;
      const rids = ritems.map((i) => i.id);
      const photoSets = {};
      if (rids.length) {
        const { rows: ph } = await sql`SELECT item_id, url FROM item_photos WHERE item_id = ANY(${rids}) ORDER BY id`;
        for (const it of ritems) {
          const urls = ph.filter((x) => x.item_id === it.id).map((x) => x.url);
          photoSets[it.id] = (await Promise.all(urls.map(fetchBytes))).filter(Boolean);
        }
      }
      const anyPin = ritems.some((i) => i.map_x != null && i.map_y != null);
      const mapBytes = anyPin ? await fetchBytes(rep.site_map_url) : null;
      const pdf = await buildReport({
        type: 'sitevisit',
        property: { id: rep.property_id, name: rep.property_name, address: rep.property_address },
        items: ritems, photoSets, mapBytes, date: rep.walk_date,
        report: { name: rep.name, walker_name: rep.walker_name, walk_date: rep.walk_date, layout: 'ledger' },
      });
      return pdfResponse(pdf, rep.property_name, 'site-visit-' + rid);
    }

    // ----- single issue -----
    if (type === 'item') {
      if (!itemId) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { rows: ir } = await sql`SELECT * FROM items WHERE id = ${itemId} LIMIT 1`;
      if (!ir.length) return NextResponse.json({ error: 'item not found' }, { status: 404 });
      const item = ir[0];
      const { rows: pr } = await sql`SELECT id, name, address, site_map_url FROM properties WHERE id = ${item.property_id} LIMIT 1`;
      const property = pr[0] || { id: item.property_id, name: item.property_id };
      const { rows: ph } = await sql`SELECT url FROM item_photos WHERE item_id = ${itemId} ORDER BY id`;
      const photoBytes = ph.length ? [await fetchBytes(ph[0].url)].filter(Boolean) : [];
      const mapBytes = item.map_x != null ? await fetchBytes(property.site_map_url) : null;
      const pdf = await buildReport({ type, property, item, mapBytes, photoBytes, date: new Date() });
      return pdfResponse(pdf, property.name, 'issue-' + itemId);
    }

    if (!pid) return NextResponse.json({ error: 'property required' }, { status: 400 });
    const { rows: pr } = await sql`SELECT id, name, address, site_map_url FROM properties WHERE id = ${pid} LIMIT 1`;
    if (!pr.length) return NextResponse.json({ error: 'property not found' }, { status: 404 });
    const property = pr[0];
    const { rows: fr } = await sql`SELECT url FROM property_floors WHERE property_id = ${pid} ORDER BY idx`;
    const floors = fr.map((f) => f.url);

    let items = [];
    if (type === 'agenda' || type === 'critical' || type === 'prewalk') {
      const { rows } = await sql`SELECT * FROM items WHERE property_id = ${pid}`;
      items = rows;
    }

    const needMap = type === 'agenda' || type === 'critical' || type === 'sitemap';
    const mapBytes = needMap ? await fetchBytes(property.site_map_url) : null;
    const floorBytes = type === 'floorplans' ? (await Promise.all(floors.map(fetchBytes))).filter(Boolean) : [];

    const pdf = await buildReport({ type, property, floors, items, mapBytes, floorBytes, date: new Date() });
    return pdfResponse(pdf, property.name, type);
  } catch (e) {
    return NextResponse.json({ error: 'report failed', detail: String((e && e.message) || e) }, { status: 500 });
  }
}

function pdfResponse(pdf, propertyName, tag) {
  const slug = (propertyName || 'property').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const d = new Date().toISOString().slice(0, 10);
  const fname = `${slug}_${tag}_${d}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${fname}"`,
      'cache-control': 'no-store',
    },
  });
}
