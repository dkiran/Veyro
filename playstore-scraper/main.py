"""Play Store app scraper. `python main.py --once` runs now; without it, runs on the cron schedule."""
import argparse
import logging

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from scraper.fetch import PlayFetcher
from scraper.run import load_config, scrape


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--once", action="store_true", help="run one scrape and exit (use with system cron)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config(args.config)
    job = lambda: scrape(cfg, PlayFetcher())
    if args.once:
        job()
        return
    sched = BlockingScheduler(timezone=cfg["timezone"])
    sched.add_job(job, CronTrigger.from_crontab(cfg["schedule_cron"], timezone=cfg["timezone"]),
                  max_instances=1, coalesce=True)
    logging.info("scheduled: %s (%s). Ctrl+C to stop.", cfg["schedule_cron"], cfg["timezone"])
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        pass


if __name__ == "__main__":
    main()
