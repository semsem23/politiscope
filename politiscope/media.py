"""Mentions presse de la vue « Flux live » — flux RSS des rédactions, gratuits.

Trois médias (Le Monde, Le Figaro, Le Parisien), leurs rubriques
internationale et politique. Chaque article est étiqueté par simple
correspondance de mots : entités citées (personnalités, pays) et sujet
dominant. Seuls ceux qui citent au moins une entité ET relèvent d'un sujet
sont gardés.

Le texte conservé est celui publié par la rédaction dans son flux (titre,
chapô), jamais reformulé, avec le lien de l'article.

Les clés d'entités et de sujets doivent rester identiques à celles de
web/src/lib/fluxScope.ts, qui les affiche.
"""
from __future__ import annotations

import html
import logging
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

import feedparser
import requests

from .quotes import THEME_LEXICON, _strip_accents
from .rss import UA

log = logging.getLogger("politiscope.media")

# Handle X de la rédaction -> flux RSS publics. Les rubriques sont choisies
# pour le périmètre (international, politique) ; la une complète chez Le
# Monde, dont chaque flux ne garde que ses 20 derniers articles.
FEEDS: dict[str, tuple[str, ...]] = {
    "lemondefr": (
        "https://www.lemonde.fr/international/rss_full.xml",
        "https://www.lemonde.fr/politique/rss_full.xml",
        "https://www.lemonde.fr/rss/une.xml",
    ),
    "Le_Figaro": (
        "https://www.lefigaro.fr/rss/figaro_international.xml",
        "https://www.lefigaro.fr/rss/figaro_politique.xml",
        "https://www.lefigaro.fr/rss/figaro_actualites.xml",
    ),
    "le_Parisien": (
        "https://feeds.leparisien.fr/leparisien/rss/international",
        "https://feeds.leparisien.fr/leparisien/rss/politique",
    ),
}

# Clé d'entité -> motifs (regex, sur texte minuscule sans accents). Les
# fonctions seules (« Premier ministre », « chef de l'État ») sont exclues :
# elles désignent aussi des dirigeants étrangers.
ENTITY_ALIASES: dict[str, tuple[str, ...]] = {
    "EmmanuelMacron": (r"macron",),
    "SebLecornu": (r"lecornu",),
    "Jean-Noël Barrot": (r"jean-noel barrot", r"barrot"),
    "Donald Trump": (r"trump",),
    "pays:us": (r"etats-unis", r"americaine?s?", r"washington", r"maison-blanche", r"maison blanche"),
    "Vladimir Poutine": (r"poutine",),
    "pays:ru": (r"russie", r"russes?", r"kremlin", r"moscou"),
    "Volodymyr Zelensky": (r"zelensky", r"zelenskyy", r"zelenski"),
    "pays:ua": (r"ukraine", r"ukrainien(ne)?s?", r"kiev", r"kyiv"),
    "Xi Jinping": (r"xi jinping",),
    "pays:cn": (r"chine", r"chinois(es?)?", r"pekin"),
    "Benjamin Netanyahu": (r"netanyahou", r"netanyahu"),
    "pays:il": (r"israel", r"israelien(ne)?s?", r"tsahal"),
}

# Sujet -> motifs. L'ordre départage les égalités : du plus spécifique au plus
# générique. « Europe & souveraineté » reprend le lexique existant de quotes.py.
SUBJECT_LEXICON: dict[str, tuple[str, ...]] = {
    "Gaza / Proche-Orient": (
        r"gaza", r"hamas", r"hezbollah", r"cisjordanie", r"proche-orient", r"moyen-orient",
        r"palestin\w*", r"liban", r"beyrouth", r"iran", r"otages?", r"jerusalem"),
    "Guerre en Ukraine": (
        r"ukraine", r"ukrainien(ne)?s?", r"kiev", r"kyiv", r"donbass", r"crimee",
        r"zaporijia", r"kharkiv", r"odessa"),
    "Commerce / droits de douane": (
        r"douanes?", r"droits de douane", r"douaniers?", r"surtaxes?", r"tarifs?",
        r"guerre commerciale", r"commerce", r"commerciale?s?", r"exportations?",
        r"importations?", r"mercosur"),
    "Défense / Otan": (
        r"otan", r"defense", r"armees?", r"militaires?", r"missiles?", r"drones?",
        r"armements?", r"dissuasion", r"frappes?", r"soldats?", r"troupes?"),
    "Europe & souveraineté": tuple(
        re.escape(_strip_accents(w)) for w in THEME_LEXICON["Europe & souveraineté"]
    ) + (r"commission europeenne", r"vingt-sept"),
    "Diplomatie": (
        r"diplomat\w*", r"sommet", r"ambassad\w*", r"affaires etrangeres", r"quai d'orsay",
        r"onu", r"g7", r"g20", r"visite d'etat", r"negociations?", r"pourparlers",
        r"accord de paix"),
}


def _compile(patterns: tuple[str, ...]) -> re.Pattern:
    # Frontières de mot : sans elles, « russe » trouverait « Prusse ».
    return re.compile(r"(?<!\w)(?:" + "|".join(patterns) + r")(?!\w)")


_ENTITY_RE = {k: _compile(v) for k, v in ENTITY_ALIASES.items()}
_SUBJECT_RE = {k: _compile(v) for k, v in SUBJECT_LEXICON.items()}
_TAGS = re.compile(r"<[^>]+>")


def tag(text: str) -> tuple[list[str], str | None]:
    """(entités citées, sujet dominant ou None) pour un titre + chapô."""
    low = _strip_accents(text.lower()).replace("’", "'")
    entities = [k for k, rx in _ENTITY_RE.items() if rx.search(low)]
    best, best_n = None, 0
    for theme, rx in _SUBJECT_RE.items():
        n = len(rx.findall(low))
        if n > best_n:
            best, best_n = theme, n
    return entities, best


def canonical_url(url: str) -> str:
    """Sans query ni fragment : les flux ajoutent des paramètres de suivi (xtor…)."""
    parts = urlsplit(url.strip())
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _plain(s: str) -> str:
    return " ".join(html.unescape(_TAGS.sub(" ", s or "")).split())


def _published(entry) -> str | None:
    st = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if not st:
        return None
    return datetime(*st[:6], tzinfo=timezone.utc).isoformat()


def mention_from_entry(outlet: str, entry) -> dict | None:
    """Une entrée de flux -> mention, ou None si hors périmètre / incomplète.

    `published_at` peut rester None : le flux du Parisien ne date pas ses
    articles, `fetch` va alors lire la date sur la page de l'article.
    """
    link = getattr(entry, "link", "") or ""
    titre = _plain(getattr(entry, "title", ""))
    published = _published(entry)
    if not link.startswith("https://") or not titre:
        return None
    resume = _plain(getattr(entry, "summary", "")) or None
    entities, theme = tag(f"{titre}. {resume or ''}")
    if not entities or not theme:
        return None
    url = canonical_url(link)
    return {
        "id": url,
        "outlet": outlet,
        "published_at": published,
        "titre": titre,
        "resume": resume[:600] if resume else None,
        "article_url": url,
        "theme": theme,
        "entities": entities,
    }


_META_TIME = re.compile(r'<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"')
_META_DESC = re.compile(r'<meta[^>]+property="og:description"[^>]+content="([^"]*)"')
# Garde-fou : une page par article retenu sans date, jamais plus par passage.
MAX_PAGE_FETCHES = 80
PAGE_PAUSE_S = 0.3


def page_meta(html_text: str) -> tuple[str | None, str | None]:
    """(date de publication ISO, chapô) lus dans les métadonnées de la page."""
    t = _META_TIME.search(html_text)
    d = _META_DESC.search(html_text)
    published = None
    if t:
        try:
            published = datetime.fromisoformat(t.group(1)).astimezone(timezone.utc).isoformat()
        except ValueError:
            published = None
    return published, (_plain(d.group(1)) or None) if d else None


def _complete_from_page(s: requests.Session, m: dict) -> dict | None:
    """Date (et chapô manquant) depuis la page ; None si introuvable — jamais de date inventée."""
    try:
        r = s.get(m["article_url"], timeout=30, headers={"Accept": "text/html"})
        r.raise_for_status()
    except requests.RequestException as e:
        log.warning("page KO %s : %s", m["article_url"], e)
        return None
    published, resume = page_meta(r.text)
    if not published:
        return None
    m["published_at"] = published
    if resume and not m["resume"]:
        m["resume"] = resume[:600]
    return m


def fetch(session: requests.Session | None = None,
          known: set[str] | frozenset[str] = frozenset()) -> tuple[list[dict], int]:
    """(nouvelles mentions retenues, articles lus). Dédoublonnées : un article
    paraît souvent dans plusieurs rubriques du même média. `known` = ids déjà
    en base, ignorés d'emblée — sans quoi chaque nuit relirait les pages des
    articles du Parisien déjà collectés."""
    s = session or requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "application/rss+xml,application/xml"})
    out: dict[str, dict] = {}
    seen = 0
    page_fetches = 0
    for outlet, urls in FEEDS.items():
        kept_before = len(out)
        for url in urls:
            try:
                r = s.get(url, timeout=30)
                r.raise_for_status()
            except requests.RequestException as e:
                log.error("%-12s flux KO %s : %s", outlet, url, e)
                continue
            for entry in feedparser.parse(r.content).entries:
                seen += 1
                m = mention_from_entry(outlet, entry)
                if not m or m["id"] in out or m["id"] in known:
                    continue
                if m["published_at"] is None:
                    if page_fetches >= MAX_PAGE_FETCHES:
                        continue
                    page_fetches += 1
                    time.sleep(PAGE_PAUSE_S)       # courtoisie envers le site
                    m = _complete_from_page(s, m)
                    if not m:
                        continue
                out[m["id"]] = m
        log.info("%-12s %3d mention(s) retenue(s)", outlet, len(out) - kept_before)
    return list(out.values()), seen
