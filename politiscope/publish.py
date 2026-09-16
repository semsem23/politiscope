"""Publication: turns a candidate citation into an entry shown on the site.

This is the only place in the pipeline where a human review is required. A
candidate carries facts — who said what, when, with which URL. `theme` is
pre-filled by automatic detection, but still needs checking: it's an entry's
only judgment field, and nothing guarantees the heuristic got it right.

Hence the two-step flow:

    publish --draft   -> writes a JSON draft, facts pre-filled,
                         judgment fields left empty
    publish --apply   -> validates the filled draft and inserts it

The citation and the source are never editable: if the draft alters them,
applying it fails.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg2.extras

from . import db
from .config import settings
from .quotes import normalise

MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
           "août", "septembre", "octobre", "novembre", "décembre"]

# Fields the machine fills in, and fields that require a human read.
CHAMPS_DEDUITS = ("nom", "parti", "code_parti", "famille", "citation",
                  "date_texte", "date_tri", "source")
CHAMPS_A_REMPLIR = ("theme",)


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
    """What we already know: parties by person, and allowed themes."""
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
    """Selects publishable candidates and pre-fills what can be deduced."""
    par_nom, _ = _reference_maps(conn)
    comptes = _comptes()

    clauses = ["c.verifie", "not c.protocolaire", "c.theme_suggere is not null",
               "c.source is not null", "c.score >= %s"]
    params: list[Any] = [min_score]
    if since_hours:
        # `make_interval(hours => …)` requires an integer; multiplication
        # accepts a float, so `--since-hours 1.5` works too.
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
            # --- deduced, do not modify ---
            "nom": nom,
            "parti": connu.get("parti") or compte.get("parti") or parti or "",
            "code_parti": connu.get("code_parti"),
            "famille": connu.get("famille") or famille_,
            "citation": citation,
            "date_texte": texte,
            "date_tri": tri,
            "source": source,
            # --- to validate / fill in ---
            "theme": theme,
        })
        if len(draft) >= limit:
            break
    return draft


def write_draft(entries: list[dict], path: Path) -> None:
    payload = {
        "_mode_emploi": [
            "`theme` is pre-filled by automatic detection: check it against",
            "  the citation, correct it, or leave it if it's right.",
            "  If it's empty, fill it in: it must exist in the `topics` table.",
            "Don't modify `citation` or `source`: applying re-checks them.",
            "Just remove an entry from the array to skip publishing it.",
            f"Then: python -m politiscope.cli publish --apply {path.name}",
        ],
        "entries": entries,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


# --- validation -----------------------------------------------------------
def validate(conn, entries: list[dict]) -> list[str]:
    """Returns the list of problems. Empty = the draft is publishable."""
    _, themes = _reference_maps(conn)
    problemes: list[str] = []

    with conn.cursor() as cur:
        cur.execute("select id, citation, source, citation_key from candidates")
        officiel = {r[0]: (r[1], r[2], r[3]) for r in cur.fetchall()}
        cur.execute("select citation_key from entries union select citation_key from publications")
        deja = {r[0] for r in cur.fetchall()}

    vus: set[str] = set()
    for i, e in enumerate(entries, 1):
        ref = f"entry {i} ({e.get('nom') or 'no name'})"

        for champ in CHAMPS_A_REMPLIR:
            if not str(e.get(champ) or "").strip():
                problemes.append(f"{ref}: « {champ} » is empty")

        t = e.get("theme")
        if t and t not in themes:
            problemes.append(f"{ref}: theme « {t} » missing from the topics table")

        src = str(e.get("source") or "")
        if not src.startswith("https://"):
            problemes.append(f"{ref}: non-https source")

        # The citation and source must match the candidate exactly: that's
        # what guarantees no text tampering makes it into the database.
        cid = e.get("candidate_id")
        if cid not in officiel:
            problemes.append(f"{ref}: candidate_id {cid} not found")
        else:
            cit_ref, src_ref, key = officiel[cid]
            if e.get("citation") != cit_ref:
                problemes.append(f"{ref}: citation was modified — refused")
            if src != src_ref:
                problemes.append(f"{ref}: source was modified — refused")
            if key in deja:
                problemes.append(f"{ref}: citation already published")
            if key in vus:
                problemes.append(f"{ref}: duplicate citation in the draft")
            vus.add(key)

    return problemes


def apply_draft(conn, entries: list[dict]) -> int:
    """Inserts the entries and records the publication. All or nothing."""
    rows, pubs = [], []
    for e in entries:
        key = normalise(e["citation"])
        rows.append((e["nom"], e["parti"], e.get("code_parti"), e["famille"],
                     e["theme"], e["citation"], key,
                     e["date_texte"], e.get("date_tri"), e["source"],
                     e.get("candidate_id")))
        pubs.append((e.get("candidate_id"), e["nom"], key))

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, """
            insert into entries (nom, parti, code_parti, famille, theme,
                                 citation, citation_key,
                                 date_texte, date_tri, source, candidate_id)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
        raise SystemExit(f"Draft not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("entries") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        raise SystemExit("Malformed draft: expected key « entries ».")
    return entries
