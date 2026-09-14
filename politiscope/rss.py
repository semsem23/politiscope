"""Ingestion Google Actualités — gratuit, sans clé, une requête ciblée par personnalité.

Attention : les liens du flux pointent vers news.google.com avec un identifiant
chiffré qui ne se résout pas côté serveur (mur de consentement). Le flux sert donc
de détecteur de pistes ; l'URL citable doit être retrouvée sur le site du média.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from urllib.parse import quote_plus

import feedparser
import requests

log = logging.getLogger("politiscope.rss")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
BASE = "https://news.google.com/rss/search"


def feed_url(query: str, days: int, lang: str = "fr", country: str = "FR") -> str:
    q = f'"{query}" when:{days}d'
    return f"{BASE}?q={quote_plus(q)}&hl={lang}&gl={country}&ceid={country}:{lang}"


def _pub_date(entry) -> str | None:
    st = getattr(entry, "published_parsed", None)
    if not st:
        return None
    return datetime(*st[:6], tzinfo=timezone.utc).isoformat()


def fetch_person(session: requests.Session, account: dict, days: int,
                 lang: str, country: str, limit: int = 40) -> list[dict]:
    url = feed_url(account["nom"], days, lang, country)
    try:
        r = session.get(url, timeout=30)
        r.raise_for_status()
    except requests.RequestException as e:
        log.error("%-26s flux KO : %s", account["nom"], e)
        return []

    parsed = feedparser.parse(r.content)
    rows = []
    for e in parsed.entries[:limit]:
        src = getattr(e, "source", None)
        rows.append({
            "kind": "rss",
            "nom": account["nom"],
            "famille": account.get("famille"),
            "parti": account.get("parti"),
            "titre": getattr(e, "title", ""),
            "date": _pub_date(e),
            "media": getattr(src, "title", None) if src else None,
            "media_url": getattr(src, "href", None) if src else None,
            "google_link": getattr(e, "link", None),
            "id": getattr(e, "id", None) or getattr(e, "link", ""),
        })
    log.info("%-26s %3d item(s)", account["nom"], len(rows))
    return rows


def ingest(accounts: list[dict], days: int, lang: str, country: str,
           pause: float = 0.4) -> list[dict]:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "application/rss+xml,application/xml"})
    out: list[dict] = []
    for a in accounts:
        out.extend(fetch_person(s, a, days, lang, country))
        time.sleep(pause)          # courtoisie : évite de se faire limiter par Google
    return out
