import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { sql, ensureSchema } from '../../../../lib/db';
import { access } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Admin uploads a site map or a floorplan sheet into Blob and wires it to the property.
export async function POST(req) {
  const me = await access();
  if (!me || !me.isAdmin) return NextResponse.json({ error: 'admin' }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    const kind = String(form.get('kind') || '');          // 'sitemap' | 'floor'
    const property_id = String(form.get('property_id') || '');
    const idx = Number(form.get('idx') || 0);
    if (!file || !property_id || !kind) return NextResponse.json({ error: 'file, property_id, kind required' }, { status: 400 });
    await ensureSchema();
    const key = `plans/${property_id}/${kind}_${idx}.jpg`;
    const blob = await put(key, file, { access: 'public', addRandomSuffix: true });
    if (kind === 'sitemap') {
      await sql`UPDATE properties SET site_map_url = ${blob.url} WHERE id = ${property_id}`;
    } else {
      if (idx === 0) await sql`DELETE FROM property_floors WHERE property_id = ${property_id}`;
      await sql`INSERT INTO property_floors (property_id, url, idx) VALUES (${property_id}, ${blob.url}, ${idx})`;
    }
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return NextResponse.json({ error: 'Storage not connected', detail: String(e.message || e) }, { status: 503 });
  }
}
