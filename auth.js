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
