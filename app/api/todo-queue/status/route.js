import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { sql, ensureSchema } from '../../../../lib/db';
import { codeFor, parseRefId } from '../../../../lib/property-codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Workbook -> app status read-back.  (DISPLAY ONLY)
 *
 * The hourly job reads the site team's own columns off each property's Site
 * Visit tab - Status, Target Date, Manager Notes & Follow-Up - and posts them
 * here, so someone standing at the property with the field app can see whether
 * an issue has already been handled.
 *
 * WHY THIS DOES NOT MAKE THE SYNC TWO-WAY
 * ---------------------------------------
 * Every field has exactly one owner:
 *
 *   owned by the WORKBOOK   Status, Target Date, Manager Notes
 *                           -> land in wb_status / wb_target_date /
 *                              wb_manager_notes, which this route is the ONLY
 *                              writer of, and which nothing ever writes back
 *                              to Excel.
 *
 *   owned by the APP        title, notes, detail, category, priority,
 *                           life_safety, status, send_todo, ...
 *                           -> this route must never touch them. The UPDATE
 *                              below names only wb_ columns for that reason.
 *
 * Because no field has two owners there is never a disagreement to resolve, so
 * there is no way for one side to silently overwrite the other. Writes stay
 * one-way in each direction; only visibility is two-way.
 *
 * A cleared cell in the workbook is meaningful and arrives as null, so the app
 * stops showing a note the manager deleted. That is why the job sends every row
 * it read rather than only the non-empty ones.
 *
 * Auth: Authorization: Bearer <SYNC_TOKEN>, the same credential the outbound
 * feed uses. If SYNC_TOKEN is unset this refuses everything rather than
 * falling open.
 */

const MAX_ITEMS = 2000;
const MAX_STATUS = 40;
const MAX_NOTES = 4000;

function clean(v, max) {
  if (v == null) return null;
  const s = String(v)
    .replace(/\r\n/g, '\n')
    .replace(/[\t\v\f\u0000-\u0008\u000e-\u001f]/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function ymd(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()) ? s : null;
}

function tokenOk(req) {
  const want = process.env.SYNC_TOKEN || '';
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  const given = m ? m[1].trim() : '';
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req) {
  if (!tokenOk(req)) return NextResponse.json({ error: 'auth' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const rows = Array.isArray(body?.items) ? body.items : null;
  if (!rows) return NextResponse.json({ error: 'expected {items:[...]}' }, { status: 400 });
  if (rows.length > MAX_ITEMS) {
    return NextResponse.json({ error: `too many items (${rows.length} > ${MAX_ITEMS})` }, { status: 400 });
  }

  try {
    await ensureSchema();

    // Look the items up first so a Ref ID can be checked against the property
    // it claims to belong to. Without that check, a Ref ID typed into the wrong
    // property's workbook would attach a manager's note to someone else's
    // issue - quietly, and in the field app.
    const ids = [];
    const parsed = new Map();
    for (const r of rows) {
      const p = parseRefId(r?.ref_id);
      if (!p) continue;
      parsed.set(p.id, { ...p, row: r });
      ids.push(p.id);
    }
    if (!ids.length) {
      return NextResponse.json({ updated: 0, unmatched: rows.length, mismatched: 0, skipped: [] });
    }

    const { rows: found } = await sql`SELECT id, property_id FROM items WHERE id = ANY(${ids})`;
    const owner = new Map(found.map((f) => [f.id, f.property_id]));

    const now = new Date().toISOString();
    let updated = 0;
    const unmatched = [];
    const mismatched = [];

    for (const [id, p] of parsed) {
      const propertyId = owner.get(id);
      if (!propertyId) { unmatched.push(p.row.ref_id); continue; }
      if (codeFor(propertyId) !== p.code) { mismatched.push(p.row.ref_id); continue; }

      const status = clean(p.row.status, MAX_STATUS);
      const target = ymd(p.row.target_date);
      const notes = clean(p.row.manager_notes, MAX_NOTES);

      // ONLY wb_ columns. Never title, notes, detail, category, priority,
      // status, send_todo or anything else the app owns.
      await sql`UPDATE items
                   SET wb_status        = ${status},
                       wb_target_date   = ${target},
                       wb_manager_notes = ${notes},
                       wb_synced_at     = ${now}
                 WHERE id = ${id}`;
      updated += 1;
    }

    return NextResponse.json({
      ok: true,
      updated,
      // surfaced rather than swallowed: an unmatched Ref ID usually means
      // someone retyped or deleted it in the workbook, and a mismatched one
      // means a row is sitting in the wrong property's file.
      unmatched: unmatched.length,
      unmatched_refs: unmatched.slice(0, 20),
      mismatched: mismatched.length,
      mismatched_refs: mismatched.slice(0, 20),
      synced_at: now,
    });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
