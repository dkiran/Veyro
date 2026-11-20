"""Thin wrapper over google-play-scraper so the rest of the code can be tested offline."""
import json
import re

from google_play_scraper import search as gp_search
from google_play_scraper.constants.regex import Regex
from google_play_scraper.constants.request import Formats
from google_play_scraper.exceptions import NotFoundError
from google_play_scraper.features.app import parse_dom
from google_play_scraper.utils.request import get

_EMAIL_ONLY = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")


def build_dataset(dom):
    """The page's embedded AF_initDataCallback blobs, keyed like 'ds:5'."""
    dataset = {}
    for match in Regex.SCRIPT.findall(dom):
        k, v = Regex.KEY.findall(match), Regex.VALUE.findall(match)
        if k and v:
            dataset[k[0]] = json.loads(v[0])
    return dataset


def email_strings(node, path=()):
    """Yield (path, email) for every string that is *only* an email address (so description text never matches)."""
    if isinstance(node, str):
        if _EMAIL_ONLY.fullmatch(node.strip()):
            yield path, node.strip()
    elif isinstance(node, list):
        for i, x in enumerate(node):
            yield from email_strings(x, path + (i,))
    elif isinstance(node, dict):
        for k, x in node.items():
            yield from email_strings(x, path + (k,))


def parse_page(dom, package, url):
    d = parse_dom(dom=dom, app_id=package, url=url)
    support = (d.get("developerEmail") or "").strip().lower()
    found, seen = [], set()
    for _, e in email_strings(build_dataset(dom)):
        k = e.lower()
        if k != support and k not in seen:
            seen.add(k)
            found.append(e)
    d["developerEmails"] = found  # emails besides the support email, e.g. from "About the developer"
    return d


class PlayFetcher:
    def search(self, term, country, lang, n):
        return gp_search(term, lang=lang, country=country, n_hits=n)

    def details(self, package, country, lang):
        url = Formats.Detail.build(app_id=package, lang=lang, country=country)
        try:
            dom = get(url)
        except NotFoundError:
            url = Formats.Detail.fallback_build(app_id=package, lang=lang)
            dom = get(url)
        return parse_page(dom, package, url)

    def inspect(self, package, country="us", lang="en"):
        """Debug: every bare-email string on the page with its location in the data."""
        dom = get(Formats.Detail.build(app_id=package, lang=lang, country=country))
        ds = build_dataset(dom)
        return [(key, p, e) for key, blob in ds.items() for p, e in email_strings(blob)]
