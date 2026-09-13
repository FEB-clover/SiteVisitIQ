# SiteVisit IQ — Site Visit Workflow Specification

**Prepared for:** SiteVisit IQ app team
**Prepared by:** Fritz Barton, Clover Capital Partners
**Version:** 2 (supersedes v1 — Site Visit is now a named report object, and photo markup is added)
**Scope:** Add an end-to-end Site Visit workflow — create a named report, build it during a walk, save it, archive it, print or send it — across the field app and the desktop dashboard, with photo markup on both.

---

## 0. Objective

Give inspectors one consistent Site Visit workflow that works identically on the phone (field app) and the browser (dashboard). A user creates a **named Site Visit Report**, adds issues to it before or during a walk, generates a clean portrait PDF with a site map and photos, saves it, and retrieves it later from either device.

**Design principle:** the dashboard is not a separate product. It is the field app re-laid-out for desktop. Every new control below ships in *both* `phone.js` and `dashboard/dashboard.js`, wired to the *same* backend endpoints, with the same labels and the same behavior. Only layout and input method differ — **touch on the field app, mouse/click on the dashboard**.

---

## 1. Current architecture (grounding for the team)

**Stack:** Next.js 14 (App Router), React 18, Vercel Postgres (`@vercel/postgres`), Vercel Blob (`@vercel/blob`) for photos and site maps, PDF generation via `pdf-lib`. Passcode auth via signed HMAC cookie (`lib/auth.js` → `currentUser()` returns `{id, name, role}`).

**Two front ends, one backend:**

- Field app: `app/phone.js`. Tabs (`const TABS`): `queue, critical, agenda, plans, archive, prewalk`. Key components: `Queue`, `ItemCard`, `Agenda`, `Archive`, `ItemSheet` (issue editor), `BottomNav`, `Zoomable` (touch pin placement), `PhotoViewer`, `ReportViewer`.
- Dashboard: `app/dashboard/dashboard.js`. Same `TABS` plus a cross-property `AllIssues` view. Key components: `Queue`, `IssueCard`, `Agenda`, `Archive`, `ItemModal` (issue editor), `NewIssueModal`, `MouseZoom` (click pin placement), `Lightbox`, `uploadPhotos()` (multi-file + drag-drop helper).

**Data model (`lib/db.js`):**

- `users(id, name, role, pin, active, created_at)`
- `properties(id, name, address, units, site_map_url, sort)` — **note: `address` already exists**, so the report header needs no new field for it.
- `property_floors(id, property_id, url, idx)`
- `items(id, property_id, title, notes, detail, priority, status, life_safety, send_todo, map_x, map_y, walker_id, walker_name, office_note, category, discussed, on_agenda, archived, source, walk_date, capex, lender, ref, created_at, updated_at)`
- `item_photos(id, item_id, url, created_at)` — multiple photos per item, public Blob URLs.
- `activity(id, item_id, who, what, at)` — audit log.

**Report pipeline (`lib/report.js` + `app/api/report/route.js`):**

- `GET /api/report?type=<t>&property=<id>&id=<itemId>` returns a portrait US-Letter PDF (612×792) inline.
- Existing types: `agenda, critical, sitemap, floorplans, prewalk, item`.
- Reusable primitives already in `buildReport()`: `drawHeader()` (brand band with property + date), `drawFooter()`, `drawMap()` (fits an image into a box and drops numbered pins from `map_x/map_y` percentages), `tourOrder()` (nearest-neighbor ordering), `pill()` (badges), `wrapLines()`.
- **Parity note:** the `agenda` report is the closest existing analog — it already renders a site map with numbered pins plus an ordered issue list. The Site Visit report is "agenda report + full issue detail + all photos per issue," so most drawing code is reusable.

**Two gaps the Site Visit report must close:**

1. The single-`item` report embeds **only the first photo** (`photoBytes[0]`). Site Visit must embed **all** photos per issue.
2. Reports are **generated on the fly and never persisted**. Named, saved, archived reports require a new persistence layer (§4).

---

## 2. Feature 1 — Site Visit Reports as named objects

### 2.1 The model (important — this replaces a simple checkbox approach)

A Site Visit Report is a **first-class record**, not a per-issue flag. Each report has its own name, property, address, date, walker, and its own list of issues. Consequences that matter:

- A user can create **as many reports as they want**, whenever they want, on either app.
- A new report **starts empty by definition** — there is no shared "cart" to clear after printing.
- An issue can belong to **many reports over time** (August's walk and October's walk both preserved), so "who walked this and when" is simply the most recent saved report that contained it. No overwrite decision exists.

### 2.2 New tab
Add a `Site Visit` tab to `TABS` in **both** apps, between `agenda` and `plans`:

```js
{ id: 'sitevisit', label: 'Site Visit', ic: '✓' }
```

New components: `SiteVisit` (in `phone.js`) and `SiteVisit` (in `dashboard.js`).

### 2.3 Creating a report
The Site Visit tab leads with a **“New Site Visit Report”** button. Pressing it opens a small create form and immediately produces a `draft` report stamped with:

| Field | Source | Editable? |
|---|---|---|
| **Name** | user-typed (default `Site Visit — <Mon D, YYYY>`) | Yes |
| **Property name** | current property | No (auto) |
| **Property address** | `properties.address` | No (auto) |
| **Walk date** | today (date picker) | Yes |
| **Walker** | `currentUser().name` | **No — always the logged-in user** |

Walker is deliberately non-editable: the report always credits whoever is signed in, so reports stay honest about who actually walked the property.

### 2.4 The active draft
"Add to Site Visit" actions need a target report. Rule:

- The Site Visit tab lists the user's `draft` reports for the current property; the most recently updated one is **active** by default, and the user can switch which draft is active.
- If a user taps "+ Site Visit" on an issue and **no draft exists**, prompt "Start a new Site Visit Report?" and create one with the default name.
- Because drafts live server-side, a walk started on the phone is still active on the dashboard — a user can tag issues in the field and finish the report at a desk.

### 2.5 Add-to-report controls (both apps)
The same action appears in three places, mirroring how `on_agenda` is exposed today:

1. **Inside an opened issue** — a **"Site Visit"** button on `ItemSheet` (field) and `ItemModal` (dashboard), next to the existing Agenda/Archive toggles. Adds/removes the issue from the active draft.
2. **On the Issues/Queue list** — a compact **"+ Site Visit"** quick action on `ItemCard` (field) and `IssueCard` (dashboard), alongside the existing actions row (`phone.js` ~line 350, `dashboard.js` ~line 376). Lets a user tag issues during a walk without opening each one.
3. **On the Site Visit tab** — a bulk picker (checkbox list of the property's open issues) for assembling a report at a desk.

Each of these calls `POST`/`DELETE /api/site-reports/<id>/items`. The control shows an active (coral) state when the issue is already in the active draft.

---

## 3. Feature 2 — The Site Visit Report output

### 3.1 Site Visit tab contents
A **review + preview + output** surface:

- **Report header card:** name (inline-editable), property name + address, walk date, walker.
- **Selected issues list:** every issue attached to the report, in map/tour order (reuse `tourOrder()`), each showing title, priority/life-safety badges, photo count, and a remove (✕) control.
- **Preview:** inline PDF preview pane on the dashboard; a "Preview report" button opening `ReportViewer` on the phone.
- **Actions:** **Save**, **Print**, **Send** (§3.5).
- **Saved reports list:** the property's saved reports, also surfaced in Archive (§4).

### 3.2 New report type
Add `sitevisit` to `TYPES` in `app/api/report/route.js`, to the `TITLES` map, and as a new branch in `buildReport()`. Title: **"Site Visit Report."**

```
GET /api/report?type=sitevisit&report=<reportId>
```
The route loads the report record, its `site_report_items`, the property (name + address + site map), and all photos per issue.

### 3.3 Report layout (portrait, concise)

**Page 1 header (extend `drawHeader`):** print **report name**, **property name**, **property address**, **walk date**, and **walker name**. These are the identity requirements; address is the only genuinely new line versus the existing header.

**Page 1, upper half — site map (only when location data exists):**
- Reuse `drawMap()` with numbered pins from each included issue's `map_x/map_y`. Pin numbers match the issue cards below.
- **Cap map height at roughly half the first page:** header content starts ~86pt from the top and half-page is 396pt, so pass **`maxH ≈ 300–320pt`**. This guarantees the map never makes the report long.
- If **no** included issue has coordinates, skip the map entirely and start the grid at the top with a one-line "No mapped locations for the selected issues."

**Below the map — issue grid:**
- A **two-column grid of issue cards** (drop to one column for issues with many photos). Each card, numbered to match its pin:
  - Title + priority / life-safety / status pills (`pill()`).
  - Meta line: category · "Logged by <walker_name>" · source.
  - Notes / detail (`wrapLines()`), capped at a sensible height per card so one verbose issue can't blow out a page; overflow continues on the next page.
  - **All photos for the issue**, as a compact thumbnail strip — target **2 across** per grid cell at ~150–170pt wide: large enough to review, tight enough to stay concise. Requires gathering `photoBytes` for *every* `item_photos` row per issue, not just the first.
- Auto-paginate with the existing `newPage()` + height-check pattern; header/footer repeat on every page.

### 3.4 Separation from the Agenda report
The Agenda report (`type=agenda`) is **unchanged** — different type, tab, storage, and archive section. The only overlap is reusable drawing primitives.

### 3.5 Save, Print, Send
- **Save** — `POST /api/site-reports/<id>/save`: renders the PDF, stores it in Blob (`site-reports/<property>/<id>.pdf`), sets `status='saved'` + `pdf_url`, and stamps last-walked metadata onto every included issue (§5). The report becomes available in Archive from both apps.
- **Print** — open the PDF (`openReport()` → `window.open` on dashboard; `ReportViewer` on phone) and use the browser/OS print dialog.
- **Send** — because the saved PDF lives at a public Blob URL: **Copy link** on the dashboard, and the native share sheet (Web Share API) on the phone, plus a `mailto:` that pre-fills a subject and the link. *Note: sending the PDF as a true email attachment would require adding an outbound mail service (e.g. Resend/SendGrid) — out of scope for v1; link-sharing covers the need.*

A saved report stays viewable as rendered. Editing a saved report should either re-open it as a new draft or re-save and re-render (recommend: **allow re-save, which re-renders `pdf_url`**).

---

## 4. Feature 3 — Archive: "Site Reports"

### 4.1 Persistence
```sql
CREATE TABLE IF NOT EXISTS site_reports (
  id           serial PRIMARY KEY,
  property_id  text NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name         text NOT NULL,
  walk_date    date NOT NULL,
  walker_id    int REFERENCES users(id),
  walker_name  text NOT NULL,
  status       text NOT NULL DEFAULT 'draft',   -- 'draft' | 'saved'
  pdf_url      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_report_items (
  report_id  int NOT NULL REFERENCES site_reports(id) ON DELETE CASCADE,
  item_id    int NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  sort       int NOT NULL DEFAULT 0,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, item_id)
);
```
The join table (rather than a flag on `items`) is what allows many reports over time, independent membership, and empty-by-default new reports.

### 4.2 UI (both apps)
In the existing `Archive` component, add a **"Site Reports"** section listing saved reports with, per requirement:

- **Walker** (`walker_name`) — who ran/prepared it
- **Date** (`walk_date`)
- **Property** (name — especially relevant in the dashboard's cross-property view)
- plus the **report name** and issue count.

Row click opens `pdf_url` (in `ReportViewer` on phone, new tab on dashboard), with Print and Send actions. Reports are server records, so they open from **either** app.

---

## 5. Feature 4 — Walk metadata on issues

**Important distinction.** `items.walker_name` / `items.walk_date` today mean *who first logged the issue and when* (set at creation in `POST /api/items`). Do **not** repurpose them — the tile would start showing the wrong thing. Add separate fields:

```sql
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_walked_by text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_walked_date date;
```

- On **Save** of a Site Visit Report, for each included issue set `last_walked_by = report.walker_name` and `last_walked_date = report.walk_date` (only when newer than the existing value, so re-saving an old report can't roll the stamp backwards).
- Log to `activity`: "included in Site Visit report '<name>' (walked <date>)".
- **Display on the issue tile** in `ItemCard` (field) and `IssueCard` (dashboard): a small line **"Walked by <last_walked_by> · <last_walked_date>"**, plus the existing "Logged by" where shown. Render nothing when unset.

---

## 6. Feature 5 — Queue sort / filter

Add a compact filter bar above the list in `Queue` (both apps) and the dashboard `AllIssues` view:

- **Filter by walker** — dropdown of distinct `last_walked_by` values (or from `users`).
- **Filter by walk date / range** — single date or from–to against `last_walked_date`.
- Combines with the existing default ordering (priority, then recency).

**Implementation:** client-side for v1 — `GET /api/items` already returns the item rows, so once `last_walked_by/date` are added they filter in-component with no backend change. Move to server-side (`?walker=&from=&to=`) once per-property item counts grow large.

---

## 7. Feature 6 — Dashboard photo download

Select photos across issues and download them organized, ready to save and email.

### 7.1 Selection UI (dashboard)
- A **"Select photos"** mode. In `AllIssues`, `Queue`, and `ItemModal`, thumbnails get a checkbox overlay (reuse existing thumbnail rendering + `Lightbox`).
- Shortcuts: "Select all photos for this issue," and on the Site Visit tab, "Select all photos in this report."
- Running counter plus a **"Download (N)"** button.

### 7.2 Download mechanism — server-side zip
`POST /api/photos/download` with `{ urls: [...] }` or `{ item_ids: [...] }`. The server streams a `.zip` with **organized, human-readable filenames**:

```
<Property>/<Issue title>-<n>.jpg
e.g.  Woodlands-of-Tyler/Cracked-stair-tread-1.jpg
```

Headers: `content-disposition: attachment; filename="<Property>_photos_<date>.zip"`. Use `runtime='nodejs'`, raise `maxDuration`, and stream with a library such as `archiver` so large batches don't buffer in memory. Clean names are the point — they make the "save and email to the manager" step effortless.

### 7.3 Field app
Bulk photo download is a desktop need; not required on the phone in v1.

---

## 8. Feature 7 — Photo markup (draw on photos)

Let a user draw on a photo — in the field by **touch**, on the dashboard by **click/drag** — and save the marked-up image to the issue.

### 8.1 Why this fits cleanly
Both apps already capture pointer coordinates over an image to drop location pins (`Zoomable` on phone, `MouseZoom` on dashboard). Markup is the same input model capturing a continuous stroke instead of a single point, so the annotation surface is an extension of components that already handle the touch-vs-mouse difference.

### 8.2 Approach — flatten and save as an additional photo
1. Open a photo → **Markup**. An HTML `<canvas>` overlays the image at its natural aspect ratio.
2. The user draws. Input: `pointerdown/move/up` (Pointer Events cover touch and mouse in one code path — recommended over separate touch/mouse handlers).
3. On **Done**, composite the source image + the annotation layer onto an offscreen canvas at the original resolution, export via `canvas.toBlob()` (JPEG q≈0.9).
4. Upload through the **existing** `POST /api/photos` pipeline (`file` + `itemId`) → new `item_photos` row.

**Keep both:** the clean original stays on the issue; the marked-up version is saved as an **additional** photo. Nothing is destroyed and the user can always get back to the unmarked shot.

**The big payoff:** because annotations are baked into the saved JPEG, a marked-up photo is just a normal photo everywhere — issue tile, lightbox, photo download, and **inside the Site Visit and issue PDFs with zero changes to the `pdf-lib` report code**.

### 8.3 Tools (v1)
Freehand **pen**, **arrow**, **circle/ellipse**, with a small **color** set (coral `#e04a54`, yellow, white, black) and 2–3 stroke widths. **Undo** and **Clear**. Typed **text callouts** are a fast follow, not v1.

Implementation notes: keep strokes in a state array and re-render the canvas each frame so Undo is trivial; scale stroke coordinates to the image's natural size on export so markup lands correctly at full resolution regardless of display size; set `touch-action: none` on the canvas so drawing doesn't scroll the page on mobile.

### 8.4 Optional enhancement (not v1)
Persist the stroke list as JSON alongside the photo to allow re-editing markup later. Adds a column and re-render logic; the flatten approach above is recommended for v1.

---

## 9. Consolidated data-model changes

```sql
-- Named Site Visit Reports
CREATE TABLE IF NOT EXISTS site_reports (
  id serial PRIMARY KEY,
  property_id text NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  walk_date date NOT NULL,
  walker_id int REFERENCES users(id),
  walker_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Report membership (many reports per issue over time)
CREATE TABLE IF NOT EXISTS site_report_items (
  report_id int NOT NULL REFERENCES site_reports(id) ON DELETE CASCADE,
  item_id int NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  sort int NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, item_id)
);

-- Last-walked stamp (separate from "logged by" on creation)
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_walked_by text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS last_walked_date date;
```

Add all of the above to the idempotent `init()` in `lib/db.js`, using the existing `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` pattern. **No `on_site_visit` column** — membership lives in `site_report_items`.

---

## 10. Consolidated API changes

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/site-reports` | POST | Create a draft: `{property_id, name, walk_date}`; walker stamped from `currentUser()`. |
| `/api/site-reports` | GET | List by `?property=<id>` and/or `?status=draft\|saved`, `?mine=1`. |
| `/api/site-reports/[id]` | GET | Report record + attached issues (with photos). |
| `/api/site-reports/[id]` | PATCH | Rename, change walk date, reorder. |
| `/api/site-reports/[id]` | DELETE | Remove a draft. |
| `/api/site-reports/[id]/items` | POST / DELETE | Add / remove an issue from the report. |
| `/api/site-reports/[id]/save` | POST | Render PDF → Blob, set `status='saved'` + `pdf_url`, stamp `last_walked_*` on included issues. |
| `/api/report` | GET | New `type=sitevisit&report=<id>`; gather **all** photos per issue; half-page map + issue grid. |
| `/api/photos` | POST | Unchanged — reused for marked-up images. |
| `/api/photos/download` | POST | Server-side zip of selected photos with organized filenames. |
| `/api/items` | GET | (Optional, later) `?walker=&from=&to=` for server-side queue filtering. |

All endpoints follow the existing pattern: `currentUser()` auth guard, `ensureSchema()`, `runtime='nodejs'`, `dynamic='force-dynamic'`.

---

## 11. Consolidated UI changes (ship in both apps)

| Screen / component | Field (`phone.js`) — touch | Dashboard (`dashboard.js`) — click |
|---|---|---|
| Tabs | Add `sitevisit` to `TABS` + `BottomNav` | Add `sitevisit` to `TABS` + `PropNav` |
| Site Visit tab | New `SiteVisit`: New Report button, draft list, issue list, preview, Save/Print/Send | Same, with inline PDF preview pane |
| Issue editor | `ItemSheet`: "Site Visit" button | `ItemModal`: "Site Visit" button |
| Issue list row | `ItemCard`: "+ Site Visit" + "Walked by … · date" | `IssueCard`: same |
| Queue | Filter by walker + walk date | Same (and `AllIssues`) |
| Archive | New "Site Reports" section | New "Site Reports" section |
| Photo markup | Markup on `PhotoViewer` (touch draw) | Markup on `Lightbox` (mouse draw) |
| Photo download | — (v1) | Select-photos mode + "Download (N)" |

Labels, colors, and toast behavior must match between the two apps.

---

## 12. Suggested build sequence

1. **Schema** — `site_reports`, `site_report_items`, `last_walked_*` columns.
2. **Report CRUD API** — create/list/get/patch/delete + add/remove items.
3. **Site Visit tab** in both apps — New Report, active draft, add-to-report controls.
4. **`sitevisit` report type** in `lib/report.js` + `/api/report` (header with address/walker, half-page map, multi-photo issue grid).
5. **Save flow** — render to Blob, `status='saved'`, stamp `last_walked_*`.
6. **Archive "Site Reports"** section + open / print / send.
7. **Walk-metadata display** on issue tiles.
8. **Queue filter** by walker / date.
9. **Photo markup** (pen, arrow, circle, colors, undo).
10. **Dashboard photo download** (server-side zip).

Steps 1–6 deliver the complete Site Visit report loop; 7–10 are the surrounding conveniences. Each step is independently shippable and testable.

---

## 13. Decisions already made (no action needed)

- **Walker on a report:** always the logged-in user, not editable.
- **New reports:** always start empty; nothing to clear after saving (named-report model).
- **Repeat walks:** an issue can appear in many reports; the tile shows the most recent via `last_walked_*`.
- **Photo download:** packaged server-side as a zip with organized filenames.
- **Photo markup:** original photo is kept; the marked-up version saves as an additional photo.
- **Markup tools v1:** pen, arrow, circle, colors, undo — typed text callouts as a fast follow.
