# AtlasCRM extension ↔ AtlasCRM — integration

Adds a **Send to CRM** button to the AtlasCRM browser extension and an
**install page** to the CRM. Listings copied from myhome.ge / ss.ge are created
as **real listings in Properties** (`listings` + `property_images`).

## What changed

CRM (drop these in, replacing/adding):
- `routes/import.js` — adds `POST /api/import/ingest`. By default it **creates a
  listing in Properties** (auto `L-0001` number, computed price/m², photos →
  `property_images`, amenities pulled from the raw payload). Reuses the existing
  `mapMyhomeToDraft` + `downloadPhotos`; adds `mapSsToDraft`. **No existing routes
  changed.** (Pass `target:"import"` in the body to stage in the AI-Hunter import
  queue instead — off by default.)
- `server.js` — adds friendly route `/extension → warm_extension.html`.
- `public/warm_extension.html` — branded install page.
- `public/downloads/warm-house-extension.zip` — the packed extension.

Extension: `warm-crm-bridge.js`, `warm-crm-theme.css`, widened `host_permissions`,
and the popup button wiring in `onpfngvcp8.html`.

## Environment variables (Railway)

| var | purpose | default (dev) |
|-----|---------|---------------|
| `CRM_INGEST_KEY` | shared secret the extension sends as `X-CRM-Key`. **Set your own.** | `warm-crm-ingest-dev-key` |
| `CRM_INGEST_COMPANY_ID` | optional — which company new listings belong to | first company in DB |

`resolveActor()`: a logged-in CRM session wins; otherwise a valid `X-CRM-Key`
maps to `CRM_INGEST_COMPANY_ID` (or the first company) and that company's first
OWNER/FOUNDER/ADMIN/MANAGER user. New listings are assigned to that agent
(`agent_id` + `created_by_id`).

## Endpoint

```
POST /api/import/ingest
Headers: Content-Type: application/json
         X-CRM-Key: <CRM_INGEST_KEY>          # or a CRM session cookie
Body:    { "source": "myhome" | "ss", "url": "...", "raw": <scraped object>,
           "target": "listing" }              # "listing" (default) | "import"
→ 200 { data: { id, listing_number, photos, target:"listing", ... } }
→ 401 invalid key / not authenticated
→ 422 couldn't extract fields from payload
```

## Field mapping (→ listings)

`deal_type → listing_type`, `property_type → property_type`, `list_price`,
`area_sqm → total_area`, `price/m²` computed, `bedrooms → bedrooms_total`,
`floor`/`total_floors`, `city`/`district`/`address`, `source`/`source_url`,
`amenities` (JSON), `status = ACTIVE`. myhome is fully mapped; ss.ge is
best-effort (its `applicationData` keys vary), with the full payload available
to the agent for review.

## Using it

1. Deploy the CRM with `CRM_INGEST_KEY` set.
2. Open `/extension`, download, load unpacked in Chrome.
3. Popup → gear → paste CRM URL + the same key → Save.
4. On a myhome/ss.ge listing, click **Send to CRM** → it appears in **Properties**.

## Follow-ups

- `host_permissions` is `*://*/*` for now; narrow to your Railway origin once
  fixed, and drop the wildcards.
- Listings are created with `status = ACTIVE`. If you'd prefer they arrive as a
  review state first, change `status` in `createListing()` (e.g. to `DRAFT`) — the
  Properties list filters can then hide them until approved.
