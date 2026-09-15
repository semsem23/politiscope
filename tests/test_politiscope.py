"""Tests du pipeline — portent sur la logique, jamais sur le réseau."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from politiscope.quotes import (candidates_from_rss, candidates_from_tweet,
                                clean_tweet, extract_quotes, normalise, score_candidate)
from politiscope.store import BudgetExceeded, State, append_jsonl, read_jsonl


# --- extraction de citations --------------------------------------------
def test_extrait_guillemets_droits_et_courbes():
    assert extract_quotes('"Je reste une candidate pour l\'écologie et pour l\'union" : Tondelier') \
        == ["Je reste une candidate pour l'écologie et pour l'union"]
    assert extract_quotes('“Il faut que la gauche se rassemble avant qu\'il ne soit trop tard”') \
        == ["Il faut que la gauche se rassemble avant qu'il ne soit trop tard"]


def test_plusieurs_citations_triees_par_longueur():
    t = ('«il faut que cela change vraiment» et '
         '«une citation nettement plus longue que la première et qui doit passer devant»')
    q = extract_quotes(t)
    assert len(q) == 2 and len(q[0]) > len(q[1])


@pytest.mark.parametrize("frag", ["non", "oui", "choc", "scandale", "1000 bistrots",
                                  "texte européen", "opération déminage"])
def test_ecarte_les_syntagmes_mis_en_exergue(frag):
    """Une expression entre guillemets n'est pas une déclaration."""
    assert extract_quotes(f'il évoque «{frag}» dans son discours') == []


# --- régressions constatées sur données réelles (14 sept. 2026) ----------
def test_regression_appariement_guillemets_bardella():
    """Deux paires dont la première est courte : ne pas capturer l'intervalle.

    Le texte entre `"Verts"` et `"lubie xénophobe"` n'est pas une citation —
    c'est la prose de Bardella. L'extraction doit rendre la vraie citation
    ou rien, jamais le fragment intermédiaire.
    """
    t = ('Pour la militante de gauche Emmanuelle Cosse, ancienne secrétaire '
         'nationale des "Verts" recyclée à la tête d\'un fromage de la République, '
         'avantager les Français dans leur propre pays, avec leur argent, est une '
         '"lubie xénophobe".')
    for q in extract_quotes(t):
        assert "recyclée à la tête" not in q, f"intervalle inter-paires capturé : {q!r}"


def test_regression_citation_de_tiers_non_attribuee_au_compte():
    """Ruffin cite Glucksmann : la citation n'est pas de Ruffin."""
    row = {"nom": "François Ruffin", "famille": "gauche-radicale", "parti": "Debout!",
           "texte": '« Je continue à dire qu\'il faut travailler avec François Ruffin », '
                    'a dit Raphaël Glucksmann hier. Non, c\'est avec Édouard Philippe '
                    'qu\'il va travailler.',
           "date": "2026-09-12T10:00:00Z",
           "source": "https://x.com/Francois_Ruffin/status/1", "id": "1"}
    assert candidates_from_tweet(row) == []


def test_regression_porte_parole_cite_dans_un_tweet():
    row = {"nom": "François Ruffin", "famille": "gauche-radicale", "parti": "Debout!",
           "texte": '"Être un communiste debout devant vous, à côté de mon copain Ruffin, '
                    'c\'est vous dire que jamais on ne renoncera." Sebastien Jumel, '
                    'porte-parole de la campagne.',
           "date": "2026-09-12T10:00:00Z",
           "source": "https://x.com/Francois_Ruffin/status/2", "id": "2"}
    assert candidates_from_tweet(row) == []


def test_tweet_sans_tiers_reste_attribue_a_lauteur():
    row = {"nom": "Marine Tondelier", "famille": "gauche-social", "parti": "Les Écologistes",
           "texte": '« Chacun a décidé d\'être dans son couloir de natation, et c\'est '
                    'exactement ce qui nous fera perdre. »',
           "date": "2026-09-12T10:00:00Z",
           "source": "https://x.com/marinetondelier/status/3", "id": "3"}
    c = candidates_from_tweet(row)
    assert len(c) == 1 and c[0]["nom"] == "Marine Tondelier"


def test_detection_attribution_tierce():
    from politiscope.quotes import third_party_attribution
    t = '« le budget est injuste pour tous », a dit Raphaël Glucksmann'
    assert third_party_attribution(t, "le budget est injuste pour tous",
                                   "François Ruffin") == "Raphaël Glucksmann"
    assert third_party_attribution(t, "le budget est injuste pour tous",
                                   "Raphaël Glucksmann") is None


def test_rss_titre_ne_nommant_pas_la_personne_est_ecarte():
    """Le flux d'une personne remonte aussi des articles sur d'autres."""
    assert candidates_from_rss({
        "titre": '«Il faut arrêter cette politique budgétaire absurde», juge Untel',
        "nom": "Marine Tondelier"}) == []


def test_ignore_les_fragments_trop_courts():
    assert extract_quotes('il a dit «non» hier') == []


def test_dedoublonne_les_citations_identiques():
    assert len(extract_quotes("«il faut vraiment que cela change» puis «il faut vraiment que cela change»")) == 1


# --- nettoyage de tweets -------------------------------------------------
def test_clean_tweet_retire_url_et_hashtags_finaux():
    t = "@journaliste Le budget est injuste. https://t.co/abc #Budget2026 #PLF"
    assert clean_tweet(t) == "Le budget est injuste."


def test_clean_tweet_preserve_hashtag_interne():
    assert "#Budget" in clean_tweet("Le #Budget doit être rejeté par les députés")


# --- notation ------------------------------------------------------------
def test_rejette_les_titres_agenda():
    score, why = score_candidate("Revoir en direct le meeting", is_tweet=False, has_quote=False)
    assert score == 0 and "rejeté" in why[0]


def test_tweet_avec_citation_mieux_note_que_titre_nu():
    haut, _ = score_candidate("«" + "x" * 60 + "», déclare le ministre",
                              is_tweet=True, has_quote=True)
    bas, _ = score_candidate("Le ministre s'exprime sur le budget",
                             is_tweet=False, has_quote=False)
    assert haut > bas


def test_penalise_les_questions_sans_citation():
    q, _ = score_candidate("Le budget sera-t-il voté par les députés cette semaine ?",
                           is_tweet=False, has_quote=False)
    a, _ = score_candidate("Le budget sera voté par les députés cette semaine.",
                           is_tweet=False, has_quote=False)
    assert q < a


# --- candidates ----------------------------------------------------------
def _tweet(texte):
    return {"nom": "Test", "famille": "majorite", "parti": "P", "texte": texte,
            "date": "2026-09-14T10:00:00Z", "source": "https://x.com/t/status/1", "id": "1"}


def test_tweet_donne_une_candidate_verifiee():
    c = candidates_from_tweet(_tweet("Le budget 2026 sacrifie les services publics "
                                     "et il faut le dire clairement aux Français."))
    assert len(c) == 1
    assert c[0]["verifie"] is True
    assert c[0]["source"].startswith("https://x.com/")


def test_tweet_trop_court_est_ecarte():
    assert candidates_from_tweet(_tweet("Merci à tous !")) == []


def test_rss_sans_guillemets_ne_donne_rien():
    assert candidates_from_rss({"titre": "Le ministre s'exprime sur le budget"}) == []


def test_rss_avec_guillemets_est_marque_a_verifier():
    c = candidates_from_rss({
        "titre": '«Notre pays s\'effondre de l\'intérieur», alerte Sébastien Chenu',
        "nom": "Sébastien Chenu", "media": "BFMTV"})
    assert len(c) == 1
    assert c[0]["verifie"] is False      # le lien Google n'est pas citable
    assert c[0]["source"] is None


# --- normalisation / doublons -------------------------------------------
def test_normalise_ignore_accents_casse_ponctuation():
    assert normalise("L'autre voie, c'est l'union.") == normalise("lautre voie cest lunion")


# --- état et budget ------------------------------------------------------
def test_budget_bloque_au_plafond(tmp_path: Path):
    st = State(tmp_path / "s.json")
    st.charge(1000, 0.005)              # 5.00 USD
    st.check_budget(10.0)               # sous le plafond : passe
    with pytest.raises(BudgetExceeded):
        st.check_budget(4.0)            # au-dessus : bloque


def test_etat_persiste_et_se_recharge(tmp_path: Path):
    p = tmp_path / "s.json"
    st = State(p)
    st.user_ids["a"] = "1"
    st.last_id["a"] = "99"
    st.charge(10, 0.005)
    st.save()

    st2 = State(p)
    assert st2.user_ids == {"a": "1"}
    assert st2.last_id == {"a": "99"}
    assert st2.spend_this_month == pytest.approx(0.05)


def test_ecriture_atomique_de_letat(tmp_path: Path):
    st = State(tmp_path / "s.json")
    st.save()
    assert not list(tmp_path.glob("*.tmp"))     # pas de résidu temporaire


def test_jsonl_aller_retour(tmp_path: Path):
    p = tmp_path / "d.jsonl"
    append_jsonl(p, [{"id": "1", "t": "é"}, {"id": "2", "t": "à"}])
    append_jsonl(p, [{"id": "3", "t": "ü"}])
    rows = list(read_jsonl(p))
    assert [r["id"] for r in rows] == ["1", "2", "3"]
    assert rows[0]["t"] == "é"          # UTF-8 préservé


def test_lecture_jsonl_absent_ne_leve_pas(tmp_path: Path):
    assert list(read_jsonl(tmp_path / "rien.jsonl")) == []


# --- configuration des comptes ------------------------------------------
def test_fichier_comptes_est_coherent():
    cfg = json.loads((Path(__file__).parent.parent / "x_accounts.json")
                     .read_text(encoding="utf-8"))
    familles = {"majorite", "droite-rep", "extreme-droite", "gauche-radicale", "gauche-social"}
    handles, noms = set(), set()
    for a in cfg["accounts"]:
        assert a["famille"] in familles, f"famille inconnue pour {a['nom']}"
        assert not a["handle"].startswith("@"), f"handle avec @ : {a['handle']}"
        assert a["handle"] not in handles, f"handle en double : {a['handle']}"
        assert a["nom"] not in noms, f"nom en double : {a['nom']}"
        handles.add(a["handle"])
        noms.add(a["nom"])
    assert len(cfg["accounts"]) >= 20


# --- correctifs de notation et d'attribution (2e passe) ------------------
def test_tweet_prime_sur_un_titre_de_presse():
    """Le vérifiable doit passer devant le bien formulé."""
    tweet, _ = score_candidate("Le budget 2026 sacrifie nos services publics et je le combattrai.",
                               is_tweet=True, has_quote=False)
    presse, _ = score_candidate('«Le budget est injuste pour les Français», juge le député',
                                is_tweet=False, has_quote=True)
    assert tweet > presse


def test_substantif_en_ement_nest_pas_un_verbe():
    """« redressement » ne doit pas faire passer un syntagme pour une phrase."""
    assert extract_quotes('il évoque «Participation au redressement des finances publiques»') == []


def test_verbe_en_ent_reste_reconnu():
    assert extract_quotes('il dit «les députés veulent un autre budget pour la France»')


def test_rss_nom_dans_la_citation_est_ecarte():
    """« Bruno Retailleau est celui qui manque » parle de lui, n'est pas de lui."""
    assert candidates_from_rss({
        "titre": '«Bruno Retailleau est celui qui manque à la France depuis des années»',
        "nom": "Bruno Retailleau"}) == []


# --- substance politique -------------------------------------------------
def test_detection_de_theme():
    from politiscope.quotes import detect_theme
    assert detect_theme("Le budget 2026 creuse le déficit") == "Budget & finances publiques"
    assert detect_theme("Il faut renoncer au droit du sol") == "Immigration & sécurité"
    assert detect_theme("Merci les Bleues pour cette finale") is None


def test_frontieres_de_mot_dans_le_lexique():
    """« améliorer » ne doit pas déclencher « aide médicale », ni « européen » « euro »."""
    from politiscope.quotes import detect_theme
    assert detect_theme("améliorer le quotidien des Français") is None


def test_message_protocolaire_deconseille():
    voeux, _ = score_candidate("Merci les Bleues de nous avoir fait rêver pour cette finale.",
                               is_tweet=True, has_quote=False)
    fond, _ = score_candidate("Le budget 2026 creuse le déficit et sacrifie les services publics.",
                              is_tweet=True, has_quote=False)
    assert fond > voeux


def test_theme_suggere_expose_dans_la_candidate():
    c = candidates_from_tweet({
        "nom": "Test", "famille": "majorite", "parti": "P",
        "texte": "Le budget 2026 creuse le déficit et je m'y opposerai fermement.",
        "date": "2026-09-14T10:00:00Z", "source": "https://x.com/t/status/9", "id": "9"})
    assert c[0]["theme_suggere"] == "Budget & finances publiques"


# --- régressions 3e passe : fenêtre 24 h et prise de position -------------
def test_regression_regex_protocolaire_compile_une_frontiere_de_mot():
    """Garde-fou : un `\b` mal échappé devient un backspace et la regex ne matche plus."""
    from politiscope.quotes import _CEREMONIAL, is_ceremonial
    assert "\x08" not in _CEREMONIAL.pattern, "backspace littéral dans la regex"
    assert is_ceremonial("Merci pour ton soutien cher Arnaud, qui m'honore !")
    assert is_ceremonial("Bravo aux Bleues pour cette finale")
    assert not is_ceremonial("Le budget creuse le déficit")
    assert not is_ceremonial("commercial et marchand")   # pas de match interne


def test_aucun_caractere_de_controle_dans_les_modules():
    """Les regex générées par script peuvent embarquer des caractères invisibles."""
    import politiscope
    root = Path(politiscope.__file__).parent
    for f in root.glob("*.py"):
        data = f.read_bytes()
        for ctrl in (0x07, 0x08, 0x0b, 0x0c, 0x1b):
            assert bytes([ctrl]) not in data, f"{f.name} contient 0x{ctrl:02x}"


def test_regression_citation_tierce_tronquee():
    """Tweet coupé à 280 car. : le guillemet ouvrant n'est jamais fermé."""
    row = {"nom": "Mathilde Panot", "famille": "gauche-radicale", "parti": "LFI",
           "texte": "🗣️ Fatia Alcabélard : « Claude Jean-Pierre était mon papa. "
                    "Il a perdu la vie en 2020 suite à un contrôle de police à Deshaies, "
                    "en Guadeloupe. Après près de 6 ans de lutte",
           "date": "2026-09-14T10:00:00Z",
           "source": "https://x.com/MathildePanot/status/1", "id": "1"}
    assert candidates_from_tweet(row) == []


def test_remerciement_exclu_comme_protocolaire():
    row = {"nom": "Olivier Faure", "famille": "gauche-social", "parti": "PS",
           "texte": "Merci pour ton soutien cher Arnaud, qui m'honore ! "
                    "De Mauroy à Aubry, Lille a toujours été la fierté du socialisme.",
           "date": "2026-09-14T10:00:00Z",
           "source": "https://x.com/faureolivier/status/2", "id": "2"}
    c = candidates_from_tweet(row)
    assert c == [] or c[0]["protocolaire"] is True


def test_prose_directe_reste_attribuee_a_lauteur():
    row = {"nom": "Éric Ciotti", "famille": "extreme-droite", "parti": "UDR",
           "texte": "L'absence de session en septembre fait perdre un temps précieux. "
                    "J'ai demandé au Premier ministre d'inscrire au plus vite le texte "
                    "sur les polices municipales.",
           "date": "2026-09-14T10:00:00Z",
           "source": "https://x.com/ECiotti/status/3", "id": "3"}
    c = candidates_from_tweet(row)
    assert len(c) == 1 and c[0]["verifie"] is True


# --- base de données -----------------------------------------------------
def test_ordre_de_repli_des_dsn(monkeypatch):
    """L'hôte direct est IPv6-only : le pooler IPv4 doit suivre en repli."""
    from politiscope import db
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://u:p@db.ref.supabase.co:5432/postgres")
    monkeypatch.setenv("SUPABASE_PROJECT_REF", "ref")
    monkeypatch.setenv("SUPABASE_DB_PASSWORD", "p")
    monkeypatch.setenv("SUPABASE_REGION", "eu-west-2")
    labels = [lab for lab, _ in db._dsns()]
    assert labels[0] == "direct"
    assert any("IPv4" in l for l in labels[1:])


def test_absence_de_config_leve_une_erreur_explicite(monkeypatch):
    from politiscope import db
    for v in ("SUPABASE_DB_URL", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD"):
        monkeypatch.delenv(v, raising=False)
    with pytest.raises(db.DatabaseUnavailable):
        with db.connect():
            pass


def test_migration_declare_invariant_verifie_source():
    """Une candidate vérifiée doit toujours porter une URL : garanti en base."""
    sql = (Path(__file__).parent.parent / "migrations" /
           "001_initial_schema.sql").read_text(encoding="utf-8")
    assert "verifie_exige_source" in sql
    assert "not verifie or source is not null" in sql


def test_migration_active_rls_sur_toutes_les_tables():
    sql = (Path(__file__).parent.parent / "migrations" /
           "001_initial_schema.sql").read_text(encoding="utf-8")
    for t in ("accounts", "tweets", "rss_items", "candidates",
              "publications", "ingest_state", "ingest_runs"):
        assert f"alter table {t}" in sql and "enable row level security" in sql


# --- bugs corrigés : état durable et journalisation ----------------------
def test_hydratation_ne_recouvre_pas_letat_local(tmp_path, monkeypatch):
    """La base complète le local, elle ne l'écrase pas : le local est plus frais."""
    from politiscope import cli, db as dbmod

    st = State(tmp_path / "s.json")
    st.user_ids["alice"] = "LOCAL"
    st.last_id["alice"] = "999"

    monkeypatch.setattr(dbmod, "fetch_user_ids", lambda _c: {"alice": "BASE", "bob": "42"})
    monkeypatch.setattr(dbmod, "fetch_last_tweet_ids", lambda _c: {"alice": "1", "bob": "7"})
    monkeypatch.setattr(dbmod, "fetch_month_spend", lambda _c, _m: (3.5, 700))

    class _Conn:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(dbmod, "connect", lambda: _Conn())

    assert cli._hydrate_state_from_db(st) is None
    assert st.user_ids["alice"] == "LOCAL"   # le local gagne
    assert st.user_ids["bob"] == "42"        # le manquant est récupéré
    assert st.last_id["alice"] == "999"
    assert st.last_id["bob"] == "7"
    # la dépense, elle, vient toujours de la base : c'est la seule qui survit
    # à un runner neuf, où le fichier local repart de zéro
    assert st.spend_this_month == 3.5


def test_hydratation_survit_a_une_base_injoignable(tmp_path, monkeypatch):
    from politiscope import cli, db as dbmod

    def boom():
        raise dbmod.DatabaseUnavailable("pas de réseau")
    monkeypatch.setattr(dbmod, "connect", boom)

    st = State(tmp_path / "s.json")
    msg = cli._hydrate_state_from_db(st)
    assert msg and "réseau" in msg          # l'anomalie est remontée
    assert st.user_ids == {}                # et rien n'explose


def test_persistance_ne_fait_pas_echouer_lingestion(tmp_path, monkeypatch):
    """Une base indisponible ne doit jamais faire perdre une ingestion payée."""
    from politiscope import cli, db as dbmod

    def boom():
        raise dbmod.DatabaseUnavailable("injoignable")
    monkeypatch.setattr(dbmod, "connect", boom)

    cli._persist_state_to_db(State(tmp_path / "s.json"), "x", 3, 10, 0.05)  # ne lève pas


def test_les_fonctions_de_db_sont_toutes_utilisees():
    """Garde-fou : une fonction de db.py jamais appelée est un bug, pas du style.

    C'est ainsi que `log_run`, `fetch_user_ids`, `fetch_last_tweet_ids` et
    `fetch_published_keys` sont restées mortes — le compteur de dépense en
    base affichait 0 pendant que le pipeline dépensait réellement.
    """
    import ast
    root = Path(__file__).parent.parent / "politiscope"
    src = ast.parse((root / "db.py").read_text(encoding="utf-8"))
    publiques = [n.name for n in src.body
                 if isinstance(n, ast.FunctionDef) and not n.name.startswith("_")]

    appelants = "".join(
        f.read_text(encoding="utf-8") for f in root.glob("*.py") if f.name != "db.py")
    mortes = [n for n in publiques if f"{n}(" not in appelants]
    assert not mortes, f"fonctions de db.py jamais appelées : {mortes}"


# --- publication ---------------------------------------------------------
def test_date_francaise():
    from politiscope.publish import date_fr
    assert date_fr("2026-09-14T18:30:00+00:00") == ("14 septembre 2026", "2026-09-14")
    assert date_fr("2026-01-03T00:00:00Z")[0] == "3 janvier 2026"
    assert date_fr(None) == ("", None)


def test_champs_de_jugement_declares_obligatoires():
    """Le pipeline ne doit jamais inventer sujet."""
    from politiscope.publish import CHAMPS_A_REMPLIR
    assert "sujet" in CHAMPS_A_REMPLIR


def _draft_entry(**over):
    e = {"candidate_id": 1, "nom": "Test", "parti": "P", "famille": "majorite",
         "theme": "Budget & finances publiques", "sujet": "Un sujet",
         "citation": "Le budget est injuste pour les Français.",
         "date_texte": "14 septembre 2026", "date_tri": "2026-09-14",
         "source": "https://x.com/t/status/1"}
    e.update(over)
    return e


class _FakeCursor:
    """Rejoue les deux requêtes de validate() sans base."""
    def __init__(self, officiel, deja):
        self.officiel, self.deja, self._rows = officiel, deja, []
    def execute(self, q, *a):
        self._rows = list(self.officiel) if "from candidates" in q else [(k,) for k in self.deja]
    def fetchall(self): return self._rows
    def __enter__(self): return self
    def __exit__(self, *a): return False


class _FakeConn:
    def __init__(self, officiel, deja, themes):
        self.officiel, self.deja, self.themes = officiel, deja, themes
    def cursor(self): return _FakeCursor(self.officiel, self.deja)


def _validate(entries, *, officiel=None, deja=(), themes=("Budget & finances publiques",)):
    from politiscope import publish
    officiel = officiel if officiel is not None else [
        (1, "Le budget est injuste pour les Français.", "https://x.com/t/status/1", "clef1")]
    import unittest.mock as m
    with m.patch.object(publish, "_reference_maps", lambda c: ({}, set(themes))):
        return publish.validate(_FakeConn(officiel, deja, themes), entries)


def test_brouillon_complet_est_valide():
    assert _validate([_draft_entry()]) == []


@pytest.mark.parametrize("champ", ["sujet", "theme"])
def test_champ_vide_est_refuse(champ):
    p = _validate([_draft_entry(**{champ: ""})])
    assert any(champ in x for x in p)


def test_theme_inconnu_est_refuse():
    assert any("topics" in x for x in _validate([_draft_entry(theme="Inventé")]))


def test_citation_modifiee_est_refusee():
    """Garde-fou central : le brouillon ne doit pas pouvoir réécrire les faits."""
    p = _validate([_draft_entry(citation="Le budget est PARFAIT.")])
    assert any("citation a été modifiée" in x for x in p)


def test_source_modifiee_est_refusee():
    p = _validate([_draft_entry(source="https://exemple.fr/faux")])
    assert any("source a été modifiée" in x for x in p)


def test_source_non_https_est_refusee():
    p = _validate([_draft_entry(source="http://x.com/t/status/1")])
    assert any("non-https" in x for x in p)


def test_citation_deja_publiee_est_refusee():
    assert any("déjà publiée" in x for x in _validate([_draft_entry()], deja=("clef1",)))


def test_doublon_dans_le_brouillon_est_refuse():
    p = _validate([_draft_entry(), _draft_entry()])
    assert any("double dans le brouillon" in x for x in p)


def test_plafond_mensuel_survit_a_un_runner_neuf(tmp_path, monkeypatch):
    """En exécution planifiée, x_state.json est vide : sans reprise depuis la
    base, le garde-fou budgétaire ne se déclencherait jamais."""
    from politiscope import cli, db as dbmod

    monkeypatch.setattr(dbmod, "fetch_user_ids", lambda _c: {})
    monkeypatch.setattr(dbmod, "fetch_last_tweet_ids", lambda _c: {})
    monkeypatch.setattr(dbmod, "fetch_month_spend", lambda _c, _m: (24.0, 4800))

    class _Conn:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(dbmod, "connect", lambda: _Conn())

    st = State(tmp_path / "neuf.json")
    assert st.spend_this_month == 0.0          # runner vierge
    cli._hydrate_state_from_db(st)
    assert st.spend_this_month == 24.0
    with pytest.raises(BudgetExceeded):
        st.check_budget(25.0 - 2)              # plafond dépassé, ingestion refusée


def test_toutes_les_dependances_sont_declarees():
    """Garde-fou : un import tiers absent de requirements.txt casse la CI.

    C'est ainsi que psycopg2 est resté non déclaré — il était déjà installé
    sur la machine de développement, donc l'oubli est resté invisible
    jusqu'au premier passage sur un runner vierge.
    """
    import ast
    import sys as _sys

    racine = Path(__file__).parent.parent
    alias = {"dotenv": "python-dotenv", "psycopg2": "psycopg2"}
    stdlib = set(_sys.stdlib_module_names)

    modules = set()
    for dossier in ("politiscope", "scripts", "tests"):
        for f in (racine / dossier).glob("*.py"):
            for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
                if isinstance(n, ast.Import):
                    modules.update(a.name.split(".")[0] for a in n.names)
                elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
                    modules.add(n.module.split(".")[0])

    declarees = (racine / "requirements.txt").read_text(encoding="utf-8").lower()
    manquants = [
        m for m in modules
        if m not in stdlib and m != "politiscope"
        and alias.get(m, m).lower() not in declarees
    ]
    assert not manquants, f"imports non déclarés dans requirements.txt : {manquants}"
