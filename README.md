# SiteVisit IQ

Clover Capital Partners — site-visit inspection app (field app) + desktop dashboard.

Next.js 14 (App Router). Deploys on Vercel.

## Required environment variables (already set on the existing Vercel project)
- `POSTGRES_URL` — Vercel Postgres connection (or DATABASE_URL)
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob store token
- `SESSION_SECRET` — any long random string for signing login cookies

> Connect this repo to the EXISTING `clover-visitiq` Vercel project (Settings → Git)
> so the database, blob storage, and the clover-visitiq.vercel.app URL carry over.

## Local dev
```
npm install
npm run dev
```
