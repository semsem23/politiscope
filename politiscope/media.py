"""Mentions presse de la vue « Flux live » — Google Actualités, gratuit.

Une seule source : la rubrique « France – Dernières infos » de Google
Actualités. Chaque <item> du flux est un cluster (un article principal et
ses articles liés, chacun avec son éditeur réel) ; chaque article compte pour
une mention. Chaque titre est étiqueté par simple correspondance de mots avec
SUBJECT_LEXICON : un article est retenu dès qu'il relève d'un sujet. Les
autres sont stockés aussi, sans sujet (theme null), pour pouvoir être
re-tagués quand le lexique évolue (scripts/retag_media.py).

Le texte conservé est le titre publié, jamais reformulé. Les liens pointent
vers news.google.com, qui redirige vers l'article : l'URL de l'éditeur ne se
résout pas côté serveur (voir rss.py).

Conditions d'usage : ce flux est destiné à un usage personnel et non
commercial. La collecte est donc derrière GOOGLE_NEWS_ENABLED (config.py),
désactivée par défaut.

Les noms de sujets sont repris par le front (web/src/lib/subjects.json,
généré par scripts/export_subjects.py ; un test vérifie qu'il est à jour).
"""
from __future__ import annotations

import html
import logging
import re
from datetime import timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit, urlunsplit

import requests

from .quotes import _strip_accents, normalise
from .rss import UA

log = logging.getLogger("politiscope.media")

# Rubrique « France – Dernières infos ».
GOOGLE_NEWS_FRANCE_URL = "https://news.google.com/rss/headlines/section/geo/France?hl=fr&gl=FR&ceid=FR:fr"
OUTLET = "google_news"
VIA = "Google Actualités"

# --- lexique ----------------------------------------------------------------

# Sujet -> termes. Les termes sont les libellés affichés et stockés
# (`matched_terms`). L'ordre du dict départage les égalités : le sujet qui a
# le plus de termes distincts trouvés gagne ; à égalité, le premier du dict.
SUBJECT_LEXICON: dict[str, tuple[str, ...]] = {
    "Proche-Orient": (
        "Gaza", "Israël", "Cisjordanie", "Liban", "Syrie", "Palestine", "Jérusalem", "Damas",
        "Iran", "Téhéran", "Yémen", "Houthis", "Benjamin Netanyahu", "Ayatollah",
        "Le Guide suprême", "Knesset", "Tel-Aviv"),
    "Ukraine-Russie": (
        "Russie", "Ukraine", "Vladimir Poutine", "Volodymyr Zelensky", "Kiev", "Moscou",
        "Kremlin", "Donbass", "Mer Noire"),
    "Otan": ("Otan", "Article 5", "Mark Rutte", "Bruxelles"),
    "Europe": (
        "Allemagne", "Espagne", "Portugal", "Pays-Bas", "Belgique", "Luxembourg",
        "Royaume-Uni", "Pologne", "Estonie", "Lituanie", "Lettonie", "Roumanie", "Bulgarie",
        "Friedrich Merz"),
    "Asie": (
        "Chine", "Inde", "Japon", "Corée du Nord", "Corée du Sud", "Pékin", "Séoul",
        "Pyongyang", "Kim Jong-un", "Xi Jinping", "Mer de Chine", "Tokyo"),
    "USA-Amérique": (
        "Donald Trump", "États-Unis", "Washington D.C.", "Canada", "Ottawa", "Mexique",
        "Venezuela", "Colombie", "Caracas", "Argentine", "Brésil", "La Maison Blanche",
        "Buenos Aires", "Marco Rubio"),
    "France": (
        "Emmanuel Macron", "Sébastien Lecornu", "Jean-Noël Barrot", "LFI", "RN", "PCF",
        "Jean-Luc Mélenchon", "Marine Le Pen", "Jordan Bardella", "Dette", "Crise des lycées",
        "Budget 2027", "Édouard Philippe", "Marine Tondelier", "Fabien Roussel",
        "Gabriel Attal", "Bruno Retailleau", "Raphaël Glucksmann", "Olivier Faure",
        "Ségolène Royal", "Élection présidentielle 2027", "Mouvement des Gilets jaunes"),
}

# Terme -> autres formes écrites dans les titres : nom seul, graphie de la
# presse française, gentilés, formulation courante. Motifs regex, sur texte
# minuscule sans accents. Le libellé lui-même est toujours cherché, tiret et
# espace interchangeables (« Maison-Blanche » = « Maison Blanche »).
TERM_FORMS: dict[str, tuple[str, ...]] = {
    # Proche-Orient
    "Israël": (r"israelien(ne)?s?",),
    "Palestine": (r"palestinien(ne)?s?",),
    "Liban": (r"libanais(es?)?",),
    "Syrie": (r"syrien(ne)?s?",),
    "Iran": (r"iranien(ne)?s?",),
    "Yémen": (r"yemenites?",),
    "Houthis": (r"houthi", r"houthistes?"),
    "Benjamin Netanyahu": (r"netanyahu", r"netanyahou"),
    "Ayatollah": (r"ayatollahs",),
    "Le Guide suprême": (r"guide supreme",),
    # Ukraine-Russie
    "Russie": (r"russes?",),
    "Ukraine": (r"ukrainien(ne)?s?",),
    "Vladimir Poutine": (r"poutine",),
    "Volodymyr Zelensky": (r"zelensky", r"zelenskyy", r"zelenski"),
    "Kiev": (r"kyiv",),
    # Otan
    "Mark Rutte": (r"rutte",),
    # Europe
    "Allemagne": (r"allemand(e)?s?",),
    "Espagne": (r"espagnol(e)?s?",),
    "Portugal": (r"portugais(es?)?",),
    "Pays-Bas": (r"neerlandais(es?)?",),
    "Belgique": (r"belges?",),
    "Luxembourg": (r"luxembourgeois(es?)?",),
    "Royaume-Uni": (r"britanniques?",),
    "Pologne": (r"polonais(es?)?",),
    "Estonie": (r"estonien(ne)?s?",),
    "Lituanie": (r"lituanien(ne)?s?",),
    "Lettonie": (r"letton(ne)?s?",),
    "Roumanie": (r"roumain(e)?s?",),
    "Bulgarie": (r"bulgares?",),
    "Friedrich Merz": (r"merz",),
    # Asie — « océan Indien » (La Réunion, Mayotte) n'est pas l'Inde.
    "Chine": (r"chinois(es?)?",),
    "Inde": (r"(?<!ocean )indien(ne)?s?",),
    "Japon": (r"japonais(es?)?",),
    "Corée du Nord": (r"nord[- ]coreen(ne)?s?",),
    "Corée du Sud": (r"sud[- ]coreen(ne)?s?",),
    # USA-Amérique — « latino-américain » n'est pas les États-Unis.
    "Donald Trump": (r"trump",),
    "États-Unis": (r"(?<!-)americain(e)?s?",),
    "Washington D.C.": (r"washington",),
    "La Maison Blanche": (r"maison[- ]blanche",),
    "Canada": (r"canadien(ne)?s?",),
    "Mexique": (r"mexicain(e)?s?",),
    "Venezuela": (r"venezuelien(ne)?s?",),
    "Colombie": (r"colombien(ne)?s?",),
    "Argentine": (r"argentin(e)?s?",),
    "Brésil": (r"bresilien(ne)?s?",),
    "Marco Rubio": (r"rubio",),
    # France
    "Emmanuel Macron": (r"macron",),
    "Sébastien Lecornu": (r"lecornu",),
    "Jean-Noël Barrot": (r"barrot",),
    "LFI": (r"la france insoumise", r"insoumis(es?)?"),
    "RN": (r"rassemblement national",),
    "PCF": (r"parti communiste",),
    "Jean-Luc Mélenchon": (r"melenchon",),
    "Marine Le Pen": (r"le pen",),
    "Jordan Bardella": (r"bardella",),
    "Crise des lycées": (r"blocus des lycees", r"lycees? bloques?", r"lyceen(ne)?s?"),
    "Budget 2027": (r"budget", r"loi de finances"),
    "Marine Tondelier": (r"tondelier",),
    "Fabien Roussel": (r"roussel",),
    "Gabriel Attal": (r"attal",),
    "Bruno Retailleau": (r"retailleau",),
    "Raphaël Glucksmann": (r"glucksmann",),
    "Olivier Faure": (r"faure",),
    "Élection présidentielle 2027": (r"presidentielles?",),
    "Mouvement des Gilets jaunes": (r"gilets? jaunes?",),
}

# Termes trop génériques seuls : comptés seulement si un autre terme du
# même sujet est aussi trouvé (« l'article 5 de la Constitution » n'est
# pas l'Otan).
REQUIRES: dict[str, str] = {"Article 5": "Otan"}


def _norm(text: str) -> str:
    return _strip_accents(text.lower()).replace("’", "'")


def _label_pattern(label: str) -> str:
    return re.escape(_norm(label)).replace(r"\-", "[- ]").replace(r"\ ", "[- ]")


def _compile(patterns: list[str]) -> re.Pattern:
    # Frontières de mot par lookarounds plutôt que \b : « D.C. » finit par un
    # point. Sans elles, « russe » trouverait « Prusse », « RN » « Bernard ».
    return re.compile(r"(?<!\w)(?:" + "|".join(patterns) + r")(?!\w)")


_TERM_RE: dict[str, dict[str, re.Pattern]] = {
    subject: {t: _compile([_label_pattern(t), *TERM_FORMS.get(t, ())]) for t in terms}
    for subject, terms in SUBJECT_LEXICON.items()
}
_TAGS = re.compile(r"<[^>]+>")


def tag(text: str) -> tuple[str | None, list[str]]:
    """(sujet, termes trouvés) pour un titre. Les termes sont les libellés du
    lexique — « Macron » est rendu « Emmanuel Macron » — tous sujets
    confondus, ceux du sujet retenu en tête. Sujet None si aucun terme :
    l'article n'est pas retenu."""
    low = _norm(text)
    found: dict[str, list[str]] = {}
    for subject, terms in _TERM_RE.items():
        hits = [t for t, rx in terms.items() if rx.search(low)]
        hits = [t for t in hits if REQUIRES.get(t, t) in hits]
        if hits:
            found[subject] = hits
    if not found:
        return None, []
    # max() garde le premier en cas d'égalité : l'ordre du dict départage.
    best = max(found, key=lambda s: len(found[s]))
    return best, found[best] + [t for s, hits in found.items() if s != best for t in hits]


def tag_cluster(titres: list[str]) -> list[tuple[str | None, list[str]]]:
    """Tague les titres d'un cluster (le principal en tête).

    Si le cluster est mono-sujet — le titre principal a un sujet et aucun
    autre titre n'en a un différent — les articles liés restés sans sujet
    prennent celui du principal : ils traitent de la même actualité. Leurs
    termes restent vides, aucun n'a été trouvé dans leur titre.
    """
    tagged = [tag(t) for t in titres]
    if not tagged:
        return []
    main = tagged[0][0]
    if main and {s for s, _ in tagged if s} == {main}:
        tagged = [(s or main, terms) for s, terms in tagged]
    return tagged


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
    """Une mention par article du cluster, chacune avec son éditeur réel —
    y compris celles sans sujet (theme None), stockées pour un re-tag futur.
    Les articles liés n'ont pas de date propre : ils prennent celle du cluster."""
    published = cluster["published_at"]
    articles = cluster["articles"]
    if not published or not articles:
        return []
    cluster_id = canonical_url(articles[0]["url"])
    tagged = tag_cluster([a["titre"] for a in articles])
    return [{
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
        "matched_terms": terms,
    } for a, (theme, terms) in zip(articles, tagged)]


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
    """(nouvelles mentions, retenues ou non, articles lus)."""
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
    log.info("Google Actualités : %d cluster(s), %d article(s) lu(s), %d nouveau(x), "
             "%d avec un sujet", len(clusters), seen, len(mentions),
             sum(1 for m in mentions if m["theme"]))
    return mentions, seen
