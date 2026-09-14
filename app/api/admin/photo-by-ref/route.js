import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { sql, ensureSchema } from '../../../../lib/db';
import { access } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Attach a historical photo to the item identified by its stable ref (admin bulk import).
export async function POST(req) {
  const me = await access();
  if (!me || !me.isAdmin) return NextResponse.json({ error: 'admin' }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    const ref = String(form.get('ref') || '');
    if (!file || !ref) return NextResponse.json({ error: 'file and ref required' }, { status: 400 });
    await ensureSchema();
    const { rows } = await sql`SELECT id FROM items WHERE ref = ${ref} LIMIT 1`;
    if (!rows.length) return NextResponse.json({ error: 'no item for ref ' + ref }, { status: 404 });
    const itemId = rows[0].id;
    const blob = await put(`photos/${itemId}/hist_${Date.now()}.jpg`, file, { access: 'public', addRandomSuffix: true });
    // avoid piling duplicates if re-run: only add if this item has no photo yet
    const { rows: ph } = await sql`SELECT count(*)::int AS n FROM item_photos WHERE item_id = ${itemId}`;
    if (ph[0].n === 0) await sql`INSERT INTO item_photos (item_id, url) VALUES (${itemId}, ${blob.url})`;
    return NextResponse.json({ url: blob.url, itemId });
  } catch (e) {
    return NextResponse.json({ error: 'Storage error', detail: String((e && e.message) || e) }, { status: 503 });
  }
}
