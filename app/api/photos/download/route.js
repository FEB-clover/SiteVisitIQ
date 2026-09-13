import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../../lib/db';
import { currentUser } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---- minimal store-only ZIP writer (photos are already JPEG-compressed, so
// deflate buys nothing and this keeps the app dependency-free) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
}
function buildZip(files) {
  const now = new Date(), time = dosTime(now), date = dosDate(now);
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data), size = f.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(size, 18); lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, name, f.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10); cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(size, 20); cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += lh.length + name.length + size;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

const safe = (s, max = 60) =>
  String(s || '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, max) || 'untitled';

async function fetchBytes(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// POST /api/photos/download  { item_ids:[...] }  or  { urls:[...] }
export async function POST(req) {
  if (!currentUser()) return NextResponse.json({ error: 'auth' }, { status: 401 });
  let b = {};
  try { b = await req.json(); } catch {}
  const itemIds = Array.isArray(b.item_ids) ? b.item_ids.map(Number).filter(Boolean) : [];
  const urls = Array.isArray(b.urls) ? b.urls.filter(Boolean) : [];
  if (!itemIds.length && !urls.length) {
    return NextResponse.json({ error: 'item_ids or urls required' }, { status: 400 });
  }

  try {
    await ensureSchema();
    const files = [];
    let propLabel = 'photos';

    if (itemIds.length) {
      const { rows } = await sql`
        SELECT i.id, i.title, p.name AS property_name, ph.url
          FROM items i
          JOIN properties p ON p.id = i.property_id
          JOIN item_photos ph ON ph.item_id = i.id
         WHERE i.id = ANY(${itemIds})
         ORDER BY i.id, ph.id`;
      if (!rows.length) return NextResponse.json({ error: 'no photos found' }, { status: 404 });
      propLabel = safe(rows[0].property_name, 40);
      const perItem = {};
      for (const r of rows) {
        perItem[r.id] = (perItem[r.id] || 0) + 1;
        const data = await fetchBytes(r.url);
        if (!data) continue;
        const ext = (r.url.split('.').pop() || 'jpg').split('?')[0].slice(0, 4);
        files.push({
          name: `${safe(r.property_name, 40)}/${safe(r.title)}-${perItem[r.id]}.${ext}`,
          data,
        });
      }
    } else {
      for (let i = 0; i < urls.length; i++) {
        const data = await fetchBytes(urls[i]);
        if (!data) continue;
        const ext = (urls[i].split('.').pop() || 'jpg').split('?')[0].slice(0, 4);
        files.push({ name: `photos/photo-${i + 1}.${ext}`, data });
      }
    }

    if (!files.length) return NextResponse.json({ error: 'could not retrieve any photos' }, { status: 502 });

    const zip = buildZip(files);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(zip, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${propLabel}_photos_${stamp}.zip"`,
        'content-length': String(zip.length),
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: 'zip failed', detail: String(e.message || e) }, { status: 500 });
  }
}
