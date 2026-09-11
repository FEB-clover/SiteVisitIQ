import { createPool } from '@vercel/postgres';

// Resolve the connection string across the names Vercel's Postgres / Neon
// integrations may inject, so connecting the store "just works".
let _pool;
function pool() {
  if (!_pool) {
    const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL
      || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL_UNPOOLED
      || process.env.POSTGRES_URL_NON_POOLING;
    _pool = cs ? createPool({ connectionString: cs }) : createPool();
  }
  return _pool;
}
export function sql(strings, ...vals) { return pool().sql(strings, ...vals); }

// Idempotent schema init. Guarded so it runs once per warm instance.
let ready = null;
export function ensureSchema() {
  if (!ready) ready = init().catch((e) => { ready = null; throw e; });
  return ready;
}

async function init() {
  await sql`CREATE TABLE IF NOT EXISTS users (
    id serial PRIMARY KEY,
    name text NOT NULL,
    role text NOT NULL DEFAULT 'walker',
    pin text NOT NULL UNIQUE,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS properties (
    id text PRIMARY KEY,
    name text NOT NULL,
    address text,
    units int,
    site_map_url text,
    sort int NOT NULL DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS property_floors (
    id serial PRIMARY KEY,
    property_id text NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    url text NOT NULL,
    idx int NOT NULL DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS items (
    id serial PRIMARY KEY,
    property_id text NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    title text NOT NULL,
    notes text DEFAULT '',
    detail text DEFAULT '',
    priority text NOT NULL DEFAULT 'Medium',
    status text NOT NULL DEFAULT 'Open',
    life_safety boolean NOT NULL DEFAULT false,
    send_todo boolean NOT NULL DEFAULT false,
    map_x real,
    map_y real,
    walker_id int REFERENCES users(id),
    walker_name text,
    office_note text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  // expanded field-parity columns (added in-place; live table already exists)
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS category text DEFAULT ''`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS discussed boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS on_agenda boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS source text DEFAULT ''`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS walk_date date`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS capex boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS lender boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS ref text`;
  await sql`CREATE TABLE IF NOT EXISTS item_photos (
    id serial PRIMARY KEY,
    item_id int NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS activity (
    id serial PRIMARY KEY,
    item_id int REFERENCES items(id) ON DELETE CASCADE,
    who text,
    what text,
    at timestamptz NOT NULL DEFAULT now()
  )`;
}
