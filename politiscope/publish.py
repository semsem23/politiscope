"""Publication : transforme une citation candidate en entrée affichée sur le site.

C'est le seul endroit du pipeline où un jugement humain est obligatoire. Une
candidate porte des faits — qui a dit quoi, quand, avec quelle URL. Une entrée
porte en plus une lecture : le `sujet` en une phrase et la `justif` qui dit ce
qu'il faut en comprendre. Rien de tout cela ne se déduit du texte, et les
inventer reviendrait à fabriquer l'analyse que le baromètre prétend offrir.

D'où le fonctionnement en deux temps :

    publish --draft   -> écrit un brouillon JSON, faits pré-remplis,
                         champs de jugement laissés vides
    publish --apply   -> valide le brouillon rempli et l'insère

La citation et la source ne sont jamais modifiables : si le brouillon les
altère, l'application échoue.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg2.extras

from . import db
from .config import settings
from .quotes import normalise

log = logging.getLogger("politiscope.publish")

MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
           "août", "septembre", "octobre", "novembre", "décembre"]

# Champs que la machine renseigne, et champs qui exigent une lecture humaine.
CHAMPS_DEDUITS = ("nom", "parti", "code_parti", "famille", "citation",
                  "date_texte", "date_tri", "source")
CHAMPS_A_REMPLIR = ("theme", "sujet", "justif")


def date_fr(iso: str | None) -> tuple[str, str | None]:
    """ISO 8601 -> (« 14 septembre 2026 », « 2026-09-14 »)."""
    if not iso:
        return ("", None)
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return (iso[:10], iso[:10] or None)
    return (f"{d.day} {MOIS_FR[d.month - 1]} {d.year}", d.date().isoformat())


def _reference_maps(conn) -> tuple[dict[str, dict], set[str]]:
    """Ce qu'on sait déjà : partis par personne, et thèmes autorisés."""
    with conn.cursor() as cur:
        cur.execute("select nom, parti, code_parti, famille from entries")
        par_nom = {r[0]: {"parti": r[1], "code_parti": r[2], "famille": r[3]}
                   for r in cur.fetchall()}
        cur.execute("select theme from topics")
        themes = {r[0] for r in cur.fetchall()}
    return par_nom, themes


def _comptes() -> dict[str, dict]:
    cfg = json.loads(settings.accounts_file.read_text(encoding="utf-8"))
    return {a["nom"]: a for a in cfg["accounts"]}


def build_draft(conn, *, limit: int, min_score: int, per_person: int,
                since_hours: float | None, famille: str | None) -> list[dict]:
    """Sélectionne des candidates publiables et pré-remplit ce qui est déductible."""
    par_nom, _ = _reference_maps(conn)
    comptes = _comptes()

    clauses = ["c.verifie", "not c.protocolaire", "c.theme_suggere is not null",
               "c.source is not null", "c.score >= %s"]
    params: list[Any] = [min_score]
    if since_hours:
        # `make_interval(hours => …)` exige un entier ; la multiplication
        # accepte un flottant, donc « --since-hours 1.5 » fonctionne aussi.
        clauses.append("c.date >= now() - (%s * interval '1 hour')")
        params.append(float(since_hours))
    if famille:
        clauses.append("c.famille = %s")
        params.append(famille)

    sql = f"""
        select c.id, c.nom, c.famille, c.parti, c.citation, c.citation_key,
               c.date, c.source, c.theme_suggere, c.score
          from candidates c
         where {' and '.join(clauses)}
           and not exists (select 1 from entries e where e.citation_key = c.citation_key)
           and not exists (select 1 from publications p where p.citation_key = c.citation_key)
         order by c.score desc, c.date desc
    """
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    draft, vus = [], {}
    for (cid, nom, famille_, parti, citation, _key, date_iso,
         source, theme, score) in rows:
        if per_person and vus.get(nom, 0) >= per_person:
            continue
        vus[nom] = vus.get(nom, 0) + 1

        connu = par_nom.get(nom, {})
        compte = comptes.get(nom, {})
        texte, tri = date_fr(date_iso.isoformat() if date_iso else None)

        draft.append({
            "candidate_id": cid,
            "_score": score,
            # --- déduit, ne pas modifier ---
            "nom": nom,
            "parti": connu.get("parti") or compte.get("parti") or parti or "",
            "code_parti": connu.get("code_parti"),
            "famille": connu.get("famille") or famille_,
            "citation": citation,
            "date_texte": texte,
            "date_tri": tri,
            "source": source,
            # --- à valider / remplir ---
            "theme": theme,
            "sujet": "",
            "justif": "",
            "hashtags": [],
        })
        if len(draft) >= limit:
            break
    return draft


def write_draft(entries: list[dict], path: Path) -> None:
    payload = {
        "_mode_emploi": [
            "Remplissez `sujet` et `justif` pour chaque entrée.",
            "sujet : le sujet principal en une phrase courte.",
            "justif : une phrase disant ce qu'il faut comprendre de la citation —",
            "  ce qu'elle avance, pas un jugement sur son auteur.",
            "`theme` est pré-rempli par détection automatique : vérifiez-le.",
            "Ne modifiez ni `citation` ni `source` : l'application les recontrôle.",
            "Supprimez simplement une entrée du tableau pour ne pas la publier.",
            f"Puis : python -m politiscope.cli publish --apply {path.name}",
        ],
        "entries": entries,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


# --- validation -----------------------------------------------------------
def validate(conn, entries: list[dict]) -> list[str]:
    """Renvoie la liste des problèmes. Vide = le brouillon est publiable."""
    _, themes = _reference_maps(conn)
    problemes: list[str] = []

    with conn.cursor() as cur:
        cur.execute("select id, citation, source, citation_key from candidates")
        officiel = {r[0]: (r[1], r[2], r[3]) for r in cur.fetchall()}
        cur.execute("select citation_key from entries union select citation_key from publications")
        deja = {r[0] for r in cur.fetchall()}

    vus: set[str] = set()
    for i, e in enumerate(entries, 1):
        ref = f"entrée {i} ({e.get('nom') or 'sans nom'})"

        for champ in CHAMPS_A_REMPLIR:
            if not str(e.get(champ) or "").strip():
                problemes.append(f"{ref} : « {champ} » est vide")

        t = e.get("theme")
        if t and t not in themes:
            problemes.append(f"{ref} : thème « {t} » absent de la table topics")

        src = str(e.get("source") or "")
        if not src.startswith("https://"):
            problemes.append(f"{ref} : source non-https")

        # La citation et la source doivent correspondre exactement à la candidate :
        # c'est ce qui garantit qu'aucune retouche de texte ne passe en base.
        cid = e.get("candidate_id")
        if cid not in officiel:
            problemes.append(f"{ref} : candidate_id {cid} introuvable")
        else:
            cit_ref, src_ref, key = officiel[cid]
            if e.get("citation") != cit_ref:
                problemes.append(f"{ref} : la citation a été modifiée — refusé")
            if src != src_ref:
                problemes.append(f"{ref} : la source a été modifiée — refusé")
            if key in deja:
                problemes.append(f"{ref} : citation déjà publiée")
            if key in vus:
                problemes.append(f"{ref} : citation en double dans le brouillon")
            vus.add(key)

    return problemes


def apply_draft(conn, entries: list[dict]) -> int:
    """Insère les entrées et enregistre la publication. Tout ou rien."""
    rows, pubs = [], []
    for e in entries:
        key = normalise(e["citation"])
        rows.append((e["nom"], e["parti"], e.get("code_parti"), e["famille"],
                     e["theme"], e["sujet"], e["citation"], key,
                     e.get("hashtags") or [], e["justif"],
                     e["date_texte"], e.get("date_tri"), e["source"],
                     e.get("candidate_id")))
        pubs.append((e.get("candidate_id"), e["nom"], key))

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, """
            insert into entries (nom, parti, code_parti, famille, theme, sujet,
                                 citation, citation_key, hashtags,
                                 justif, date_texte, date_tri, source, candidate_id)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (nom, citation_key) do nothing
        """, rows)
        psycopg2.extras.execute_batch(cur, """
            insert into publications (candidate_id, nom, citation_key)
            values (%s,%s,%s)
            on conflict (citation_key) do nothing
        """, pubs)
    return len(rows)


def load_draft(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"Brouillon introuvable : {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("entries") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        raise SystemExit("Brouillon mal formé : clé « entries » attendue.")
    return entries
