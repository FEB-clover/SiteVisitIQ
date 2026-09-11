import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// ---- brand palette ----
const CORAL = rgb(0.878, 0.290, 0.329);   // #e04a54
const CORAL_D = rgb(0.784, 0.196, 0.227); // #c8323a
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
const PRIO_COLOR = { High: CORAL, Low: MUTED, Monitor: AMBER, Status: BLUE, Medium: MUTED };
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
function drawHeader(page, fonts, { title, property, date }) {
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
  page.drawLine({ start: { x: M, y: PAGE_H - 74 }, end: { x: PAGE_W - M, y: PAGE_H - 74 }, thickness: 1.5, color: CORAL });
  return 86;
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

export async function buildReport({ type, property, floors = [], items = [], item = null, mapBytes = null, floorBytes = [], photoBytes = [], date }) {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { reg, bold };
  const propName = property?.name || 'Property';
  let pageNo = 0;

  const TITLES = { agenda: 'Site Visit Agenda', critical: 'Critical Items', sitemap: 'Site Map', floorplans: 'Floorplans', prewalk: 'Pre-Walk Checklist', item: 'Issue Detail' };
  const title = TITLES[type] || 'Report';

  function newPage(t) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    pageNo += 1;
    const top = drawHeader(page, fonts, { title: t, property: propName, date });
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
