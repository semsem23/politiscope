"""Configuration centrale : chemins, secrets, garde-fous de budget."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# --- tarifs X API pay-per-use (USD), source : docs.x.com/x-api/getting-started/pricing
PRICE_POST_READ = 0.005
PRICE_USER_READ = 0.010
MONTHLY_READ_CAP = 3_000_000


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        raise SystemExit(f"{name} doit être un nombre, reçu : {raw!r}")


@dataclass(frozen=True)
class Settings:
    """Réglages résolus une fois au démarrage."""

    root: Path = ROOT
    accounts_file: Path = ROOT / "x_accounts.json"
    state_file: Path = ROOT / "x_state.json"
    tweets_file: Path = ROOT / "x_tweets.jsonl"
    rss_file: Path = ROOT / "rss_items.jsonl"
    # Archivé : le site vivant est `web/`, qui lit Supabase. Ce fichier ne sert
    # plus qu'à consulter la version diffusée initialement.
    artifact_file: Path = ROOT / "archive" / "politiscope.html"

    bearer_token: str | None = field(default_factory=lambda: os.getenv("X_BEARER_TOKEN"))

    # Garde-fous : une boucle qui s'emballe ne doit jamais pouvoir vider le compte.
    budget_usd_month: float = field(default_factory=lambda: _env_float("BUDGET_USD_MONTH", 25.0))
    max_reads_per_run: int = field(default_factory=lambda: int(_env_float("MAX_READS_PER_RUN", 600)))

    # Fenêtre d'ingestion par défaut (jours) au tout premier remplissage.
    backfill_days: int = field(default_factory=lambda: int(_env_float("BACKFILL_DAYS", 3)))

    # RSS Google Actualités
    rss_lang: str = "fr"
    rss_country: str = "FR"

    def require_token(self) -> str:
        if not self.bearer_token:
            raise SystemExit(
                "X_BEARER_TOKEN absent.\n"
                "  Copiez .env.example vers .env et renseignez-le, "
                "ou utilisez --dry-run pour estimer sans appeler l'API."
            )
        return self.bearer_token.strip()


settings = Settings()
