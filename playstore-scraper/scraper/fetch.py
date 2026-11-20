"""Thin wrapper over google-play-scraper so the rest of the code can be tested offline."""
from google_play_scraper import app as gp_app, search as gp_search


class PlayFetcher:
    def search(self, term, country, lang, n):
        return gp_search(term, lang=lang, country=country, n_hits=n)

    def details(self, package, country, lang):
        return gp_app(package, lang=lang, country=country)
