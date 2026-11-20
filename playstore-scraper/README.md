# Play Store app scraper

Scheduled scraper that collects Google Play apps into SQLite and exports
`data/apps.csv` with columns:
`Email, App, Company, Website, Category, Play Store URL, Developer email, Developer address, Country`.

```bash
pip install -r requirements.txt
python main.py --once      # run one scrape now
python main.py             # stay running, scrape on config.json "schedule_cron" (default 02:00 UTC daily)
pytest                     # offline tests
```

System cron alternative: `0 2 * * * cd /path/playstore-scraper && python main.py --once`

## Config (`config.json`)
- `search_terms` + `countries`: how apps are discovered (Play has no "list all apps" endpoint).
- `max_new_apps_per_run`, `delay_seconds`: throttle. Keep them conservative to avoid blocks.
- `refresh_after_days`: apps fetched more recently than this are skipped.

## Notes
- `Email` = the app's **support** email (Play's "App support" block). `Developer email` = other emails found in the developer's about text, never repeating the support email. The scraping library doesn't expose the "About the developer" section, so the app description is scanned instead (a `developerDescription` field is used if one is ever present).
- `Country` is parsed from the developer address (blank if it can't be recognised); the store region crawled is kept in the DB as `crawl_region`.
- Scraping Play pages is against Google's Terms of Service and may be rate-limited or blocked; use at your own risk, and handle collected emails in line with applicable privacy/anti-spam law.
- Not verified against live Play Store (network was blocked where this was built); only the offline tests have been run.
