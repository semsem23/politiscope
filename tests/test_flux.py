"""Collecte de la page /flux : normalisation, filtre de mention, sources, journal — sans réseau ni base."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from politiscope import flux

NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)
RECENT = NOW - timedelta(hours=3)


def _item(**over):
    base = dict(source_kind="google_news", native_id="g1", publisher="Le Monde",
                title="Emmanuel Macron reçoit le chancelier à l'Élysée", excerpt=None,
                url="https://news.google.com/rss/articles/abc?oc=5", published_at=RECENT, now=NOW)
    base.update(over)
    return flux.normalize(**base)


# --- texte ------------------------------------------------------------------
def test_texte_brut_sans_balises_entites_ni_controles():
    brut = "<b>Macron</b> &amp; l’Europe‮\u0007 <script>alert(1)</script>&lt;i&gt;x&lt;/i&gt;"
    assert flux.strip_html(brut) == "Macron & l’Europe x"


def test_entites_doublement_encodees_ne_redeviennent_pas_des_balises():
    assert flux.strip_html("&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;") == "alert(1)"


@pytest.mark.parametrize("texte,attendu", [
    ("Emmanuel Macron à Berlin", True),
    ("EMMANUEL MACRON À BERLIN", True),
    ("le président Macron s'exprime", True),
    ("La macronie divisée", False),            # mot entier seulement
    ("Un macaron de Paris", False),
    ("", False),
])
def test_mention_en_mot_entier_sans_accents_ni_casse(texte, attendu):
    assert flux.mentions_figure(texte) is attendu


@pytest.mark.parametrize("url,attendu", [
    ("https://exemple.fr/a/?utm_source=x&id=3&fbclid=zz#haut", "https://exemple.fr/a?id=3"),
    ("http://exemple.fr/", "http://exemple.fr/"),
    ("javascript:alert(1)", None),
    ("ftp://exemple.fr/a", None),
    ("https://user:mdp@exemple.fr/a", None),
    ("", None),
    (None, None),
])
def test_url_http_s_sans_pistage_ni_identifiants(url, attendu):
    assert flux.canonical_url(url) == attendu


# --- normalisation -------------------------------------------------------------
def test_article_valide():
    a = _item(excerpt="  Une   phrase d'extrait   suffisante. ")
    assert a["id"].startswith("google_news:") and a["figure"] == "emmanuel-macron"
    assert a["published_at"] == RECENT                      # date de publication, pas de collecte
    assert a["excerpt"] == "Une phrase d'extrait suffisante."
    assert a["original_source_url"] is None


def test_suffixe_editeur_retire_seulement_s_il_correspond():
    assert _item(title="Macron reçoit le chancelier - Le Monde")["title"] == "Macron reçoit le chancelier"
    assert _item(title="Macron reçoit le chancelier - Autre média")["title"] == "Macron reçoit le chancelier - Autre média"


@pytest.mark.parametrize("over,raison", [
    (dict(url="javascript:alert(1)"), "URL"),
    (dict(published_at=None), "date"),
    (dict(published_at=NOW + timedelta(hours=2)), "futur"),
    (dict(title="Court"), "titre"),
])
def test_elements_invalides_rejetes_avec_raison(over, raison):
    r = _item(**over)
    assert isinstance(r, flux.Rejected) and raison in r.reason


def test_description_google_titre_plus_editeur_n_est_pas_un_extrait():
    # Cas réel : la description du flux est « <titre> <éditeur> » (liens retirés).
    r = _item(publisher="BFM", title="Macron reconnaît des « angoisses légitimes » - BFM",
              excerpt='<a href="https://exemple.fr">Macron reconnaît des « angoisses légitimes »</a>&nbsp;&nbsp;<font>BFM</font>')
    assert r["title"] == "Macron reconnaît des « angoisses légitimes »" and r["excerpt"] is None


def test_extrait_identique_au_titre_ou_trop_long():
    titre = "Emmanuel Macron reçoit le chancelier à l'Élysée"
    assert _item(excerpt=titre)["excerpt"] is None
    assert len(_item(excerpt="mot " * 200)["excerpt"]) <= flux.MAX_EXCERPT


def test_date_sans_fuseau_est_lue_en_utc():
    a = _item(published_at=datetime(2026, 10, 14, 9, 0))
    assert a["published_at"].tzinfo is not None and a["published_at"].hour == 9


# --- X : posts déjà ingérés ------------------------------------------------------
def test_posts_x_vers_articles():
    rows = [("2110000000000000001", RECENT, "Ce soir, entretien avec le chancelier. " * 6,
             "https://x.com/EmmanuelMacron/status/2110000000000000001"),
            ("2110000000000000002", RECENT, "x", "https://x.com/EmmanuelMacron/status/2110000000000000002"),   # trop court
            ("2110000000000000003", NOW + timedelta(days=1), "Un post daté du futur, donc écarté.",
             "https://x.com/EmmanuelMacron/status/2110000000000000003")]
    arts, seen = flux.articles_from_tweets(rows, NOW)
    assert seen == 3 and len(arts) == 1
    a = arts[0]
    assert a["id"] == "x:2110000000000000001" and a["source_kind"] == "x"
    assert a["publisher_name"] == "@EmmanuelMacron (X)" and a["author_or_account"] == "@EmmanuelMacron"
    assert a["url"] == "https://x.com/EmmanuelMacron/status/2110000000000000001"
    assert len(a["title"]) <= flux.X_TITLE_CHARS and a["excerpt"].startswith("Ce soir")


# --- Google Actualités : flux RSS -----------------------------------------------
FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Google Actualités</title>
<item><title>Emmanuel Macron défend sa réforme - Le Figaro</title>
 <link>https://news.google.com/rss/articles/CBM1</link><guid isPermaLink="false">CBM1</guid>
 <pubDate>Tue, 14 Oct 2026 08:30:00 GMT</pubDate>
 <description>&lt;a href="https://x"&gt;Emmanuel Macron défend sa réforme&lt;/a&gt;</description>
 <source url="https://www.lefigaro.fr">Le Figaro</source></item>
<item><title>Météo : tornade dans le Gard - 20 Minutes</title>
 <link>https://news.google.com/rss/articles/CBM2</link><guid isPermaLink="false">CBM2</guid>
 <pubDate>Tue, 14 Oct 2026 08:00:00 GMT</pubDate><source url="https://www.20minutes.fr">20 Minutes</source></item>
<item><title>La macronie face à la rue - Libération</title>
 <link>https://news.google.com/rss/articles/CBM3</link><guid isPermaLink="false">CBM3</guid>
 <pubDate>Tue, 14 Oct 2026 07:00:00 GMT</pubDate><source url="https://www.liberation.fr">Libération</source></item>
<item><title>Macron au Sommet - Le Monde</title>
 <link>javascript:alert(1)</link><guid>CBM4</guid>
 <pubDate>Tue, 14 Oct 2026 06:00:00 GMT</pubDate><source url="https://www.lemonde.fr">Le Monde</source></item>
</channel></rss>"""


def test_flux_google_ne_garde_que_ce_qui_mentionne_macron():
    arts, seen = flux.articles_from_google(flux.parse_google_feed(FEED), NOW)
    assert seen == 4
    assert [a["title"] for a in arts] == ["Emmanuel Macron défend sa réforme"]   # météo, « macronie » et URL piégée écartés
    a = arts[0]
    assert a["publisher_name"] == "Le Figaro" and a["source_kind"] == "google_news"
    assert a["url"] == "https://news.google.com/rss/articles/CBM1"
    assert a["published_at"] == datetime(2026, 10, 14, 8, 30, tzinfo=timezone.utc)
    assert a["excerpt"] is None        # description = titre : ignorée


def test_identifiant_stable_d_un_passage_a_l_autre():
    a1, _ = flux.articles_from_google(flux.parse_google_feed(FEED), NOW)
    a2, _ = flux.articles_from_google(flux.parse_google_feed(FEED), NOW + timedelta(hours=1))
    assert a1[0]["id"] == a2[0]["id"]


# --- passage complet (base et réseau simulés) --------------------------------------
class FakeDB:
    """Remplace politiscope.db pour `run` : enregistre ce qui serait écrit."""
    def __init__(self, tweets=(), account=True, ingested=True):
        self.tweets, self.account, self.ingested = list(tweets), account, ingested
        self.articles, self.runs = {}, []

    def account_exists(self, conn, handle): return self.account
    def has_ingest_run(self, conn, kind): return self.ingested
    def fetch_figure_tweets(self, conn, handle, since): return [t for t in self.tweets if t[1] >= since]

    def insert_flux_articles(self, conn, arts):
        new = 0
        for a in arts:
            if a["id"] not in self.articles:
                self.articles[a["id"]] = a
                new += 1
        return new

    def record_flux_run(self, conn, kind, started, status, seen, kept, new, error):
        self.runs.append((kind, status, seen, kept, new, error))


@pytest.fixture
def fake_db(monkeypatch):
    from politiscope import db
    f = FakeDB(tweets=[("2110000000000000001", RECENT, "Entretien avec le chancelier à l'Élysée ce soir.",
                        "https://x.com/EmmanuelMacron/status/2110000000000000001")])
    for name in ("account_exists", "has_ingest_run", "fetch_figure_tweets", "insert_flux_articles", "record_flux_run"):
        monkeypatch.setattr(db, name, getattr(f, name))
    return f


def test_google_desactive_aucune_requete_et_journal_disabled(fake_db, monkeypatch):
    monkeypatch.setattr(flux, "settings", replace(flux.settings, google_news_enabled=False))
    monkeypatch.setattr(flux, "fetch_google", lambda *a, **k: pytest.fail("aucune requête attendue"))
    rep = flux.run(None, days=30, dry_run=False, now=NOW)
    assert rep.ok
    assert ("google_news", "disabled", 0, 0, 0, None) in fake_db.runs
    assert ("x", "ok", 1, 1, 1, None) in fake_db.runs and list(fake_db.articles) == ["x:2110000000000000001"]


def test_passage_idempotent_et_google_active(fake_db, monkeypatch):
    monkeypatch.setattr(flux, "settings", replace(flux.settings, google_news_enabled=True))
    monkeypatch.setattr(flux, "fetch_google", lambda days, session=None: flux.parse_google_feed(FEED))
    flux.run(None, days=30, dry_run=False, now=NOW)
    rep = flux.run(None, days=30, dry_run=False, now=NOW)
    assert len(fake_db.articles) == 2                                 # 1 post X + 1 article Google, pas de doublon
    assert fake_db.runs[-1] == ("google_news", "ok", 4, 1, 0, None) and rep.ok


def test_echec_google_journalise_et_n_arrete_pas_x(fake_db, monkeypatch):
    import requests
    monkeypatch.setattr(flux, "settings", replace(flux.settings, google_news_enabled=True))

    def boom(*a, **k):
        raise requests.ConnectionError("réseau coupé")

    monkeypatch.setattr(flux, "fetch_google", boom)
    rep = flux.run(None, days=30, dry_run=False, now=NOW)
    assert not rep.ok and "x:2110000000000000001" in fake_db.articles
    kind, status, *_, error = fake_db.runs[-1]
    assert (kind, status) == ("google_news", "error") and "réseau coupé" in error


def test_x_non_configure_sans_ingestion(fake_db, monkeypatch):
    monkeypatch.setattr(flux, "settings", replace(flux.settings, google_news_enabled=False))
    fake_db.ingested = False
    flux.run(None, days=30, dry_run=False, now=NOW)
    assert fake_db.runs[0][:2] == ("x", "not_configured") and not fake_db.articles


def test_dry_run_n_ecrit_ni_ne_requete(fake_db, monkeypatch):
    monkeypatch.setattr(flux, "settings", replace(flux.settings, google_news_enabled=True))
    monkeypatch.setattr(flux, "fetch_google", lambda *a, **k: pytest.fail("aucune requête en dry-run"))
    flux.run(None, days=30, dry_run=True, now=NOW)
    assert not fake_db.articles and not fake_db.runs
