# warm.ge

A production-ready real-estate CRM for Georgia, built on Node.js + SQLite. No Supabase, no native modules to compile, no external services required.

## Quick start

```bash
cd server
npm install
npm run seed     # one-time: creates the demo company + login
npm start        # runs the server on http://localhost:3000
```

Open **http://localhost:3000** in your browser and log in with:

| email             | password   | role         |
|-------------------|------------|--------------|
| `beso@prime.ge`   | `warm123`  | FOUNDER      |
| `nino@prime.ge`   | `warm123`  | AGENT        |
| `giorgi@prime.ge` | `warm123`  | AGENT        |
| `tamar@prime.ge`  | `warm123`  | MANAGER      |

## What's inside

### Sidebar pages (every one is wired up to live data)

- **Dashboard** — KPIs (active listings / new leads / active deals / commissions), deal pipeline, recent leads
- **რუკა (Map)** — Mapbox view of listings with lat/lng markers *(requires internet)*
- **ლიდები (Leads)** — full CRUD, sources (Facebook/Instagram/TikTok/MyHome/SS.ge/etc.), temperature (HOT/WARM/COLD)
- **კლიენტები (Clients)** — buyers, sellers, tenants, landlords with budget ranges
- **გარიგებები (Deals)** — pipeline stages from QUALIFICATION → SHOWING → NEGOTIATION → DEPOSIT → CLOSED_WON/LOST
- **ობიექტები (Listings)** — properties with photos, prices, regions, cadastral codes
- **აგენტები (Agents)** — team management
- **ამოცანები (Tasks)** — calls, meetings, paperwork, with priority and assignee
- **ჩვენებები (Showings)** — calendar of property viewings, feedback, ratings
- **ფინანსები (Finance)** — commissions per agent, transactions in/out
- **მარკეტინგი (Marketing)** — campaigns with budget/spent/leads/ROI per channel
- **იურისტი (Lawyer)** — contracts and templates (sale / rent / exclusivity)
- **AI Hunter** — hunting profiles + auto-scraped external listings from myhome.ge / ss.ge

### Architecture

```
server/
├─ server.js              Express app, routing, static serving
├─ db.js                  SQLite schema (Node 22's built-in sqlite, no compile)
├─ auth.js                bcrypt + JWT + session table
├─ seed.js                Demo data: 1 company, 4 users, 12 listings, 8 leads…
├─ routes/
│  ├─ auth.js             /api/auth/{signup,login,logout,session,me}
│  └─ data.js             /api/data/:table — PostgREST-compatible generic CRUD
├─ public/
│  ├─ warm_login.html     login + signup
│  ├─ warm.html           main SPA (every sidebar page lives here)
│  ├─ warm_dashboard.html standalone dashboard view
│  ├─ warm_add_lead.html  standalone "add lead" form
│  ├─ warm_add_listing.html standalone "add property" form
│  └─ js/
│     ├─ supabase-shim.js   drop-in @supabase/supabase-js replacement
│     └─ lucide.min.js      icon library (bundled, no CDN dependency)
└─ uploads/              user-uploaded photos and contract documents
```

### How the Supabase shim works

The frontend was originally built against Supabase's JS SDK. Rather than rewrite thousands of lines of UI code, `public/js/supabase-shim.js` reimplements `window.supabase.createClient()` with the same chainable API:

```javascript
// This exact line still works — but it's now talking to our local server:
await client.from('leads').select('*').eq('status', 'NEW').order('created_at', { ascending: false }).limit(10);
```

The shim translates SDK calls into PostgREST-style URL queries (`?status=eq.NEW&order=created_at.desc&limit=10`) and the server's generic `/api/data/:table` route parses that same dialect — including foreign-key embed joins like `select=*,property_images(*)`.

### Multi-tenancy

Every data table that has a `company_id` column is automatically scoped to the logged-in user's company. The server-side query builder injects `company_id = ?` into every `WHERE` clause unless the caller already supplied one. Tenants cannot read each other's data.

### Auth

- Passwords are hashed with bcrypt (10 rounds)
- Sessions are JWTs (signed with `JWT_SECRET` env var) **and** tracked in a `sessions` SQL table so `signOut()` actually invalidates the token server-side
- Sessions are delivered via a `httpOnly` cookie (`warm_session`) so the frontend can't accidentally leak the token

## Commands

```bash
npm start              # production
npm run dev            # restart on file changes (Node --watch)
npm run seed           # seed demo data (no-op if already seeded)
npm run reset          # delete the DB and re-seed from scratch
```

## Configuration

Environment variables (all optional):

| var          | default                                | meaning                       |
|--------------|----------------------------------------|-------------------------------|
| `PORT`       | `3000`                                 | HTTP port                     |
| `JWT_SECRET` | a dev string — **change this in prod** | signing key for session JWTs  |

## Production hardening checklist

The current setup runs anywhere Node 22+ runs. Before exposing to the internet:

1. Set `JWT_SECRET` to a real random string
2. Put the server behind HTTPS (reverse proxy via nginx or Caddy), then flip `secure: true` for the cookie in `routes/auth.js`
3. Add rate limiting on `/api/auth/login`
4. Switch the SQLite file to a persistent volume / regular backups
5. For >1 process, swap SQLite for Postgres — the `routes/data.js` query builder is already SQL-standard so the change is mostly the connection driver

## Routes reference

### Auth
| method | path                  | body / query                 |
|--------|-----------------------|------------------------------|
| POST   | `/api/auth/signup`    | `{email, password, first_name, last_name, company_name, phone}` |
| POST   | `/api/auth/login`     | `{email, password}`          |
| POST   | `/api/auth/logout`    | —                            |
| GET    | `/api/auth/session`   | —                            |
| GET    | `/api/auth/me`        | —                            |

### Data (generic, PostgREST-style)
| method | path                                             | use                          |
|--------|--------------------------------------------------|------------------------------|
| GET    | `/api/data/:table?col=eq.X&order=col.desc&limit=N` | list                         |
| GET    | `/api/data/:table?select=*,fk(*)&id=eq.X`        | with foreign-key embed       |
| GET    | `/api/data/:table?count=exact&head=true`         | just the count               |
| POST   | `/api/data/:table`                               | insert (body = row or rows[]) |
| PATCH  | `/api/data/:table?id=eq.X`                       | update (body = patch)         |
| DELETE | `/api/data/:table?id=eq.X`                       | delete                        |

Supported filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, plus negation via `not.<op>.<value>`.

### File upload
| method | path             | use                                          |
|--------|------------------|----------------------------------------------|
| POST   | `/api/upload`    | multipart, field name `files`, up to 10×10MB |
| GET    | `/uploads/:name` | static                                       |
