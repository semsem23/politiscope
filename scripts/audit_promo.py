"""Liste, en lecture seule, les entrées déjà publiées que le filtre autopromo écarterait.

    python scripts/audit_promo.py

Ne modifie rien : c'est à vous de décider quoi dépublier.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import politiscope.config  # noqa: E402,F401 — charge .env (SUPABASE_*)
from politiscope import db  # noqa: E402
from politiscope.selection import is_promo  # noqa: E402


def main() -> int:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("select id, nom, citation from entries where publie order by id")
        rows = cur.fetchall()
    flagged = [r for r in rows if is_promo(r[2])]
    print(f"{len(flagged)} entrée(s) autopromo sur {len(rows)} publiées\n")
    for eid, nom, citation in flagged:
        print(f"#{eid:<4} {nom:<24} {citation[:110]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
