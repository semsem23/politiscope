"""Charge artifact_data.json (26 entrées éditorialisées) dans Supabase."""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2.extras  # noqa: E402

from politiscope import db  # noqa: E402
from politiscope.config import settings  # noqa: E402
from politiscope.quotes import normalise  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

MOIS = {m: i + 1 for i, m in enumerate(
    ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
     "août", "septembre", "octobre", "novembre", "décembre"])}

# Ordre d'affichage des thèmes dans le graphe, du plus structurant au plus niche.
ORDRE = ["Stratégie 2027 & recomposition", "Budget & finances publiques",
         "Immigration & sécurité", "Pouvoir d'achat & vie chère",
         "Institutions & calendrier électoral", "Europe & souveraineté",
         "Inégalités & fiscalité", "Climat & écologie", "Social & inclusion"]


def parse_fr_date(s: str) -> date | None:
    """« 13 septembre 2026 » / « août 2026 » / « 2026 » -> date triable."""
    parts = s.strip().split()
    try:
        year = int(parts[-1])
    except (ValueError, IndexError):
        return None
    if len(parts) == 1:
        return date(year, 1, 1)
    month = MOIS.get(parts[-2].lower(), 1)
    day = 1
    if len(parts) >= 3:
        try:
            day = int(parts[-3])
        except ValueError:
            pass
    try:
        return date(year, month, day)
    except ValueError:
        return date(year, month, 1)


def main() -> int:
    data = json.loads((settings.root / "artifact_data.json").read_text(encoding="utf-8"))
    entries, topics = data["entries"], data["topics"]

    with db.connect() as conn:
        applied = db.migrate(conn)
        if applied:
            print("migrations :", ", ".join(applied))

        topic_rows = [(theme, court, ORDRE.index(theme) if theme in ORDRE else 100)
                      for theme, court in topics.items()]
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, """
                insert into topics (theme, libelle_court, ordre)
                values (%s, %s, %s)
                on conflict (theme) do update
                  set libelle_court = excluded.libelle_court, ordre = excluded.ordre
            """, topic_rows)

        rows = []
        for e in entries:
            rows.append((
                e["nom"], e["parti"], e.get("code_parti"), e["famille"], e["theme"],
                e["sujet"], e["citation"], normalise(e["citation"]),
                e["date"], parse_fr_date(e["date"]), e["source"],
            ))
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, """
                insert into entries (nom, parti, code_parti, famille, theme, sujet,
                                     citation, citation_key,
                                     date_texte, date_tri, source)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (nom, citation_key) do update
                  set parti = excluded.parti, code_parti = excluded.code_parti,
                      famille = excluded.famille, theme = excluded.theme,
                      sujet = excluded.sujet,
                      date_texte = excluded.date_texte, date_tri = excluded.date_tri,
                      source = excluded.source
            """, rows)

        with conn.cursor() as cur:
            cur.execute("select count(*) from topics")
            n_topics = cur.fetchone()[0]
            cur.execute("select count(*) from entries")
            n_entries = cur.fetchone()[0]
            cur.execute("""select famille, count(*) from entries
                           group by famille order by 2 desc""")
            par_famille = cur.fetchall()

    print(f"\ntopics  {n_topics}")
    print(f"entries {n_entries}")
    print("\npar famille :")
    for f, n in par_famille:
        print(f"  {n:>2}  {f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
