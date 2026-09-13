import { NextResponse } from 'next/server';
import { sql, ensureSchema } from '../../../lib/db';
import { currentUser } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!currentUser()) return NextResponse.json({ error: 'auth' }, { status: 401 });
  try {
    await ensureSchema();
    const { rows: props } = await sql`SELECT id, name, address, units, site_map_url, sort FROM properties ORDER BY sort`;
    const { rows: floors } = await sql`SELECT property_id, url, idx FROM property_floors ORDER BY property_id, idx`;
    const { rows: counts } = await sql`SELECT property_id,
        count(*) FILTER (WHERE status <> 'Complete' AND NOT archived)::int AS open,
        count(*) FILTER (WHERE (priority='High' OR life_safety) AND status <> 'Complete' AND NOT archived)::int AS critical,
        count(*)::int AS total
      FROM items GROUP BY property_id`;
    const cmap = Object.fromEntries(counts.map((c) => [c.property_id, c]));
    const out = props.map((p) => ({
      ...p,
      floors: floors.filter((f) => f.property_id === p.id).map((f) => f.url),
      open: cmap[p.id]?.open || 0,
      critical: cmap[p.id]?.critical || 0,
      total: cmap[p.id]?.total || 0,
    }));
    return NextResponse.json({ properties: out });
  } catch (e) {
    return NextResponse.json({ error: 'db', detail: String(e.message || e) }, { status: 503 });
  }
}
