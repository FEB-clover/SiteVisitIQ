import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { sql, ensureSchema } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only export of the items a walker flagged "Send to to-do".  (v2 payload)
 *
 * The nightly writer pulls this and appends rows to each property's Site Visit
 * tab in the manager's Visit Notes & To-Do workbook. It is a separate endpoint
 * from /api/items on purpose: it is reachable with a sync token instead of a
 * person's session, so the job never has to hold someone's login.
 *
 * WHAT CHANGED IN v2
 * ------------------
 * v1 sent the issue TITLE and called it the description. In the field the
 * title is the answer to "What did you find?" - a two- or three-word topic
 * ("Window screen", "Graffiti") - and the actual description of the problem is
 * in Notes, with follow-up added later in More Detail. So the manager was
 * getting the label and not the item. v2 sends title, notes and detail as
 * three separate fields and lets the workbook show all three.
 *
 * v1 also mapped the walker's free-text Category into one of the workbook's
 * five fixed categories, which threw away what they actually typed. v2 sends
 * it verbatim and lets the manager choose the To-Do List category when they
 * promote the item. The one thing that must not get lost in that change is the
 * life-safety signal, so it now travels as its own field.
 *
 * v1 had a Location field derived by pattern-matching the text. There is no
 * location field on the issue form, so it was blank for most rows and guessed
 * on the rest. It is gone. If Location is wanted it has to be a real field in
 * the app first.
 *
 * v2 also stops sending `responsible`. In the workbook that column is now part
 * of the staff block, which the sync is never allowed to write to. The feed
 * sending a default value for a cell the writer must not touch was a trap
 * waiting to be walked into.
 *
 * THE DIRECTION OF THE FEED IS FIXED: app -> workbook, once per item, and
 * never again. This route is read-only by construction (GET, no mutations),
 * and the writer only ever appends rows for Ref IDs it has not posted before.
 * Nothing typed in a workbook is ever read back into the app.
 *
 * Note the status filter below: an item that has been closed in the app simply
 * stops appearing in this feed. It does NOT get removed from the workbook -
 * a row leaves the manager's list when their team clears it, not when the app
 * changes. The writer has no delete path at all.
 *
 * STILL NOT SERIALISED, deliberately: office_note (labelled "internal" in the
 * app), photos, map pins, cost commentary, capex/lender flags. These workbooks
 * live in a folder shared with the management company.
 *
 * Auth: Authorization: Bearer <SYNC_TOKEN>. If SYNC_TOKEN is unset the route
 * refuses every request rather than falling open.
 */

const PAYLOAD_VERSION = 2;

// workbook ID prefix per property. Anything not listed here is not synced.
const CODES = {
  wot: 'WOT',
  wop: 'WOP',
  creekstone: 'CRK',
  foj: 'FOJ',
  fountains: 'FOJ',
  gp: 'GBP',
  gablepoint: 'GBP',
  'gable-point': 'GBP',
  forma: 'FRM',
};

// our priority vocabulary -> the workbook's (Instructions section 3).
// Monitor is an internal-only distinction; it lands as Low for the manager.
const PRIORITY = { High: 'High', Medium: 'Medium', Low: 'Low', Monitor: 'Low', Status: 'Low' };

// The workbook's cells are wrapped and the tab is meant to stay readable, so a
// runaway paste is capped here rather than at the writer. These match the caps
// the writer enforces, so a value that gets through is always writable.
const MAX_TEXT = 4000;
const MAX_SHORT = 120;

function clean(v, max) {
  const s = String(v == null ? '' : v)
    .replace(/\r\n/g, '\n')
    .replace(/[\t\v\f\u0000-\u0008\u000e-\u001f]/g, ' ')   // control chars break the XML
    .replace(/[ ]{2,}/g, ' ')
    .trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function bearer(req) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function tokenOk(given) {
  const want = process.env.SYNC_TOKEN || '';
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;         // timingSafeEqual throws on length mismatch
  return crypto.timingSafeEqual(a, b);
}

function ymd(d) {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

export async function GET(req) {
  if (!tokenOk(bearer(req))) {
    return NextResponse.json({ error: 'auth' }, { status: 401 });
  }
  try {
    await ensureSchema();
    const url = new URL(req.url);
    const only = url.searchParams.get('property');    // optional single-property run

    const { rows } = only
      ? await sql`SELECT i.id, i.property_id, i.title, i.notes, i.detail, i.category,
                         i.priority, i.life_safety, i.walker_name, i.last_walked_by,
                         i.walk_date, i.created_at, p.name AS property_name
                    FROM items i JOIN properties p ON p.id = i.property_id
                   WHERE i.send_todo AND NOT i.archived AND i.status <> 'Complete'
                     AND i.property_id = ${only}
                   ORDER BY i.property_id, i.id`
      : await sql`SELECT i.id, i.property_id, i.title, i.notes, i.detail, i.category,
                         i.priority, i.life_safety, i.walker_name, i.last_walked_by,
                         i.walk_date, i.created_at, p.name AS property_name
                    FROM items i JOIN properties p ON p.id = i.property_id
                   WHERE i.send_todo AND NOT i.archived AND i.status <> 'Complete'
                   ORDER BY i.property_id, i.id`;

    const items = [];
    const unmapped = new Set();
    for (const r of rows) {
      const code = CODES[String(r.property_id).toLowerCase()];
      if (!code) { unmapped.add(r.property_id); continue; }
      items.push({
        // stable de-dup key. items.id is a serial PK, so this never changes
        // and never gets reused - a re-run appends nothing.
        ref_id: `SV-${code}-${r.id}`,
        property_id: r.property_id,
        property_code: code,
        walk_date: ymd(r.walk_date) || ymd(r.created_at),
        found_by: clean(r.walker_name || r.last_walked_by, MAX_SHORT),
        category: clean(r.category, MAX_SHORT),        // verbatim - no re-bucketing
        title: clean(r.title, MAX_SHORT),              // "What did you find?"
        notes: clean(r.notes, MAX_TEXT),               // the substance
        detail: clean(r.detail, MAX_TEXT),             // added later at the office
        priority: PRIORITY[r.priority] || 'Low',
        life_safety: r.life_safety ? 'Yes' : '',
      });
    }
    return NextResponse.json({
      payload_version: PAYLOAD_VERSION,
      generated_at: new Date().toISOString(),
      count: items.length,
      unmapped_properties: [...unmapped],   // surfaced so a new property cannot go missing in silence
      items,
    });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
