import re

_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")


def find_emails(text, exclude=()):
    """Unique emails in text (order kept), minus any in `exclude` (case-insensitive)."""
    skip = {e.lower() for e in exclude if e}
    out, seen = [], set()
    for m in _EMAIL.findall(text or ""):
        m = m.rstrip(".")
        k = m.lower()
        if k not in skip and k not in seen:
            seen.add(k)
            out.append(m)
    return out
