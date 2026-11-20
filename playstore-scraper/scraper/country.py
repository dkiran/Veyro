"""Derive a country name from a free-text developer address."""
import re
import pycountry

_ALIASES = {"usa": "United States", "u.s.a.": "United States", "us": "United States",
            "uk": "United Kingdom", "u.k.": "United Kingdom", "uae": "United Arab Emirates",
            "south korea": "South Korea", "russia": "Russia", "vietnam": "Vietnam"}
_NAMES = {}
for c in pycountry.countries:
    _NAMES[c.name.lower()] = c.name
    if getattr(c, "common_name", None):
        _NAMES[c.common_name.lower()] = c.common_name
_NAMES.update({k: v for k, v in _ALIASES.items()})


def country_from_address(address):
    """Return a country name if the last address segment (or text) names one, else ''."""
    if not address:
        return ""
    parts = [p.strip() for p in re.split(r"[,\n]", address) if p.strip()]
    for part in reversed(parts[-2:]):
        key = re.sub(r"[\d\W_]+$|^[\d\W_]+", "", part).lower()
        if key in _ALIASES:
            return _ALIASES[key]
        if len(key) > 2 and key in _NAMES:
            return _NAMES[key]
    return ""
