import json
import logging
import time

from . import db
from .country import country_from_address

log = logging.getLogger("playstore")


def to_row(package, d, region):
    address = (d.get("developerAddress") or "").replace("\n", ", ")
    return {
        "package": package,
        "app": d.get("title") or "",
        "company": d.get("developer") or "",
        "website": d.get("developerWebsite") or "",
        "category": d.get("genre") or "",
        "url": d.get("url") or f"https://play.google.com/store/apps/details?id={package}",
        "developer_email": d.get("developerEmail") or "",
        "developer_address": address,
        "country": country_from_address(address),
        "crawl_region": region,
        "fetched_at": db.now(),
    }


def scrape(cfg, fetcher, sleep=time.sleep):
    conn = db.connect(cfg["db_path"])
    fresh = db.known_packages(conn, cfg["refresh_after_days"])
    budget = cfg["max_new_apps_per_run"]
    saved = failed = 0
    seen = set()
    for country in cfg["countries"]:
        for term in cfg["search_terms"]:
            if budget <= 0:
                break
            try:
                hits = fetcher.search(term, country, cfg["lang"], cfg["results_per_query"])
            except Exception as e:  # network/blocking: log and move on
                log.warning("search failed term=%r country=%s: %s", term, country, e)
                failed += 1
                sleep(cfg["delay_seconds"])
                continue
            for h in hits:
                pkg = h.get("appId")
                if not pkg or pkg in fresh or pkg in seen:
                    continue
                if budget <= 0:
                    break
                seen.add(pkg)
                try:
                    d = fetcher.details(pkg, country, cfg["lang"])
                    db.upsert(conn, to_row(pkg, d, country))
                    saved += 1
                    budget -= 1
                except Exception as e:
                    log.warning("details failed %s: %s", pkg, e)
                    failed += 1
                sleep(cfg["delay_seconds"])
    total = db.export_csv(conn, cfg["csv_path"])
    log.info("run done: saved=%d failed=%d total_in_csv=%d", saved, failed, total)
    conn.close()
    return {"saved": saved, "failed": failed, "total": total}


def load_config(path):
    with open(path) as f:
        return json.load(f)
