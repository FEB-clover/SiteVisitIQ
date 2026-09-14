import crypto from 'crypto';
import { cookies } from 'next/headers';
import { sql, ensureSchema } from './db';

const SECRET = process.env.SESSION_SECRET || 'visitiq-clover-field-test-secret-v1';
const COOKIE = 'vq_session';

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch { return null; }
}

export function setSession(user) {
  cookies().set(COOKIE, sign({ id: user.id, name: user.name, role: user.role }), {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession() {
  cookies().set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export function currentUser() {
  const tok = cookies().get(COOKIE)?.value;
  return verify(tok); // {id,name,role} or null
}

// Look up a user by PIN. Returns the user row or null.
export async function userByPin(pin) {
  await ensureSchema();
  const { rows } = await sql`SELECT id, name, role, active FROM users WHERE pin = ${pin} AND active = true LIMIT 1`;
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Access control.
//
// Resolved from the database on every request, never from the cookie, so that
// revoking someone's access or deactivating them takes effect immediately
// instead of waiting for their session to expire.
// ---------------------------------------------------------------------------

// Returns { id, name, role, can_field, can_dash, properties } or null.
// `properties === null` means "every property" (admins and regionals).
export async function access() {
  const s = currentUser();
  if (!s?.id) return null;
  await ensureSchema();
  const { rows } = await sql`
    SELECT id, name, role, active, can_field, can_dash, all_properties
      FROM users WHERE id = ${s.id} AND active = true LIMIT 1`;
  const u = rows[0];
  if (!u) return null;                      // deactivated mid-session -> locked out now
  const isAdmin = u.role === 'admin';
  let properties = null;
  if (!isAdmin && !u.all_properties) {
    const { rows: pr } = await sql`SELECT property_id FROM user_properties WHERE user_id = ${u.id}`;
    properties = pr.map((r) => r.property_id);
  }
  return {
    id: u.id, name: u.name, role: u.role, isAdmin,
    can_field: isAdmin || u.can_field,
    can_dash: isAdmin || u.can_dash,
    properties,
  };
}

// May this person see/touch this property?
export function allowed(acc, propertyId) {
  if (!acc) return false;
  if (acc.properties === null) return true;
  return acc.properties.includes(String(propertyId));
}

// Convenience for routes: resolve access or return the reason it failed.
export async function gate({ property, dash, field } = {}) {
  const acc = await access();
  if (!acc) return { error: 'auth', status: 401 };
  if (dash && !acc.can_dash) return { error: 'no dashboard access', status: 403 };
  if (field && !acc.can_field) return { error: 'no field app access', status: 403 };
  if (property != null && !allowed(acc, property)) return { error: 'no access to this property', status: 403 };
  return { acc };
}
