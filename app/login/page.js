'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function press(d) {
    setErr('');
    if (d === 'del') return setPin((p) => p.slice(0, -1));
    if (pin.length >= 8) return;
    setPin((p) => p + d);
  }
  async function submit() {
    if (pin.length < 4) return setErr('Enter your passcode');
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || 'Try again'); setPin(''); setBusy(false); return; }
      router.replace('/');
      router.refresh();
    } catch { setErr('Connection problem'); setBusy(false); }
  }

  return (
    <div style={S.wrap}>
      <div style={S.brand}>
        <div className="ring on-dark" style={{ width: 46, height: 46 }} />
        <div>
          <div style={S.name}>SiteVisit <span style={{ color: 'var(--accent-lt)' }}>IQ</span></div>
          <div style={S.sub}>Operations Intelligence</div>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.prompt}>Enter your passcode</div>
        <div style={S.dots}>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span key={i} style={{ ...S.dot, background: i < pin.length ? '#fff' : 'transparent', borderColor: i < pin.length ? '#fff' : '#3a4657' }} />
          ))}
        </div>
        <div style={{ height: 18, color: '#ff9aa0', fontSize: 14.5, textAlign: 'center' }}>{err}</div>
        <div style={S.pad}>
          {['1','2','3','4','5','6','7','8','9'].map((d) => (
            <button key={d} style={S.key} onClick={() => press(d)}>{d}</button>
          ))}
          <button style={{ ...S.key, ...S.keyGhost }} onClick={() => press('del')}>⌫</button>
          <button style={S.key} onClick={() => press('0')}>0</button>
          <button style={{ ...S.key, background: 'var(--coral)', color: '#fff' }} onClick={submit} disabled={busy}>
            {busy ? '…' : '→'}
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: '100vh', background: 'var(--navy)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 22 },
  brand: { display: 'flex', alignItems: 'center', gap: 12 },
  name: { color: '#fff', fontSize: 29, fontWeight: 700, letterSpacing: '-0.02em' },
  sub: { color: '#8fa0b4', fontSize: 12.5, letterSpacing: '0.16em', textTransform: 'uppercase' },
  card: { width: '100%', maxWidth: 320 },
  prompt: { color: '#c6d0da', textAlign: 'center', fontSize: 15.5, marginBottom: 16 },
  dots: { display: 'flex', gap: 12, justifyContent: 'center' },
  dot: { width: 13, height: 13, borderRadius: '50%', border: '2px solid' },
  pad: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 8 },
  key: { height: 62, borderRadius: 14, background: '#1b2a3d', color: '#fff', fontSize: 24.5, fontWeight: 600 },
  keyGhost: { background: 'transparent', color: '#8fa0b4', fontSize: 22.5 },
  foot: { color: '#5b6b7d', fontSize: 13.5 },
};
