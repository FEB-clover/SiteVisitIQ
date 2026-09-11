import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../lib/db';
import { currentUser } from '../../../lib/auth';
import { buildReport } from '../../../lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TYPES = ['agenda', 'critical', 'sitemap', 'floorplans', 'prewalk', 'item'];

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
