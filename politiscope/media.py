"""Mentions presse de la vue « Flux live » — Google Actualités, gratuit.

Une seule source : la rubrique « France – Dernières infos » de Google
Actualités. Chaque <item> du flux est un cluster (un article principal et
ses articles liés, chacun avec son éditeur réel) ; chaque article compte pour
une mention. Les titres sont étiquetés par simple correspondance de mots :
entités citées (personnalités, pays) et sujet dominant. Seuls ceux qui citent
au moins une entité ET relèvent d'un sujet sont gardés.

Le texte conservé est le titre publié, jamais reformulé. Les liens pointent
vers news.google.com, qui redirige vers l'article : l'URL de l'éditeur ne se
résout pas côté serveur (voir rss.py).

Conditions d'usage : ce flux est destiné à un usage personnel et non
commercial. La collecte est donc derrière GOOGLE_NEWS_ENABLED (config.py),
désactivée par défaut.

Les clés d'entités et de sujets doivent rester identiques à celles de
web/src/lib/fluxScope.ts, qui les affiche.
"""
from __future__ import annotations

import html
import logging
import re
from datetime import timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit, urlunsplit

import requests

from .quotes import THEME_LEXICON, _strip_accents, normalise
from .rss import UA

log = logging.getLogger("politiscope.media")

# Rubrique « France – Dernières infos ».
GOOGLE_NEWS_FRANCE_URL = "https://news.google.com/rss/headlines/section/geo/France?hl=fr&gl=FR&ceid=FR:fr"
OUTLET = "google_news"
VIA = "Google Actualités"

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
    """(entités citées, sujet dominant ou None) pour un titre."""
    low = _strip_accents(text.lower()).replace("’", "'")
    entities = [k for k, rx in _ENTITY_RE.items() if rx.search(low)]
    best, best_n = None, 0
    for theme, rx in _SUBJECT_RE.items():
        n = len(rx.findall(low))
        if n > best_n:
            best, best_n = theme, n
    return entities, best


def canonical_url(url: str) -> str:
    """Sans query ni fragment : Google ajoute ?oc=5 à ses liens de redirection."""
    parts = urlsplit(url.strip())
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _plain(s: str) -> str:
    return " ".join(html.unescape(_TAGS.sub(" ", s or "")).split())


# --- lecture du flux --------------------------------------------------------
# Par regex, pas par un parseur XML : un « & » non échappé dans un lien fait
# échouer ElementTree sur tout le document ; une regex par <item> ne perd au
# pire que l'item fautif.

_ITEM = re.compile(r"<item>(.*?)</item>", re.S)
_CDATA = re.compile(r"^<!\[CDATA\[(.*)\]\]>$", re.S)
_LI = re.compile(r"<li>(.*?)</li>", re.S)
_LI_ARTICLE = re.compile(r'<a\s[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?<font[^>]*>(.*?)</font>', re.S)


def _field(block: str, name: str) -> str | None:
    m = re.search(rf"<{name}(?:\s[^>]*)?>(.*?)</{name}>", block, re.S)
    if not m:
        return None
    raw = m.group(1).strip()
    c = _CDATA.match(raw)
    return c.group(1) if c else html.unescape(raw)


def _rfc822(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def strip_publisher(titre: str, publisher: str | None) -> str:
    """« Titre - Éditeur » -> « Titre ». Seulement si le suffixe est bien
    l'éditeur du <source> : un titre qui contient lui-même « - » reste intact."""
    if publisher and titre.endswith(f" - {publisher}"):
        return titre[: -len(publisher) - 3].rstrip()
    return titre


def parse_feed(xml: str) -> list[dict]:
    """Flux -> clusters. Un <item> est un cluster : son titre et son lien sont
    ceux de l'article principal, sa <description> liste (<ol><li>) les articles
    liés, l'éditeur de chacun dans un <font>. Le principal ouvre d'ordinaire
    cette liste : il n'est compté qu'une fois."""
    clusters = []
    for block in _ITEM.findall(xml):
        link = (_field(block, "link") or "").strip()
        publisher = _plain(_field(block, "source") or "") or None
        titre = strip_publisher(_plain(_field(block, "title") or ""), publisher)
        if not link.startswith("https://") or not titre or not publisher:
            continue
        articles = [{"url": link, "titre": titre, "publisher": publisher}]
        seen = {canonical_url(link)}
        for li in _LI.findall(_field(block, "description") or ""):
            a = _LI_ARTICLE.search(li)
            if not a:
                continue
            url, t, pub = html.unescape(a.group(1)), _plain(a.group(2)), _plain(a.group(3))
            if not url.startswith("https://") or not t or not pub or canonical_url(url) in seen:
                continue
            seen.add(canonical_url(url))
            articles.append({"url": url, "titre": t, "publisher": pub})
        clusters.append({"published_at": _rfc822(_field(block, "pubDate")), "articles": articles})
    return clusters


def mentions_from_cluster(cluster: dict) -> list[dict]:
    """Une mention par article du cluster, chacune avec son éditeur réel.

    Les articles liés n'ont pas de date propre : ils prennent celle du
    cluster. Chaque titre est tagué seul ; si le cluster est mono-sujet — le
    titre principal a un sujet et aucun autre titre n'en a un différent — les
    articles liés restés sans sujet prennent celui du principal : ils traitent
    de la même actualité.
    """
    published = cluster["published_at"]
    articles = cluster["articles"]
    if not published or not articles:
        return []
    cluster_id = canonical_url(articles[0]["url"])
    tagged = [(a, *tag(a["titre"])) for a in articles]
    main_theme = tagged[0][2]
    inherit = main_theme if {t for _, _, t in tagged if t} == {main_theme} else None

    out = []
    for a, entities, theme in tagged:
        theme = theme or inherit
        if not entities or not theme:
            continue
        out.append({
            "id": canonical_url(a["url"]),
            "outlet": OUTLET,
            "publisher": a["publisher"],
            "via": VIA,
            "cluster_id": cluster_id,
            "published_at": published,
            "titre": a["titre"],
            "resume": None,                # le flux ne donne pas de chapô
            "article_url": a["url"],
            "theme": theme,
            "entities": entities,
        })
    return out


def dedupe(mentions: list[dict], known: set[str] | frozenset[str] = frozenset()) -> list[dict]:
    """Un même article revient dans plusieurs clusters, parfois sous une autre
    URL de redirection : on écarte d'abord sur l'URL, puis sur titre normalisé
    + éditeur + jour. `known` = ids déjà en base."""
    out, urls, keys = [], set(known), set()
    for m in mentions:
        key = (normalise(m["titre"]), m["publisher"].casefold(), m["published_at"][:10])
        if m["id"] in urls or key in keys:
            continue
        urls.add(m["id"])
        keys.add(key)
        out.append(m)
    return out


def fetch(session: requests.Session | None = None,
          known: set[str] | frozenset[str] = frozenset()) -> tuple[list[dict], int]:
    """(nouvelles mentions retenues, articles lus)."""
    s = session or requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "application/rss+xml,application/xml"})
    try:
        r = s.get(GOOGLE_NEWS_FRANCE_URL, timeout=30)
        r.raise_for_status()
    except requests.RequestException as e:
        log.error("flux Google Actualités KO : %s", e)
        return [], 0
    clusters = parse_feed(r.content.decode("utf-8", errors="replace"))
    seen = sum(len(c["articles"]) for c in clusters)
    mentions = dedupe([m for c in clusters for m in mentions_from_cluster(c)], known)
    log.info("Google Actualités : %d cluster(s), %d article(s) lu(s), %d mention(s) retenue(s)",
             len(clusters), seen, len(mentions))
    return mentions, seen
