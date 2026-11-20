import csv
import os
import sqlite3
from datetime import datetime, timezone

CSV_COLUMNS = ["Email", "App", "Company", "Website", "Category",
               "Play Store URL", "Developer email", "Developer address", "Country"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS apps (
  package TEXT PRIMARY KEY,
  app TEXT, company TEXT, website TEXT, category TEXT, url TEXT,
  developer_email TEXT, developer_address TEXT, country TEXT,
  crawl_region TEXT, fetched_at TEXT
);
"""


def connect(path):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def upsert(conn, row):
    cols = list(row)
    placeholders = ",".join("?" * len(cols))
    updates = ",".join(f"{c}=excluded.{c}" for c in cols if c != "package")
    conn.execute(
        f"INSERT INTO apps ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(package) DO UPDATE SET {updates}",
        [row[c] for c in cols])
    conn.commit()


def known_packages(conn, refresh_after_days):
    """Packages fetched recently enough that they need no refresh."""
    cutoff = datetime.now(timezone.utc).timestamp() - refresh_after_days * 86400
    out = set()
    for r in conn.execute("SELECT package, fetched_at FROM apps"):
        try:
            if datetime.fromisoformat(r["fetched_at"]).timestamp() >= cutoff:
                out.add(r["package"])
        except (TypeError, ValueError):
            pass
    return out


def export_csv(conn, path):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    rows = conn.execute("SELECT * FROM apps ORDER BY company, app").fetchall()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for r in rows:
            # "Email" and "Developer email" both come from the developer's public contact email.
            w.writerow([r["developer_email"], r["app"], r["company"], r["website"], r["category"],
                        r["url"], r["developer_email"], r["developer_address"], r["country"]])
    return len(rows)
