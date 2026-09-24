#!/usr/bin/env python3
"""
scraper.py — monitors myhome.ge for listings via its Next.js data endpoint and
pushes them into the warm.ge CRM (AI Hunter / external_listings).

Breakthrough approach (no auth, no Cloudflare 403, no HTML parsing):
myhome is a Next.js app. Its pages have a JSON twin at
  https://www.myhome.ge/_next/data/{BUILD_ID}/ka/<page>.json?<params>
The BUILD_ID rotates on each myhome deploy, so we fetch it fresh from the
homepage (__NEXT_DATA__) on every run, then hit the listings JSON.

Env:
  CRM_URL            CRM base url (default https://atlascrm.ge)
  SCRAPER_KEY        must match server SCRAPER_KEY
  SCRAPER_MAX_PAGES  listings pages to scan per run (default 3)
  SCRAPER_DEAL       deal type: 1=sale 2=rent 7=daily (default 1)
"""
import os, re, sys, json, time, urllib.request, urllib.error
from datetime import datetime

CRM_URL = os.environ.get("CRM_URL", "https://atlascrm.ge").rstrip("/")
SCRAPER_KEY = os.environ.get("SCRAPER_KEY", "warm-scraper-dev-key")
MAX_PAGES = int(os.environ.get("SCRAPER_MAX_PAGES", "3"))
DEAL = os.environ.get("SCRAPER_DEAL", "1,2")   # comma list: 1=sale 2=rent 7=daily
# real_estate_types: 1=apartment 2=house 3=cottage 4=land 5=commercial 7=hotel
RE_TYPES = os.environ.get("SCRAPER_RE_TYPES", "1,2,4,5")

BASE = "https://www.myhome.ge"
HEADERS = {
    "Accept": "*/*",
    "Accept-Language": "ka",
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "x-nextjs-data": "1",
    "Referer": BASE + "/udzravi-qoneba/?currency_id=1&CardView=1&page=1",
}


def log(m): print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {m}", flush=True)


def http_get(url, as_json=True):
    req = urllib.request.Request(url, headers=HEADERS, method="GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read().decode("utf-8", "replace")
    return json.loads(data) if as_json else data


def get_build_id():
    """Fetch the current Next.js build id from the homepage __NEXT_DATA__."""
    html = http_get(BASE + "/", as_json=False)
    m = re.search(r'"buildId":"([^"]+)"', html)
    if not m:
        m = re.search(r'/_next/static/([^/]+)/_buildManifest', html)
    if not m:
        raise RuntimeError("could not find buildId on homepage")
    return m.group(1)


def deep_find_listings(node, found):
    """Walk the JSON and collect dicts that look like listings (have an id + price-ish)."""
    if isinstance(node, list):
        for x in node:
            deep_find_listings(x, found)
    elif isinstance(node, dict):
        keys = set(node.keys())
        looks_like = ("id" in keys or "uuid" in keys) and (
            "price" in keys or "price_total" in keys or "total_price" in keys
            or "dynamic_title" in keys or "user_id" in keys or "address" in keys)
        if looks_like:
            found.append(node)
        for v in node.values():
            deep_find_listings(v, found)


def pick(it, *names, contains=None):
    for n in names:
        if isinstance(it, dict) and it.get(n) not in (None, "", []):
            return it.get(n)
    if contains and isinstance(it, dict):
        for k, v in it.items():
            if any(c in k.lower() for c in contains) and v not in (None, "", []):
                return v
    return None


def to_num(v):
    try: return round(float(v))
    except (TypeError, ValueError): return None


def myhome_price_usd(it):
    """myhome price is nested: price={'1':{price_total GEL}, '2':{price_total USD}}.
    Currency key '2' = USD, '1' = GEL. Prefer USD."""
    p = it.get("price")
    if isinstance(p, dict):
        usd = p.get("2") or {}
        if isinstance(usd, dict) and usd.get("price_total"):
            return to_num(usd["price_total"])
        gel = p.get("1") or {}
        if isinstance(gel, dict) and gel.get("price_total"):
            # fall back to GEL→USD if no USD given (rate ~2.7)
            g = to_num(gel["price_total"])
            return round(g / 2.7) if g else None
    return to_num(p)


def map_listing(it):
    ext_id = pick(it, "id", "statement_id", "uuid")
    slug = pick(it, "dynamic_slug", "middle_slug")
    # user_type = {'type': 'physical'|'agency'|..., ...}. 'physical' = owner.
    ut = it.get("user_type")
    utype = ut.get("type") if isinstance(ut, dict) else ut
    is_owner = str(utype).lower() in ("physical", "owner", "person")
    # bedrooms: 'room' is total rooms, 'bedroom' is bedrooms
    rooms = pick(it, "room", "bedroom", "bedrooms", "rooms")
    # deal_type_id: 1=sale, 2=rent, 7=daily rent
    deal_map = {1: "SALE", 2: "RENT", 7: "DAILY", "1": "SALE", "2": "RENT", "7": "DAILY"}
    deal_id = pick(it, "deal_type_id", "deal_type")
    deal_type = deal_map.get(deal_id)
    # real_estate_type_id: 1=apartment 2=house 3=cottage 4=land 5=commercial 7=hotel
    re_map = {1: "APARTMENT", 2: "HOUSE", 3: "COTTAGE", 4: "LAND", 5: "COMMERCIAL", 7: "HOTEL",
              "1": "APARTMENT", "2": "HOUSE", "3": "COTTAGE", "4": "LAND", "5": "COMMERCIAL", "7": "HOTEL"}
    re_id = pick(it, "real_estate_type_id", "real_estate_type")
    property_type = re_map.get(re_id)
    return {
        "source": "myhome.ge",
        "external_id": str(ext_id) if ext_id is not None else None,
        "external_url": (f"{BASE}/pr/{ext_id}/{slug}" if ext_id and slug
                         else (f"{BASE}/pr/{ext_id}/" if ext_id else None)),
        "title": pick(it, "dynamic_title", "title", "address", "street_address"),
        "list_price": myhome_price_usd(it),
        "bedrooms": str(rooms) if rooms not in (None, "") else None,
        "area_sqm": to_num(pick(it, "area", "total_area")),
        "city": pick(it, "city_name", "city"),
        "district": pick(it, "urban_name", "district_name", "district", "urban"),
        "address": pick(it, "address", "street_address", "street"),
        "deal_type": deal_type,
        "property_type": property_type,
        "owner_phone": pick(it, "telephone", "user_phone", "phone", "phone_number"),
        "is_owner": is_owner,
    }


def fetch():
    log("Fetching current myhome build id…")
    build = get_build_id()
    log(f"build id: {build}")
    rows, seen = [], set()
    # DEAL can be a comma list, e.g. "1,2" (sale+rent) or "1,2,7" (incl daily).
    deal_types = [d.strip() for d in str(DEAL).split(",") if d.strip()]
    re_types = [r.strip() for r in str(RE_TYPES).split(",") if r.strip()]
    deal_names = {"1": "sale", "2": "rent", "7": "daily"}
    re_names = {"1": "apartment", "2": "house", "3": "cottage", "4": "land", "5": "commercial", "7": "hotel"}
    debug_done = False
    for rt in re_types:
        for dt in deal_types:
            log(f"--- {re_names.get(rt, rt)} / {deal_names.get(dt, dt)} ---")
            for page in range(1, MAX_PAGES + 1):
                url = (f"{BASE}/_next/data/{build}/ka/udzravi-qoneba.json"
                       f"?real_estate_types={rt}&deal_types={dt}&currency_id=1&CardView=1&page={page}")
                try:
                    payload = http_get(url)
                except urllib.error.HTTPError as e:
                    log(f"  page {page}: HTTP {e.code}")
                    break
                except Exception as e:
                    log(f"  page {page}: {e}"); break
                found = []
                deep_find_listings(payload, found)
                uniq = {}
                for f in found:
                    i = pick(f, "id", "uuid")
                    if i is not None and i not in uniq:
                        uniq[i] = f
                log(f"  page {page}: {len(uniq)} listings")
                if not uniq:
                    break
                if not debug_done and os.environ.get("SCRAPER_DEBUG", "0") == "1" and uniq:
                    debug_done = True
                    first = next(iter(uniq.values()))
                    log("DEBUG first-listing fields:")
                    for k, v in sorted(first.items()):
                        sv = str(v)
                        if len(sv) > 80: sv = sv[:80] + "…"
                        log(f"    {k} = {sv}")
                for f in uniq.values():
                    m = map_listing(f)
                    if m["external_id"] and m["external_id"] not in seen:
                        seen.add(m["external_id"]); rows.append(m)
                time.sleep(1.2)
    return rows


def push(rows):
    data = json.dumps({"listings": rows}).encode("utf-8")
    req = urllib.request.Request(f"{CRM_URL}/api/scraper/ingest", data=data, method="POST",
        headers={"Content-Type": "application/json", "X-Scraper-Key": SCRAPER_KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8")).get("data", {})


def main():
    log(f"Scraper start → {CRM_URL} | pages={MAX_PAGES} | deal={DEAL}")
    try:
        rows = fetch()
    except Exception as e:
        log(f"Fetch failed: {e}"); sys.exit(1)
    if not rows:
        log("No listings found (endpoint path may need adjusting)."); return
    log(f"Pushing {len(rows)} listings…")
    try:
        log(f"Done. Server result: {push(rows)}")
    except Exception as e:
        log(f"Push failed: {e}"); sys.exit(1)


if __name__ == "__main__":
    main()
