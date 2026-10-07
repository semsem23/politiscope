"""Écrit web/src/lib/subjects.json depuis SUBJECT_LEXICON (politiscope/media.py).

Le front lit les noms de sujets et leurs termes dans ce fichier : il ne peut
donc pas diverger du lexique Python. À relancer après toute modification du
lexique — un test (tests/test_politiscope.py) échoue sinon.

    python scripts/export_subjects.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from politiscope.media import SUBJECT_LEXICON  # noqa: E402

OUT = ROOT / "web" / "src" / "lib" / "subjects.json"


def render() -> str:
    data = [{"theme": s, "terms": list(terms)} for s, terms in SUBJECT_LEXICON.items()]
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    OUT.write_text(render(), encoding="utf-8", newline="\n")
    print(f"{OUT.relative_to(ROOT)} : {len(SUBJECT_LEXICON)} sujets")
