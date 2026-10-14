"""Collecte de la page /flux : X et Google Actualités, pour UNE figure (Emmanuel Macron).

Principes (voir aussi reference/flux-macron/docs/SOURCES.md) :
  - rien n'est inventé ni simulé : sans source utilisable, on le consigne et on s'arrête ;
  - on ne garde que ce qui mentionne réellement la figure (mot entier, sans accents ni casse) ;
  - la date conservée est celle de la PUBLICATION, jamais celle de la collecte ;
  - le texte n'est jamais reformulé : balises, entités et caractères de contrôle sont retirés,
    l'extrait est limité à 280 caractères, les URL sont http(s) sans identifiants ni pistage.

Les publications X viennent de la table `tweets`, déjà alimentée chaque nuit par
`fetch-x` (aucune lecture X supplémentaire, donc aucun coût en plus). Google
Actualités est lu directement, derrière GOOGLE_NEWS_ENABLED (désactivé par défaut) :
ce flux est destiné à un usage personnel et non commercial, à vérifier avant activation.

Le regroupement en événements, les statuts et l'indice de recoupement ne sont PAS
calculés ici : le site les calcule à la lecture (web/src/flux/shared/pipeline).
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser
import requests

from .config import settings
from .rss import UA, feed_url

log = logging.getLogger("politiscope.flux")

FIGURE = "emmanuel-macron"
FIGURE_NAME = "Emmanuel Macron"
FIGURE_HANDLE = "EmmanuelMacron"
PERSONALITIES_FILE = settings.root / "flux_personalities.json"

MAX_TITLE = 300
MAX_EXCERPT = 280          # extrait court : pas de reproduction d'articles protégés
X_TITLE_CHARS = 140
FUTURE_TOLERANCE = timedelta(minutes=5)

# Même liste que le prototype : paramètres de suivi retirés des URL.
_TRACKING = re.compile(r"^(utm_|fbclid|gclid|mc_|ref$|ref_src|cmpid|xtor|ocid|guccounter|at_)", re.I)
_TAGS = re.compile(r"<[^>]*>")
_BLOCKS = re.compile(r"<(script|style)[\s\S]*?</\1>", re.I)
# Caractères de contrôle et de direction (bidi) qui pourraient tromper l'affichage.
_CONTROL = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]")
_MENTION = re.compile(r"\bmacron\b")


# --- texte ---------------------------------------------------------------------
def fold(s: str) -> str:
    """Minuscules sans accents : sert à comparer, jamais à afficher."""
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def strip_html(s: str) -> str:
    """Texte brut : balises, entités, caractères de contrôle retirés, espaces réduits."""
    s = _BLOCKS.sub(" ", s or "")
    s = html.unescape(_TAGS.sub(" ", s))
    s = html.unescape(s)          # une seconde passe : « &amp;lt; » ne doit pas redevenir « < »
    s = _TAGS.sub(" ", s)
    return " ".join(_CONTROL.sub(" ", s).split())


def truncate(s: str, limit: int) -> str:
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def mentions_figure(*parts: str | None) -> bool:
    """Le texte mentionne-t-il réellement Macron (mot entier) ?"""
    return bool(_MENTION.search(fold(" ".join(p for p in parts if p))))


def canonical_url(raw: str | None) -> str | None:
    """URL http(s) sans identifiants, fragment ni paramètres de suivi ; None si invalide."""
    try:
        u = urlsplit((raw or "").strip())
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
        return None
    query = urlencode([(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if not _TRACKING.match(k)])
    path = u.path[:-1] if u.path.endswith("/") and u.path != "/" else u.path
    return urlunsplit((u.scheme, u.netloc, path, query, ""))


def strip_publisher_suffix(title: str, publisher: str | None) -> str:
    """Google ajoute « - Le Monde » aux titres : retiré seulement s'il correspond à l'éditeur."""
    if publisher:
        suffix = f" - {publisher}"
        if title.lower().endswith(suffix.lower()):
            return title[: -len(suffix)].rstrip()
    return title


def short_hash(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


# --- normalisation ---------------------------------------------------------------
@dataclass
class Rejected:
    reason: str


def normalize(
    *,
    source_kind: str,
    native_id: str | None,
    publisher: str | None,
    title: str,
    excerpt: str | None,
    url: str | None,
    published_at: datetime | None,
    account: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any] | Rejected:
    """Un élément brut -> ligne de `flux_articles`, ou la raison du rejet."""
    now = now or datetime.now(timezone.utc)
    clean_url = canonical_url(url)
    if not clean_url:
        return Rejected("URL invalide ou non http(s)")
    if published_at is None:
        return Rejected("date de publication absente")
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    published_at = published_at.astimezone(timezone.utc)
    if published_at > now + FUTURE_TOLERANCE:
        return Rejected("date de publication dans le futur")

    publisher_name = truncate(strip_html(publisher or ""), 80) or "Source inconnue"
    clean_title = truncate(strip_publisher_suffix(strip_html(title), publisher_name), MAX_TITLE)
    if len(clean_title) < 8:
        return Rejected("titre vide ou trop court")

    clean_excerpt = truncate(strip_html(excerpt), MAX_EXCERPT) if excerpt else None
    # La description de Google Actualités n'est que « titre + nom de l'éditeur » : ce n'est pas un extrait.
    redundant = {fold(clean_title), fold(f"{clean_title} {publisher_name}")}
    if clean_excerpt and (len(clean_excerpt) < 8 or fold(clean_excerpt) in redundant):
        clean_excerpt = None

    return {
        "id": f"{source_kind}:{native_id if source_kind == 'x' and native_id else short_hash(native_id or clean_url)}",
        "figure": FIGURE,
        "source_kind": source_kind,
        "publisher_name": publisher_name,
        "title": clean_title,
        "excerpt": clean_excerpt,
        "url": clean_url,
        "published_at": published_at,
        "author_or_account": truncate(strip_html(account), 80) if account else None,
        "original_source_url": None,
    }


# --- sources ---------------------------------------------------------------------
def articles_from_tweets(rows: Iterable[tuple], now: datetime | None = None) -> tuple[list[dict], int]:
    """Lignes de la table `tweets` (id, created_at, texte, source) -> articles. Renvoie (articles, lus).

    Un post du compte officiel est retenu tel quel : c'est l'activité publique de la figure suivie
    (retweets et réponses sont déjà exclus à l'ingestion).
    """
    out, seen = [], 0
    for tweet_id, created_at, texte, source in rows:
        seen += 1
        one_line = " ".join(strip_html(texte).split())
        item = normalize(
            source_kind="x",
            native_id=str(tweet_id),
            publisher=f"@{FIGURE_HANDLE} (X)",
            title=truncate(one_line, X_TITLE_CHARS),
            excerpt=one_line,
            url=source,
            published_at=created_at,
            account=f"@{FIGURE_HANDLE}",
            now=now,
        )
        if isinstance(item, Rejected):
            log.info("post X %s écarté : %s", tweet_id, item.reason)
            continue
        out.append(item)
    return out, seen


def parse_google_feed(content: bytes | str) -> list[dict[str, Any]]:
    """Flux RSS Google Actualités -> éléments bruts (le contenu est traité comme non fiable)."""
    out = []
    for e in feedparser.parse(content).entries:
        src = getattr(e, "source", None)
        st = getattr(e, "published_parsed", None)
        out.append({
            "guid": getattr(e, "id", None) or getattr(e, "link", None),
            "title": getattr(e, "title", "") or "",
            "description": getattr(e, "summary", None),
            "link": getattr(e, "link", None),
            "publisher": getattr(src, "title", None) if src else None,
            "published_at": datetime(*st[:6], tzinfo=timezone.utc) if st else None,
        })
    return out


def articles_from_google(items: Iterable[dict[str, Any]], now: datetime | None = None) -> tuple[list[dict], int]:
    """Éléments bruts Google -> articles qui mentionnent réellement Macron. Renvoie (articles, lus)."""
    out, seen = [], 0
    for it in items:
        seen += 1
        if not mentions_figure(it.get("title"), strip_html(it.get("description") or "")):
            continue
        publisher = it.get("publisher") or (it["title"].rsplit(" - ", 1)[1] if " - " in it["title"] else None)
        item = normalize(
            source_kind="google_news",
            native_id=it.get("guid"),
            publisher=publisher,
            title=it["title"],
            excerpt=it.get("description"),
            url=it.get("link"),
            published_at=it.get("published_at"),
            now=now,
        )
        if isinstance(item, Rejected):
            log.info("article Google écarté : %s", item.reason)
            continue
        out.append(item)
    return out, seen


def fetch_google(days: int, session: requests.Session | None = None) -> list[dict[str, Any]]:
    """Une requête au flux RSS public de recherche. Lève requests.RequestException en cas d'échec."""
    s = session or requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "application/rss+xml,application/xml"})
    r = s.get(feed_url(FIGURE_NAME, days, settings.rss_lang, settings.rss_country), timeout=30)
    r.raise_for_status()
    return parse_google_feed(r.content)


# --- personnalités (miroir de flux_personalities.json) -----------------------------
def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-")


def load_personalities(path) -> list[dict[str, Any]]:
    """Lit flux_personalities.json ; aliases trop courts ignorés (faux positifs), doublons écartés."""
    import json

    raw = json.loads(path.read_text(encoding="utf-8")).get("personalities", [])
    out, seen = [], set()
    for p in raw:
        name = (p.get("name") or "").strip()
        pid = slug(name)
        if len(name) < 4 or not pid or pid in seen:
            continue
        seen.add(pid)
        out.append({
            "id": pid,
            "name": name,
            "aliases": [a.strip() for a in p.get("aliases", []) if len(a.strip()) >= 4],
            "role": (p.get("role") or None),
        })
    return out


# --- passage -------------------------------------------------------------------------
@dataclass
class RunReport:
    lines: list[str] = field(default_factory=list)
    ok: bool = True

    def add(self, line: str) -> None:
        self.lines.append(line)


def run(conn, *, days: int, dry_run: bool, session: requests.Session | None = None,
        now: datetime | None = None) -> RunReport:
    """Un passage : synchronise les personnalités, lit les deux sources, enregistre articles et journal."""
    from . import db

    now = now or datetime.now(timezone.utc)
    rep = RunReport()
    since = now - timedelta(days=days)

    # --- X : posts déjà ingérés par fetch-x ---------------------------------------
    started = datetime.now(timezone.utc)
    x_status, x_error, x_seen, x_kept, x_new = "ok", None, 0, 0, 0
    try:
        if not db.account_exists(conn, FIGURE_HANDLE) or not db.has_ingest_run(conn, "x"):
            x_status = "not_configured"
            rep.add("X : aucune ingestion de @%s en base (fetch-x n'a jamais tourné pour ce compte)" % FIGURE_HANDLE)
        else:
            articles, x_seen = articles_from_tweets(db.fetch_figure_tweets(conn, FIGURE_HANDLE, since), now)
            x_kept = len(articles)
            if not dry_run:
                x_new = db.insert_flux_articles(conn, articles)
            rep.add(f"X : {x_seen} post(s) lu(s), {x_kept} retenu(s), {x_new} nouveau(x)")
    except Exception as e:  # noqa: BLE001 — une source en échec ne doit pas arrêter l'autre
        x_status, x_error, rep.ok = "error", f"{type(e).__name__}: {e}"[:300], False
        rep.add(f"X : échec — {x_error}")
    if not dry_run:
        db.record_flux_run(conn, "x", started, x_status, x_seen, x_kept, x_new, x_error)

    # --- Google Actualités -------------------------------------------------------
    started = datetime.now(timezone.utc)
    g_status, g_error, g_seen, g_kept, g_new = "ok", None, 0, 0, 0
    if not settings.google_news_enabled:
        g_status = "disabled"
        rep.add("Google Actualités : désactivé (GOOGLE_NEWS_ENABLED) — aucune requête")
    elif dry_run:
        rep.add(f"Google Actualités : [DRY-RUN] interrogerait le flux RSS public sur {days} jour(s), sans le faire")
    else:
        try:
            articles, g_seen = articles_from_google(fetch_google(days, session), now)
            g_kept = len(articles)
            g_new = db.insert_flux_articles(conn, articles)
            rep.add(f"Google Actualités : {g_seen} élément(s) lu(s), {g_kept} mentionnant Macron, {g_new} nouveau(x)")
        except requests.RequestException as e:
            g_status, g_error, rep.ok = "error", f"{type(e).__name__}: {e}"[:300], False
            rep.add(f"Google Actualités : échec — {g_error}")
    if not dry_run:
        db.record_flux_run(conn, "google_news", started, g_status, g_seen, g_kept, g_new, g_error)

    return rep
