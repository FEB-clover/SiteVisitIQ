'use client';

/* Shown when someone signs in successfully but has not been given this half of
   the app. It is a permissions message, not an error — so it says who they are
   signed in as and offers the door they can actually use. */
export default function NoAccess({ name, want, other }) {
  async function signOut() {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login';
  }
  return (
    <div className="center" style={{ background: 'var(--navy)', color: '#fff', textAlign: 'center', padding: 30 }}>
      <div className="ring on-dark" style={{ width: 42, height: 42 }} />
      <div style={{ fontWeight: 700, fontSize: 22 }}>No access to {want}</div>
      <div style={{ color: '#aab6c4', maxWidth: 430, lineHeight: 1.55, fontSize: 15.5 }}>
        You are signed in as <b style={{ color: '#fff' }}>{name}</b>, but your account has not been
        given access to {want}. Ask an administrator if you need it.
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {other && <a href={other} style={{ background: 'var(--accent)', color: '#fff', fontWeight: 700,
          fontSize: 15.5, padding: '11px 20px', borderRadius: 10, textDecoration: 'none' }}>
          Go to {other === '/' ? 'the field app' : 'the dashboard'}
        </a>}
        <button onClick={signOut} style={{ background: '#1b2a3d', color: '#cdd8e4', fontWeight: 700,
          fontSize: 15.5, padding: '11px 20px', borderRadius: 10 }}>Sign out</button>
      </div>
    </div>
  );
}
