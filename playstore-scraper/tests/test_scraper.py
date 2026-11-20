import csv
from scraper.country import country_from_address
from scraper.run import scrape

CFG = lambda tmp: {"db_path": str(tmp / "a.db"), "csv_path": str(tmp / "a.csv"),
                   "search_terms": ["x"], "countries": ["us"], "lang": "en",
                   "results_per_query": 5, "max_new_apps_per_run": 10,
                   "delay_seconds": 0, "refresh_after_days": 30}


class Fake:
    def __init__(self): self.detail_calls = 0
    def search(self, t, c, l, n): return [{"appId": "com.a"}, {"appId": "com.b"}]
    def details(self, p, c, l):
        self.detail_calls += 1
        if p == "com.b":
            raise RuntimeError("blocked")
        return {"title": "A", "developer": "Acme", "developerWebsite": "https://acme.io",
                "genre": "Tools", "url": "https://play.google.com/store/apps/details?id=com.a",
                "developerEmail": "support@acme.io", "developerEmails": ["ceo@acme.io"], "developerAddress": "1 Main St\nNairobi, Kenya"}


def test_country():
    assert country_from_address("1 Main St, Mumbai, India") == "India"
    assert country_from_address("PO Box 1, CA 94000, USA") == "United States"
    assert country_from_address("") == ""


def test_scrape_exports_columns_and_skips_fresh(tmp_path):
    f = Fake()
    r = scrape(CFG(tmp_path), f, sleep=lambda s: None)
    assert r["saved"] == 1 and r["failed"] == 1
    rows = list(csv.DictReader(open(tmp_path / "a.csv")))
    assert list(rows[0]) == ["Email", "App", "Company", "Website", "Category",
                             "Play Store URL", "Developer email", "Developer address", "Country"]
    assert rows[0]["Country"] == "Kenya" and rows[0]["Email"] == "support@acme.io"
    assert rows[0]["Developer email"] == "ceo@acme.io"
    calls = f.detail_calls
    scrape(CFG(tmp_path), f, sleep=lambda s: None)  # com.a fresh -> only com.b retried
    assert f.detail_calls == calls + 1


def test_page_email_extraction():
    from scraper.fetch import email_strings
    blob = [["desc: mail me at x@y.com"], [["a@b.com"], ["Support@B.com", "c@d.org"]]]
    assert [e for _, e in email_strings(blob)] == ["a@b.com", "Support@B.com", "c@d.org"]
