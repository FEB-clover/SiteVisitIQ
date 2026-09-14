import { NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import { sql, ensureSchema } from '../../../../lib/db';
import { access } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Recover photos whose item_photos row is missing but whose file is still in
// Blob storage. Every photo is stored at `photos/<itemId>/<name>`, so the owning
// issue is recoverable from the path alone.
//
//   GET /api/admin/photo-rescan              -> report only, changes nothing
//   GET /api/admin/photo-rescan?apply=1      -> insert the missing rows
//   GET /api/admin/photo-rescan?property=wop -> limit to one property
//
// Insert-only: it never deletes a row or a file.
export async function GET(req) {
  const me = await access();
  if (!me || !me.isAdmin) return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const q = new URL(req.url).searchParams;
  const apply = q.get('apply') === '1';
  const propertyId = q.get('property') || null;

  try {
    await ensureSchema();

    // every photo blob, paged
    const blobs = [];
    let cursor;
    for (let page = 0; page < 40; page++) {
      const r = await list({ prefix: 'photos/', limit: 1000, cursor });
      blobs.push(...r.blobs);
      if (!r.hasMore) break;
      cursor = r.cursor;
    }

    // group by the item id in the path
    const byItem = new Map();
    for (const b of blobs) {
      const m = /^photos\/(\d+)\//.exec(b.pathname);
      if (!m) continue;
      const id = Number(m[1]);
      if (!byItem.has(id)) byItem.set(id, []);
      byItem.get(id).push(b.url);
    }

    const ids = [...byItem.keys()];
    if (!ids.length) {
      return NextResponse.json({ scanned: blobs.length, note: 'no photo blobs found' });
    }

    // which of those issues still exist, and what is already linked
    const { rows: liveItems } = propertyId
      ? await sql`SELECT id, property_id, title FROM items WHERE id = ANY(${ids}) AND property_id = ${propertyId}`
      : await sql`SELECT id, property_id, title FROM items WHERE id = ANY(${ids})`;
    const liveIds = new Set(liveItems.map((r) => r.id));

    const { rows: linked } = await sql`SELECT item_id, url FROM item_photos WHERE item_id = ANY(${ids})`;
    const have = new Set(linked.map((r) => r.item_id + '|' + r.url));

    const missing = [];
    for (const [id, urls] of byItem) {
      if (!liveIds.has(id)) continue;
      for (const url of urls) if (!have.has(id + '|' + url)) missing.push({ item_id: id, url });
    }

    let inserted = 0;
    if (apply) {
      for (const m of missing) {
        await sql`INSERT INTO item_photos (item_id, url) VALUES (${m.item_id}, ${m.url})`;
        inserted++;
      }
    }

    const byTitle = {};
    for (const m of missing) {
      const it = liveItems.find((r) => r.id === m.item_id);
      const k = it ? `${it.property_id} · ${it.title}` : String(m.item_id);
      byTitle[k] = (byTitle[k] || 0) + 1;
    }

    return NextResponse.json({
      mode: apply ? 'APPLIED' : 'report only — add ?apply=1 to restore',
      photo_files_in_storage: blobs.length,
      issues_with_files: byItem.size,
      issues_still_in_database: liveIds.size,
      orphan_files_for_deleted_issues: [...byItem.keys()].filter((i) => !liveIds.has(i)).length,
      already_linked: linked.length,
      missing_links_found: missing.length,
      restored: inserted,
      detail: byTitle,
    });
  } catch (e) {
    return NextResponse.json({ error: 'rescan failed', detail: String(e.message || e) }, { status: 500 });
  }
}
