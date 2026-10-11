"""Newsletter quotidienne : les citations publiées dans les dernières 24 h.

Le contenu vient uniquement de `entries` (ce que le site affiche). Le texte des
citations est rendu tel quel — jamais réécrit, raccourci ni résumé — avec deux
liens : le message d'origine et la page de la citation. Le thème n'est volontairement
pas repris : il est deviné par mots-clés et une erreur y serait bien plus visible
dans un e-mail que sur le site.

L'envoi, les abonnés, le double opt-in et la désinscription sont ceux du service
externe (Brevo) : la campagne y est créée en brouillon, puis envoyée à la liste
choisie. Brevo ajoute lui-même l'adresse légale de l'expéditeur au pied du mail.
"""
from __future__ import annotations

import html
import os
from dataclasses import dataclass
from datetime import date
from typing import Any

import requests

from .publish import MOIS_FR

SITE = "https://politiscope.app"
API = "https://api.brevo.com/v3/emailCampaigns"

# Même ordre et mêmes libellés que le site (web/src/types.ts) : aucune famille
# n'ouvre systématiquement le numéro.
FAMILLES = [
    ("majorite", "Majorité présidentielle"),
    ("droite-rep", "Droite républicaine"),
    ("extreme-droite", "Droite radicale / souverainiste"),
    ("gauche-radicale", "Gauche radicale"),
    ("gauche-social", "Gauche social-démocrate / écologiste"),
]
COULEURS = {
    "majorite": "#2a78d6", "droite-rep": "#eb6834", "extreme-droite": "#1baf7a",
    "gauche-radicale": "#eda100", "gauche-social": "#e87ba4",
}

@dataclass
class Issue:
    subject: str
    html: str
    text: str
    n_entries: int


def date_label(d: date) -> str:
    return f"{d.day} {MOIS_FR[d.month - 1]} {d.year}"


def fetch_entries(conn, since_hours: float) -> list[dict[str, Any]]:
    """Entrées publiées depuis `since_hours`, les plus récentes d'abord."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, nom, parti, famille, theme, citation, date_texte, source
              from entries
             where publie and created_at >= now() - (%s * interval '1 hour')
             order by date_tri desc nulls last, id desc
            """,
            (float(since_hours),),
        )
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _grouped(entries: list[dict]) -> list[tuple[str, str, list[dict]]]:
    connus = {fid for fid, _ in FAMILLES}
    out = []
    for fid, label in FAMILLES:
        rows = [e for e in entries if e["famille"] == fid]
        if rows:
            out.append((fid, label, rows))
    # Une famille inconnue (nouvelle valeur en base) ne doit pas faire
    # disparaître ses citations du numéro.
    autres = [e for e in entries if e["famille"] not in connus]
    if autres:
        out.append(("", "Autres", autres))
    return out


def build_issue(entries: list[dict], day: date) -> Issue | None:
    """Numéro du jour, ou None s'il n'y a rien à envoyer."""
    if not entries:
        return None
    n = len(entries)
    label = date_label(day)
    subject = f"Politiscope — {n} citation{'s' if n > 1 else ''} du {label}"
    e_ = html.escape

    parts = [
        '<div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#0b0b0b;line-height:1.55">',
        '<h1 style="font-size:24px;margin:0 0 4px">Politiscope</h1>',
        f'<p style="color:#52514e;margin:0 0 24px">Ce que les responsables politiques ont dit — {e_(label)}</p>',
    ]
    text = [f"POLITISCOPE — {label}", f"{n} citation{'s' if n > 1 else ''}", ""]

    for fid, famille, rows in _grouped(entries):
        couleur = COULEURS.get(fid, "#52514e")
        parts.append(
            '<h2 style="font-size:15px;text-transform:uppercase;letter-spacing:.06em;'
            f'margin:28px 0 10px;padding-left:10px;border-left:4px solid {couleur}">{e_(famille)}</h2>'
        )
        text += [famille.upper(), "-" * len(famille)]
        for r in rows:
            page = f"{SITE}/c/{r['id']}"
            parts.append(
                f'<blockquote style="margin:0 0 4px;font-size:17px">« {e_(r["citation"])} »</blockquote>'
                '<p style="margin:0 0 18px;font-size:14px;color:#52514e">'
                f'<strong style="color:#0b0b0b">{e_(r["nom"])}</strong> · {e_(r["parti"])} · '
                f'{e_(r["date_texte"])}<br>'
                f'<a href="{e_(r["source"])}">Message d\'origine</a> · <a href="{e_(page)}">Sur Politiscope</a></p>'
            )
            text += [
                f"« {r['citation']} »",
                f"{r['nom']} · {r['parti']} · {r['date_texte']}",
                f"Message d'origine : {r['source']}",
                f"Sur Politiscope : {page}",
                "",
            ]

    parts.append(
        '<hr style="border:0;border-top:1px solid #e1e0d9;margin:28px 0 14px">'
        '<p style="font-size:13px;color:#898781">Citations sélectionnées et publiées automatiquement, '
        'sans relecture individuelle ; le texte est celui du message, tel que publié. '
        f'<a href="{SITE}/methodologie">Méthodologie et limites</a>. '
        # Variable Brevo : remplacée à l'envoi par le lien de désinscription propre à chaque abonné.
        '<a href="{{ unsubscribe }}">Se désinscrire</a>.</p></div>'
    )
    text += [
        "Citations sélectionnées et publiées automatiquement, sans relecture individuelle ;",
        "le texte est celui du message, tel que publié.",
        f"Méthodologie et limites : {SITE}/methodologie",
    ]  # la version texte ne sert qu'à l'aperçu ; Brevo n'envoie que le HTML
    return Issue(subject, "\n".join(parts), "\n".join(text), n)


# --- journal et envoi ------------------------------------------------------
def already_issued(conn, day: date) -> bool:
    with conn.cursor() as cur:
        cur.execute("select 1 from newsletter_issues where issue_date = %s", (day,))
        return cur.fetchone() is not None


def record_issue(conn, day: date, issue: Issue, status: str, provider_id: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "insert into newsletter_issues (issue_date, subject, n_entries, status, provider_id)"
            " values (%s, %s, %s, %s, %s)",
            (day, issue.subject, issue.n_entries, status, provider_id),
        )


def _brevo_headers() -> dict[str, str]:
    key = os.getenv("BREVO_API_KEY", "").strip()
    if not key:
        raise RuntimeError("BREVO_API_KEY absent : renseignez-le dans .env ou en secret CI")
    return {"api-key": key, "Content-Type": "application/json", "accept": "application/json"}


def create_campaign(issue: Issue, day: date) -> str:
    """Crée la campagne chez Brevo, en brouillon : rien n'est encore envoyé.

    Brevo laisse une campagne en brouillon tant qu'on ne programme pas d'envoi ;
    on peut la relire dans leur interface avant d'écrire aux abonnés.
    """
    headers = _brevo_headers()
    email = os.getenv("BREVO_SENDER_EMAIL", "").strip()
    list_id = os.getenv("BREVO_LIST_ID", "").strip()
    if not email or not list_id.isdigit():
        raise RuntimeError("BREVO_SENDER_EMAIL (expéditeur validé chez Brevo) et BREVO_LIST_ID (numéro de liste) sont requis")
    r = requests.post(
        API,
        headers=headers,
        json={
            "name": f"Politiscope {day.isoformat()}",
            "subject": issue.subject,
            "sender": {"name": os.getenv("BREVO_SENDER_NAME", "Politiscope").strip() or "Politiscope", "email": email},
            "htmlContent": issue.html,
            "recipients": {"listIds": [int(list_id)]},
        },
        timeout=30,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"Brevo a refusé la campagne (HTTP {r.status_code}) : {r.text[:300]}")
    return str(r.json()["id"])


def send_campaign(campaign_id: str) -> None:
    """Envoie immédiatement une campagne déjà créée (irréversible)."""
    r = requests.post(f"{API}/{campaign_id}/sendNow", headers=_brevo_headers(), timeout=30)
    if r.status_code != 204:
        raise RuntimeError(f"Brevo n'a pas envoyé la campagne {campaign_id} (HTTP {r.status_code}) : {r.text[:300]}")
