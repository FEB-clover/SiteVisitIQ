import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { sql, ensureSchema } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only export of the items a walker flagged "Send to to-do".
 *
 * The nightly writer pulls this and appends rows to each property's Site Visit
 * tab in the manager's Visit Notes & To-Do workbook. It is a separate endpoint
 * from /api/items on purpose:
 *
 *   - it is reachable with a sync token instead of a person's session, so the
 *     job never has to hold someone's login;
 *   - it returns ONLY the nine fields the workbook tab has columns for. The
 *     internal lanes - detail, office_note, cost commentary, photos, map pins,
 *     lender/capex flags - are never serialised here, so they cannot leak into
 *     a workbook that is shared with the management company.
 *
 * Auth: Authorization: Bearer <SYNC_TOKEN>. If SYNC_TOKEN is unset the route
 * refuses every request rather than falling open.
 */

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

// our free-text category -> the workbook's five exact strings. A value that
// does not match exactly silently breaks the manager's sweep, so anything
// unrecognised falls back to Operations/General rather than travelling as-is.
const CATEGORY = [
  [/life\s*safety|lender|compliance|fire|egress|hazard/i, 'Life Safety/Lender Compliance'],
  [/capex|capital|reno|renovation/i, 'CapEx'],
  [/lease|leasing|market|marketing|tour/i, 'Leasing/Marketing'],
  [/repair|paint|punch|hvac|plumb|roof|grounds|landscap|maint/i, 'Repairs'],
];

function category(raw, lifeSafety) {
  // a life-safety flag outranks whatever the category text says
  if (lifeSafety) return 'Life Safety/Lender Compliance';
  const s = String(raw || '');
  for (const [re, out] of CATEGORY) if (re.test(s)) return out;
  return 'Operations/General';
}

// The app has no structured location field yet (see the workflow spec - building /
// area / unit alongside the map pin is still unbuilt). Rather than shipping the
// first line of someone's notes into a shared workbook and calling it a location,
// we pull only an explicit place token out of the title and notes, and leave the
// column blank when there isn't one. Blank is honest; a wrong location sends a
// tech to the wrong building.
// Two tiers, because a numbered building or unit is worth far more to someone
// walking the property than a generic area word. We look for a numbered place
// across BOTH the title and the notes before we settle for a named area -
// "Bldg 7 breezeway" in the notes beats "stair" in the title.
const NUMBERED = new RegExp(
  '\\b(?:' +
    'bldg\\.?\\s*\\d+[a-z]?|building\\s*\\d+[a-z]?|' +
    'unit\\s*#?\\s*\\d+[a-z]?|apt\\.?\\s*#?\\s*\\d+[a-z]?|' +
    'carports?\\s*\\d+(?:\\s*[-–]\\s*\\d+)?' +
  ')\\b', 'i');

const AREA = new RegExp(
  '\\b(?:' +
    'breezeway|clubhouse|leasing office|front office|pool\\s*(?:gate|deck|area)?|' +
    'laundry(?:\\s*room)?|dog park|mail\\s*(?:room|kiosk)|gate\\s*house|' +
    'stairwell|parking\\s*lot|dumpster|compactor|playground|fitness\\s*center' +
  ')\\b', 'i');

function location(title, notes) {
  const sources = [String(title || ''), String(notes || '')];
  for (const re of [NUMBERED, AREA]) {
    for (const src of sources) {
      const m = re.exec(src);
      if (m) {
        // keep a trailing area word when it directly follows the number,
        // so "Bldg 7 breezeway" survives intact rather than becoming "Bldg 7"
        const tail = src.slice(m.index + m[0].length).match(/^\s+(breezeway|stairwell|laundry|pool|clubhouse)\b/i);
        return (m[0] + (tail ? ' ' + tail[1] : '')).replace(/\s+/g, ' ').trim();
      }
    }
  }
  return '';
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
      ? await sql`SELECT i.id, i.property_id, i.title, i.notes, i.category, i.priority,
                         i.life_safety, i.walk_date, i.created_at, p.name AS property_name
                    FROM items i JOIN properties p ON p.id = i.property_id
                   WHERE i.send_todo AND NOT i.archived AND i.status <> 'Complete'
                     AND i.property_id = ${only}
                   ORDER BY i.property_id, i.id`
      : await sql`SELECT i.id, i.property_id, i.title, i.notes, i.category, i.priority,
                         i.life_safety, i.walk_date, i.created_at, p.name AS property_name
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
        location: location(r.title, r.notes),
        category: category(r.category, r.life_safety),
        description: String(r.title || '').trim(),
        priority: PRIORITY[r.priority] || 'Low',
        responsible: 'Mgmt',
        due_date: null,
      });
    }
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      count: items.length,
      unmapped_properties: [...unmapped],   // surfaced so a new property cannot go missing in silence
      items,
    });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
