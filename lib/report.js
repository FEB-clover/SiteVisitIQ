import { PDFDocument, rgb, StandardFonts, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';

// ---- brand palette ----
const CORAL = rgb(0.055, 0.361, 0.388);   // #0e5c63 brand teal
const CORAL_D = rgb(0.039, 0.271, 0.290); // #0a454a
const FLAG = rgb(0.804, 0.267, 0.157);    // #cd4428 danger
const NAVY = rgb(0.051, 0.086, 0.125);    // #0d1620
const INK = rgb(0.102, 0.141, 0.188);     // #1a2430
const MUTED = rgb(0.42, 0.46, 0.52);
const LINE = rgb(0.84, 0.87, 0.90);
const WHITE = rgb(1, 1, 1);
const AMBER = rgb(0.72, 0.47, 0.12);
const BLUE = rgb(0.165, 0.42, 0.83);
const GREEN = rgb(0.118, 0.49, 0.275);

const PAGE_W = 612, PAGE_H = 792, M = 48;
const CONTENT_W = PAGE_W - M * 2;

const PRIO_LABEL = { High: 'High', Low: 'Low', Monitor: 'Monitor', Status: 'Job Status', Medium: 'Low' };
const PRIO_COLOR = { High: FLAG, Low: MUTED, Monitor: AMBER, Status: BLUE, Medium: MUTED };
const STATUS_COLOR = { Open: MUTED, 'In progress': BLUE, Complete: GREEN };
const ENTRANCE = { map_x: 30, map_y: 63 };

function fmtDate(d) {
  const dt = d ? new Date(d) : new Date();
  return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

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

// draw the shared header band; returns the y (from top) where content may start
function drawHeader(page, fonts, { title, property, date, extra = [] }) {
  const { reg, bold } = fonts;
  const cx = M + 11, cy = PAGE_H - 40;
  page.drawCircle({ x: cx, y: cy, size: 11, color: CORAL });
  page.drawCircle({ x: cx, y: cy, size: 6, color: WHITE });
  page.drawCircle({ x: cx, y: cy, size: 3, color: CORAL_D });
  page.drawText('SiteVisit', { x: M + 28, y: PAGE_H - 36, size: 17, font: bold, color: NAVY });
  const svW = bold.widthOfTextAtSize('SiteVisit', 17);
  page.drawText('IQ', { x: M + 28 + svW + 4, y: PAGE_H - 36, size: 17, font: bold, color: CORAL });
  page.drawText('CLOVER CAPITAL PARTNERS', { x: M + 28, y: PAGE_H - 50, size: 7.5, font: bold, color: MUTED, characterSpacing: 1.4 });
  const rightX = PAGE_W - M;
  const put = (t, y, size, font, color) => { const w = font.widthOfTextAtSize(t, size); page.drawText(t, { x: rightX - w, y, size, font, color }); };
  put(title.toUpperCase(), PAGE_H - 34, 12, bold, CORAL_D);
  put(property, PAGE_H - 49, 10, bold, INK);
  put(fmtDate(date), PAGE_H - 62, 8.5, reg, MUTED);
  // optional extra right-aligned identity lines (address, walker, …)
  let ry = PAGE_H - 62;
  (extra || []).filter(Boolean).forEach((t) => { ry -= 11; put(String(t), ry, 8.5, reg, MUTED); });
  const ruleY = Math.min(PAGE_H - 74, ry - 9);
  page.drawLine({ start: { x: M, y: ruleY }, end: { x: PAGE_W - M, y: ruleY }, thickness: 1.5, color: CORAL });
  return PAGE_H - ruleY + 12;
}

// draw an image "contained" inside a fixed box (yTop measured from page top)
function drawFit(page, img, x, yTop, boxW, boxH) {
  page.drawRectangle({ x, y: PAGE_H - yTop - boxH, width: boxW, height: boxH, color: rgb(0.96, 0.97, 0.98), borderColor: LINE, borderWidth: 0.5 });
  if (!img) return;
  const s = Math.min(boxW / img.width, boxH / img.height);
  const w = img.width * s, h = img.height * s;
  page.drawImage(img, { x: x + (boxW - w) / 2, y: PAGE_H - yTop - boxH + (boxH - h) / 2, width: w, height: h });
}

function drawFooter(page, fonts, { property, date, pageNo }) {
  const { reg } = fonts;
  page.drawLine({ start: { x: M, y: 38 }, end: { x: PAGE_W - M, y: 38 }, thickness: 0.75, color: LINE });
  page.drawText(`SiteVisit IQ  ·  ${property}  ·  ${fmtDate(date)}`, { x: M, y: 27, size: 7.5, font: reg, color: MUTED });
  const pt = `Page ${pageNo}`; const w = reg.widthOfTextAtSize(pt, 7.5);
  page.drawText(pt, { x: PAGE_W - M - w, y: 27, size: 7.5, font: reg, color: MUTED });
}

async function embedImage(doc, bytes) {
  const u = new Uint8Array(bytes);
  const isPng = u[0] === 0x89 && u[1] === 0x50;
  try { return isPng ? await doc.embedPng(u) : await doc.embedJpg(u); }
  catch { try { return await doc.embedPng(u); } catch { return await doc.embedJpg(u); } }
}

// draw an image fitted into a box (topY from top), optional pins; returns {bottomTop, drawPins}
function drawMap(page, img, marks, topY, { maxH = 430 } = {}) {
  const ar = img.height / img.width;
  let w = CONTENT_W, h = w * ar;
  if (h > maxH) { h = maxH; w = h / ar; }
  const x = M + (CONTENT_W - w) / 2;
  const yTopPx = topY;
  const yBottom = PAGE_H - (yTopPx + h);
  page.drawRectangle({ x: x - 1, y: yBottom - 1, width: w + 2, height: h + 2, borderColor: LINE, borderWidth: 1, color: rgb(0.96, 0.97, 0.98) });
  page.drawImage(img, { x, y: yBottom, width: w, height: h });
  return { bottomTop: yTopPx + h, drawPins: (fonts, color) => {
    marks.forEach((m) => {
      const px = x + (m.x / 100) * w;
      const py = PAGE_H - (yTopPx + (m.y / 100) * h);
      page.drawCircle({ x: px, y: py, size: 9, color: WHITE });
      page.drawCircle({ x: px, y: py, size: 7.5, color: color || CORAL });
      const label = String(m.n);
      const tw = fonts.bold.widthOfTextAtSize(label, 8);
      page.drawText(label, { x: px - tw / 2, y: py - 3, size: 8, font: fonts.bold, color: WHITE });
    });
  } };
}


// draw an image that FILLS the box, cropping the overflow (no letterbox gaps)
function drawCover(page, img, x, yTop, boxW, boxH) {
  const by = PAGE_H - yTop - boxH;
  if (!img) { page.drawRectangle({ x, y: by, width: boxW, height: boxH, color: rgb(0.94, 0.95, 0.96) }); return; }
  const s = Math.max(boxW / img.width, boxH / img.height);
  const dw = img.width * s, dh = img.height * s;
  page.pushOperators(pushGraphicsState(), rectangle(x, by, boxW, boxH), clip(), endPath());
  page.drawImage(img, { x: x - (dw - boxW) / 2, y: by - (dh - boxH) / 2, width: dw, height: dh });
  page.pushOperators(popGraphicsState());
}

function wrapLines(text, font, size, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const wd of words) {
    const t = cur ? cur + ' ' + wd : wd;
    if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = wd; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// a small filled pill with label; returns width consumed
function pill(page, fonts, x, yTop, text, bg, fg) {
  const size = 8.5, padX = 6, h = 15;
  const w = fonts.bold.widthOfTextAtSize(text, size) + padX * 2;
  page.drawRectangle({ x, y: PAGE_H - yTop - h, width: w, height: h, color: bg, borderWidth: 0 });
  page.drawText(text, { x: x + padX, y: PAGE_H - yTop - h + 4.5, size, font: fonts.bold, color: fg });
  return w;
}

export async function buildReport({ type, property, floors = [], items = [], item = null, mapBytes = null, floorBytes = [], photoBytes = [], photoSets = null, report = null, date }) {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { reg, bold };
  const propName = property?.name || 'Property';
  let pageNo = 0;

  const TITLES = { agenda: 'Site Visit Agenda', critical: 'Critical Items', sitemap: 'Site Map', floorplans: 'Floorplans', prewalk: 'Pre-Walk Checklist', item: 'Issue Detail', sitevisit: 'Site Visit Report' };
  const title = TITLES[type] || 'Report';

  // Site Visit reports carry address + walker in the header identity block
  const headerExtra = type === 'sitevisit'
    ? [property?.address, report?.walker_name ? `Walked by ${report.walker_name}` : null]
    : [];

  function newPage(t) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    pageNo += 1;
    const top = drawHeader(page, fonts, { title: t, property: propName, date, extra: headerExtra });
    drawFooter(page, fonts, { property: propName, date, pageNo });
    return { page, top };
  }
  const heading = (page, y, text) => { page.drawText(text, { x: M, y: PAGE_H - y - 9, size: 9, font: bold, color: MUTED, characterSpacing: 0.6 }); return y + 16; };

  let map = null;
  if (mapBytes) { try { map = await embedImage(doc, mapBytes); } catch { map = null; } }

  // ---------- SITE MAP ----------
  if (type === 'sitemap') {
    const { page, top } = newPage(title);
    if (map) drawMap(page, map, [], top, { maxH: PAGE_H - top - 60 });
    else page.drawText('No site map loaded for this property.', { x: M, y: PAGE_H - top - 20, size: 11, font: reg, color: MUTED });
    return doc.save();
  }

  // ---------- FLOORPLANS ----------
  if (type === 'floorplans') {
    if (!floorBytes.length) {
      const { page, top } = newPage(title);
      page.drawText('No floorplans loaded for this property.', { x: M, y: PAGE_H - top - 20, size: 11, font: reg, color: MUTED });
      return doc.save();
    }
    for (let i = 0; i < floorBytes.length; i++) {
      const label = floorBytes.length > 1 ? `Floorplans — Floor ${i + 1}` : 'Floorplans';
      const { page, top } = newPage(label);
      let fimg = null; try { fimg = await embedImage(doc, floorBytes[i]); } catch { fimg = null; }
      if (fimg) drawMap(page, fimg, [], top, { maxH: PAGE_H - top - 60 });
    }
    return doc.save();
  }

  // ---------- SINGLE ISSUE ----------
  if (type === 'item') {
    const it = item || {};
    let { page, top } = newPage(title);
    let y = top;
    // title
    wrapLines(it.title || '(untitled issue)', bold, 15, CONTENT_W).forEach((ln) => { page.drawText(ln, { x: M, y: PAGE_H - y - 13, size: 15, font: bold, color: INK }); y += 19; });
    y += 4;
    // badge row
    let bx = M;
    bx += pill(page, fonts, bx, y, (PRIO_LABEL[it.priority] || it.priority || 'Low').toUpperCase(), PRIO_COLOR[it.priority] || MUTED, WHITE) + 6;
    if (it.life_safety) bx += pill(page, fonts, bx, y, 'LIFE SAFETY', CORAL_D, WHITE) + 6;
    if (it.status) bx += pill(page, fonts, bx, y, it.status, STATUS_COLOR[it.status] || MUTED, WHITE) + 6;
    if (it.send_todo) bx += pill(page, fonts, bx, y, 'MANAGER TO-DO', NAVY, WHITE) + 6;
    y += 24;
    // meta line
    const metaBits = [];
    if (it.category) metaBits.push(it.category);
    if (it.walker_name) metaBits.push('Logged by ' + it.walker_name);
    if (it.walk_date) metaBits.push(String(it.walk_date).slice(0, 10));
    if (it.source) metaBits.push(it.source);
    if (metaBits.length) { page.drawText(metaBits.join('  ·  '), { x: M, y: PAGE_H - y - 9, size: 9, font: reg, color: MUTED }); y += 18; }
    page.drawLine({ start: { x: M, y: PAGE_H - y }, end: { x: PAGE_W - M, y: PAGE_H - y }, thickness: 0.75, color: LINE });
    y += 14;
    // photo
    if (photoBytes.length) {
      let pimg = null; try { pimg = await embedImage(doc, photoBytes[0]); } catch { pimg = null; }
      if (pimg) { const drawn = drawMap(page, pimg, [], y, { maxH: 300 }); y = drawn.bottomTop + 16; }
    }
    // text sections
    const section = (label, text) => {
      if (!text) return;
      if (PAGE_H - y < 120) { const np = newPage(title + ' (cont.)'); page = np.page; y = np.top; }
      y = heading(page, y, label);
      wrapLines(text, reg, 10.5, CONTENT_W).forEach((ln) => { page.drawText(ln, { x: M, y: PAGE_H - y - 10, size: 10.5, font: reg, color: INK }); y += 14; });
      y += 10;
    };
    section('NOTES', it.notes);
    section('MORE DETAIL', it.detail);
    section('OFFICE NOTE', it.office_note);
    if (!it.notes && !it.detail && !it.office_note) { page.drawText('No written notes on this issue yet.', { x: M, y: PAGE_H - y - 10, size: 10.5, font: reg, color: MUTED }); y += 16; }
    // location
    if (map && it.map_x != null) {
      if (PAGE_H - y < 200) { const np = newPage(title + ' (cont.)'); page = np.page; y = np.top; }
      y = heading(page, y, 'LOCATION ON SITE MAP');
      const drawn = drawMap(page, map, [{ x: it.map_x, y: it.map_y, n: '' }], y, { maxH: 300 });
      drawn.drawPins(fonts, CORAL);
      y = drawn.bottomTop + 10;
    }
    return doc.save();
  }

  // ---------- PRE-WALK CHECKLIST ----------
  if (type === 'prewalk') {
    const sevRank = { High: 0, Monitor: 1, Status: 2, Low: 3, Medium: 3 };
    const carry = items.filter((i) => !i.archived && i.status !== 'Complete' && (i.priority === 'High' || i.life_safety))
      .sort((a, b) => (sevRank[a.priority] ?? 3) - (sevRank[b.priority] ?? 3));
    let { page, top } = newPage(title);
    let y = top;
    const checks = ['Phone charged & camera ready', 'Keys / access for buildings & amenities', "Review last visit's open items (below)", 'Note anything the manager flagged this week'];
    y = heading(page, y, 'BEFORE YOU WALK');
    checks.forEach((c) => {
      page.drawRectangle({ x: M, y: PAGE_H - y - 13, width: 12, height: 12, borderColor: MUTED, borderWidth: 1.2, color: WHITE });
      page.drawText(c, { x: M + 22, y: PAGE_H - y - 11, size: 11, font: reg, color: INK });
      y += 22;
    });
    y += 8;
    y = heading(page, y, `CARRY-OVER TO VERIFY · ${carry.length}`);
    if (!carry.length) { page.drawText('No high-priority carry-over items.', { x: M, y: PAGE_H - y - 10, size: 10.5, font: reg, color: MUTED }); return doc.save(); }
    for (const it of carry) {
      const titleLines = wrapLines(it.title || '(untitled)', bold, 11, CONTENT_W - 26);
      const metaBits = [PRIO_LABEL[it.priority] || it.priority];
      if (it.category) metaBits.push(it.category);
      if (it.life_safety) metaBits.push('LIFE SAFETY');
      if (it.source) metaBits.push(it.source);
      const blockH = titleLines.length * 13 + 14 + 8;
      if (PAGE_H - y - blockH < 56) { const np = newPage(title + ' (cont.)'); page = np.page; y = np.top; }
      page.drawRectangle({ x: M, y: PAGE_H - y - 13, width: 12, height: 12, borderColor: MUTED, borderWidth: 1.2, color: WHITE });
      let ly = y;
      titleLines.forEach((ln) => { page.drawText(ln, { x: M + 22, y: PAGE_H - ly - 10, size: 11, font: bold, color: INK }); ly += 13; });
      page.drawText(metaBits.filter(Boolean).join('  ·  '), { x: M + 22, y: PAGE_H - ly - 9, size: 8.5, font: reg, color: it.life_safety ? CORAL_D : MUTED }); ly += 13;
      y = ly + 8;
      page.drawLine({ start: { x: M + 22, y: PAGE_H - y + 4 }, end: { x: PAGE_W - M, y: PAGE_H - y + 4 }, thickness: 0.5, color: LINE });
    }
    return doc.save();
  }

  // ---------- SITE VISIT REPORT ----------
  if (type === 'sitevisit') {
    // 'ledger' : 2-col grid, six issues per page (max density)
    // 'record' : full-width band per issue, larger photo strip
    const DIR = (report && report.layout) === 'record' ? 'record' : 'ledger';
    const REC = DIR === 'record';
    const W = 612, H = 792, MG = 48, CW = W - MG * 2;
    const T = { ink: rgb(0.063, 0.075, 0.086), accent: rgb(0.055, 0.361, 0.388),
                warm: rgb(0.45, 0.47, 0.49), rule: rgb(0.85, 0.86, 0.87),
                soft: rgb(0.961, 0.967, 0.971), flag: rgb(0.804, 0.267, 0.157) };

    const MAXPH = 4;   // photos shown per issue in the report
    const rank = { High: 0, Monitor: 1, Status: 2, Low: 3, Medium: 3 };
    const list = (report && report.order === 'walk')
      ? tourOrder(items)
      : [...items].sort((a, b) =>
          (b.life_safety ? 1 : 0) - (a.life_safety ? 1 : 0)
          || (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3));
    const marks = list.filter((i) => i.map_x != null && i.map_y != null)
      .map((it) => ({ x: it.map_x, y: it.map_y, n: list.indexOf(it) + 1 }));

    const imgs = {};
    for (const it of list) {
      const arr = (photoSets && photoSets[it.id]) || [];
      const out = [];
      for (const b of arr) { try { out.push(await embedImage(doc, b)); } catch {} }
      imgs[it.id] = out;
    }

    const walker = (report && report.walker_name) || '';
    const rptName = (report && report.name) || '';
    // field-app vocabulary: RATING + flags, CATEGORY, STATUS, NOTES, MORE DETAIL
    const rating = (it) => (PRIO_LABEL[it.priority] || it.priority || 'Low').toUpperCase();
    const urgent = (it) => it.life_safety || it.priority === 'High';
    const nLife = list.filter((i) => i.life_safety).length;
    const nHigh = list.filter((i) => i.priority === 'High' && !i.life_safety).length;
    const nTodo = list.filter((i) => i.send_todo).length;

    const TX = (pg, t, x, yTop, size, font, color, ls) =>
      pg.drawText(String(t), { x, y: H - yTop - size, size, font, color, characterSpacing: ls || 0 });
    const CAPS = (pg, t, x, yTop, size, color, ls = 1.6) => TX(pg, String(t).toUpperCase(), x, yTop, size, bold, color, ls);
    const capW = (t, size, ls = 1.6) => bold.widthOfTextAtSize(String(t).toUpperCase(), size) + ls * String(t).length;
    const RULE = (pg, x1, yTop, x2, color = T.rule, th = 0.6) =>
      pg.drawLine({ start: { x: x1, y: H - yTop }, end: { x: x2, y: H - yTop }, thickness: th, color });
    // Photos are never cropped. A row is laid out at a target height with each
    // photo keeping its own proportions (portrait phone shots come out narrow
    // and tall, landscape wide); if the row would overflow the card, the whole
    // row scales down until it fits. photoRowH() measures, photoRow() draws.
    const GAP = 5;
    const photoRowH = (ims, wid, targetH) => {
      if (!ims || !ims.length) return 0;
      const ar = ims.map((im) => im.width / im.height);      // w per unit h
      const sum = ar.reduce((a, b) => a + b, 0);
      const avail = wid - GAP * (ims.length - 1);
      return Math.min(targetH, avail / sum);
    };
    const photoRow = (pg, ims, x, yTop, wid, targetH) => {
      const h = photoRowH(ims, wid, targetH);
      if (!h) return 0;
      let cx = x;
      ims.forEach((im) => {
        const w = h * (im.width / im.height);
        pg.drawRectangle({ x: cx, y: H - yTop - h, width: w, height: h, color: T.soft });
        pg.drawImage(im, { x: cx, y: H - yTop - h, width: w, height: h });
        cx += w + GAP;
      });
      return h;
    };
    const MAPBOX = (pg, img, x, yTop, boxW, boxH) => {
      const s = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * s, h = img.height * s;
      const px = x + (boxW - w) / 2;
      pg.drawImage(img, { x: px, y: H - yTop - h, width: w, height: h });
      marks.forEach((m) => {
        const bx = px + (m.x / 100) * w, by = H - (yTop + (m.y / 100) * h);
        pg.drawCircle({ x: bx, y: by, size: 10, color: WHITE });
        pg.drawCircle({ x: bx, y: by, size: 8.5, color: T.accent });
        const l = String(m.n), lw = bold.widthOfTextAtSize(l, 9);
        pg.drawText(l, { x: bx - lw / 2, y: by - 3.2, size: 9, font: bold, color: WHITE });
      });
      return yTop + h;
    };
    const newPg = () => { pageNo += 1; return doc.addPage([W, H]); };
    const mast = (pg, right) => {
      pg.drawCircle({ x: MG + 6, y: H - 44, size: 6.5, color: T.accent });
      pg.drawCircle({ x: MG + 6, y: H - 44, size: 3.1, color: WHITE });
      TX(pg, 'SiteVisit', MG + 17, 40, 10.5, bold, T.ink);
      TX(pg, 'IQ', MG + 17 + bold.widthOfTextAtSize('SiteVisit', 10.5) + 2.5, 40, 10.5, bold, T.accent);
      if (right) CAPS(pg, right, W - MG - capW(right, 6.5, 1.8), 41, 6.5, T.warm, 1.8);
      RULE(pg, MG, 58, W - MG, T.ink, 0.8);
      return 58;
    };
    const foot = (pg) => {
      RULE(pg, MG, H - 44, W - MG);
      TX(pg, rptName || propName, MG, H - 36, 7, reg, T.warm);
      const p = String(pageNo).padStart(2, '0');
      TX(pg, p, W - MG - bold.widthOfTextAtSize(p, 7.5), H - 36, 7.5, bold, T.ink);
    };
    // status reads as a marker, not a filled chip (ink-light)
    const statusMark = (pg, it, x, yTop) => {
      const s = (it.status || 'Open').toUpperCase();
      pg.drawCircle({ x: x + 2.5, y: H - yTop - 3, size: 2.5, color: it.status === 'Complete' ? T.accent : T.warm });
      CAPS(pg, s, x + 9, yTop - 1, 5.8, T.warm, 1.2);
      return capW(s, 5.8, 1.2) + 11;
    };

    // ================= COVER =================
    const cov = newPg();
    // title-page brand lockup — the software is the headline act here
    (() => {
      const cx = MG + 13, cy = H - 52;
      cov.drawCircle({ x: cx, y: cy, size: 13, color: T.accent });
      cov.drawCircle({ x: cx, y: cy, size: 6.2, color: WHITE });
      cov.drawCircle({ x: cx, y: cy, size: 2.8, color: T.accent });
      TX(cov, 'SiteVisit', MG + 34, 40, 24, bold, T.ink);
      const bw = bold.widthOfTextAtSize('SiteVisit', 24);
      TX(cov, 'IQ', MG + 34 + bw + 6, 40, 24, bold, T.accent);
      CAPS(cov, 'Operations Intelligence', MG + 35, 70, 7, T.warm, 2.7);
      RULE(cov, MG, 92, W - MG, T.ink, 0.8);
    })();
    let y = 92 + 18;
    CAPS(cov, 'Site Visit Report', MG, y, 6.5, T.accent, 2.4); y += 18;
    wrapLines(propName, bold, 26, CW).forEach((ln) => { TX(cov, ln, MG, y, 26, bold, T.ink); y += 30; });
    if (property && property.address) { TX(cov, property.address, MG, y, 9.5, reg, T.warm); y += 15; }
    TX(cov, [fmtDate(date), walker ? `Walked by ${walker}` : null].filter(Boolean).join('     ·     '), MG, y, 8.5, reg, T.warm);
    y += 18;
    RULE(cov, MG, y, W - MG, T.ink, 0.8); y += 13;
    // metric row
    const cells = [[nLife, 'Life safety'], [nHigh, 'High'], [nTodo, 'Manager to-do'], [list.length, 'Total issues']];
    const cwid = CW / cells.length;
    cells.forEach(([v, k], i) => {
      TX(cov, String(v), MG + i * cwid, y, 19, bold, i === 0 && v > 0 ? T.flag : T.ink);
      CAPS(cov, k, MG + i * cwid, y + 23, 5.8, T.warm, 1.5);
    });
    y += 36; RULE(cov, MG, y, W - MG); y += 18;
    // large site map
    if (map) y = MAPBOX(cov, map, MG, y, CW, 310) + 22;
    // index — titles wrap, never truncated
    CAPS(cov, 'Issues at a glance', MG, y, 6.5, T.ink, 2);
    RULE(cov, MG + capW('Issues at a glance', 6.5, 2) + 12, y + 4, W - MG);
    y += 14;
    const TCOL = MG + 24, CATX = W - MG - 178, SEVX = W - MG - 84;
    // a long inspection spills the index onto continuation pages rather than
    // running off the bottom of the cover
    const IDX_LIMIT = H - 62;
    let ip = cov;
    list.forEach((it, i) => {
      const tl = wrapLines(it.title || '(untitled)', reg, 8.5, CATX - TCOL - 12);
      const rowH = Math.max(14, tl.length * 10.5 + 4) + 7;
      if (y + rowH > IDX_LIMIT) {
        foot(ip);
        ip = newPg();
        y = mast(ip, `${propName} · ${fmtDate(date)}`) + 16;
        CAPS(ip, 'Issues at a glance · continued', MG, y, 6.5, T.ink, 2);
        RULE(ip, MG + capW('Issues at a glance · continued', 6.5, 2) + 12, y + 4, W - MG);
        y += 14;
      }
      TX(ip, String(i + 1).padStart(2, '0'), MG, y, 8.5, bold, T.accent);
      tl.forEach((ln, k) => TX(ip, ln, TCOL, y + k * 10.5, 8.5, reg, T.ink));
      TX(ip, it.category || '—', CATX, y, 7.5, reg, T.warm);
      CAPS(ip, it.life_safety ? 'LIFE SAFETY' : rating(it), SEVX, y, 6, urgent(it) ? T.flag : T.warm, 1.2);
      y += Math.max(14, tl.length * 10.5 + 4);
      RULE(ip, MG, y - 3, W - MG); y += 7;
    });
    foot(ip);

    // ================= ISSUE PAGES =================
    const LIMIT = H - 56;
    let pg = null;
    const open = () => { pg = newPg(); mast(pg, `${propName} · ${fmtDate(date)}`); foot(pg); return 74; };

    // Nothing is truncated any more: notes and more-detail wrap in full and the
    // card grows to fit. Cards are measured individually and flowed into
    // whichever column is shorter, so short cards no longer leave dead space.
    const measureBlock = (wid, it, photoH) => {
      let h = 13;
      h += wrapLines(it.title || '(untitled)', bold, 10.5, wid - 36).length * 12.5 + 1;
      if (it.category || it.walker_name) h += 11;
      h += 8;
      if (it.notes) h += 9 + wrapLines(it.notes, reg, 8, wid).length * 9.8 + 4;
      if (it.detail) h += 9 + wrapLines(it.detail, reg, 8, wid - 10).length * 9.8 + 4;
      const ims = (imgs[it.id] || []).slice(0, MAXPH);
      return h + 2 + (ims.length ? photoRowH(ims, wid, photoH) + 2 : 0);
    };

    // one issue block, mirroring the field-app entry order:
    // what did you find -> rating/flags -> category/status -> notes -> more detail -> photos
    const block = (x, yTop, wid, it, idx, photoH) => {
      let ty = yTop;
      const IND = 36;
      const nn = String(idx + 1).padStart(2, '0');
      TX(pg, nn, x, ty - 4, 24, bold, T.accent, -0.8);
      pg.drawLine({ start: { x, y: H - ty - 26 }, end: { x: x + 25, y: H - ty - 26 }, thickness: 1.8, color: T.accent });
      let fx = x + IND;
      if (it.life_safety) { CAPS(pg, 'LIFE SAFETY', fx, ty + 1, 6, T.flag, 1.2); fx += capW('LIFE SAFETY', 6, 1.2) + 10; }
      CAPS(pg, rating(it), fx, ty + 1, 6, urgent(it) ? T.flag : T.warm, 1.2); fx += capW(rating(it), 6, 1.2) + 10;
      if (it.send_todo) { CAPS(pg, 'TO-DO', fx, ty + 1, 6, T.accent, 1.2); }
      statusMark(pg, it, x + wid - 62, ty + 1);
      ty += 13;
      wrapLines(it.title || '(untitled)', bold, 10.5, wid - IND)
        .forEach((ln) => { TX(pg, ln, x + IND, ty, 10.5, bold, T.ink); ty += 12.5; });
      ty += 1;
      const mt = [it.category, it.walker_name ? 'Logged by ' + it.walker_name : null].filter(Boolean).join('   ·   ');
      if (mt) { CAPS(pg, mt, x + IND, ty, 5.6, T.warm, 1.1); ty += 11; }
      RULE(pg, x, ty, x + wid); ty += 8;
      // NOTES — captured in the field
      const nt = it.notes || '';
      if (nt) {
        CAPS(pg, 'Notes', x, ty, 5.6, T.ink, 1.4); ty += 9;
        wrapLines(nt, reg, 8, wid).forEach((ln) => { TX(pg, ln, x, ty, 8, reg, T.ink); ty += 9.8; });
        ty += 4;
      }
      // MORE DETAIL — added at the office, marked with an accent rule
      const dt = it.detail || '';
      if (dt) {
        const dl = wrapLines(dt, reg, 8, wid - 10);
        const bh = 9 + dl.length * 9.8;
        pg.drawLine({ start: { x: x + 1, y: H - ty - 1 }, end: { x: x + 1, y: H - ty - bh }, thickness: 1.4, color: T.accent });
        CAPS(pg, 'More detail · office', x + 10, ty, 5.6, T.accent, 1.4); ty += 9;
        dl.forEach((ln) => { TX(pg, ln, x + 10, ty, 8, reg, T.ink); ty += 9.8; });
        ty += 4;
      }
      // photos at the foot of the block, uncropped
      const ims = (imgs[it.id] || []).slice(0, MAXPH);
      const top = Math.max(ty + 2, yTop);
      if (!ims.length) return top;
      return top + photoRow(pg, ims, x, top, wid, photoH);
    };

    // same card system, two densities:
    //   ledger -> 6 per page, compact photo strip
    //   record -> 4 per page, larger photos for detail review
    //   ledger -> 2 columns, photo row ~1.6in tall
    //   record -> 2 columns, photo row ~2.4in tall for close review
    const PH = REC ? 172 : 116;
    const GW = (CW - 20) / 2;
    const COLX = [MG, MG + GW + 20];
    const TOP = 74;

    let colY = [TOP, TOP];
    y = open();
    colY = [TOP, TOP];
    list.forEach((it, i) => {
      const bh = measureBlock(GW, it, PH) + 14;
      // place in whichever column is currently shorter
      let c = colY[0] <= colY[1] ? 0 : 1;
      if (colY[c] + bh > LIMIT) {
        // a card taller than a full column still has to go somewhere
        if (bh <= LIMIT - TOP) { y = open(); colY = [TOP, TOP]; c = 0; }
        else { y = open(); colY = [TOP, TOP]; c = 0; }
      }
      const yTop = colY[c];
      block(COLX[c], yTop, GW, it, i, PH);
      colY[c] = yTop + bh;
      RULE(pg, COLX[c], colY[c] - 9, COLX[c] + GW);
    });
    return doc.save();
  }
  // ---------- AGENDA / CRITICAL ----------
  let list, pinColor;
  if (type === 'agenda') {
    const ag = items.filter((i) => i.on_agenda && !i.archived);
    list = tourOrder(ag);
    pinColor = NAVY;
  } else {
    const sevRank = { High: 0, Monitor: 1, Status: 2, Low: 3, Medium: 3 };
    list = items.filter((i) => !i.archived && i.status !== 'Complete' && (i.priority === 'High' || i.life_safety))
      .sort((a, b) => (sevRank[a.priority] ?? 3) - (sevRank[b.priority] ?? 3));
    pinColor = CORAL;
  }
  const marks = list.filter((i) => i.map_x != null).map((it) => ({ x: it.map_x, y: it.map_y, n: list.indexOf(it) + 1, color: pinColor }));

  let { page, top } = newPage(title);
  let y = top;
  const summary = type === 'agenda'
    ? `${list.length} stop${list.length === 1 ? '' : 's'} · walked in the order below to minimize backtracking`
    : `${list.length} critical / life-safety item${list.length === 1 ? '' : 's'} open`;
  page.drawText(summary, { x: M, y: PAGE_H - y - 10, size: 9.5, font: reg, color: MUTED });
  y += 22;

  if (map) {
    const drawn = drawMap(page, map, marks, y, { maxH: 360 });
    drawn.drawPins(fonts, pinColor);
    y = drawn.bottomTop + 22;
  } else if (marks.length) {
    page.drawText('No site map loaded — items are listed below.', { x: M, y: PAGE_H - y - 10, size: 9.5, font: reg, color: MUTED });
    y += 18;
  }

  y = heading(page, y, type === 'agenda' ? 'STOPS IN ORDER' : 'ITEMS');

  const listX = M + 26;
  const listW = CONTENT_W - 26;
  for (let idx = 0; idx < list.length; idx++) {
    const it = list[idx];
    const titleLines = wrapLines(it.title || '(untitled)', bold, 11, listW);
    const metaBits = [];
    metaBits.push(PRIO_LABEL[it.priority] || it.priority || '');
    if (it.category) metaBits.push(it.category);
    if (it.life_safety) metaBits.push('LIFE SAFETY');
    if (it.map_x == null) metaBits.push('not on map');
    const metaLine = metaBits.filter(Boolean).join('  ·  ');
    const detail = type === 'agenda' ? (it.detail || it.notes || '') : '';
    const detailLines = detail ? wrapLines(detail, reg, 9, listW) : [];
    const blockH = titleLines.length * 13 + 12 + (detailLines.length * 11) + 12;

    if (PAGE_H - y - blockH < 56) { const np = newPage(title + ' (cont.)'); page = np.page; y = np.top; }
    const badgeY = PAGE_H - y - 4;
    page.drawCircle({ x: M + 8, y: badgeY, size: 8.5, color: type === 'agenda' ? NAVY : CORAL });
    const num = String(idx + 1); const nw = bold.widthOfTextAtSize(num, 8.5);
    page.drawText(num, { x: M + 8 - nw / 2, y: badgeY - 3, size: 8.5, font: bold, color: WHITE });
    let ly = y;
    titleLines.forEach((ln) => { page.drawText(ln, { x: listX, y: PAGE_H - ly - 10, size: 11, font: bold, color: INK }); ly += 13; });
    if (metaLine) { page.drawText(metaLine, { x: listX, y: PAGE_H - ly - 9, size: 8.5, font: reg, color: it.life_safety ? CORAL_D : MUTED }); ly += 12; }
    detailLines.forEach((ln) => { page.drawText(ln, { x: listX, y: PAGE_H - ly - 9, size: 9, font: reg, color: rgb(0.29, 0.34, 0.40) }); ly += 11; });
    y = ly + 12;
    page.drawLine({ start: { x: listX, y: PAGE_H - y + 5 }, end: { x: PAGE_W - M, y: PAGE_H - y + 5 }, thickness: 0.5, color: LINE });
  }
  if (!list.length) {
    page.drawText(type === 'agenda' ? 'No items on the agenda yet.' : 'No critical items open.', { x: listX, y: PAGE_H - y - 10, size: 11, font: reg, color: MUTED });
  }
  return doc.save();
}
