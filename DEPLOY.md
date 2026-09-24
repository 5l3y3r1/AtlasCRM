# AtlasCRM — Deployment Guide

This app is **Node.js + Express + `node:sqlite`**. Two hard requirements:

1. **Node 22+** (the built-in `node:sqlite` module does not exist before Node 22).
2. **Persistent storage for `warm.db`** — on hosts with ephemeral disks (Render/Railway/Fly),
   attach a volume and point `DB_PATH` at it, or the database resets on every redeploy.

## Environment variables

See `.env.example` for the complete annotated list. The ones that matter most:

| Var | Purpose | Production value |
|-----|---------|------------------|
| `NODE_ENV` | enables the production guards | `production` |
| `JWT_SECRET` | session signing | **a long random string — the server refuses to start without it when `NODE_ENV=production`** |
| `PORT` | HTTP port | set by host, default 3000 |
| `DB_PATH` | SQLite file path | on the persistent volume, e.g. `/data/warm.db` |
| `UPLOADS_DIR` | uploaded photos/documents | on the same volume, e.g. `/data/uploads` |
| `BACKUP_DIR` | automatic snapshots | on the same volume, e.g. `/data/backups` |
| `APP_URL` | public base URL | used to build password-reset links — wrong value = broken resets |
| `MAIL_SMTP_*`, `MAIL_FROM` | transactional email | without these, nobody can recover a forgotten password |
| `SUPER_ADMIN_EMAILS` | unlocks `/admin` | your own address |
| `SCRAPER_KEY` | shared key for `/api/scraper/ingest` | a long random string |
| `CRM_INGEST_KEY` | shared key for the browser extension | a long random string |

Generate any secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

First boot seeds the DB automatically (login: `beso@prime.ge` / `warm123` — change this).

## Health checks

Point your host's health check at **`/healthz`**. It touches the database, so a
container whose volume failed to mount reports 503 instead of a misleading OK.

## Backups

Snapshots are automatic — daily by default, keeping the last 14, written with
`VACUUM INTO` while the server keeps serving. Each is a standalone `.db` file.

**`BACKUP_DIR` must be on the same persistent volume as `DB_PATH`.** Put it
anywhere else and the snapshots die with the container, which is the one
scenario they exist for.

To restore: stop the app, replace the file at `DB_PATH` with a snapshot
(removing any `-wal` / `-shm` siblings), and start it again.

```bash
# verify a snapshot before trusting it
node -e "const {DatabaseSync}=require('node:sqlite');
         const d=new DatabaseSync('hearth-2026-09-15T03-54-39.db');
         console.log(d.prepare('PRAGMA integrity_check').get());
         console.log(d.prepare('SELECT COUNT(*) n FROM listings').get());"
```

A backup you have never restored is a hypothesis, not a backup — do this once
on a copy before you need it for real.

---

## Docker (any VPS)

```bash
docker build -t warm-ge .
docker run -d --name warm-ge \
  -p 80:3000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e SCRAPER_KEY="$(openssl rand -hex 32)" \
  -v warm-data:/data \
  warm-ge
```

The named volume `warm-data` keeps `warm.db` across container restarts/rebuilds.

---

## Render

- New → Web Service → connect repo.
- Runtime: Docker (uses the included `Dockerfile`).
- Add a **Disk**: mount path `/data`, size 1 GB.
- Env vars: `JWT_SECRET`, `SCRAPER_KEY`, `DB_PATH=/data/warm.db`.

## Railway

- New Project → Deploy from repo (Docker autodetected).
- Add a **Volume** mounted at `/data`.
- Variables: `JWT_SECRET`, `SCRAPER_KEY`, `DB_PATH=/data/warm.db`.

## Fly.io

```bash
fly launch --no-deploy        # accept the Dockerfile
fly volumes create warm_data --size 1
# in fly.toml add:  [mounts] source="warm_data" destination="/data"
fly secrets set JWT_SECRET=$(openssl rand -hex 32) SCRAPER_KEY=$(openssl rand -hex 32) DB_PATH=/data/warm.db
fly deploy
```

---

## The myhome.ge / ss.ge scraper

The CRM does **not** scrape by itself (by design — see the in-app note). It exposes an
ingestion endpoint that any external scraper pushes into:

```
POST /api/scraper/ingest
Header:  X-Scraper-Key: <SCRAPER_KEY>
Body:    { "listings": [ { source, external_id, external_url, title, description,
                           list_price, bedrooms, area_sqm, region, city, district,
                           owner_phone, is_owner } ] }
```

Rows are upserted by `(source, external_id)`, so re-running is safe.

A starter scraper is in `scraper/scraper.py`. Run it on a cron (e.g. hourly):

```cron
0 * * * * cd /path/to/app/scraper && SCRAPER_KEY=xxx CRM_URL=https://your-app python3 scraper.py
```

> Respect each site's Terms of Service and `robots.txt`. For production volume you
> generally need the site's permission or an official data feed/API.

The **„განახლება“** button in the AI Hunter → external tab seeds demo rows via
`POST /api/scraper/sample` so you can see the feature working before a real scraper is wired up.
