import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { sql, ensureSchema } from '../../../lib/db';
import { currentUser } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req) {
  const me = currentUser();
  if (!me) return NextResponse.json({ error: 'auth' }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    const itemId = Number(form.get('itemId'));
    if (!file || !itemId) return NextResponse.json({ error: 'file and itemId required' }, { status: 400 });
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
