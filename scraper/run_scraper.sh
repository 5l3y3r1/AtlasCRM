#!/bin/bash
# Always-on entry point for the warm.ge myhome scraper.
#
# For near real-time monitoring, run every 5 minutes via cron:
#   */5 * * * * /root/warm-crm/scraper/run_scraper.sh >> /root/warm-crm/scraper/scraper.log 2>&1
#
# The scraper auto-fetches myhome's current build id each run (so it never
# goes stale), pulls recent listings, and upserts them into the CRM. Only
# genuinely new listings become new rows; existing ones are updated in place.

export CRM_URL="https://atlascrm.ge"
export SCRAPER_KEY="a243d9b8b99d08709dc7d02e9eddcc94424f4f0300bf656d"   # must match: pm2 set warm-crm:SCRAPER_KEY ...
export SCRAPER_MAX_PAGES="3"
export SCRAPER_DEAL="1"        # 1=sale 2=rent 7=daily
export SCRAPER_DEBUG="0"       # set to 1 once to dump field names for mapping

cd "$(dirname "$0")" || exit 1
python3 scraper.py
