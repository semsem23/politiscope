"""Re-tague toutes les lignes de press_mentions avec le lexique actuel.

À lancer après une modification de SUBJECT_LEXICON / TERM_FORMS
(politiscope/media.py), et une fois après la migration 012 pour passer
l'historique sur les sept sujets. Toutes les lignes sont re-taguées, y compris
celles sans sujet ; l'héritage de sujet au sein d'un cluster Google est refait.
Seul le titre est tagué, comme à l'ingestion.

    python scripts/retag_media.py              # simulation : diff par sujet
    python scripts/retag_media.py --sample 20  # + 20 titres retenus au hasard
    python scripts/retag_media.py --apply      # écrit en base
"""
from __future__ import annotations

import argparse
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2.extras  # noqa: E402

import politiscope.config  # noqa: E402,F401 — charge .env (SUPABASE_*)
from politiscope import db  # noqa: E402
from politiscope.media import tag_cluster  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass


def retag(rows: list[dict]) -> dict[str, tuple[str | None, list[str]]]:
    """id -> (sujet, termes). Les lignes d'un même cluster sont taguées
    ensemble, l'article principal (id = cluster_id) en tête ; une ligne sans
    cluster (historique RSS) est son propre cluster."""
    clusters: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        clusters[r["cluster_id"] or r["id"]].append(r)
    out = {}
    for cid, members in clusters.items():
        members.sort(key=lambda r: r["id"] != cid)
        for r, result in zip(members, tag_cluster([r["titre"] for r in members])):
            out[r["id"]] = result
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="écrire en base (sinon simulation)")
    ap.add_argument("--sample", type=int, default=0, metavar="N", help="afficher N titres retenus au hasard")
    args = ap.parse_args()

    with db.connect() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""select 1 from information_schema.columns
                           where table_name = 'press_mentions' and column_name = 'matched_terms'""")
            if not cur.fetchone():
                print("Colonne matched_terms absente : appliquez d'abord la migration 012 "
                      "(python -m politiscope.cli db-migrate).")
                return 1
            cur.execute("select id, titre, cluster_id, theme, matched_terms from press_mentions")
            rows = cur.fetchall()

        new = retag(rows)
        before = Counter(r["theme"] for r in rows)
        after = Counter(t for t, _ in new.values())
        print(f"{len(rows)} ligne(s)\n")
        print(f"  {'sujet':<28} {'avant':>6} {'après':>6}")
        for s in sorted(set(before) | set(after), key=lambda s: (s is None, s or "")):
            print(f"  {s or '(aucun)':<28} {before[s]:>6} {after[s]:>6}")

        changed = [(r["id"], *new[r["id"]]) for r in rows
                   if (r["theme"], list(r["matched_terms"] or [])) != new[r["id"]]]
        print(f"\n{len(changed)} ligne(s) à modifier")

        if args.sample:
            kept = [r for r in rows if new[r["id"]][0]]
            for r in random.sample(kept, min(args.sample, len(kept))):
                theme, terms = new[r["id"]]
                print(f"  [{theme}] {', '.join(terms) or '(cluster)'}\n      {r['titre']}")

        if not args.apply:
            print("\nSimulation : rien écrit. Relancez avec --apply pour écrire.")
            return 0
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(
                cur, "update press_mentions set theme = %s, matched_terms = %s where id = %s",
                [(theme, terms, i) for i, theme, terms in changed], page_size=200)
        print(f"{len(changed)} ligne(s) mise(s) à jour.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
