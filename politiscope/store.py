"""État persistant, journal d'ingestion et compteur de dépense."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SystemExit(f"{path.name} est corrompu ({e}). Supprimez-le pour repartir de zéro.")


def write_json(path: Path, data: Any) -> None:
    """Écriture atomique : pas d'état tronqué si le process est tué en cours."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def append_jsonl(path: Path, rows: Iterable[dict]) -> int:
    n = 0
    with path.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            n += 1
    return n


def read_jsonl(path: Path) -> Iterator[dict]:
    if not path.exists():
        return
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


class BudgetExceeded(RuntimeError):
    """Levée quand le plafond mensuel est atteint — arrête l'ingestion net."""


class State:
    """État d'ingestion : IDs résolus, derniers tweets vus, dépense par mois."""

    def __init__(self, path: Path):
        self.path = path
        d = read_json(path, {})
        self.user_ids: dict[str, str] = d.get("user_ids", {})
        self.last_id: dict[str, str] = d.get("last_id", {})
        self.spend: dict[str, float] = d.get("spend", {})
        self.reads: dict[str, int] = d.get("reads", {})
        self.last_run: str | None = d.get("last_run")

    # --- dépense ---------------------------------------------------------
    @staticmethod
    def _month() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m")

    @property
    def spend_this_month(self) -> float:
        return self.spend.get(self._month(), 0.0)

    @property
    def reads_this_month(self) -> int:
        return self.reads.get(self._month(), 0)

    def check_budget(self, budget_usd: float) -> None:
        if self.spend_this_month >= budget_usd:
            raise BudgetExceeded(
                f"Plafond mensuel atteint : {self.spend_this_month:.2f} / {budget_usd:.2f} USD "
                f"pour {self._month()}. Relevez BUDGET_USD_MONTH dans .env pour continuer."
            )

    def charge(self, resources: int, unit_price: float) -> float:
        cost = resources * unit_price
        m = self._month()
        self.spend[m] = round(self.spend.get(m, 0.0) + cost, 4)
        self.reads[m] = self.reads.get(m, 0) + resources
        return cost

    def save(self) -> None:
        self.last_run = datetime.now(timezone.utc).isoformat(timespec="seconds")
        write_json(self.path, {
            "user_ids": self.user_ids,
            "last_id": self.last_id,
            "spend": self.spend,
            "reads": self.reads,
            "last_run": self.last_run,
        })
