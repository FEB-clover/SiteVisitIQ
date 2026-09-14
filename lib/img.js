// Photo fetch + downsample for report generation.
//
// Phone photos arrive at 1200x1600 (~1MB each). Embedded at full resolution they
// made a 12-photo report 20MB — unmailable, and pointless: a photo printed 2"
// wide only needs ~600px to exceed 300 DPI. Shrinking to a 1000px long edge cuts
// ~85% of the bytes with no visible difference on paper or screen.
//
// sharp is optional at runtime: if it fails to load (or fails on a given image)
// we fall back to the original bytes so a report never fails to render.

export const PHOTO_MAX_EDGE = 1000;
export const PHOTO_QUALITY = 74;

let sharpMod;
let sharpTried = false;
async function getSharp() {
  if (sharpTried) return sharpMod;
  sharpTried = true;
  try { sharpMod = (await import('sharp')).default; }
  catch { sharpMod = null; }
  return sharpMod;
}

export async function fetchBytes(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// Shrink to fit inside maxEdge x maxEdge, honouring EXIF orientation.
// Never enlarges. Returns the original buffer if anything goes wrong.
export async function shrink(buf, maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_QUALITY) {
  if (!buf || !buf.length) return buf;
  const sharp = await getSharp();
  if (!sharp) return buf;
  try {
    const out = await sharp(buf)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return out.length < buf.length ? out : buf;
  } catch { return buf; }
}

// Fetch a photo already sized for the page.
export async function fetchPhoto(url, maxEdge = PHOTO_MAX_EDGE) {
  const b = await fetchBytes(url);
  return b ? shrink(b, maxEdge) : null;
}

// Site maps and floorplans are drawn large and need finer detail than a photo
// thumbnail, so they get a bigger budget — still far below a raw upload.
export async function fetchPlan(url) {
  const b = await fetchBytes(url);
  return b ? shrink(b, 1800, 82) : null;
}

// One human-readable name for a saved report, used for the stored file, the
// download and the PDF's own title. This is what shows up when someone texts
// or emails the report, so it has to read as a sentence, not a key.
//   "Creekstone Apartments - Site Visit Report - Fritz Barton - Sep 14 2026"
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(d) {
  const s = String(d || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  return `${MON[Number(m[2]) - 1]} ${Number(m[3])} ${m[1]}`;
}
export function reportName({ property, walker, date, kind = 'Site Visit Report' }) {
  // keep spaces and hyphens; drop only what breaks a URL or a filesystem
  const clean = (t) => String(t || '').replace(/[\\/:*?"<>|#%{}^~\[\]`]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return [clean(property), kind, clean(walker), prettyDate(date)]
    .filter(Boolean).join(' - ') || 'Site Visit Report';
}
