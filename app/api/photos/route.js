import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import { sql, ensureSchema } from '../../../lib/db';
import { access, allowed } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req) {
  const me = await access();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    const itemId = Number(form.get('itemId'));
    if (!file || !itemId) return NextResponse.json({ error: 'file and itemId required' }, { status: 400 });
    await ensureSchema();
    const { rows: own } = await sql`SELECT property_id FROM items WHERE id = ${itemId} LIMIT 1`;
    if (!own[0] || !allowed(me, own[0].property_id)) {
      return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
    }
    const ext = (file.type && file.type.split('/')[1]) || 'jpg';
    const key = `photos/${itemId}/${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const blob = await put(key, file, { access: 'public', addRandomSuffix: true });
    await ensureSchema();
    await sql`INSERT INTO item_photos (item_id, url) VALUES (${itemId}, ${blob.url})`;
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: 'Photo storage not connected yet', detail: String(e.message || e) }, { status: 503 });
  }
}

// DELETE /api/photos?url=...   — remove one photo from an issue.
// Used when a marked-up version replaces the original, and to drop a bad shot.
// The blob is best-effort: if it is already gone, the row still goes.
export async function DELETE(req) {
  const me = await access();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const url = new URL(req.url).searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
  try {
    await ensureSchema();
    const { rows: own } = await sql`
      SELECT i.property_id FROM item_photos p JOIN items i ON i.id = p.item_id
       WHERE p.url = ${url} LIMIT 1`;
    if (own[0] && !allowed(me, own[0].property_id)) {
      return NextResponse.json({ error: 'no access to this property' }, { status: 403 });
    }
    const { rowCount } = await sql`DELETE FROM item_photos WHERE url = ${url}`;
    try { await del(url); } catch {}
    return NextResponse.json({ ok: true, removed: rowCount });
  } catch (e) {
    return NextResponse.json({ error: 'delete failed', detail: String(e.message || e) }, { status: 500 });
  }
}
