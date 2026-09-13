'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const RATINGS = ['High', 'Low', 'Monitor', 'Status'];
const RLABEL = { High: 'High', Low: 'Low', Monitor: 'Monitor', Status: 'Job Status', Medium: 'Low' };
const RCOLOR = { High: '#cd4428', Low: '#6b7684', Monitor: '#b7791f', Status: '#2a6bd4', Medium: '#6b7684' };
const SEV = { High: 0, Monitor: 1, Status: 2, Low: 3, Medium: 3 };
const SCOLOR = { Open: '#6b7684', 'In progress': '#2a6bd4', Complete: '#1e7d46' };
const MODAL_LAYOUT = 'A'; // 'A' = two column (bigger photos, compact map) | 'B' = three column
const CATS = ['Life Safety', 'Curb Appeal', 'Grounds', 'Building Exterior', 'Amenity', 'Unit / Interior', 'Mechanical', 'Signage', 'Office / Admin', 'Vendor / Contract', 'Other'];
const ENTRANCE = { map_x: 30, map_y: 63 };
const J = { 'content-type': 'application/json' };
const TABS = [
  { id: 'queue', label: 'Queue' },
  { id: 'critical', label: 'Critical' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'sitevisit', label: 'Site Visit' },
  { id: 'plans', label: 'Plans' },
  { id: 'archive', label: 'Archive' },
  { id: 'prewalk', label: 'Pre-Walk' },
];

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
const matchQ = (it, q) => !q || [it.title, it.category, it.notes, it.detail, it.source].some((s) => (s || '').toLowerCase().includes(q.toLowerCase()));
const openReport = (url) => { try { window.open(url, '_blank', 'noopener'); } catch { location.href = url; } };

async function uploadPhotos(itemId, files, onEach) {
  let ok = 0;
  for (const f of files) {
    try {
      const fd = new FormData(); fd.append('file', f, f.name || 'photo.jpg'); fd.append('itemId', String(itemId));
      const r = await fetch('/api/photos', { method: 'POST', body: fd });
      if (r.ok) { const j = await r.json(); ok++; if (onEach) onEach(j.url); }
    } catch {}
  }
  return ok;
}

/* ---------- mouse pinch/zoom map (mirror of the field-app Zoomable, adapted for desktop) ---------- */
function MouseZoom({ src, markers, placing, onPlace, minHeight = 260, maxHeight = 0, fit = 'aspect' }) {
  const wrap = useRef(); const drag = useRef(null); const moved = useRef(false);
  const [h, setH] = useState(minHeight);
  const [boxW, setBoxW] = useState(null);
  const [tr, setTr] = useState({ s: 1, x: 0, y: 0 });
  const contain = fit === 'contain';
  function measure(e) {
    if (contain) return;
    const el = e.target; const wrapW = wrap.current ? wrap.current.getBoundingClientRect().width : el.getBoundingClientRect().width;
    if (!el.naturalWidth) return;
    const ar = el.naturalHeight / el.naturalWidth;
    let w = wrapW, hh = wrapW * ar;
    // cap by height by NARROWING the box, so the whole map stays visible and
    // percentage pin coords keep mapping correctly
    if (maxHeight && hh > maxHeight) { hh = maxHeight; w = hh / ar; }
    setH(hh); setBoxW(w < wrapW ? Math.round(w) : null);
  }
  function clampT(nt) {
    const r = wrap.current.getBoundingClientRect();
    const minX = r.width * (1 - nt.s), minY = r.height * (1 - nt.s);
    return { s: nt.s, x: Math.min(0, Math.max(minX, nt.x)), y: Math.min(0, Math.max(minY, nt.y)) };
  }
  function onWheel(e) {
    e.preventDefault();
    const r = wrap.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let s = Math.min(6, Math.max(1, tr.s * (e.deltaY < 0 ? 1.16 : 0.86)));
    const k = s / tr.s;
    setTr(clampT({ s, x: mx - (mx - tr.x) * k, y: my - (my - tr.y) * k }));
  }
  function down(e) { drag.current = { x0: e.clientX, y0: e.clientY, t0: { ...tr } }; moved.current = false; }
  function mv(e) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x0, dy = e.clientY - drag.current.y0;
    if (Math.hypot(dx, dy) > 4) moved.current = true;
    if (tr.s > 1) setTr(clampT({ s: tr.s, x: drag.current.t0.x + dx, y: drag.current.t0.y + dy }));
  }
  function up(e) {
    const was = drag.current; drag.current = null;
    if (!was || moved.current) return;
    const r = wrap.current.getBoundingClientRect();
    if (placing && onPlace) {
      const ix = (e.clientX - r.left - tr.x) / tr.s, iy = (e.clientY - r.top - tr.y) / tr.s;
      onPlace(+(ix / r.width * 100).toFixed(1), +(iy / r.height * 100).toFixed(1));
    } else {
      const ns = tr.s > 1 ? 1 : 2.4; const mx = e.clientX - r.left, my = e.clientY - r.top; const k = ns / tr.s;
      setTr(ns === 1 ? { s: 1, x: 0, y: 0 } : clampT({ s: ns, x: mx - (mx - tr.x) * k, y: my - (my - tr.y) * k }));
    }
  }
  return (
    <div ref={wrap} onWheel={onWheel} onMouseDown={down} onMouseMove={mv} onMouseUp={up} onMouseLeave={() => { drag.current = null; }}
      style={{ width: contain ? '100%' : (boxW || '100%'), margin: boxW ? '0 auto' : undefined, height: contain ? '100%' : h, borderRadius: contain ? 0 : 10, border: contain ? 'none' : '1px solid #e2e8f0', overflow: 'hidden', position: 'relative', background: '#0a1017', cursor: placing ? 'crosshair' : (tr.s > 1 ? 'grab' : 'zoom-in'), userSelect: 'none' }}>
      <div style={{ transform: `translate(${tr.x}px,${tr.y}px) scale(${tr.s})`, transformOrigin: '0 0', width: '100%', height: contain ? '100%' : 'auto', position: 'relative', display: contain ? 'flex' : 'block', alignItems: 'center', justifyContent: 'center' }}>
        <img src={src} onLoad={measure} draggable={false} alt="" style={contain ? { maxWidth: '100%', maxHeight: '100%', width: 'auto', display: 'block' } : { width: '100%', display: 'block' }} />
        {(markers || []).map((m, i) => (
          <div key={i} style={{ position: 'absolute', left: m.x + '%', top: m.y + '%', transform: `translate(-50%,-50%) scale(${1 / tr.s})` }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: m.color || '#0e5c63', color: '#fff', border: '2px solid #fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 6px rgba(0,0,0,.45)' }}>{m.n || ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* full-screen zoomable viewer for a photo or a plan sheet */
function Markup({ src, itemId, onClose, onSaved, onToast }) {
  const wrapRef = useRef(null), cvsRef = useRef(null), imgRef = useRef(null);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#cd4428');
  const [strokes, setStrokes] = useState([]);
  const [live, setLive] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const COLORS = ['#cd4428', '#0e5c63', '#f2b705', '#ffffff', '#111111'];

  const redraw = useCallback(() => {
    const c = cvsRef.current, img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const lw = Math.max(3, c.width / 260);
    const all = live ? [...strokes, live] : strokes;
    for (const st of all) {
      ctx.strokeStyle = st.color; ctx.fillStyle = st.color;
      ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (st.type === 'pen') {
        ctx.beginPath();
        st.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      } else if (st.type === 'circle') {
        const cx = (st.a.x + st.b.x) / 2, cy = (st.a.y + st.b.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(st.b.x - st.a.x) / 2, Math.abs(st.b.y - st.a.y) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (st.type === 'arrow') {
        const { a, b } = st, ang = Math.atan2(b.y - a.y, b.x - a.x), head = lw * 5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 7), b.y - head * Math.sin(ang - Math.PI / 7));
        ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 7), b.y - head * Math.sin(ang + Math.PI / 7));
        ctx.closePath(); ctx.fill();
      }
    }
  }, [strokes, live]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      const c = cvsRef.current; if (!c) return;
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      setReady(true);
    };
    img.src = src;
  }, [src]);
  useEffect(() => { if (ready) redraw(); }, [ready, redraw]);

  const pos = (e) => {
    const c = cvsRef.current, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const down = (e) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pos(e);
    setLive(tool === 'pen' ? { type: 'pen', color, pts: [p] } : { type: tool, color, a: p, b: p });
  };
  const move = (e) => {
    if (!live) return;
    const p = pos(e);
    setLive((s) => (s.type === 'pen' ? { ...s, pts: [...s.pts, p] } : { ...s, b: p }));
  };
  const up = () => { if (live) { setStrokes((s) => [...s, live]); setLive(null); } };

  async function saveMarkup() {
    const c = cvsRef.current; if (!c || !strokes.length) return;
    setBusy(true);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) { setBusy(false); onToast('Could not render the markup'); return; }
    const fd = new FormData();
    fd.append('file', new File([blob], 'markup.jpg', { type: 'image/jpeg' }));
    fd.append('itemId', String(itemId));
    const r = await fetch('/api/photos', { method: 'POST', body: fd });
    setBusy(false);
    if (!r.ok) { onToast('Could not save the marked-up photo'); return; }
    onToast('Marked-up photo saved to the issue');
    onSaved();
  }

  const tbtn = (id, label) => (
    <button key={id} onClick={() => setTool(id)} style={{ ...D.mkTool, ...(tool === id ? D.mkToolOn : {}) }}>{label}</button>
  );
  return (
    <div style={D.mkWrap}>
      <div style={D.mkBar}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {tbtn('pen', '✎ Pen')}{tbtn('arrow', '↗ Arrow')}{tbtn('circle', '◯ Circle')}
          <span style={{ width: 1, height: 22, background: '#33414f', margin: '0 4px' }} />
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: color === c ? '3px solid #fff' : '1px solid #55606c' }} />
          ))}
          <span style={{ width: 1, height: 22, background: '#33414f', margin: '0 4px' }} />
          <button style={D.mkTool} onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length}>↶ Undo</button>
          <button style={D.mkTool} onClick={() => setStrokes([])} disabled={!strokes.length}>Clear</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={D.mkCancel} onClick={onClose}>Cancel</button>
          <button style={D.mkSave} onClick={saveMarkup} disabled={!strokes.length || busy}>{busy ? 'Saving…' : 'Save as new photo'}</button>
        </div>
      </div>
      <div ref={wrapRef} style={D.mkStage}>
        <canvas ref={cvsRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
          style={{ height: '100%', width: 'auto', maxWidth: '100%', cursor: 'crosshair', touchAction: 'none', borderRadius: 8, background: '#000' }} />
      </div>
      <div style={{ textAlign: 'center', color: '#8b96a3', fontSize: 13, padding: '8px 0 14px' }}>
        Click and drag on the photo to mark it. The original photo is kept — this saves as an additional photo on the issue.
      </div>
    </div>
  );
}

function Lightbox({ srcs, start = 0, labels, onClose, onPrint }) {
  const [i, setI] = useState(start);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI((v) => Math.min(srcs.length - 1, v + 1)); if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1)); };
    window.addEventListener('keydown', k);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', k); };
  }, [srcs.length, onClose]);
  const many = srcs.length > 1;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,15,.94)', zIndex: 90, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', color: '#fff', flex: 'none' }}>
        <div style={{ fontWeight: 700, fontSize: 15.5, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{labels?.[i] || ''}{many ? `   ·   ${i + 1} / ${srcs.length}` : ''}</div>
        {onPrint && <button style={Z.viewerBtn} onClick={() => onPrint(i)}>📄 Save / Print</button>}
        <button style={Z.viewerBtn} onClick={onClose}>✕ Close</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 18px 10px' }}>
        <div style={{ width: '100%', height: '100%' }}><MouseZoom key={i} src={srcs[i]} fit="contain" /></div>
        {many && i > 0 && <button style={{ ...Z.navBtn, left: 24 }} onClick={() => setI(i - 1)}>‹</button>}
        {many && i < srcs.length - 1 && <button style={{ ...Z.navBtn, right: 24 }} onClick={() => setI(i + 1)}>›</button>}
      </div>
      <div style={{ textAlign: 'center', color: '#7f8da3', fontSize: 13, padding: '0 0 14px', flex: 'none' }}>Scroll to zoom · drag to move · click to zoom · Esc to close{many ? ' · ← → to page' : ''}</div>
    </div>
  );
}

export default function Dashboard({ user }) {
  const router = useRouter();
  const [props, setProps] = useState(null);
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState('portfolio'); // portfolio | property | all
  const [pid, setPid] = useState(null);
  const [tab, setTab] = useState('queue');
  const [editItem, setEditItem] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { srcs, start, labels?, onPrint? }
  const [seeding, setSeeding] = useState(false);
  const [importMsg, setImportMsg] = useState('Import plans');
  const [photoMsg, setPhotoMsg] = useState('Import photos');
  const [toast, setToast] = useState('');
  const [svReports, setSvReports] = useState([]);
  const [svActiveId, setSvActiveId] = useState(null);
  const [svItems, setSvItems] = useState([]);
  const [svBusy, setSvBusy] = useState(false);
  const [markup, setMarkup] = useState(null); // { src, itemId }
  const planRef = useRef();
  const histRef = useRef();

  const show = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 2200); }, []);
  const load = useCallback(async () => {
    setErr(null);
    const [pr, ir] = await Promise.all([fetch('/api/properties'), fetch('/api/items')]);
    if (pr.status === 503 || ir.status === 503) { setErr('backend'); return; }
    const pj = await pr.json(); const ij = await ir.json();
    setProps(pj.properties || []); setItems(ij.items || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const prop = props?.find((p) => p.id === pid);
  const propItems = useMemo(() => (items || []).filter((i) => i.property_id === pid), [items, pid]);

  const loadReportMembers = useCallback(async (rid) => {
    if (!rid) { setSvItems([]); return; }
    try { const j = await (await fetch('/api/site-reports/' + rid)).json(); setSvItems((j.items || []).map((i) => i.id)); }
    catch { setSvItems([]); }
  }, []);
  const loadReports = useCallback(async (id) => {
    if (!id) return;
    try {
      const j = await (await fetch('/api/site-reports?property=' + id)).json();
      const reps = j.reports || [];
      setSvReports(reps);
      const draft = reps.find((x) => x.status === 'draft');
      setSvActiveId(draft ? draft.id : null);
      await loadReportMembers(draft ? draft.id : null);
    } catch { setSvReports([]); setSvActiveId(null); setSvItems([]); }
  }, [loadReportMembers]);

  const newSiteVisit = useCallback(async () => {
    const r = await fetch('/api/site-reports', { method: 'POST', headers: J, body: JSON.stringify({ property_id: pid }) });
    if (!r.ok) { show('Could not start report'); return null; }
    const j = await r.json();
    setSvReports((p) => [j.report, ...p]); setSvActiveId(j.report.id); setSvItems([]);
    show('New Site Visit report started');
    return j.report.id;
  }, [pid, show]);

  const toggleSiteVisit = useCallback(async (item) => {
    let rid = svActiveId;
    if (!rid) { rid = await newSiteVisit(); if (!rid) return; }
    const inIt = svItems.includes(item.id);
    if (inIt) {
      setSvItems((p) => p.filter((x) => x !== item.id));
      await fetch(`/api/site-reports/${rid}/items?item=${item.id}`, { method: 'DELETE' });
      show('Removed from Site Visit');
    } else {
      setSvItems((p) => [...p, item.id]);
      await fetch(`/api/site-reports/${rid}/items`, { method: 'POST', headers: J, body: JSON.stringify({ item_id: item.id }) });
      show('Added to Site Visit');
    }
    setSvReports((p) => p.map((r) => (r.id === rid ? { ...r, item_count: (r.item_count || 0) + (inIt ? -1 : 1) } : r)));
  }, [svActiveId, svItems, newSiteVisit, show]);

  const saveSiteVisit = useCallback(async (rid) => {
    setSvBusy(true);
    const r = await fetch(`/api/site-reports/${rid}/save`, { method: 'POST' });
    setSvBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); show(j.error || 'Save failed'); return; }
    show('Site Visit report saved');
    await loadReports(pid); load();
  }, [pid, show, loadReports, load]);

  function openProp(id) { setPid(id); setTab('queue'); setView('property'); loadReports(id); }
  function openPhotos(srcs, start = 0, labels, onPrint) { setLightbox({ srcs, start, labels, onPrint }); }

  const patch = useCallback(async (id, body, msg) => {
    setItems((its) => its.map((i) => (i.id === id ? { ...i, ...body } : i)));
    const r = await fetch('/api/items/' + id, { method: 'PATCH', headers: J, body: JSON.stringify(body) });
    if (r.ok) { const j = await r.json(); setItems((its) => its.map((i) => (i.id === id ? j.item : i))); load(); if (msg) show(msg); }
  }, [load, show]);

  async function importPlans(e) {
    const files = [...(e.target.files || [])].sort((a, b) => a.name.localeCompare(b.name));
    e.target.value = '';
    if (!files.length) return;
    const rx = /^(sitemap|floor)_([a-z]+)(?:_(\d+))?\.jpe?g$/i;
    let ok = 0, skip = 0;
    for (let k = 0; k < files.length; k++) {
      const f = files[k]; const m = f.name.match(rx);
      if (!m) { skip++; continue; }
      const kind = m[1].toLowerCase() === 'sitemap' ? 'sitemap' : 'floor';
      const pidv = m[2].toLowerCase(); const idx = kind === 'floor' ? Number(m[3] || 0) : 0;
      setImportMsg(`Uploading ${k + 1}/${files.length}…`);
      const fd = new FormData();
      fd.append('file', f, f.name); fd.append('kind', kind); fd.append('property_id', pidv); fd.append('idx', String(idx));
      const r = await fetch('/api/admin/asset', { method: 'POST', body: fd });
      if (r.ok) ok++; else skip++;
    }
    setImportMsg('Import plans');
    show(`Imported ${ok} plan image(s)` + (skip ? `, skipped ${skip}` : ''));
    load();
  }
  async function importPhotos(e) {
    const files = [...(e.target.files || [])].sort((a, b) => a.name.localeCompare(b.name));
    e.target.value = '';
    if (!files.length) return;
    const rx = /^p_([a-z0-9]+)_(\d+)\.jpe?g$/i;
    let ok = 0, skip = 0, miss = 0;
    for (let k = 0; k < files.length; k++) {
      const f = files[k]; const m = f.name.match(rx);
      if (!m) { skip++; continue; }
      const ref = `walk:${m[1].toLowerCase()}:${m[2]}`;
      setPhotoMsg(`Uploading ${k + 1}/${files.length}…`);
      const fd = new FormData();
      fd.append('file', f, f.name); fd.append('ref', ref);
      const r = await fetch('/api/admin/photo-by-ref', { method: 'POST', body: fd });
      if (r.ok) ok++; else if (r.status === 404) miss++; else skip++;
    }
    setPhotoMsg('Import photos');
    show(`Attached ${ok} photo(s)` + (miss ? `, ${miss} unmatched` : '') + (skip ? `, skipped ${skip}` : ''));
    load();
  }
  async function seed() {
    setSeeding(true);
    const r = await fetch('/api/seed', { method: 'POST' });
    setSeeding(false);
    if (r.ok) load(); else { const j = await r.json().catch(() => ({})); alert(j.error || 'Seed failed'); }
  }
  async function logout() { await fetch('/api/logout', { method: 'POST' }); router.replace('/login'); router.refresh(); }

  if (err === 'backend') return <Setup onSeed={seed} seeding={seeding} onRetry={load} />;
  if (!props || !items) return <div className="center"><div className="spin" /></div>;

  const isAdmin = user.role === 'admin';

  return (
    <div style={{ minHeight: '100vh', background: '#eef2f6' }}>
      <div style={D.top}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer' }} onClick={() => setView('portfolio')}>
          <div className="ring on-dark" style={{ width: 28, height: 28 }} />
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 20 }}>SiteVisit <span style={{ color: '#4bb0bc' }}>IQ</span> <span style={{ color: '#8fa0b4', fontWeight: 500, fontSize: 16 }}>· Dashboard</span></div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button style={D.newbtn} onClick={() => setNewOpen(true)}>+ New issue</button>
          {isAdmin && <button style={D.ghost} onClick={() => planRef.current?.click()}>{importMsg}</button>}
          {isAdmin && <button style={D.ghost} onClick={() => histRef.current?.click()}>{photoMsg}</button>}
          {isAdmin && <button style={D.ghost} onClick={() => setUsersOpen(true)}>Users &amp; passcodes</button>}
          <input ref={planRef} type="file" accept="image/*" multiple hidden onChange={importPlans} />
          <input ref={histRef} type="file" accept="image/*" multiple hidden onChange={importPhotos} />
          <button style={D.ghost} onClick={() => router.push('/')}>Field app</button>
          <button style={D.who} onClick={logout}>{user.name.split(' ')[0]} ⏻</button>
        </div>
      </div>

      <div style={D.wrap}>
        {view === 'portfolio' && <Portfolio props={props} items={items} onOpen={openProp} onAll={() => setView('all')} />}
        {view === 'all' && <AllIssues props={props} items={items} onBack={() => setView('portfolio')} onOpen={setEditItem} patch={patch} onPhoto={openPhotos} />}
        {view === 'property' && prop && (
          <div>
            <PropNav prop={prop} tab={tab} setTab={setTab} items={propItems} onBack={() => setView('portfolio')} />
            <div style={{ marginTop: 16 }}>
              {tab === 'queue' && <Queue items={propItems} onOpen={setEditItem} patch={patch} onNew={() => setNewOpen(true)} onPhoto={openPhotos} onSiteVisit={toggleSiteVisit} svIds={svItems} />}
              {tab === 'critical' && <Critical prop={prop} items={propItems} onOpen={setEditItem} onPhoto={openPhotos} />}
              {tab === 'agenda' && <Agenda prop={prop} items={propItems} onOpen={setEditItem} patch={patch} onPhoto={openPhotos} />}
              {tab === 'sitevisit' && (
                <SiteVisit prop={prop} items={propItems} reports={svReports} activeId={svActiveId} memberIds={svItems} busy={svBusy}
                  onNew={newSiteVisit} onSetActive={(id) => { setSvActiveId(id); loadReportMembers(id); }}
                  onRemove={(itemId) => toggleSiteVisit({ id: itemId })} onSave={saveSiteVisit}
                  onPreview={(rid) => openReport('/api/report?type=sitevisit&report=' + rid)}
                  onOpenSaved={(url) => openReport(url)} onOpen={setEditItem} onPhoto={openPhotos} show={show} />
              )}
              {tab === 'plans' && <Plans prop={prop} onPhoto={openPhotos} />}
              {tab === 'archive' && <Archive items={propItems} onOpen={setEditItem} patch={patch} onPhoto={openPhotos} reports={svReports} onOpenSaved={(url) => openReport(url)} />}
              {tab === 'prewalk' && <PreWalk prop={prop} items={propItems} />}
            </div>
          </div>
        )}
      </div>

      {editItem && <ItemModal item={editItem} prop={props.find((p) => p.id === editItem.property_id)} pname={props.find((p) => p.id === editItem.property_id)?.name || editItem.property_id} onClose={() => setEditItem(null)} onSaved={load} onPhoto={openPhotos} onToast={show} onSiteVisit={toggleSiteVisit} inSv={svItems.includes(editItem.id)} onMarkup={(src) => setMarkup({ src, itemId: editItem.id })} />}
      {newOpen && <NewIssueModal props={props} defaultPid={view === 'property' ? pid : null} onClose={() => setNewOpen(false)} onDone={() => { setNewOpen(false); load(); show('Issue added'); }} onPhoto={openPhotos} />}
      {usersOpen && <UsersModal onClose={() => setUsersOpen(false)} />}
      {lightbox && <Lightbox srcs={lightbox.srcs} start={lightbox.start} labels={lightbox.labels} onClose={() => setLightbox(null)} onPrint={lightbox.onPrint} />}
      {markup && <Markup src={markup.src} itemId={markup.itemId} onClose={() => setMarkup(null)} onToast={show} onSaved={() => { setMarkup(null); load(); }} />}
      {toast && <div style={D.toast}>{toast}</div>}
    </div>
  );
}

/* ---------------- Portfolio landing ---------------- */
function Portfolio({ props, items, onOpen, onAll }) {
  const live = items.filter((i) => !i.archived);
  const openN = live.filter((i) => i.status !== 'Complete').length;
  const critN = live.filter((i) => (i.priority === 'High' || i.life_safety) && i.status !== 'Complete').length;
  const todoN = live.filter((i) => i.send_todo).length;
  const cnt = (p) => {
    const a = items.filter((i) => i.property_id === p.id && !i.archived);
    return { open: a.filter((i) => i.status !== 'Complete').length, crit: a.filter((i) => (i.priority === 'High' || i.life_safety) && i.status !== 'Complete').length };
  };
  return (
    <div>
      <div style={D.statsRow}>
        <Stat n={openN} label="Open items" />
        <Stat n={critN} label="Critical" color="#cd4428" />
        <Stat n={todoN} label="On manager to-do" color="#0e5c63" />
        <Stat n={items.length} label="Total logged" color="#6b7684" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 2px 12px' }}>
        <div style={D.h2}>Portfolio</div>
        <button style={D.linkbtn} onClick={onAll}>View all issues across portfolio ▸</button>
      </div>
      <div style={D.cardGrid}>
        {props.map((p) => {
          const c = cnt(p);
          return (
            <button key={p.id} style={D.propcard} onClick={() => onOpen(p.id)}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{p.name}</div>
              <div style={{ color: '#8b96a3', fontSize: 13.5, marginTop: 3 }}>{p.address}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {c.crit > 0 && <span style={D.critpill}>{c.crit} critical</span>}
                <span style={D.openpill}>{c.open} open</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Property nav + tabs ---------------- */
function PropNav({ prop, tab, setTab, items, onBack }) {
  const live = items.filter((i) => !i.archived);
  const badge = {
    queue: live.filter((i) => i.status !== 'Complete').length,
    critical: live.filter((i) => (i.priority === 'High' || i.life_safety) && i.status !== 'Complete').length,
    agenda: live.filter((i) => i.on_agenda).length,
    archive: items.filter((i) => i.archived).length,
  };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <button style={D.backlink} onClick={onBack}>‹ All properties</button>
        <div style={{ fontWeight: 800, fontSize: 24 }}>{prop.name}</div>
        <div style={{ color: '#8b96a3', fontSize: 14 }}>{prop.address}</div>
      </div>
      <div style={D.tabstrip}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ ...D.tab, ...(tab === t.id ? D.tabOn : {}) }}>
            {t.label}{badge[t.id] ? <span style={{ ...D.tbadge, ...(t.id === 'critical' ? { background: '#cd4428' } : {}) }}>{badge[t.id]}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Queue (card grid) ---------------- */
function Queue({ items, onOpen, patch, onNew, onPhoto, onSiteVisit, svIds }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState({ open: true });
  const chips = [['ls', 'Life safety'], ['High', 'High'], ['Low', 'Low'], ['Monitor', 'Monitor'], ['Status', 'Job Status'], ['todo', 'On to-do']];
  const toggle = (k) => setF((s) => ({ ...s, [k]: !s[k] }));
  let list = items.filter((i) => !i.archived && matchQ(i, q));
  if (f.open) list = list.filter((i) => i.status !== 'Complete');
  if (f.ls) list = list.filter((i) => i.life_safety);
  if (f.todo) list = list.filter((i) => i.send_todo);
  const rs = RATINGS.filter((r) => f[r]);
  if (rs.length) list = list.filter((i) => rs.includes(i.priority));
  list = [...list].sort((a, b) => (SEV[a.priority] ?? 3) - (SEV[b.priority] ?? 3) || new Date(b.walk_date || b.created_at) - new Date(a.walk_date || a.created_at));
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={D.search}>
          <span style={{ color: '#95a1b0' }}>🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" style={{ border: 'none', outline: 'none', flex: 1, fontSize: 15, background: 'transparent' }} />
        </div>
        {chips.map(([k, lbl]) => <button key={k} onClick={() => toggle(k)} style={{ ...D.chip, ...(f[k] ? D.chipOn : {}) }}>{lbl}</button>)}
        <button style={{ ...D.filt, marginLeft: 'auto' }} onClick={() => setF({})}>Clear</button>
        <button style={D.newbtn2} onClick={onNew}>+ New issue</button>
      </div>
      <div style={{ color: '#6b7684', fontSize: 13.5, margin: '0 2px 10px' }}>{list.length} of {items.filter((i) => !i.archived).length} · by severity</div>
      {list.length === 0 ? <Empty /> : (
        <div style={D.issueGrid}>
          {list.map((it) => <IssueCard key={it.id} it={it} onOpen={onOpen} patch={patch} onPhoto={onPhoto} onSiteVisit={onSiteVisit} inSv={(svIds || []).includes(it.id)} />)}
        </div>
      )}
    </div>
  );
}

function IssueCard({ it, onOpen, patch, onPhoto, onSiteVisit, inSv }) {
  // same set and order as the field app so the two read identically
  const acts = [
    ['Agenda', it.on_agenda, () => patch(it.id, { on_agenda: !it.on_agenda }, it.on_agenda ? '' : 'Added to agenda')],
    ...(onSiteVisit ? [['Site Visit', !!inSv, () => onSiteVisit(it)]] : []),
    ['Complete', it.status === 'Complete', () => patch(it.id, { status: it.status === 'Complete' ? 'Open' : 'Complete' })],
    ['Archive', it.archived, () => patch(it.id, { archived: !it.archived }, 'Archived')],
  ];
  return (
    <div style={D.card}>
      <div style={{ display: 'flex', gap: 12, cursor: 'pointer' }} onClick={() => onOpen(it)}>
        {it.photos?.[0]
          ? <img src={it.photos[0]} alt="" style={D.cardThumb} onClick={(e) => { e.stopPropagation(); onPhoto(it.photos, 0, it.photos.map(() => it.title)); }} />
          : <div style={{ ...D.cardThumb, ...D.thumbEmpty }}>—</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...D.ratebadge, background: RCOLOR[it.priority] || '#6b7684' }}>{(RLABEL[it.priority] || it.priority || '').toUpperCase()}</span>
            {it.life_safety && <span style={D.ls}>Life safety</span>}
            {it.send_todo && <span style={D.todo}>To-do</span>}
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, margin: '4px 0 3px' }}>{it.title}</div>
          <div style={{ color: '#8b96a3', fontSize: 13 }}>{it.category ? it.category + ' · ' : ''}{it.walker_name || '—'}{it.walk_date ? ' · ' + String(it.walk_date).slice(0, 10) : ''}</div>
          {(it.detail || it.notes) && <div style={{ color: '#4a5665', fontSize: 13.5, marginTop: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.detail || it.notes}</div>}
        </div>
      </div>
      <div style={D.actionrow}>
        {acts.map(([lbl, on, fn]) => (
          <button key={lbl} onClick={fn} style={D.actbtn}>
            <span style={{ ...D.checkbox, ...(on ? { background: '#0e5c63', borderColor: '#0e5c63' } : {}) }}>{on ? '✓' : ''}</span>{lbl}
          </button>
        ))}
        <button onClick={() => onOpen(it)} style={{ ...D.actbtn, color: '#2a6bd4', fontWeight: 700 }}>Open ▸</button>
      </div>
    </div>
  );
}

/* ---------------- Critical ---------------- */
function Critical({ prop, items, onOpen, onPhoto }) {
  const crit = items.filter((i) => !i.archived && i.status !== 'Complete' && (i.priority === 'High' || i.life_safety)).sort((a, b) => (SEV[a.priority] ?? 3) - (SEV[b.priority] ?? 3));
  const marks = crit.filter((i) => i.map_x != null).map((it) => ({ x: it.map_x, y: it.map_y, n: crit.indexOf(it) + 1 }));
  return (
    <div style={D.split}>
      <div style={D.splitMap}>
        <SecHead>Critical map<PrintBtn onClick={() => openReport('/api/report?type=critical&property=' + encodeURIComponent(prop.id))} disabled={!crit.length} /></SecHead>
        {prop.site_map_url
          ? <MouseZoom src={prop.site_map_url} markers={marks} />
          : <div style={D.emptyBox}>No site map — pin items in an issue to place them here.</div>}
      </div>
      <div style={D.splitList}>
        <div style={D.h3}>Critical &amp; high-priority · {crit.length}</div>
        {crit.length === 0 ? <div style={D.muted}>Nothing critical open.</div> :
          crit.map((it, i) => (
            <button key={it.id} style={D.listrow} onClick={() => onOpen(it)}>
              <span style={D.critnum}>{i + 1}</span>
              {it.photos?.[0] ? <img src={it.photos[0]} alt="" style={D.rowThumb} onClick={(e) => { e.stopPropagation(); onPhoto(it.photos, 0, it.photos.map(() => it.title)); }} /> : <div style={{ ...D.rowThumb, ...D.thumbEmpty }}>—</div>}
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ ...D.ratebadge, background: RCOLOR[it.priority] || '#6b7684' }}>{(RLABEL[it.priority] || it.priority || '').toUpperCase()}</span>
                  {it.life_safety && <span style={D.ls}>Life safety</span>}
                </div>
                <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 3 }}>{it.title}</div>
                <div style={{ color: '#8b96a3', fontSize: 13 }}>{it.category || ''}{it.source ? ' · ' + it.source : ''}</div>
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}

/* ---------------- Agenda ---------------- */
function Agenda({ prop, items, onOpen, patch, onPhoto }) {
  const ag = items.filter((i) => i.on_agenda && !i.archived);
  const tour = tourOrder(ag);
  const marks = tour.filter((i) => i.map_x != null).map((it) => ({ x: it.map_x, y: it.map_y, n: tour.indexOf(it) + 1, color: '#0d1620' }));
  if (!ag.length) return (
    <div style={{ ...D.emptyBox, textAlign: 'center', padding: '46px 24px' }}>
      <div style={{ fontSize: 17, marginBottom: 6, color: '#4a5665' }}>No agenda items yet.</div>
      <div style={{ fontSize: 14 }}>On the Queue, tap <b>Agenda</b> on any item to add it here for the walk.</div>
    </div>
  );
  return (
    <div style={D.split}>
      <div style={D.splitMap}>
        <SecHead>Agenda map · walking order<PrintBtn onClick={() => openReport('/api/report?type=agenda&property=' + encodeURIComponent(prop.id))} /></SecHead>
        {prop.site_map_url ? <MouseZoom src={prop.site_map_url} markers={marks} /> : <div style={D.emptyBox}>No site map — pin items to see the route.</div>}
      </div>
      <div style={D.splitList}>
        <div style={D.h3}>Stops in order · {tour.length}</div>
        {tour.map((it, i) => (
          <div key={it.id} style={D.agitem}>
            <span style={D.agnum}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(it)}>
              <div style={{ fontWeight: 700, fontSize: 15.5 }}>{it.title}</div>
              {(it.detail || it.notes) && <div style={{ color: '#4a5665', fontSize: 13.5, marginTop: 3 }}>{it.detail || it.notes}</div>}
              <div style={{ color: '#8b96a3', fontSize: 12.5, marginTop: 4 }}>
                <span style={{ color: RCOLOR[it.priority], fontWeight: 700 }}>{RLABEL[it.priority] || it.priority}</span>
                {it.category ? ' · ' + it.category : ''}{it.map_x == null ? ' · not on map' : ''}
              </div>
            </div>
            <button style={D.rowx} onClick={() => patch(it.id, { on_agenda: false }, 'Removed from agenda')}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Site Visit (desktop) ---------------- */
function SiteVisit({ prop, items, reports, activeId, memberIds, busy, onNew, onSetActive, onRemove, onSave, onPreview, onOpenSaved, onOpen, onPhoto, show }) {
  const [sel, setSel] = useState([]);
  const [dl, setDl] = useState(false);
  const all = items || [];
  const list = reports || [];
  const draft = list.find((r) => r.id === activeId && r.status === 'draft');
  const otherDrafts = list.filter((r) => r.status === 'draft' && r.id !== activeId);
  const saved = list.filter((r) => r.status === 'saved');
  const included = all.filter((i) => (memberIds || []).includes(i.id));
  const marks = included
    .map((it, i) => ({ it, n: i + 1 }))
    .filter((m) => m.it.map_x != null && m.it.map_y != null)
    .map((m) => ({ x: m.it.map_x, y: m.it.map_y, n: m.n, color: '#0e5c63' }));
  const withPhotos = included.filter((i) => i.photos && i.photos.length);
  const picked = withPhotos.filter((i) => sel.includes(i.id));
  const photoCount = picked.reduce((n, i) => n + i.photos.length, 0);
  const allSel = withPhotos.length > 0 && picked.length === withPhotos.length;

  async function download() {
    if (!picked.length) return;
    setDl(true);
    try {
      const r = await fetch('/api/photos/download', { method: 'POST', headers: J, body: JSON.stringify({ item_ids: picked.map((i) => i.id) }) });
      if (!r.ok) throw new Error('bad');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = String(prop?.name || 'photos').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') + '_photos.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (show) show(photoCount + ' photo' + (photoCount === 1 ? '' : 's') + ' downloaded');
    } catch { if (show) show('Photo download failed'); }
    setDl(false);
  }

  const tail = (
    <div style={{ marginTop: 26 }}>
      {otherDrafts.length > 0 && (
        <>
          <div style={D.h3}>Other drafts</div>
          {otherDrafts.map((d) => (
            <button key={d.id} style={D.listrow} onClick={() => onSetActive(d.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{d.name}</div>
                <div style={{ color: '#8b96a3', fontSize: 13 }}>{d.walker_name} · {String(d.walk_date).slice(0, 10)} · {d.item_count} issue{d.item_count === 1 ? '' : 's'}</div>
              </div>
              <span style={{ color: '#0e5c63', fontWeight: 700, fontSize: 13.5 }}>Make active →</span>
            </button>
          ))}
          <div style={{ height: 18 }} />
        </>
      )}
      <div style={D.h3}>Saved reports · {saved.length}</div>
      {!saved.length ? <div style={D.emptyBox}>No saved reports yet. Save a report and it lands here and in Archive.</div>
        : saved.map((r) => (
          <div key={r.id} style={{ ...D.listrow, cursor: 'default', opacity: r.pdf_url ? 1 : 0.55 }}>
            <span style={{ fontSize: 19 }}>📄</span>
            <div style={{ flex: 1, minWidth: 0, cursor: r.pdf_url ? 'pointer' : 'default' }} onClick={() => r.pdf_url && onOpenSaved(r.pdf_url)}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</div>
              <div style={{ color: '#8b96a3', fontSize: 13 }}>{r.walker_name} · {String(r.walk_date).slice(0, 10)} · {r.item_count} issue{r.item_count === 1 ? '' : 's'}</div>
            </div>
            {r.pdf_url && <ShareBtns url={r.pdf_url} name={r.name} prop={draft?.property_name || prop?.name} show={show} />}
            {r.pdf_url && <button style={{ color: '#0e5c63', fontWeight: 700, fontSize: 13.5, background: 'none' }} onClick={() => onOpenSaved(r.pdf_url)}>Open PDF</button>}
          </div>
        ))}
    </div>
  );

  if (!draft) return (
    <div>
      <div style={{ ...D.emptyBox, textAlign: 'center', padding: '42px 24px' }}>
        <div style={{ fontSize: 17, color: '#4a5665', marginBottom: 6 }}>No Site Visit report in progress.</div>
        <div style={{ fontSize: 14, marginBottom: 16 }}>Start one, then add issues from the Queue or from inside any issue.</div>
        <button style={D.newbtn2} onClick={onNew}>＋ New Site Visit Report</button>
      </div>
      {tail}
    </div>
  );

  return (
    <div>
      <div style={{ ...D.card, marginBottom: 18, display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 260 }}>
          <div style={{ fontWeight: 800, fontSize: 19, color: '#0d1620' }}>{draft.name}</div>
          <div style={{ color: '#4a5665', fontSize: 14, marginTop: 4 }}>
            {draft.property_name || prop?.name}{(draft.property_address || prop?.address) ? ' · ' + (draft.property_address || prop.address) : ''}
          </div>
          <div style={{ color: '#8b96a3', fontSize: 13.5, marginTop: 2 }}>
            {String(draft.walk_date).slice(0, 10)} · Walked by {draft.walker_name} · {included.length} issue{included.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <button style={{ ...D.printbtn, opacity: included.length ? 1 : 0.4, pointerEvents: included.length ? 'auto' : 'none' }} onClick={() => onPreview(draft.id)}>📄 Preview</button>
          <button style={{ ...D.newbtn, opacity: included.length && !busy ? 1 : 0.5, pointerEvents: included.length && !busy ? 'auto' : 'none' }} onClick={() => onSave(draft.id)}>{busy ? 'Saving…' : 'Save report'}</button>
          <button style={D.ghostDark} onClick={onNew}>＋ New</button>
        </div>
      </div>

      <div style={D.split}>
        <div style={D.splitMap}>
          <SecHead>Site map · issue locations</SecHead>
          {prop?.site_map_url
            ? <MouseZoom src={prop.site_map_url} markers={marks} maxHeight={520} />
            : <div style={D.emptyBox}>No site map loaded for this property.</div>}
          {included.length > marks.length && (
            <div style={{ color: '#8b96a3', fontSize: 13, marginTop: 8 }}>
              {included.length - marks.length} issue{included.length - marks.length === 1 ? '' : 's'} not pinned yet — open an issue and click the map to place it.
            </div>
          )}
        </div>

        <div style={D.splitList}>
          <div style={D.secheadrow}>
            <span>On this walk · {included.length}</span>
            {withPhotos.length > 0 && (
              <button style={D.linkbtn2} onClick={() => setSel(allSel ? [] : withPhotos.map((i) => i.id))}>
                {allSel ? 'Clear photo selection' : 'Select all photos'}
              </button>
            )}
          </div>

          {!included.length ? (
            <div style={D.emptyBox}>Nothing added yet. On the Queue, click <b>Site Visit</b> on any issue — or open an issue and use <b>Add to Site Visit</b>.</div>
          ) : included.map((it, i) => {
            const has = !!(it.photos && it.photos.length);
            const on = sel.includes(it.id);
            return (
              <div key={it.id} style={D.agitem}>
                <span style={{ ...D.agnum, background: '#0e5c63' }}>{i + 1}</span>
                {has
                  ? <img src={it.photos[0]} alt="" style={D.rowThumb} onClick={() => onPhoto(it.photos, 0, it.photos.map((_, k) => it.title + ' · ' + (k + 1)))} />
                  : <div style={{ ...D.rowThumb, ...D.thumbEmpty, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>—</div>}
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(it)}>
                  <div style={{ fontWeight: 700, fontSize: 15.5 }}>{it.title}</div>
                  {(it.notes || it.detail) && <div style={{ color: '#4a5665', fontSize: 13.5, marginTop: 3 }}>{it.notes || it.detail}</div>}
                  <div style={{ color: '#8b96a3', fontSize: 12.5, marginTop: 4 }}>
                    <span style={{ color: RCOLOR[it.priority], fontWeight: 700 }}>{RLABEL[it.priority] || it.priority}</span>
                    {it.life_safety ? ' · Life safety' : ''}{it.category ? ' · ' + it.category : ''}
                    {has ? ' · ' + it.photos.length + ' photo' + (it.photos.length === 1 ? '' : 's') : ' · no photos'}
                    {it.map_x == null ? ' · not on map' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  {has && (
                    <button title="Include these photos in the download" onClick={() => setSel((s) => (s.includes(it.id) ? s.filter((x) => x !== it.id) : [...s, it.id]))}
                      style={{ ...D.checkbox, background: on ? '#0e5c63' : '#fff', borderColor: on ? '#0e5c63' : '#c3ccd6' }}>{on ? '✓' : ''}</button>
                  )}
                  <button style={D.rowx} title="Remove from report" onClick={() => onRemove(it.id)}>✕</button>
                </div>
              </div>
            );
          })}

          {withPhotos.length > 0 && (
            <div style={{ ...D.card, marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 180px', color: '#4a5665', fontSize: 14 }}>
                {picked.length
                  ? <><b>{photoCount}</b> photo{photoCount === 1 ? '' : 's'} from {picked.length} issue{picked.length === 1 ? '' : 's'} selected</>
                  : <>Tick the boxes to pick photos to save or email.</>}
              </div>
              <button style={{ ...D.newbtn2, opacity: picked.length && !dl ? 1 : 0.45, pointerEvents: picked.length && !dl ? 'auto' : 'none' }} onClick={download}>
                {dl ? 'Preparing…' : '⬇ Download photos (.zip)'}
              </button>
            </div>
          )}
        </div>
      </div>
      {tail}
    </div>
  );
}


/* Share a saved report by link instead of attaching a 20MB PDF to an email. */
function ShareBtns({ url, name, prop, show }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    setCopied(true); if (show) show('Link copied — paste it into an email');
    setTimeout(() => setCopied(false), 2200);
  }
  const subject = encodeURIComponent(`${prop ? prop + ' — ' : ''}${name}`);
  const body = encodeURIComponent(`${name}\n\nView the site visit report:\n${url}\n`);
  return (
    <>
      <button title="Copy a shareable link to this report" onClick={copy}
        style={{ color: copied ? '#1e7d46' : '#4a5665', fontWeight: 600, fontSize: 13, background: '#eef2f6', borderRadius: 7, padding: '5px 10px' }}>
        {copied ? '✓ Copied' : '🔗 Copy link'}
      </button>
      <a href={`mailto:?subject=${subject}&body=${body}`}
        title="Open an email with the link already in it"
        style={{ textDecoration: 'none', color: '#4a5665', fontWeight: 600, fontSize: 13, background: '#eef2f6', borderRadius: 7, padding: '5px 10px' }}>
        ✉ Email link
      </a>
    </>
  );
}

/* ---------------- Plans ---------------- */
function Plans({ prop, onPhoto }) {
  const floors = prop.floors || [];
  const printMap = () => openReport('/api/report?type=sitemap&property=' + encodeURIComponent(prop.id));
  const printFloors = () => openReport('/api/report?type=floorplans&property=' + encodeURIComponent(prop.id));
  return (
    <div>
      <SecHead>Site map<PrintBtn onClick={printMap} disabled={!prop.site_map_url} /></SecHead>
      {prop.site_map_url
        ? <PlanThumb src={prop.site_map_url} onOpen={() => onPhoto([prop.site_map_url], 0, ['Site Map'], () => printMap())} />
        : <div style={D.emptyBox}>No site map loaded.</div>}
      <div style={{ height: 18 }} />
      <SecHead>Floorplans{floors.length > 1 ? ' · ' + floors.length + ' sheets' : ''}<PrintBtn onClick={printFloors} disabled={!floors.length} /></SecHead>
      {floors.length ? (
        <div style={D.planGrid}>
          {floors.map((u, i) => <PlanThumb key={i} src={u} onOpen={() => onPhoto(floors, i, floors.map((_, k) => 'Floor ' + (k + 1)), () => printFloors())} />)}
        </div>
      ) : <div style={D.emptyBox}>No floorplans loaded.</div>}
    </div>
  );
}
function PlanThumb({ src, onOpen }) {
  return (
    <button onClick={onOpen} style={{ display: 'block', width: '100%', position: 'relative', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#0a1017', padding: 0, cursor: 'zoom-in' }}>
      <img src={src} alt="" draggable={false} style={{ width: '100%', maxHeight: '62vh', objectFit: 'contain', display: 'block' }} />
      <span style={{ position: 'absolute', right: 10, bottom: 10, background: 'rgba(13,22,32,.85)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 16 }}>⤢ Click to zoom</span>
    </button>
  );
}

/* ---------------- Archive ---------------- */
function Archive({ items, onOpen, patch, onPhoto }) {
  const [q, setQ] = useState('');
  const arc = items.filter((i) => i.archived && matchQ(i, q)).sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  return (
    <div>
      <div style={D.search}>
        <span style={{ color: '#95a1b0' }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search archived…" style={{ border: 'none', outline: 'none', flex: 1, fontSize: 15, background: 'transparent' }} />
      </div>
      <div style={{ ...D.h3, marginTop: 14 }}>Archived · {items.filter((i) => i.archived).length}</div>
      {arc.length === 0 ? <div style={D.muted}>{q ? 'No archived items match.' : 'Nothing archived yet.'}</div> : (
        <div style={D.issueGrid}>
          {arc.map((it) => (
            <div key={it.id} style={D.card}>
              <div style={{ display: 'flex', gap: 12, cursor: 'pointer' }} onClick={() => onOpen(it)}>
                {it.photos?.[0] ? <img src={it.photos[0]} alt="" style={D.cardThumb} onClick={(e) => { e.stopPropagation(); onPhoto(it.photos, 0, it.photos.map(() => it.title)); }} /> : <div style={{ ...D.cardThumb, ...D.thumbEmpty }}>—</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15.5 }}>{it.title}</div>
                  <div style={{ color: '#8b96a3', fontSize: 13, marginTop: 2 }}>{it.category || ''}{it.source ? ' · ' + it.source : ''}</div>
                </div>
              </div>
              <div style={D.actionrow}><button style={D.actbtn} onClick={() => patch(it.id, { archived: false }, 'Restored')}>↩ Restore to queue</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Pre-Walk ---------------- */
function PreWalk({ prop, items }) {
  const carry = items.filter((i) => !i.archived && i.status !== 'Complete' && (i.priority === 'High' || i.life_safety));
  const check = ['Phone charged & camera ready', 'Keys / access for buildings & amenities', 'Review last visit’s open items (below)', 'Note anything the manager flagged this week'];
  return (
    <div style={{ maxWidth: 760 }}>
      <SecHead>Before you walk<PrintBtn onClick={() => openReport('/api/report?type=prewalk&property=' + encodeURIComponent(prop.id))} /></SecHead>
      <div style={D.panel}>
        {check.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 4px', borderBottom: i < check.length - 1 ? '1px solid #eef1f4' : 'none' }}>
            <span style={D.checkbox2} /><span style={{ fontSize: 15 }}>{c}</span>
          </div>
        ))}
      </div>
      <div style={{ ...D.h3, marginTop: 20 }}>Carry-over to verify · {carry.length}</div>
      {carry.length === 0 ? <div style={D.muted}>No high-priority carry-over items.</div> : (
        <div style={D.panel}>
          {carry.map((it, i) => (
            <div key={it.id} style={{ padding: '11px 4px', borderBottom: i < carry.length - 1 ? '1px solid #eef1f4' : 'none' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ ...D.ratebadge, background: RCOLOR[it.priority] || '#6b7684' }}>{(RLABEL[it.priority] || it.priority || '').toUpperCase()}</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{it.title}</span>
              </div>
              <div style={{ color: '#8b96a3', fontSize: 13, marginTop: 3 }}>{it.source || ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- All-issues overview table ---------------- */
function AllIssues({ props, items, onBack, onOpen, patch, onPhoto }) {
  const [fp, setFp] = useState('all');
  const [fs, setFs] = useState('open');
  const [crit, setCrit] = useState(false);
  const [todo, setTodo] = useState(false);
  const [q, setQ] = useState('');
  const rowPhotoRef = useRef(); const target = useRef(null);
  const [busyPhoto, setBusyPhoto] = useState(null);
  const pname = (id) => props.find((p) => p.id === id)?.name || id;

  let view = items.filter((i) => !i.archived && matchQ(i, q));
  if (fp !== 'all') view = view.filter((i) => i.property_id === fp);
  if (fs === 'open') view = view.filter((i) => i.status !== 'Complete');
  if (fs === 'complete') view = view.filter((i) => i.status === 'Complete');
  if (crit) view = view.filter((i) => (i.priority === 'High' || i.life_safety) && i.status !== 'Complete');
  if (todo) view = view.filter((i) => i.send_todo);

  function pickPhoto(id) { target.current = id; rowPhotoRef.current?.click(); }
  async function onRowPhoto(e) {
    const files = [...(e.target.files || [])]; const id = target.current; e.target.value = '';
    if (!files.length || !id) return;
    setBusyPhoto(id);
    await uploadPhotos(id, files);
    setBusyPhoto(null);
    patch(id, {});
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <button style={D.backlink} onClick={onBack}>‹ Portfolio</button>
        <div style={{ fontWeight: 800, fontSize: 24 }}>All issues</div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
        <div style={{ ...D.search, maxWidth: 260 }}>
          <span style={{ color: '#95a1b0' }}>🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ border: 'none', outline: 'none', flex: 1, fontSize: 15, background: 'transparent' }} />
        </div>
        <select style={D.sel} value={fp} onChange={(e) => setFp(e.target.value)}>
          <option value="all">All properties</option>
          {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select style={D.sel} value={fs} onChange={(e) => setFs(e.target.value)}>
          <option value="open">Open</option>
          <option value="all">All statuses</option>
          <option value="complete">Complete</option>
        </select>
        <button style={{ ...D.filt, ...(crit ? D.filtOn : {}) }} onClick={() => setCrit((v) => !v)}>Critical only</button>
        <button style={{ ...D.filt, ...(todo ? D.filtOn : {}) }} onClick={() => setTodo((v) => !v)}>On to-do</button>
        <div style={{ marginLeft: 'auto', color: '#6b7684', fontSize: 14 }}>{view.length} shown</div>
      </div>
      <input ref={rowPhotoRef} type="file" accept="image/*" multiple hidden onChange={onRowPhoto} />
      {view.length === 0 && <div style={{ color: '#6b7684', padding: 40, textAlign: 'center' }}>No items match.</div>}
      {view.map((it) => (
        <div key={it.id} style={D.row}>
          <div style={{ width: 82, flex: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <select value={RATINGS.includes(it.priority) ? it.priority : 'Low'} onChange={(e) => patch(it.id, { priority: e.target.value })}
              style={{ ...D.mini, color: RCOLOR[it.priority] || '#6b7684', fontWeight: 700 }}>
              {RATINGS.map((p) => <option key={p} value={p}>{RLABEL[p]}</option>)}
            </select>
            {it.life_safety && <span style={D.lsSm}>Life safety</span>}
          </div>
          <div style={{ flex: 'none', width: 66 }}>
            {it.photos?.[0]
              ? <img src={it.photos[0]} alt="" style={D.rowThumb2} onClick={() => onPhoto(it.photos, 0, it.photos.map(() => it.title))} />
              : <div style={{ ...D.rowThumb2, ...D.thumbEmpty }}>—</div>}
            <button style={D.addphoto} disabled={busyPhoto === it.id} onClick={() => pickPhoto(it.id)}>{busyPhoto === it.id ? '…' : (it.photos?.length ? '+ Photo' : 'Add photo')}</button>
          </div>
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(it)}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{it.title}</div>
            {(it.notes || it.detail) && <div style={{ color: '#4a5665', fontSize: 13.5, marginTop: 2 }}>{it.detail || it.notes}</div>}
            <div style={{ color: '#8b96a3', fontSize: 13, marginTop: 3 }}>
              {it.category ? it.category + ' · ' : ''}{pname(it.property_id)} · {it.walker_name || '—'}{it.source ? ' · ' + it.source : ''}
              <span style={{ color: '#2a6bd4', fontWeight: 700 }}> · Open ▸</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 150, flex: 'none' }}>
            <select value={it.status} onChange={(e) => patch(it.id, { status: e.target.value })} style={{ ...D.status, color: SCOLOR[it.status], borderColor: SCOLOR[it.status] }}>
              {['Open', 'In progress', 'Complete'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <button onClick={() => patch(it.id, { send_todo: !it.send_todo })} style={{ ...D.todoBtn, ...(it.send_todo ? { background: '#0e5c63', color: '#fff', borderColor: '#0e5c63' } : {}) }}>{it.send_todo ? '✓ On to-do' : 'Send to to-do'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Issue modal (desktop, proportionate) ---------------- */
function ItemModal({ item, prop, pname, onClose, onSaved, onPhoto, onToast, onSiteVisit, inSv, onMarkup }) {
  const [title, setTitle] = useState(item.title || '');
  const [priority, setPriority] = useState(RATINGS.includes(item.priority) ? item.priority : 'Low');
  const [status, setStatus] = useState(['Open', 'In progress', 'Complete'].includes(item.status) ? item.status : 'Open');
  const [category, setCategory] = useState(item.category || '');
  const [notes, setNotes] = useState(item.notes || '');
  const [detail, setDetail] = useState(item.detail || '');
  const [office, setOffice] = useState(item.office_note || '');
  const [ls, setLS] = useState(!!item.life_safety);
  const [todo, setTodo] = useState(!!item.send_todo);
  const [agenda, setAgenda] = useState(!!item.on_agenda);
  const [photos, setPhotos] = useState(item.photos || []);
  const [pin, setPin] = useState(item.map_x != null ? { x: item.map_x, y: item.map_y } : null);
  const [placing, setPlacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef();

  async function addFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setUploading(true);
    const added = await uploadPhotos(item.id, list, (url) => setPhotos((p) => [...p, url]));
    setUploading(false);
    if (added) onToast(added + ' photo' + (added > 1 ? 's' : '') + ' added');
  }
  async function save(close) {
    if (!title.trim()) { setMsg('Title is required.'); return false; }
    setBusy(true); setMsg('');
    const r = await fetch('/api/items/' + item.id, {
      method: 'PATCH', headers: J,
      body: JSON.stringify({ title: title.trim(), priority, status, category, notes, detail, office_note: office, life_safety: ls, send_todo: todo, on_agenda: agenda, map_x: pin?.x ?? null, map_y: pin?.y ?? null }),
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.error || 'Save failed'); return false; }
    onSaved(); if (close) onClose(); return true;
  }
  const MapBlock = () => (
    <>
      <label style={{ ...D.flabel, marginTop: MODAL_LAYOUT === 'A' ? 16 : 0 }}>Location on site map</label>
      {prop?.site_map_url ? (
        <div>
          <button style={{ ...D.pinbtn, ...(placing ? { background: '#0e5c63', color: '#fff', borderColor: '#0e5c63' } : {}) }} onClick={() => setPlacing((p) => !p)}>
            {placing ? 'Click the map to drop the pin' : pin ? '✓ Pinned — click to move' : 'Place pin on site map'}
          </button>
          <MouseZoom src={prop.site_map_url} placing={placing} maxHeight={MODAL_LAYOUT === 'B' ? 300 : 250}
            onPlace={(x, y) => { setPin({ x, y }); setPlacing(false); }} markers={pin ? [{ x: pin.x, y: pin.y }] : []} />
          <div style={{ color: '#95a1b0', fontSize: 12.5, marginTop: 5, textAlign: 'center' }}>Scroll to zoom · drag to move · click to drop the pin</div>
        </div>
      ) : <div style={D.muted}>No site map for this property.</div>}
    </>
  );
  return (
    <div style={D.lb} onClick={onClose}>
      <div style={D.modalWide} onClick={(e) => e.stopPropagation()}>
        <div style={D.modalHead}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>Issue detail</div>
            <div style={{ color: '#8b96a3', fontSize: 13, marginTop: 2 }}>{pname}{item.walker_name ? ' · Logged by ' + item.walker_name : ''}{item.walk_date ? ' · ' + String(item.walk_date).slice(0, 10) : ''}{item.source ? ' · ' + item.source : ''}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={D.printbtn} onClick={async () => { if (await save(false)) openReport('/api/report?type=item&id=' + item.id); }}>📄 Save / Print</button>
            <button style={D.xbtn} onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: MODAL_LAYOUT === 'B' ? 20 : 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* PHOTOS */}
          <div style={{ flex: MODAL_LAYOUT === 'B' ? '1 1 370px' : '1 1 430px', minWidth: 320 }}>
            <label style={D.flabel}>Photos</label>
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              style={{ ...D.dropzone, ...(drag ? { borderColor: '#0e5c63', background: '#e7f0f1' } : {}) }}>
              {photos.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {photos.map((u, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={u} alt="" onClick={() => onPhoto(photos, i, photos.map(() => title))} style={D.modalThumb} />
                      {onMarkup && <button style={D.markbtn} title="Draw on this photo" onClick={(e) => { e.stopPropagation(); onMarkup(u); }}>✎ Mark</button>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ textAlign: 'center', color: '#8b96a3', fontSize: 13.5 }}>
                {uploading ? 'Uploading…' : <>Drag &amp; drop photos here, or <button style={D.linkbtn2} onClick={() => fileRef.current?.click()}>browse to upload</button></>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {photos.length > 0 && <div style={{ color: '#95a1b0', fontSize: 12.5, marginTop: 5, textAlign: 'center' }}>Click a photo to zoom · ✎ Mark to draw on it.</div>}
            {MODAL_LAYOUT === 'A' && <MapBlock />}
          </div>

          {/* FIELDS */}
          <div style={{ flex: MODAL_LAYOUT === 'B' ? '1 1 400px' : '1 1 430px', minWidth: 330 }}>
            <label style={D.flabel}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={D.finput} />

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={D.flabel}>Priority</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} style={D.finput}>{RATINGS.map((p) => <option key={p} value={p}>{RLABEL[p]}</option>)}</select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={D.flabel}>Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} style={D.finput}>{['Open', 'In progress', 'Complete'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </div>
            </div>

            <label style={D.flabel}>Category</label>
            <input list="cats-dl" value={category} onChange={(e) => setCategory(e.target.value)} style={D.finput}
              placeholder="e.g. Maintenance, Signage, Make Ready, Office" />
            <datalist id="cats-dl">{CATS.map((c) => <option key={c} value={c} />)}</datalist>

            <div style={{ display: 'flex', gap: 8, margin: '12px 0 2px' }}>
              <button onClick={() => setLS((v) => !v)} style={{ ...D.toggle, ...(ls ? D.toggleLS : {}) }}>Life safety</button>
              <button onClick={() => setAgenda((v) => !v)} style={{ ...D.toggle, ...(agenda ? D.toggleNavy : {}) }}>On agenda</button>
              <button onClick={() => setTodo((v) => !v)} style={{ ...D.toggle, ...(todo ? D.toggleOn : {}) }}>Manager to-do</button>
              {onSiteVisit && <button onClick={() => onSiteVisit(item)} style={{ ...D.toggle, ...(inSv ? D.toggleOn : {}) }}>{inSv ? '✓ On Site Visit' : 'Add to Site Visit'}</button>}
            </div>

            <label style={D.flabel}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was found…" style={{ ...D.finput, minHeight: 74, resize: 'vertical', lineHeight: 1.45 }} />

            <label style={D.flabel}>More detail (office)</label>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Fuller description, vendor, measurements…" style={{ ...D.finput, minHeight: 90, resize: 'vertical', lineHeight: 1.45 }} />

            <label style={D.flabel}>Office note</label>
            <textarea value={office} onChange={(e) => setOffice(e.target.value)} placeholder="Internal note for the team…" style={{ ...D.finput, minHeight: 58, resize: 'vertical', lineHeight: 1.45 }} />
          </div>

          {/* MAP — its own column in layout B */}
          {MODAL_LAYOUT === 'B' && (
            <div style={{ flex: '0 0 300px', minWidth: 280 }}><MapBlock /></div>
          )}
        </div>

        {msg && <div style={{ color: '#cd4428', fontSize: 14, marginTop: 10 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button style={D.ghostDark} onClick={onClose}>Cancel</button>
          <button style={{ ...D.savebtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- New issue modal ---------------- */
function NewIssueModal({ props, defaultPid, onClose, onDone, onPhoto }) {
  const [property_id, setPid] = useState(defaultPid || props[0]?.id || '');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('Low');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [ls, setLS] = useState(false);
  const [todo, setTodo] = useState(false);
  const [agenda, setAgenda] = useState(false);
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [pin, setPin] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef();
  const prop = props.find((p) => p.id === property_id);

  function addFiles(fl) {
    const list = [...fl].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setFiles((p) => [...p, ...list]);
    setPreviews((p) => [...p, ...list.map((f) => URL.createObjectURL(f))]);
  }
  async function save() {
    if (!property_id || !title.trim()) { setMsg('Property and title are required.'); return; }
    setBusy(true); setMsg('');
    const r = await fetch('/api/items', {
      method: 'POST', headers: J,
      body: JSON.stringify({ property_id, title: title.trim(), priority, category, notes, life_safety: ls, send_todo: todo, on_agenda: agenda, source: 'Dashboard', map_x: pin?.x ?? null, map_y: pin?.y ?? null }),
    });
    if (!r.ok) { setBusy(false); const j = await r.json().catch(() => ({})); setMsg(j.error || 'Could not save.'); return; }
    const j = await r.json();
    if (files.length && j.item?.id) await uploadPhotos(j.item.id, files);
    setBusy(false);
    onDone();
  }
  return (
    <div style={D.lb} onClick={onClose}>
      <div style={D.modalWide} onClick={(e) => e.stopPropagation()}>
        <div style={D.modalHead}>
          <div style={{ fontWeight: 800, fontSize: 20 }}>New issue</div>
          <button style={D.xbtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px', minWidth: 300 }}>
            <label style={D.flabel}>Photos</label>
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              style={{ ...D.dropzone, ...(drag ? { borderColor: '#0e5c63', background: '#e7f0f1' } : {}) }}>
              {previews.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {previews.map((u, i) => <img key={i} src={u} alt="" onClick={() => onPhoto(previews, i)} style={D.modalThumb} />)}
                </div>
              )}
              <div style={{ textAlign: 'center', color: '#8b96a3', fontSize: 13.5 }}>Drag &amp; drop photos here, or <button style={D.linkbtn2} onClick={() => fileRef.current?.click()}>browse to upload</button></div>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>

            <label style={{ ...D.flabel, marginTop: 16 }}>Location on site map</label>
            {prop?.site_map_url ? (
              <div>
                <button style={{ ...D.pinbtn, ...(placing ? { background: '#0e5c63', color: '#fff', borderColor: '#0e5c63' } : {}) }} onClick={() => setPlacing((p) => !p)}>
                  {placing ? 'Click the map to drop the pin' : pin ? '✓ Pinned — click to move' : 'Place pin on site map'}
                </button>
                <MouseZoom src={prop.site_map_url} placing={placing} onPlace={(x, y) => { setPin({ x, y }); setPlacing(false); }} markers={pin ? [{ x: pin.x, y: pin.y }] : []} />
              </div>
            ) : <div style={D.muted}>No site map for this property.</div>}
          </div>

          <div style={{ flex: '1 1 340px', minWidth: 300 }}>
            <label style={D.flabel}>Property</label>
            <select value={property_id} onChange={(e) => { setPid(e.target.value); setPin(null); }} style={D.finput}>
              {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            <label style={D.flabel}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What did you find?" style={D.finput} autoFocus />

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={D.flabel}>Priority</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} style={D.finput}>{RATINGS.map((p) => <option key={p} value={p}>{RLABEL[p]}</option>)}</select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={D.flabel}>Category</label>
                <input list="cats-dl" value={category} onChange={(e) => setCategory(e.target.value)} style={D.finput}
                  placeholder="e.g. Maintenance, Signage, Make Ready, Office" />
                <datalist id="cats-dl">{CATS.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, margin: '12px 0 2px' }}>
              <button onClick={() => setLS((v) => !v)} style={{ ...D.toggle, ...(ls ? D.toggleLS : {}) }}>Life safety</button>
              <button onClick={() => setAgenda((v) => !v)} style={{ ...D.toggle, ...(agenda ? D.toggleNavy : {}) }}>On agenda</button>
              <button onClick={() => setTodo((v) => !v)} style={{ ...D.toggle, ...(todo ? D.toggleOn : {}) }}>Manager to-do</button>
            </div>

            <label style={D.flabel}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details…" style={{ ...D.finput, minHeight: 110, resize: 'vertical', lineHeight: 1.45 }} />
          </div>
        </div>
        {msg && <div style={{ color: '#cd4428', fontSize: 14, marginTop: 10 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button style={D.ghostDark} onClick={onClose}>Cancel</button>
          <button style={{ ...D.savebtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save issue'}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Users modal ---------------- */
function UsersModal({ onClose }) {
  const [users, setUsers] = useState(null);
  const [name, setName] = useState(''); const [pin, setPin] = useState(''); const [msg, setMsg] = useState('');
  const load = () => fetch('/api/users').then((r) => r.json()).then((j) => setUsers(j.users || []));
  useEffect(() => { load(); }, []);
  async function add() {
    setMsg('');
    const r = await fetch('/api/users', { method: 'POST', headers: J, body: JSON.stringify({ name, pin }) });
    const j = await r.json();
    if (!r.ok) return setMsg(j.error || 'Failed');
    setName(''); setPin(''); load();
  }
  async function update(id, body) { await fetch('/api/users', { method: 'POST', headers: J, body: JSON.stringify({ id, ...body }) }); load(); }
  return (
    <div style={D.lb} onClick={onClose}>
      <div style={D.modal} onClick={(e) => e.stopPropagation()}>
        <div style={D.modalHead}>
          <div style={{ fontWeight: 800, fontSize: 20 }}>Users &amp; passcodes</div>
          <button style={D.xbtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ color: '#6b7684', fontSize: 14, marginBottom: 12 }}>Each person gets a passcode. Every walk and note is stamped with their name.</div>
        {!users ? <div className="spin" /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #eef1f4' }}>
                  <td style={{ padding: '8px 6px' }}>{u.name}{u.role === 'admin' && <span style={D.adminTag}>admin</span>}</td>
                  <td style={{ padding: '8px 6px' }}>
                    <input defaultValue={u.pin} onBlur={(e) => e.target.value !== u.pin && update(u.id, { pin: e.target.value })} style={{ width: 74, border: '1px solid #d5dde5', borderRadius: 6, padding: '5px 8px', fontVariantNumeric: 'tabular-nums' }} />
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                    <button style={D.tinybtn} onClick={() => update(u.id, { active: !u.active })}>{u.active ? 'Active' : 'Off'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, border: '1px solid #d5dde5', borderRadius: 8, padding: '9px 10px' }} />
          <input placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} style={{ width: 90, border: '1px solid #d5dde5', borderRadius: 8, padding: '9px 10px' }} />
          <button style={D.savebtn} onClick={add}>Add</button>
        </div>
        {msg && <div style={{ color: '#cd4428', fontSize: 14, marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  );
}

/* ---------------- small pieces ---------------- */
function Stat({ n, label, color }) {
  return (
    <div style={D.stat}>
      <div style={{ fontSize: 30, fontWeight: 800, color: color || '#0d1620' }}>{n}</div>
      <div style={{ fontSize: 13.5, color: '#6b7684', marginTop: 2 }}>{label}</div>
    </div>
  );
}
function SecHead({ children }) {
  return <div style={D.secheadrow}>{Array.isArray(children) ? children : [children]}</div>;
}
function PrintBtn({ onClick, disabled }) {
  return <button style={{ ...D.printbtn, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }} onClick={onClick}>📄 Save / Print</button>;
}
function Empty() {
  return <div style={{ ...D.emptyBox, textAlign: 'center', padding: '46px 24px' }}><div style={{ fontSize: 16, color: '#4a5665' }}>No items match.</div></div>;
}
function Setup({ onSeed, seeding, onRetry }) {
  return (
    <div className="center" style={{ background: '#0d1620', color: '#fff', textAlign: 'center', padding: 30 }}>
      <div className="ring" style={{ width: 40, height: 40 }} />
      <div style={{ fontWeight: 700, fontSize: 22.5 }}>Almost there</div>
      <div style={{ color: '#aab6c4', maxWidth: 460, lineHeight: 1.5, fontSize: 15.5 }}>The app is live, but its database isn’t connected yet. In Vercel → Storage, create a Postgres database and a Blob store and connect both to this project, then load the starter data.</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button style={{ ...D.savebtn, padding: '11px 20px' }} onClick={onSeed} disabled={seeding}>{seeding ? 'Setting up…' : 'Set up data'}</button>
        <button style={{ ...D.ghost, padding: '11px 20px' }} onClick={onRetry}>Retry</button>
      </div>
    </div>
  );
}

const Z = {
  viewerBtn: { color: '#fff', background: 'rgba(255,255,255,.16)', fontSize: 14, fontWeight: 700, padding: '8px 14px', borderRadius: 9, flex: 'none' },
  navBtn: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 46, height: 46, borderRadius: '50%', background: 'rgba(255,255,255,.15)', color: '#fff', fontSize: 26, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },
};

const D = {
  top: { background: '#0d1620', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 22px', position: 'sticky', top: 0, zIndex: 20, gap: 12, flexWrap: 'wrap' },
  wrap: { maxWidth: 1200, margin: '0 auto', padding: '22px 22px 60px' },
  ghost: { background: '#1b2a3d', color: '#cdd8e4', fontSize: 14, fontWeight: 600, padding: '7px 12px', borderRadius: 8 },
  ghostDark: { background: '#eef2f6', color: '#4a5665', fontSize: 15, fontWeight: 600, borderRadius: 9, padding: '11px 18px' },
  newbtn: { background: '#0e5c63', color: '#fff', fontSize: 14, fontWeight: 700, padding: '8px 15px', borderRadius: 8 },
  newbtn2: { background: '#0d1620', color: '#fff', fontSize: 14, fontWeight: 700, padding: '9px 15px', borderRadius: 9 },
  who: { color: '#9fb0c2', fontSize: 14, fontWeight: 600 },
  h2: { fontSize: 18, fontWeight: 800, color: '#0d1620' },
  h3: { fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b7684', margin: '2px 2px 12px' },
  linkbtn: { background: 'none', color: '#2a6bd4', fontSize: 14.5, fontWeight: 700 },
  linkbtn2: { background: 'none', color: '#2a6bd4', fontSize: 13.5, fontWeight: 700, padding: 0, textDecoration: 'underline' },
  backlink: { background: 'none', color: '#6b7684', fontSize: 14.5, fontWeight: 700 },
  statsRow: { display: 'flex', gap: 14, marginBottom: 22, flexWrap: 'wrap' },
  stat: { background: '#fff', border: '1px solid #e6ebf0', borderRadius: 14, padding: '14px 24px', minWidth: 140, flex: '0 0 auto' },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 },
  propcard: { textAlign: 'left', background: '#fff', border: '1px solid #e6ebf0', borderRadius: 14, padding: 18, cursor: 'pointer' },
  critpill: { background: '#fdeee9', color: '#cd4428', fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 20 },
  openpill: { background: '#eef2f6', color: '#4a5665', fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 20 },
  tabstrip: { display: 'flex', gap: 6, marginTop: 16, borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' },
  tab: { padding: '9px 16px', borderRadius: '8px 8px 0 0', background: 'transparent', color: '#6b7684', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, borderBottom: '2px solid transparent', marginBottom: -1 },
  tabOn: { background: '#fff', color: '#0d1620', border: '1px solid #e2e8f0', borderBottom: '2px solid #0e5c63' },
  tbadge: { background: '#33465c', color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 10, padding: '0 7px', minWidth: 18, textAlign: 'center' },
  search: { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 13px', flex: '1 1 240px', maxWidth: 340 },
  chip: { padding: '7px 13px', borderRadius: 18, background: '#fff', border: '1px solid #e2e8f0', color: '#6b7684', fontSize: 13.5, fontWeight: 600 },
  chipOn: { background: '#0d1620', color: '#fff', borderColor: '#0d1620' },
  filt: { border: '1px solid #d5dde5', borderRadius: 8, padding: '8px 12px', background: '#fff', color: '#6b7684', fontSize: 14, fontWeight: 600 },
  filtOn: { background: '#0d1620', color: '#fff', borderColor: '#0d1620' },
  issueGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: 14 },
  card: { background: '#fff', border: '1px solid #e6ebf0', borderRadius: 14, padding: 14 },
  cardThumb: { width: 84, height: 84, borderRadius: 10, objectFit: 'cover', flex: 'none', cursor: 'zoom-in', border: '1px solid #e6ebf0' },
  thumbEmpty: { background: '#eef2f6', color: '#b7c1cc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 },
  ratebadge: { color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: '.03em', padding: '2px 8px', borderRadius: 5 },
  ls: { fontSize: 12, fontWeight: 700, color: '#cd4428', background: '#fdeee9', padding: '1px 7px', borderRadius: 10 },
  lsSm: { fontSize: 10.5, fontWeight: 700, color: '#cd4428', background: '#fdeee9', padding: '1px 5px', borderRadius: 8, textAlign: 'center' },
  todo: { fontSize: 12, fontWeight: 700, color: '#fff', background: '#0e5c63', padding: '1px 7px', borderRadius: 10 },
  actionrow: { display: 'flex', gap: 4, marginTop: 11, paddingTop: 10, borderTop: '1px solid #f0f3f6', flexWrap: 'wrap' },
  actbtn: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: '#4a5665', padding: '4px 7px', borderRadius: 7 },
  checkbox: { width: 17, height: 17, borderRadius: 5, border: '1.5px solid #c3ccd6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12.5, flex: 'none' },
  checkbox2: { width: 22, height: 22, borderRadius: 6, border: '2px solid #c3ccd6', flex: 'none' },
  split: { display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' },
  splitMap: { flex: '1 1 420px', minWidth: 320, position: 'sticky', top: 78 },
  splitList: { flex: '1 1 360px', minWidth: 300 },
  listrow: { width: '100%', display: 'flex', gap: 12, alignItems: 'center', background: '#fff', border: '1px solid #e6ebf0', borderRadius: 12, padding: 11, marginBottom: 9, textAlign: 'left', cursor: 'pointer' },
  rowThumb: { width: 46, height: 46, borderRadius: 8, objectFit: 'cover', flex: 'none', cursor: 'zoom-in' },
  critnum: { width: 24, height: 24, borderRadius: '50%', background: '#0e5c63', color: '#fff', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' },
  agitem: { display: 'flex', gap: 10, alignItems: 'flex-start', background: '#fff', border: '1px solid #e6ebf0', borderRadius: 12, padding: 12, marginBottom: 9 },
  agnum: { width: 24, height: 24, borderRadius: '50%', background: '#0d1620', color: '#fff', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 2 },
  rowx: { color: '#95a1b0', fontSize: 16, width: 26, flex: 'none' },
  planGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(420px,1fr))', gap: 14 },
  panel: { background: '#fff', border: '1px solid #e6ebf0', borderRadius: 12, padding: '6px 16px' },
  emptyBox: { background: '#fff', border: '1px dashed #d5dde5', borderRadius: 12, padding: '22px', color: '#6b7684', fontSize: 14 },
  muted: { color: '#6b7684', fontSize: 14.5, padding: '8px 2px' },
  secheadrow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6b7684', margin: '2px 2px 12px' },
  printbtn: { background: 'rgba(14,92,99,.12)', border: '1px solid rgba(14,92,99,.4)', color: '#0e5c63', fontSize: 13, fontWeight: 700, textTransform: 'none', letterSpacing: 0, padding: '7px 13px', borderRadius: 8 },
  // all-issues table
  row: { display: 'flex', gap: 16, alignItems: 'flex-start', background: '#fff', border: '1px solid #e6ebf0', borderRadius: 12, padding: 13, marginBottom: 10 },
  mini: { border: '1px solid #e0e6ec', borderRadius: 7, padding: '5px 6px', background: '#fff', fontSize: 14 },
  rowThumb2: { width: 66, height: 66, borderRadius: 9, objectFit: 'cover', cursor: 'zoom-in', border: '1px solid #e6ebf0' },
  addphoto: { width: 66, marginTop: 4, border: '1px solid #d5dde5', borderRadius: 7, padding: '3px 0', background: '#fff', color: '#6b7684', fontSize: 12, fontWeight: 600 },
  status: { border: '1.5px solid', borderRadius: 8, padding: '8px', background: '#fff', fontSize: 14.5, fontWeight: 700 },
  todoBtn: { border: '1px solid #d5dde5', borderRadius: 8, padding: '8px', background: '#fff', color: '#6b7684', fontSize: 13.5, fontWeight: 700 },
  sel: { border: '1px solid #d5dde5', borderRadius: 8, padding: '9px 11px', background: '#fff', fontSize: 15, color: '#1a2430' },
  // modals
  lb: { position: 'fixed', inset: 0, background: 'rgba(9,14,20,.72)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 16, padding: 24, width: 'min(560px,96vw)', margin: 'auto' },
  modalWide: { background: '#fff', borderRadius: 16, padding: 24, width: MODAL_LAYOUT === 'B' ? 'min(1280px,97vw)' : 'min(1060px,96vw)', margin: 'auto' },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  xbtn: { fontSize: 18, color: '#6b7684', width: 40, height: 40, background: '#f1f4f8', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' },
  dropzone: { border: '2px dashed #cbd5e1', borderRadius: 12, padding: 16, background: '#fbfcfd' },
  mkWrap: { position: 'fixed', inset: 0, background: '#0b1218', zIndex: 90, display: 'flex', flexDirection: 'column' },
  mkBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, padding: '12px 18px', borderBottom: '1px solid #1e2a36', flexWrap: 'wrap' },
  mkStage: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, minHeight: 0 },
  mkTool: { color: '#dbe3ea', background: '#1b2733', border: '1px solid #2b3947', fontSize: 13, fontWeight: 600, padding: '7px 12px', borderRadius: 8 },
  mkToolOn: { background: '#0e5c63', borderColor: '#0e5c63', color: '#fff' },
  mkCancel: { color: '#dbe3ea', background: 'transparent', border: '1px solid #2b3947', fontSize: 13.5, fontWeight: 600, padding: '8px 16px', borderRadius: 8 },
  mkSave: { color: '#fff', background: '#0e5c63', fontSize: 13.5, fontWeight: 700, padding: '8px 18px', borderRadius: 8 },
  markbtn: { position: 'absolute', left: 4, bottom: 4, fontSize: 10.5, fontWeight: 700, color: '#fff', background: 'rgba(14,92,99,.92)', padding: '2px 6px', borderRadius: 6 },
  modalThumb: { width: MODAL_LAYOUT === 'B' ? 168 : 150, height: MODAL_LAYOUT === 'B' ? 168 : 150, objectFit: 'cover', borderRadius: 8, border: '1px solid #e6ebf0', cursor: 'zoom-in' },
  pinbtn: { width: '100%', marginBottom: 10, border: '1px solid #d5dde5', borderRadius: 9, padding: '10px', background: '#fff', color: '#1a2430', fontWeight: 600, fontSize: 14.5 },
  flabel: { display: 'block', fontSize: 13, fontWeight: 700, color: '#6b7684', margin: '12px 0 6px' },
  finput: { width: '100%', border: '1px solid #d5dde5', borderRadius: 9, padding: '10px 12px', fontSize: 15.5, background: '#fff', color: '#1a2430' },
  toggle: { flex: 1, border: '1px solid #d5dde5', borderRadius: 8, padding: '9px 6px', background: '#fff', color: '#6b7684', fontSize: 13.5, fontWeight: 700 },
  toggleOn: { background: '#0e5c63', color: '#fff', borderColor: '#0e5c63' },
  toggleLS: { background: '#cd4428', color: '#fff', borderColor: '#cd4428' },
  toggleNavy: { background: '#0d1620', color: '#fff', borderColor: '#0d1620' },
  savebtn: { background: '#0d1620', color: '#fff', fontWeight: 700, borderRadius: 9, padding: '11px 22px', fontSize: 15.5 },
  tinybtn: { border: '1px solid #d5dde5', borderRadius: 6, padding: '4px 10px', background: '#fff', fontSize: 13.5, color: '#4a5665' },
  adminTag: { fontSize: 11, fontWeight: 700, color: '#cd4428', background: '#fdeee9', padding: '1px 6px', borderRadius: 8, marginLeft: 8 },
  toast: { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: '#0d1620', color: '#fff', fontSize: 15, padding: '11px 20px', borderRadius: 24, zIndex: 95 },
};
