"""Client X API v2 : lecture de timelines, avec compteur de coût et garde-fous."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from .config import PRICE_POST_READ, PRICE_USER_READ, Settings
from .store import BudgetExceeded, State

log = logging.getLogger("politiscope.x")

API = "https://api.x.com/2"
MAX_ATTEMPTS = 4


class XApiError(RuntimeError):
    pass


class XClient:
    """Enveloppe minimale mais robuste autour des endpoints de lecture.

    Trois responsabilités au-delà du simple GET :
      - respecter les 429 en s'appuyant sur x-rate-limit-reset ;
      - facturer chaque ressource lue dans l'état partagé ;
      - refuser d'appeler si le plafond mensuel est déjà atteint.
    """

    def __init__(self, token: str, state: State, settings: Settings):
        self.state = state
        self.settings = settings
        self.reads_this_run = 0
        self.s = requests.Session()
        self.s.headers.update({
            "Authorization": f"Bearer {token}",
            "User-Agent": "politiscope-ingest/2.0",
        })

    # --- transport -------------------------------------------------------
    def _get(self, path: str, params: dict[str, Any]) -> dict:
        self.state.check_budget(self.settings.budget_usd_month)
        url = f"{API}{path}"

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                r = self.s.get(url, params=params, timeout=30)
            except requests.RequestException as e:
                if attempt == MAX_ATTEMPTS:
                    raise XApiError(f"échec réseau sur {path} : {e}") from e
                wait = 2 ** attempt
                log.warning("réseau KO (%s), nouvelle tentative dans %ss", e, wait)
                time.sleep(wait)
                continue

            if r.status_code == 429:
                reset = r.headers.get("x-rate-limit-reset")
                wait = max(5, int(reset) - int(time.time())) if reset else 30 * attempt
                wait = min(wait, 900)
                log.warning("429 rate-limit sur %s — attente %ss", path, wait)
                time.sleep(wait)
                continue

            if r.status_code == 401:
                raise XApiError("401 : bearer token invalide ou révoqué.")
            if r.status_code == 403:
                raise XApiError(f"403 : accès refusé (crédits épuisés ?) — {r.text[:200]}")
            if r.status_code >= 500:
                if attempt == MAX_ATTEMPTS:
                    raise XApiError(f"{r.status_code} persistant sur {path}")
                time.sleep(2 ** attempt)
                continue

            if not r.ok:
                raise XApiError(f"{r.status_code} sur {path} — {r.text[:200]}")
            return r.json()

        raise XApiError(f"rate-limit persistant sur {path} après {MAX_ATTEMPTS} tentatives")

    def _charge(self, n: int, unit: float) -> None:
        if n:
            self.state.charge(n, unit)
            self.reads_this_run += n

    # --- endpoints -------------------------------------------------------
    def resolve_users(self, handles: list[str]) -> dict[str, str]:
        """handle -> user_id. Payant, donc mis en cache définitivement dans l'état."""
        todo = [h for h in handles if h not in self.state.user_ids]
        if not todo:
            return self.state.user_ids

        for i in range(0, len(todo), 100):
            chunk = todo[i:i + 100]
            data = self._get("/users/by", {"usernames": ",".join(chunk)})
            found = data.get("data", []) or []
            for u in found:
                for h in chunk:                       # réindexe sur la casse du fichier
                    if h.lower() == u["username"].lower():
                        self.state.user_ids[h] = u["id"]
            for err in data.get("errors", []) or []:
                log.error("handle introuvable : @%s", err.get("value"))
            self._charge(len(chunk), PRICE_USER_READ)
        return self.state.user_ids

    def timeline(self, user_id: str, since_id: str | None, backfill_days: int) -> list[dict]:
        """Tweets originaux depuis since_id (ou les N derniers jours au premier passage)."""
        params: dict[str, Any] = {
            "max_results": 100,
            "exclude": "retweets,replies",   # levier de coût principal
            "tweet.fields": "created_at,text,lang,public_metrics,entities",
        }
        if since_id:
            params["since_id"] = since_id
        else:
            start = datetime.now(timezone.utc) - timedelta(days=backfill_days)
            params["start_time"] = start.strftime("%Y-%m-%dT%H:%M:%SZ")

        data = self._get(f"/users/{user_id}/tweets", params)
        tweets = data.get("data", []) or []
        self._charge(len(tweets), PRICE_POST_READ)
        return tweets

    # --- contrôle du volume ---------------------------------------------
    def run_cap_reached(self) -> bool:
        return self.reads_this_run >= self.settings.max_reads_per_run


def ingest(client: XClient, accounts: list[dict], settings: Settings) -> list[dict]:
    """Parcourt les comptes et renvoie les nouveaux tweets normalisés."""
    ids = client.resolve_users([a["handle"] for a in accounts])
    rows: list[dict] = []

    for a in accounts:
        uid = ids.get(a["handle"])
        if not uid:
            log.warning("%-26s handle non résolu — ignoré", a["nom"])
            continue
        if client.run_cap_reached():
            log.warning("plafond de %d lectures atteint pour ce passage — arrêt",
                        settings.max_reads_per_run)
            break

        try:
            tweets = client.timeline(uid, client.state.last_id.get(a["handle"]),
                                     settings.backfill_days)
        except BudgetExceeded:
            raise
        except XApiError as e:
            log.error("%-26s %s", a["nom"], e)
            continue

        for t in tweets:
            rows.append({
                "kind": "tweet",
                "nom": a["nom"],
                "handle": a["handle"],
                "famille": a["famille"],
                "parti": a["parti"],
                "id": t["id"],
                "date": t.get("created_at"),
                "texte": t.get("text", ""),
                "lang": t.get("lang"),
                "metrics": t.get("public_metrics"),
                "source": f"https://x.com/{a['handle']}/status/{t['id']}",
            })
        if tweets:
            client.state.last_id[a["handle"]] = max(t["id"] for t in tweets)
        log.info("%-26s %3d nouveau(x)", a["nom"], len(tweets))

    return rows
