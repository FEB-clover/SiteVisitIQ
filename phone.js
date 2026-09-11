'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const RATINGS = ['High', 'Low', 'Monitor', 'Status'];
const RLABEL = { High: 'High', Low: 'Low', Monitor: 'Monitor', Status: 'Job Status' };
const RCOLOR = { High: '#e04a54', Low: '#6b7684', Monitor: '#b7791f', Status: '#2a6bd4' };
const SEV = { High: 0, Monitor: 1, Status: 2, Low: 3, Medium: 3 };
const SCOLOR = { Open: '#6b7684', 'In progress': '#2a6bd4', Complete: 'var(--green)' };
const ENTRANCE = { map_x: 30, map_y: 63 };
const TABS = [
  { id: 'queue', label: 'Queue', ic: '≣' },
  { id: 'critical', label: 'Critical', ic: '△' },
  { id: 'agenda', label: 'Agenda', ic: '◎' },
  { id: 'plans', label: 'Plans', ic: '▤' },
  { id: 'archive', label: 'Archive', ic: '▦' },
  { id: 'prewalk', label: 'Pre-Walk', ic: '☑' },
];
const J = { 'content-type': 'application/json' };

function tourOrder(items) {
  const withPos = items.filter((i) => i.map_x != null && i.map_y != null);
  const without = items.filter((i) => i.map_x == null || i.map_y == null);
  const pts = [...withPos]; const order = []; let cur = ENTRANCE;
  while (pts.length) {
    let bi = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = (p.map_x - cur.map_x) ** 2 + (p.map_y - cur.map_y) ** 2; if (d < bd) { bd = d; bi = i; } });
    cur = pts[bi]; order.push(pts[bi]); pts.splice(bi, 1);
  }
  return [...order, ...without];
}

// ---------- pinch/pan zoomable image ----------
function Zoomable({ src, markers, placing, onPlace, minHeight = 200, fit = 'aspect' }) {
  const wrap = useRef(); const g = useRef({}); const lastTap = useRef(0);
  const [h, setH] = useState(minHeight);
  const [tr, setTr] = useState({ s: 1, x: 0, y: 0 });
  const contain = fit === 'contain';
  function measure(e) { if (contain) return; const el = e.target; const cw = el.getBoundingClientRect().width; if (el.naturalWidth) setH(el.naturalHeight * cw / el.naturalWidth); }
  function clampT(nt) {
    const r = wrap.current.getBoundingClientRect();
    const minX = r.width * (1 - nt.s), minY = r.height * (1 - nt.s);
    return { s: nt.s, x: Math.min(0, Math.max(minX, nt.x)), y: Math.min(0, Math.max(minY, nt.y)) };
  }
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
  function ts(e) {
    if (e.touches.length === 2) { const [a, b] = e.touches; g.current = { mode: 'pinch', d0: dist(a, b), t0: { ...tr }, m0: mid(a, b) }; }
    else if (e.touches.length === 1) { g.current = { mode: 'pan', x0: e.touches[0].clientX, y0: e.touches[0].clientY, t0: { ...tr }, moved: false }; }
  }
  function tm(e) {
    const gg = g.current; if (!gg.mode) return;
    const r = wrap.current.getBoundingClientRect();
    if (gg.mode === 'pinch' && e.touches.length >= 2) {
      if (e.cancelable) e.preventDefault();
      const [a, b] = e.touches; let s = gg.t0.s * dist(a, b) / gg.d0; s = Math.max(1, Math.min(6, s));
      const k = s / gg.t0.s; const mx = gg.m0.x - r.left, my = gg.m0.y - r.top;
      setTr(clampT({ s, x: mx - (mx - gg.t0.x) * k, y: my - (my - gg.t0.y) * k }));
    } else if (gg.mode === 'pan' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - gg.x0, dy = e.touches[0].clientY - gg.y0;
      if (Math.hypot(dx, dy) > 6) gg.moved = true;
      // only hijack the drag when zoomed in (or in the full-screen viewer); otherwise let the page scroll
      if (tr.s > 1) { if (e.cancelable) e.preventDefault(); setTr(clampT({ s: tr.s, x: gg.t0.x + dx, y: gg.t0.y + dy })); }
    }
  }
  function te() {
    const gg = g.current;
    if (gg.mode === 'pan' && !gg.moved) {
      const r = wrap.current.getBoundingClientRect();
      if (placing && onPlace) {
        const ix = (gg.x0 - r.left - tr.x) / tr.s, iy = (gg.y0 - r.top - tr.y) / tr.s;
        onPlace(+(ix / r.width * 100).toFixed(1), +(iy / r.height * 100).toFixed(1));
      } else {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          const ns = tr.s > 1 ? 1 : 2.5; const mx = gg.x0 - r.left, my = gg.y0 - r.top; const k = ns / tr.s;
          setTr(ns === 1 ? { s: 1, x: 0, y: 0 } : clampT({ s: ns, x: mx - (mx - tr.x) * k, y: my - (my - tr.y) * k }));
          lastTap.current = 0;
        } else lastTap.current = now;
      }
    }
    g.current = {};
  }
  return (
    <div className="zoomwrap" ref={wrap} style={{ width: '100%', height: contain ? '100%' : h, borderRadius: contain ? 0 : 8, border: contain ? 'none' : '1px solid var(--line)', touchAction: contain ? 'none' : (tr.s > 1 ? 'none' : 'pan-y') }}
      onTouchStart={ts} onTouchMove={tm} onTouchEnd={te}>
      <div style={{ transform: `translate(${tr.x}px,${tr.y}px) scale(${tr.s})`, transformOrigin: '0 0', width: '100%', height: contain ? '100%' : 'auto', position: 'relative', display: contain ? 'flex' : 'block', alignItems: 'center', justifyContent: 'center' }}>
        <img src={src} onLoad={measure} draggable={false} alt="" style={contain ? { maxWidth: '100%', maxHeight: '100%', width: 'auto', display: 'block' } : { width: '100%', display: 'block' }} />
        {(markers || []).map((m, i) => (
          <div key={i} style={{ position: 'absolute', left: m.x + '%', top: m.y + '%', transform: `translate(-50%,-50%) scale(${1 / tr.s})` }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: m.color || 'var(--coral)', color: '#fff', border: '2px solid #fff', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 5px rgba(0,0,0,.4)' }}>{m.n || ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhotoViewer({ src, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 80, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 10, paddingTop: 'calc(10px + env(safe-area-inset-top))' }}>
        <button onClick={onClose} style={{ color: '#fff', fontSize: 22.5, padding: '6px 14px' }}>✕ Close</button>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: 6 }}><div style={{ width: '100%' }}><Zoomable src={src} minHeight={260} /></div></div>
      <div style={{ textAlign: 'center', color: '#8b96a3', fontSize: 13.5, padding: 12 }}>Pinch or double-tap to zoom</div>
    </div>
  );
}

function ReportViewer({ url, filename, onClose }) {
  const [state, setState] = useState('loading');
  const [blobUrl, setBlobUrl] = useState(null);
  const fileRef = useRef(null);
  const urlRef = useRef(null);
  useEffect(() => {
    let alive = true;
    document.body.style.overflow = 'hidden';
    (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('bad');
        const blob = await r.blob();
        if (!alive) return;
        fileRef.current = new File([blob], filename, { type: 'application/pdf' });
        const u = URL.createObjectURL(blob); urlRef.current = u;
        setBlobUrl(u); setState('ready');
      } catch { if (alive) setState('error'); }
    })();
    return () => { alive = false; document.body.style.overflow = ''; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [url, filename]);
  async function share() {
    const f = fileRef.current;
    try {
      if (f && navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: filename }); return; }
    } catch { return; }
    if (urlRef.current) window.open(urlRef.current, '_blank');
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a1017', zIndex: 95, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', paddingTop: 'calc(12px + env(safe-area-inset-top))', color: '#fff', flex: 'none' }}>
        <div style={{ fontWeight: 700, fontSize: 17, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{filename.replace(/\.pdf$/, '')}</div>
        <button onClick={onClose} style={{ color: '#fff', background: 'rgba(255,255,255,.16)', fontSize: 15.5, fontWeight: 700, padding: '9px 16px', borderRadius: 9 }}>✕ Close</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#11202f' }}>
        {state === 'ready' && blobUrl && <iframe title="report" src={blobUrl} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />}
        {state === 'loading' && <div className="center" style={{ height: '100%', color: '#8fa0b4' }}><div className="spin" /><div>Preparing report…</div></div>}
        {state === 'error' && <div className="center" style={{ height: '100%', color: '#ff9aa0', padding: 24, textAlign: 'center' }}>Could not generate the report. Please close and try again.</div>}
      </div>
      <div style={{ flex: 'none', padding: '12px 14px 4px', display: 'flex', gap: 10 }}>
        <button onClick={share} disabled={state !== 'ready'} style={{ flex: 1, background: 'var(--coral)', color: '#fff', fontWeight: 700, fontSize: 18, padding: '14px 0', borderRadius: 12, opacity: state === 'ready' ? 1 : 0.5 }}>🖨 Print / Share / Save</button>
      </div>
      <div style={{ flex: 'none', textAlign: 'center', color: '#5b6b7d', fontSize: 13.5, padding: '6px 20px calc(12px + env(safe-area-inset-bottom))' }}>Print sends it to any AirPrint printer on your Wi-Fi. Share also lets you save it to Files or email it.</div>
    </div>
  );
}

function AutoText({ value, onChange, placeholder, minH = 84 }) {
  const ref = useRef();
  const resize = useCallback(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = Math.max(minH, el.scrollHeight) + 'px'; } }, [minH]);
  useEffect(() => { resize(); }, [value, resize]);
  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} onInput={resize} placeholder={placeholder}
    style={{ ...ST.input, resize: 'none', overflow: 'hidden', minHeight: minH, lineHeight: 1.45 }} />;
}

export default function Phone({ user }) {
  const router = useRouter();
  const [view, setView] = useState('portfolio');
  const [tab, setTab] = useState('queue');
  const [props, setProps] = useState(null);
  const [pid, setPid] = useState(null);
  const [items, setItems] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [report, setReport] = useState(null);
  const [toast, setToast] = useState('');
  const openReport = useCallback((url, filename) => setReport({ url, filename }), []);

  const prop = props?.find((p) => p.id === pid);
  const show = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 2000); }, []);
  const loadProps = useCallback(() => fetch('/api/properties').then((r) => r.json()).then((j) => setProps(j.properties || [])), []);
  const loadItems = useCallback((id) => { setItems(null); return fetch('/api/items?property=' + id).then((r) => r.json()).then((j) => setItems(j.items || [])); }, []);
  useEffect(() => { loadProps(); }, [loadProps]);
  function openProp(id) { setPid(id); setTab('queue'); setView('property'); loadItems(id); }

  const patchItem = useCallback(async (id, body, msg) => {
    setItems((its) => its.map((i) => (i.id === id ? { ...i, ...body } : i)));
    const r = await fetch('/api/items/' + id, { method: 'PATCH', headers: J, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); setItems((its) => its.map((i) => (i.id === id ? j.item : i))); loadProps(); if (msg) show(msg); }
  }, [loadProps, show]);
  async function logout() { await fetch('/api/logout', { method: 'POST' }); router.replace('/login'); router.refresh(); }

  const counts = useMemo(() => {
    const a = items || []; const live = a.filter((i) => !i.archived);
    return {
      queue: live.filter((i) => i.status !== 'Complete').length,
      critical: live.filter((i) => (i.priority === 'High' || i.life_safety) && i.status !== 'Complete').length,
      agenda: live.filter((i) => i.on_agenda).length,
      archive: a.filter((i) => i.archived).length,
    };
  }, [items]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ground)', paddingBottom: view === 'property' ? 66 : 0 }}>
      <Header user={user} onLogout={logout} onDash={() => router.push('/dashboard')} />
      {view === 'portfolio' && <Portfolio props={props} onOpen={openProp} />}
      {view === 'property' && prop && (
        <>
          <PropHeader prop={prop} counts={counts} onBack={() => { setView('portfolio'); loadProps(); }} tab={tab} setTab={setTab} />
          <div style={{ paddingBottom: 8 }}>
            {items === null ? <Loading /> : (
              <>
                {tab === 'queue' && <Queue items={items} onOpen={(it) => setSheet({ mode: 'edit', item: it })} patchItem={patchItem} />}
                {tab === 'critical' && <Critical prop={prop} items={items} onOpen={(it) => setSheet({ mode: 'edit', item: it })} openReport={openReport} />}
                {tab === 'agenda' && <Agenda prop={prop} items={items} onOpen={(it) => setSheet({ mode: 'edit', item: it })} patchItem={patchItem} openReport={openReport} />}
                {tab === 'plans' && <Plans prop={prop} openReport={openReport} />}
                {tab === 'archive' && <Archive items={items} onOpen={(it) => setSheet({ mode: 'edit', item: it })} patchItem={patchItem} />}
                {tab === 'prewalk' && <PreWalk items={items} prop={prop} openReport={openReport} />}
              </>
            )}
          </div>
          {(tab === 'queue' || tab === 'critical') && <button style={ST.fab} onClick={() => setSheet({ mode: 'new' })}>＋ New item</button>}
          <BottomNav tab={tab} setTab={setTab} counts={counts} />
        </>
      )}
      {sheet && (
        <ItemSheet mode={sheet.mode} item={sheet.item} prop={prop} onClose={() => setSheet(null)} onViewPhoto={setViewer} openReport={openReport}
          onSaved={() => { setSheet(null); loadItems(pid).then(loadProps); show('Saved'); }} onToast={show} />
      )}
      {viewer && <PhotoViewer src={viewer} onClose={() => setViewer(null)} />}
      {report && <ReportViewer url={report.url} filename={report.filename} onClose={() => setReport(null)} />}
      {toast && <div style={ST.toast}>{toast}</div>}
    </div>
  );
}

function Header({ user, onLogout, onDash }) {
  return (
    <div style={ST.top}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div className="ring" style={{ width: 26, height: 26 }} />
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em' }}>SiteVisit <span style={{ color: 'var(--coral)' }}>IQ</span></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={ST.dashBtn} onClick={onDash}>Dashboard</button>
        <button style={ST.who} onClick={onLogout} title="Sign out">{user.name.split(' ')[0]} ⏻</button>
      </div>
    </div>
  );
}

function Portfolio({ props, onOpen }) {
  if (!props) return <Loading />;
  return (
    <div style={{ padding: 14 }}>
      <div style={ST.sechead}>Portfolio</div>
      {props.map((p) => (
        <button key={p.id} style={ST.propcard} onClick={() => onOpen(p.id)}>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{p.name}</div>
            <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 2 }}>{p.address}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {p.critical > 0 && <div style={ST.critpill}>{p.critical} critical</div>}
            <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 4 }}>{p.open} open</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function PropHeader({ prop, counts, onBack, tab, setTab }) {
  return (
    <div style={ST.propHeadWrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 4px' }}>
        <button style={ST.back} onClick={onBack}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prop.name}</div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{prop.address}</div>
        </div>
      </div>
      <div style={ST.tabstrip}>
        {TABS.map((t) => {
          const b = counts[t.id];
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ ...ST.tab, ...(tab === t.id ? ST.tabOn : {}) }}>
              {t.label}{b ? <span style={{ ...ST.tbadge, ...(t.id === 'critical' ? { background: '#e04a54' } : {}) }}>{b}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BottomNav({ tab, setTab, counts }) {
  return (
    <div style={ST.bnav}>
      {TABS.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{ ...ST.bbtn, color: tab === t.id ? 'var(--coral)' : '#8b96a3' }}>
          <span style={{ fontSize: 19, lineHeight: 1, position: 'relative' }}>{t.ic}{counts[t.id] ? <span style={ST.bdot} /> : null}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function SearchBar({ q, setQ }) {
  return (
    <div style={{ padding: '10px 12px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px' }}>
        <span style={{ color: 'var(--muted2)' }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" style={{ border: 'none', outline: 'none', flex: 1, fontSize: 17, background: 'transparent' }} />
        {q && <button onClick={() => setQ('')} style={{ color: 'var(--muted2)', fontSize: 17 }}>✕</button>}
      </div>
    </div>
  );
}
const matchQ = (it, q) => !q || [it.title, it.category, it.notes, it.detail, it.source].some((s) => (s || '').toLowerCase().includes(q.toLowerCase()));

function Queue({ items, onOpen, patchItem }) {
  const [f, setF] = useState({ open: true });
  const [q, setQ] = useState('');
  const chips = [['ls', 'Life safety'], ['High', 'High'], ['Low', 'Low'], ['Monitor', 'Monitor'], ['Status', 'Job Status'], ['open', 'Open only']];
  const toggle = (k) => setF((s) => ({ ...s, [k]: !s[k] }));
  let list = items.filter((i) => !i.archived && matchQ(i, q));
  if (f.open) list = list.filter((i) => i.status !== 'Complete');
  if (f.ls) list = list.filter((i) => i.life_safety);
  const rs = RATINGS.filter((r) => f[r]);
  if (rs.length) list = list.filter((i) => rs.includes(i.priority));
  list = [...list].sort((a, b) => (SEV[a.priority] ?? 3) - (SEV[b.priority] ?? 3) || new Date(b.walk_date || b.created_at) - new Date(a.walk_date || a.created_at));
  return (
    <div>
      <SearchBar q={q} setQ={setQ} />
      <div style={ST.chipbar}>
        {chips.map(([k, lbl]) => <button key={k} onClick={() => toggle(k)} style={{ ...ST.chipf, ...(f[k] ? ST.chipfOn : {}) }}>{lbl}</button>)}
      </div>
      <div style={{ padding: '2px 16px 6px', color: 'var(--muted)', fontSize: 13.5 }}>{list.length} of {items.filter((i) => !i.archived).length} · severity</div>
      {list.length === 0 ? <Empty /> : <div style={{ padding: '0 12px' }}>{list.map((it) => <ItemCard key={it.id} it={it} onOpen={onOpen} patchItem={patchItem} />)}</div>}
    </div>
  );
}

function ItemCard({ it, onOpen, patchItem }) {
  const actions = [
    ['Discussed', it.discussed, () => patchItem(it.id, { discussed: !it.discussed })],
    ['Complete', it.status === 'Complete', () => patchItem(it.id, { status: it.status === 'Complete' ? 'Open' : 'Complete' })],
    ['Agenda', it.on_agenda, () => patchItem(it.id, { on_agenda: !it.on_agenda }, it.on_agenda ? '' : 'Added to agenda')],
    ['Archive', it.archived, () => patchItem(it.id, { archived: !it.archived }, 'Archived')],
  ];
  return (
    <div style={ST.card}>
      <div style={{ display: 'flex', gap: 11 }} onClick={() => onOpen(it)}>
        {it.photos?.[0] ? <img src={it.photos[0]} alt="" style={ST.thumb} /> : <div style={{ ...ST.thumb, ...ST.thumbEmpty }}>—</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...ST.ratebadge, background: RCOLOR[it.priority] || '#6b7684' }}>{(RLABEL[it.priority] || it.priority || '').toUpperCase()}</span>
            {it.life_safety && <span style={ST.ls}>Life safety</span>}
            {it.send_todo && <span style={ST.todo}>To-do</span>}
          </div>
          <div style={{ fontWeight: 600, fontSize: 16, margin: '3px 0 2px' }}>{it.title}</div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{it.category ? it.category + ' · ' : ''}{it.source || '—'}{it.walk_date ? ' · ' + String(it.walk_date).slice(0, 10) : ''}</div>
        </div>
      </div>
      <div style={ST.actionrow}>
        {actions.map(([lbl, on, fn]) => (
          <button key={lbl} onClick={fn} style={ST.actbtn}>
            <span style={{ ...ST.checkbox, ...(on ? { background: 'var(--coral)', borderColor: 'var(--coral)' } : {}) }}>{on ? '✓' : ''}</span>{lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

function Critical({ prop, items, onOpen, openReport }) {
  const crit = items.filter((i) => !i.archived && i.status !== 'Complete' && (i.priority === 'High' || i.life_safety)).sort((a, b) => (SEV[a.priority] ?? 3) - (SEV[b.priority] ?? 3));
  const marks = crit.filter((i) => i.map_x != null).map((it) => ({ x: it.map_x, y: it.map_y, n: crit.indexOf(it) + 1 }));
  function printIt() { openReport('/api/report?type=critical&property=' + encodeURIComponent(prop.id), prop.name + ' — Critical Items.pdf'); }
  return (
    <div style={{ padding: 14 }}>
      <div style={ST.secheadrow}><span>Critical map</span>{crit.length ? <button style={ST.printbtn} onClick={printIt}>📄 Save / Print</button> : null}</div>
      {prop.site_map_url ? <Zoomable src={prop.site_map_url} markers={marks} /> : <div style={{ color: 'var(--muted)', fontSize: 14 }}>No site map — pin items to place them here.</div>}
      <div style={{ ...ST.sechead, marginTop: 16 }}>Critical &amp; high-priority · {crit.length}</div>
      {crit.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 14.5, padding: 12 }}>Nothing critical open.</div> :
        crit.map((it, i) => (
          <button key={it.id} style={ST.critrow} onClick={() => onOpen(it)}>
            <span style={ST.critnum}>{i + 1}</span>
            {it.photos?.[0] ? <img src={it.photos[0]} alt="" style={ST.thumbSm} /> : <div style={{ ...ST.thumbSm, ...ST.thumbEmpty }}>—</div>}
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ ...ST.ratebadge, background: RCOLOR[it.priority] || '#6b7684' }}>{(RLABEL[it.priority] || it.priority || '').toUpperCase()}</span>
                {it.life_safety && <span style={ST.ls}>Life safety</span>}
              </div>
              <div style={{ fontWeight: 600, fontSize: 15.5, marginTop: 2 }}>{it.title}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{it.category || ''}{it.source ? ' · ' + it.source : ''}</div>
            </div>
          </button>
        ))}
    </div>
  );
}

function Agenda({ prop, items, onOpen, patchItem, openReport }) {
  const ag = items.filter((i) => i.on_agenda && !i.archived);
  const tour = tourOrder(ag);
  const marks = tour.filter((i) => i.map_x != null).map((it) => ({ x: it.map_x, y: it.map_y, n: tour.indexOf(it) + 1, color: 'var(--navy)' }));
  function printIt() { openReport('/api/report?type=agenda&property=' + encodeURIComponent(prop.id), prop.name + ' — Agenda.pdf'); }
  if (!ag.length) return (
    <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--muted)' }}>
      <div style={{ fontSize: 17, marginBottom: 6 }}>No agenda items yet.</div>
      <div style={{ fontSize: 14.5 }}>On the Queue, tap <b>Agenda</b> on any item to add it here for the walk.</div>
    </div>
  );
  return (
    <div style={{ padding: 14 }}>
      <div style={ST.secheadrow}><span>Agenda map · walking order</span><button style={ST.printbtn} onClick={printIt}>📄 Save / Print</button></div>
      {prop.site_map_url ? <Zoomable src={prop.site_map_url} markers={marks} /> : <div style={{ color: 'var(--muted)', fontSize: 14 }}>No site map — pin items to see the route.</div>}
      <div style={{ ...ST.sechead, marginTop: 16 }}>Stops in order · {tour.length}</div>
      {tour.map((it, i) => (
        <div key={it.id} style={ST.agitem}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={ST.agnum}>{i + 1}</span>
            <div style={{ flex: 1 }} onClick={() => onOpen(it)}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{it.title}</div>
              {(it.detail || it.notes) && <div style={{ color: '#4a5665', fontSize: 14, marginTop: 3, lineHeight: 1.4 }}>{it.detail || it.notes}</div>}
              <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 4 }}>
                <span style={{ color: RCOLOR[it.priority], fontWeight: 700 }}>{RLABEL[it.priority] || it.priority}</span>
                {it.category ? ' · ' + it.category : ''}{it.map_x == null ? ' · not on map' : ''}
              </div>
            </div>
            <button style={ST.agx} onClick={() => patchItem(it.id, { on_agenda: false }, 'Removed from agenda')}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Plans({ prop, openReport }) {
  const [viewer, setViewer] = useState(null); // { kind:'site'|'floor', index }
  const floors = prop.floors || [];
  const openPdf = (t) => openReport('/api/report?type=' + t + '&property=' + encodeURIComponent(prop.id), prop.name + ' — ' + (t === 'sitemap' ? 'Site Map' : 'Floorplans') + '.pdf');
  const printMap = () => openPdf('sitemap');
  const printFloors = () => openPdf('floorplans');
  return (
    <div style={{ padding: 14 }}>
      <div style={ST.secheadrow}><span>Site map</span>{prop.site_map_url ? <button style={ST.printbtn} onClick={printMap}>📄 Save / Print</button> : null}</div>
      {prop.site_map_url ? <PlanThumb src={prop.site_map_url} onOpen={() => setViewer({ kind: 'site', index: 0 })} /> : <div style={{ color: 'var(--muted)', fontSize: 14.5 }}>No site map loaded.</div>}
      <div style={{ ...ST.secheadrow, marginTop: 16 }}><span>Floorplans{floors.length > 1 ? ' · ' + floors.length + ' sheets' : ''}</span>{floors.length ? <button style={ST.printbtn} onClick={printFloors}>📄 Save / Print</button> : null}</div>
      {floors.length ? floors.map((u, i) => <div key={i} style={{ marginBottom: 10 }}><PlanThumb src={u} onOpen={() => setViewer({ kind: 'floor', index: i })} /></div>) : <div style={{ color: 'var(--muted)', fontSize: 14.5 }}>No floorplans loaded.</div>}
      {viewer && (
        <PlanViewer
          srcs={viewer.kind === 'site' ? [prop.site_map_url] : floors}
          labels={viewer.kind === 'site' ? ['Site Map'] : floors.map((_, i) => 'Floor ' + (i + 1))}
          start={viewer.index}
          onClose={() => setViewer(null)}
          onPrint={() => openPdf(viewer.kind === 'site' ? 'sitemap' : 'floorplans')}
        />
      )}
    </div>
  );
}

function PlanThumb({ src, label, onOpen }) {
  return (
    <button onClick={onOpen} style={{ display: 'block', width: '100%', position: 'relative', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden', background: '#0a1017', padding: 0 }}>
      <img src={src} alt="" draggable={false} style={{ width: '100%', maxHeight: '38vh', objectFit: 'contain', display: 'block' }} />
      {label && <span style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(13,22,32,.82)', color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6 }}>{label}</span>}
      <span style={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(13,22,32,.85)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '5px 11px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 5 }}>⤢ Tap to zoom full screen</span>
    </button>
  );
}

function PlanViewer({ srcs, labels, start = 0, onClose, onPrint }) {
  const [i, setI] = useState(start);
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  const many = srcs.length > 1;
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a1017', zIndex: 85, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', paddingTop: 'calc(10px + env(safe-area-inset-top))', color: '#fff', flex: 'none' }}>
        <div style={{ fontWeight: 700, fontSize: 15.5, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labels[i]}{many ? `  ·  ${i + 1}/${srcs.length}` : ''}</div>
        <button onClick={() => onPrint(srcs[i], labels[i], i, srcs.length)} style={ST.viewerBtn}>📄 Save / Print</button>
        <button onClick={onClose} style={ST.viewerBtn}>✕ Close</button>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <Zoomable key={i} src={srcs[i]} fit="contain" />
      </div>
      {many && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px calc(12px + env(safe-area-inset-bottom))', flex: 'none' }}>
          <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0} style={{ ...ST.viewerBtn, opacity: i === 0 ? 0.4 : 1 }}>‹ Prev</button>
          <div style={{ color: '#8fa0b4', fontSize: 13.5 }}>Floor {i + 1} of {srcs.length}</div>
          <button onClick={() => setI((v) => Math.min(srcs.length - 1, v + 1))} disabled={i === srcs.length - 1} style={{ ...ST.viewerBtn, opacity: i === srcs.length - 1 ? 0.4 : 1 }}>Next ›</button>
        </div>
      )}
      <div style={{ textAlign: 'center', color: '#5b6b7d', fontSize: 12.5, padding: '0 0 calc(8px + env(safe-area-inset-bottom))', flex: 'none' }}>Pinch to zoom · drag to move · double-tap to reset</div>
    </div>
  );
}

function Archive({ items, onOpen, patchItem }) {
  const [q, setQ] = useState('');
  const arc = items.filter((i) => i.archived && matchQ(i, q)).sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  return (
    <div>
      <SearchBar q={q} setQ={setQ} />
      <div style={{ padding: '4px 14px' }}>
        <div style={ST.sechead}>Archived · {items.filter((i) => i.archived).length}</div>
        {arc.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 14.5, padding: 12 }}>{q ? 'No archived items match.' : 'Nothing archived yet.'}</div> :
          arc.map((it) => (
            <div key={it.id} style={ST.card}>
              <div style={{ display: 'flex', gap: 11 }} onClick={() => onOpen(it)}>
                {it.photos?.[0] ? <img src={it.photos[0]} alt="" style={ST.thumb} /> : <div style={{ ...ST.thumb, ...ST.thumbEmpty }}>—</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15.5 }}>{it.title}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{it.category || ''}{it.source ? ' · ' + it.source : ''}</div>
                </div>
              </div>
              <div style={ST.actionrow}><button style={ST.actbtn} onClick={() => patchItem(it.id, { archived: false }, 'Restored')}>↩ Restore to queue</button></div>
            </div>
          ))}
      </div>
    </div>
  );
}

function PreWalk({ items, prop, openReport }) {
  const carry = items.filter((i) => !i.archived && i.status !== 'Complete' && (i.priority === 'High' || i.life_safety));
  const check = ['Phone charged & camera ready', 'Keys / access for buildings & amenities', 'Review last visit’s open items (below)', 'Note anything the manager flagged this week'];
  return (
    <div style={{ padding: 14 }}>
      <div style={ST.secheadrow}><span>Before you walk</span>{prop ? <button style={ST.printbtn} onClick={() => openReport('/api/report?type=prewalk&property=' + encodeURIComponent(prop.id), prop.name + ' — Pre-Walk Checklist.pdf')}>📄 Save / Print</button> : null}</div>
      {check.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 4px', borderBottom: '1px solid var(--line)' }}>
          <span style={ST.checkbox2} /><span style={{ fontSize: 15.5 }}>{c}</span>
        </div>
      ))}
      <div style={{ ...ST.sechead, marginTop: 18 }}>Carry-over to verify · {carry.length}</div>
      {carry.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 14.5 }}>No high-priority carry-over items.</div> :
        carry.map((it) => (
          <div key={it.id} style={{ padding: '9px 4px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ ...ST.ratebadge, background: RCOLOR[it.priority] || '#6b7684' }}>{(RLABEL[it.priority] || it.priority || '').toUpperCase()}</span>
              <span style={{ fontWeight: 600, fontSize: 15.5 }}>{it.title}</span>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>{it.source || ''}</div>
          </div>
        ))}
    </div>
  );
}

function ItemSheet({ mode, item, prop, onClose, onSaved, onToast, onViewPhoto, openReport }) {
  const editing = mode === 'edit';
  const [title, setTitle] = useState(item?.title || '');
  const [rating, setRating] = useState(item?.priority || 'Low');
  const [category, setCategory] = useState(item?.category || '');
  const [ls, setLs] = useState(!!item?.life_safety);
  const [todo, setTodo] = useState(!!item?.send_todo);
  const [agenda, setAgenda] = useState(!!item?.on_agenda);
  const [status, setStatus] = useState(item?.status || 'Open');
  const [notes, setNotes] = useState(item?.notes || '');
  const [detail, setDetail] = useState(item?.detail || '');
  const [pin, setPin] = useState(item?.map_x != null ? { x: item.map_x, y: item.map_y } : null);
  const [photos, setPhotos] = useState(item?.photos || []);
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const fileRef = useRef();
  const pendingFile = useRef(null);

  async function pickPhoto(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const small = await downscale(file);
    if (editing) { await uploadPhoto(item.id, small); setPhotos((p) => [...p, URL.createObjectURL(small)]); onToast('Photo added'); }
    else { pendingFile.current = small; setPhotos([URL.createObjectURL(small)]); }
    e.target.value = '';
  }
  async function save() {
    if (!title.trim()) return onToast('Add a short title');
    setBusy(true);
    try {
      if (editing) {
        await fetch('/api/items/' + item.id, { method: 'PATCH', headers: J, body: JSON.stringify({ title, priority: rating, category, life_safety: ls, send_todo: todo, on_agenda: agenda, status, notes, detail, map_x: pin?.x ?? null, map_y: pin?.y ?? null }) });
      } else {
        const r = await fetch('/api/items', { method: 'POST', headers: J, body: JSON.stringify({ property_id: prop.id, title, priority: rating, category, life_safety: ls, send_todo: todo, on_agenda: agenda, notes, source: 'Field entry', map_x: pin?.x ?? null, map_y: pin?.y ?? null }) });
        const j = await r.json();
        if (j.item && pendingFile.current) await uploadPhoto(j.item.id, pendingFile.current);
      }
      onSaved();
    } catch { onToast('Save failed'); setBusy(false); }
  }
  return (
    <div style={ST.overlay} onClick={onClose}>
      <div style={ST.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={ST.sheetHead}>
          <div style={ST.grab} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 18, flex: 1, minWidth: 0 }}>{editing ? 'Item' : 'New item — this visit'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
              {editing && item?.id && <button style={ST.printbtn} onClick={() => openReport('/api/report?type=item&id=' + item.id, (item.title || 'Issue').slice(0, 40) + '.pdf')}>📄 Save / Print</button>}
              <button style={ST.x} onClick={onClose} aria-label="Close">✕</button>
            </div>
          </div>
        </div>

        {editing && photos.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <img src={photos[0]} alt="" onClick={() => onViewPhoto(photos[0])} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
            {photos.length > 1 && <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>{photos.slice(1).map((u, i) => <img key={i} src={u} alt="" onClick={() => onViewPhoto(u)} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />)}</div>}
            <div style={{ textAlign: 'center', color: 'var(--muted2)', fontSize: 12.5, marginTop: 4 }}>Tap the photo to zoom</div>
          </div>
        )}

        <label style={ST.lbl}>What did you find?</label>
        <input style={ST.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gutter separation at clubhouse" />

        <label style={ST.lbl}>Rating</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {RATINGS.map((r) => <button key={r} onClick={() => setRating(r)} style={{ ...ST.chip, fontSize: 14, ...(rating === r ? { background: RCOLOR[r], color: '#fff', borderColor: RCOLOR[r] } : {}) }}>{RLABEL[r]}</button>)}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Toggle label="Life safety" on={ls} onClick={() => setLs(!ls)} />
          <Toggle label="Add to agenda" on={agenda} onClick={() => setAgenda(!agenda)} />
          <Toggle label="Send to to-do" on={todo} onClick={() => setTodo(!todo)} coral />
        </div>

        <label style={ST.lbl}>Category</label>
        <input style={ST.input} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Maintenance, Signage, Make Ready, Office" />

        {editing && (
          <>
            <label style={ST.lbl}>Status</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Open', 'In progress', 'Complete'].map((s) => <button key={s} onClick={() => setStatus(s)} style={{ ...ST.chip, fontSize: 14, ...(status === s ? { background: SCOLOR[s], color: '#fff', borderColor: SCOLOR[s] } : {}) }}>{s}</button>)}
            </div>
          </>
        )}

        <label style={ST.lbl}>{editing ? 'Notes' : 'Quick note (optional)'}</label>
        <AutoText value={notes} onChange={setNotes} placeholder="A line now — add detail later at the office" minH={editing ? 96 : 70} />

        {editing && (
          <>
            <label style={ST.lbl}>More detail (added at the office)</label>
            <AutoText value={detail} onChange={setDetail} placeholder="Fuller description, vendor, measurements…" minH={110} />
          </>
        )}

        <label style={ST.lbl}>{editing ? 'Add another photo' : 'Photo'}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {!editing && photos.map((u, i) => <img key={i} src={u} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />)}
          <button style={ST.addPhoto} onClick={() => fileRef.current?.click()}>＋</button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
        </div>

        <label style={ST.lbl}>Location on site map</label>
        {prop?.site_map_url ? (
          <div>
            <button style={{ ...ST.chip, marginBottom: 8, ...(placing ? { background: 'var(--coral)', color: '#fff', borderColor: 'var(--coral)' } : {}) }} onClick={() => setPlacing((p) => !p)}>
              {pin ? '✓ Pinned — tap “Move pin” to change' : placing ? 'Now tap the map (zoom in first for accuracy)' : 'Place pin on site map'}
            </button>
            <Zoomable src={prop.site_map_url} placing={placing} onPlace={(x, y) => { setPin({ x, y }); setPlacing(false); }} markers={pin ? [{ x: pin.x, y: pin.y }] : []} />
            <div style={{ textAlign: 'center', color: 'var(--muted2)', fontSize: 12.5, marginTop: 4 }}>Pinch to zoom · drag to move · then tap to drop the pin</div>
          </div>
        ) : <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>No site map for this property.</div>}

        <button style={{ ...ST.save, opacity: busy ? 0.6 : 1 }} onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save item'}</button>
        {!editing && <div style={{ textAlign: 'center', color: 'var(--muted2)', fontSize: 13, marginTop: 8 }}>In a hurry? Title + rating is enough — add the rest later.</div>}
      </div>
    </div>
  );
}

function Toggle({ label, on, onClick, coral }) {
  return (
    <button onClick={onClick} style={{ ...ST.toggle, ...(on ? { background: coral ? 'var(--coral)' : 'var(--navy)', color: '#fff', borderColor: 'transparent' } : {}) }}>
      <span style={{ ...ST.dot2, background: on ? '#fff' : '#c3ccd6' }} />{label}
    </button>
  );
}
function Empty() {
  return (
    <div style={{ padding: '44px 24px', textAlign: 'center', color: 'var(--muted)' }}>
      <div style={{ fontSize: 17, marginBottom: 6 }}>No items match.</div>
      <div style={{ fontSize: 14.5 }}>Adjust the filters, or tap <b>+ New item</b> to log one.</div>
    </div>
  );
}
function Loading() { return <div className="center" style={{ minHeight: 220 }}><div className="spin" /></div>; }

async function uploadPhoto(itemId, file) {
  const fd = new FormData(); fd.append('file', file, 'photo.jpg'); fd.append('itemId', String(itemId));
  await fetch('/api/photos', { method: 'POST', body: fd });
}
function downscale(file, max = 1600, q = 0.82) {
  return new Promise((res) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((b) => { URL.revokeObjectURL(url); res(b || file); }, 'image/jpeg', q);
    };
    img.onerror = () => res(file); img.src = url;
  });
}

const ST = {
  top: { position: 'sticky', top: 0, zIndex: 20, background: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', paddingTop: 'calc(10px + env(safe-area-inset-top))' },
  dashBtn: { background: '#1b2a3d', color: '#cdd8e4', fontSize: 14, fontWeight: 600, padding: '6px 11px', borderRadius: 8 },
  who: { color: '#9fb0c2', fontSize: 14, fontWeight: 600 },
  sechead: { fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', margin: '4px 2px 10px' },
  secheadrow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', margin: '4px 2px 10px' },
  printbtn: { background: 'rgba(224,74,84,.12)', border: '1px solid rgba(224,74,84,.4)', color: 'var(--coral)', fontSize: 12.5, fontWeight: 700, letterSpacing: '.02em', textTransform: 'none', padding: '5px 10px', borderRadius: 7 },
  propcard: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 10 },
  critpill: { background: '#fbe3e4', color: 'var(--coral-d)', fontSize: 13, fontWeight: 700, padding: '3px 8px', borderRadius: 20, display: 'inline-block' },
  propHeadWrap: { position: 'sticky', top: 46, zIndex: 15, background: 'var(--ground)', borderBottom: '1px solid var(--line)' },
  back: { fontSize: 29, color: 'var(--muted)', width: 26, lineHeight: 1 },
  tabstrip: { display: 'flex', gap: 4, padding: '2px 10px 8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  tab: { flex: 'none', padding: '7px 12px', borderRadius: 8, background: 'transparent', color: 'var(--muted)', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 },
  tabOn: { background: 'var(--navy)', color: '#fff' },
  tbadge: { background: '#33465c', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 10, padding: '0 6px', minWidth: 16, textAlign: 'center' },
  chipbar: { display: 'flex', gap: 7, padding: '8px 16px 6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  chipf: { flex: 'none', padding: '6px 12px', borderRadius: 18, background: '#fff', border: '1px solid var(--line)', color: 'var(--muted)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' },
  chipfOn: { background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' },
  card: { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 9 },
  thumb: { width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flex: 'none' },
  thumbSm: { width: 42, height: 42, borderRadius: 7, objectFit: 'cover', flex: 'none' },
  thumbEmpty: { background: '#eef2f6', color: '#b7c1cc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 },
  ratebadge: { color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: '.03em', padding: '2px 7px', borderRadius: 5 },
  ls: { fontSize: 12, fontWeight: 700, color: 'var(--coral-d)', background: '#fbe3e4', padding: '1px 6px', borderRadius: 10 },
  todo: { fontSize: 12, fontWeight: 700, color: '#fff', background: 'var(--coral)', padding: '1px 6px', borderRadius: 10 },
  actionrow: { display: 'flex', gap: 4, marginTop: 9, paddingTop: 8, borderTop: '1px solid #f0f3f6' },
  actbtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: '#4a5665', padding: '3px 2px' },
  checkbox: { width: 16, height: 16, borderRadius: 5, border: '1.5px solid #c3ccd6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12.5, flex: 'none' },
  checkbox2: { width: 20, height: 20, borderRadius: 6, border: '2px solid #c3ccd6', flex: 'none' },
  critrow: { width: '100%', display: 'flex', gap: 10, alignItems: 'center', background: '#fff', border: '1px solid var(--line)', borderRadius: 11, padding: 9, marginBottom: 8, textAlign: 'left' },
  critnum: { width: 22, height: 22, borderRadius: '50%', background: 'var(--coral)', color: '#fff', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' },
  agitem: { background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 9 },
  agnum: { width: 22, height: 22, borderRadius: '50%', background: 'var(--navy)', color: '#fff', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' },
  agx: { color: 'var(--muted2)', fontSize: 15.5, width: 24, flex: 'none' },
  fab: { position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(74px + env(safe-area-inset-bottom))', zIndex: 30, background: 'var(--coral)', color: '#fff', fontWeight: 700, fontSize: 16, padding: '11px 24px', borderRadius: 26, boxShadow: '0 6px 20px rgba(224,74,84,.4)' },
  bnav: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 25, background: '#fff', borderTop: '1px solid var(--line)', display: 'flex', padding: '6px 4px calc(6px + env(safe-area-inset-bottom))' },
  bbtn: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '3px 0' },
  bdot: { position: 'absolute', top: -2, right: -6, width: 6, height: 6, borderRadius: '50%', background: 'var(--coral)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(9,14,20,.55)', zIndex: 50, display: 'flex', alignItems: 'flex-end' },
  sheet: { background: '#fff', width: '100%', maxHeight: '92dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: '18px 18px 0 0', padding: '0 16px calc(24px + env(safe-area-inset-bottom))' },
  sheetHead: { position: 'sticky', top: 0, zIndex: 5, background: '#fff', padding: 'calc(6px + env(safe-area-inset-top)) 16px 8px', margin: '0 -16px 6px', borderBottom: '1px solid var(--line)' },
  grab: { width: 40, height: 4, background: '#d5dde5', borderRadius: 3, margin: '2px auto 8px' },
  x: { fontSize: 18, color: 'var(--muted)', width: 40, height: 40, background: '#f1f4f8', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' },
  lbl: { display: 'block', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', margin: '14px 0 7px' },
  input: { width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 12px', fontSize: 17, color: 'var(--ink)', background: '#fff' },
  chip: { flex: 1, padding: '9px 0', borderRadius: 9, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', fontWeight: 600, fontSize: 15 },
  toggle: { flex: '1 1 30%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 4px', borderRadius: 9, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' },
  dot2: { width: 9, height: 9, borderRadius: '50%', flex: 'none' },
  addPhoto: { width: 72, height: 72, borderRadius: 8, border: '2px dashed #c3ccd6', color: '#9aa6b2', fontSize: 29, background: '#fbfcfd' },
  save: { width: '100%', marginTop: 20, background: 'var(--navy)', color: '#fff', fontWeight: 700, fontSize: 17.5, padding: '14px 0', borderRadius: 12 },
  toast: { position: 'fixed', bottom: 84, left: '50%', transform: 'translateX(-50%)', background: '#0d1620', color: '#fff', fontSize: 15, padding: '10px 18px', borderRadius: 22, zIndex: 90 },
  viewerBtn: { color: '#fff', background: 'rgba(255,255,255,.14)', fontSize: 14, fontWeight: 700, padding: '7px 12px', borderRadius: 8, flex: 'none' },
};
