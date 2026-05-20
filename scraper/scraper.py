#!/usr/bin/env python3
"""
scraper.py — starter scraper that pushes external listings into the warm.ge CRM.

This is a TEMPLATE. The fetch_listings() function below returns demo data; replace
its body with real parsing of myhome.ge / ss.ge (respecting their ToS and robots.txt,
or using an official feed). The push logic to the CRM is production-ready.

Env:
  CRM_URL      base URL of the CRM, e.g. https://your-app.onrender.com  (default http://localhost:3000)
  SCRAPER_KEY  must match the server's SCRAPER_KEY env var
"""
import os
import sys
import json
import urllib.request

CRM_URL = os.environ.get("CRM_URL", "http://localhost:3000").rstrip("/")
SCRAPER_KEY = os.environ.get("SCRAPER_KEY", "warm-scraper-dev-key")


def fetch_listings():
    """Replace this with real scraping. Must return a list of dicts with these keys:
       source, external_id, external_url, title, description, list_price,
       bedrooms, area_sqm, region, city, district, owner_phone, is_owner
    """
    return [
        {
            "source": "myhome.ge",
            "external_id": "mh-demo-1",
            "external_url": "https://www.myhome.ge/pr/demo-1",
            "title": "ნიმუში: 2 ოთახიანი ბინა",
            "description": "scraper-ის ნიმუში ჩანაწერი",
            "list_price": 85000,
            "bedrooms": 2,
            "area_sqm": 58,
            "region": "თბილისი",
            "city": "თბილისი",
            "district": "საბურთალო",
            "owner_phone": "+995 555 000 000",
            "is_owner": True,
        }
    ]


def push(listings):
    payload = json.dumps({"listings": listings}).encode("utf-8")
    req = urllib.request.Request(
        f"{CRM_URL}/api/scraper/ingest",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Scraper-Key": SCRAPER_KEY,
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
        result = body.get("data", body)
        print(f"Ingested -> {result}")


def main():
    listings = fetch_listings()
    if not listings:
        print("No listings scraped.")
        return
    print(f"Scraped {len(listings)} listing(s); pushing to {CRM_URL} ...")
    try:
        push(listings)
    except Exception as e:  # noqa
        print(f"Push failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
