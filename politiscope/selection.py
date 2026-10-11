"""Sélection éditoriale : écarte l'autopromo, équilibre les familles.

Vit à côté de `quotes.py` plutôt que dedans : `quotes.py` garantit l'intégrité
des citations (extraction, attribution) et ne bouge pas. Ici, on ne touche
jamais au texte — on décide seulement *lesquelles* passent au brouillon.
"""
from __future__ import annotations

import re
from collections import defaultdict, deque
from typing import Callable, Iterable, TypeVar

T = TypeVar("T")

# Un tweet qui renvoie vers une interview, une émission ou un rendez-vous
# n'est pas une prise de position : il l'annonce. Chaque motif vient d'un cas
# réel publié sur le site ; ils sont volontairement étroits (« Vous rendez-vous
# compte ? » ne doit pas passer pour un « rendez-vous à 20h »).
_PROMO = re.compile(
    r"""
      \bretrouvez(?:-moi|-nous)?\b                      # « Retrouvez mon passage… »
    | \b(?:j['’]étais|était|suis)\s+(?:l['’]invit|invit|interrog)  # « J'étais l'invité du… »
    | \binvité(?:e|s)?\s+(?:de|du|d['’]|des|sur)\b      # « …, invité de TF1 ! »
    | \brendez[\s-]vous\s+(?:à|ce|demain|dès|sur|ici|aujourd)   # pas « rendez-vous compte »
    | \bce\s+soir\s+(?:dès|sur|à\s+\d)                  # « Ce soir dès 21h », « À ce soir sur LCI »
    | \b(?:mon|ma|mes|notre)\s+(?:interview|entretien|passage|émission|podcast)\b
    | \bquelques\s+mots\s+depuis\b                      # « Quelques mots depuis Baden-Baden »
    | \b(?:à\s+(?:visionner|revoir)|disponible\s+sur)\b
    | \bvoir\s+l['’]intégralité\b
    | \bfaites\s+un\s+don\b
    | \bc['’]est\s+maintenant\s*!?\s*(?:[👉👇⤵▶⬇➡][️\U0001F3FB-\U0001F3FF]*\s*)*$  # « …c'est maintenant ! 👉 »
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Un tweet court qui se termine par une flèche ne fait que pointer vers un
# lien. Au-delà de ce seuil il y a assez de substance pour le garder.
_POINTER_END = re.compile(r"[👉👇⤵▶⬇➡][️\U0001F3FB-\U0001F3FF]*\s*$")
_POINTER_MAX_CHARS = 90


def is_promo(text: str) -> bool:
    """Vrai si `text` annonce ou renvoie vers un contenu au lieu de se prononcer."""
    t = (text or "").strip()
    if not t:
        return False
    if _PROMO.search(t):
        return True
    return len(t) <= _POINTER_MAX_CHARS and bool(_POINTER_END.search(t))


def balance_by_family(
    items: Iterable[T],
    limit: int,
    *,
    family: Callable[[T], str],
    prior: dict[str, int] | None = None,
) -> list[T]:
    """Choisit `limit` éléments en tournant entre les familles.

    `items` arrive trié par priorité (meilleur score d'abord) ; cet ordre est
    conservé *à l'intérieur* de chaque famille. Sans ce tourniquet, les
    familles qui tweetent le plus occupent tout le brouillon : sur le site,
    68 % des citations venaient des deux extrêmes.

    `prior` donne le nombre de citations déjà publiées par famille : à chaque
    tour, les familles les moins représentées passent en premier, donc les
    places restantes (quand `limit` n'est pas multiple du nombre de familles)
    corrigent le déséquilibre historique au lieu de l'aggraver. Une famille
    sans candidat est sautée : ses places reviennent aux autres.
    """
    prior = prior or {}
    files: dict[str, deque[T]] = defaultdict(deque)
    for it in items:
        files[family(it)].append(it)

    # Ordre stable : moins représentée d'abord, puis meilleure tête de file.
    rang = {f: i for i, f in enumerate(files)}
    ordre = sorted(files, key=lambda f: (prior.get(f, 0), rang[f]))

    out: list[T] = []
    while len(out) < limit and any(files[f] for f in ordre):
        for f in ordre:
            if files[f] and len(out) < limit:
                out.append(files[f].popleft())
    return out
