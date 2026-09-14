"""Auto-diagnostic : vérifie l'installation sans rien dépenser ni modifier.

Trois niveaux, du plus sûr au plus engageant :

  hors-ligne   configuration, fichiers, suite de tests, simulations (--dry-run)
  réseau       Google Actualités et Supabase en LECTURE — gratuit  (--network)
  payant       une lecture X API à 0,01 $ pour valider le jeton     (--api)

Aucun niveau n'écrit en base ni ne consomme de quota d'ingestion.
"""
from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .config import settings


@dataclass
class Result:
    name: str
    ok: bool | None          # None = ignoré
    detail: str = ""
    cost: float = 0.0


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)

    def add(self, name, ok, detail="", cost=0.0):
        self.results.append(Result(name, ok, detail, cost))
        icon = {True: "✅", False: "❌", None: "⏭ "}[ok]
        print(f"  {icon} {name:<34} {detail}")

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if r.ok is False)

    @property
    def spent(self) -> float:
        return sum(r.cost for r in self.results)


def _mask(v: str | None) -> str:
    if not v:
        return "absent"
    return f"{v[:6]}…{v[-4:]} ({len(v)} car.)"


# --- niveau 1 : hors-ligne ------------------------------------------------
def check_offline(rep: Report) -> None:
    print("\nHORS-LIGNE — aucune requête réseau")

    rep.add("secrets chargés", bool(settings.bearer_token),
            f"X_BEARER_TOKEN {_mask(settings.bearer_token)}")

    env = settings.root / ".env"
    gi = settings.root / ".gitignore"
    ignored = gi.exists() and ".env" in gi.read_text(encoding="utf-8")
    rep.add(".env exclu de git", ignored or not env.exists(),
            "protégé" if ignored else "⚠ .env RISQUE D'ÊTRE COMMITÉ")

    try:
        cfg = json.loads(settings.accounts_file.read_text(encoding="utf-8"))
        accounts = cfg["accounts"]
        familles = {"majorite", "droite-rep", "extreme-droite",
                    "gauche-radicale", "gauche-social"}
        bad = [a["nom"] for a in accounts if a["famille"] not in familles]
        handles = [a["handle"] for a in accounts]
        dup = len(handles) != len(set(handles))
        rep.add("x_accounts.json", not bad and not dup,
                f"{len(accounts)} comptes, {len(set(handles))} handles uniques")
    except Exception as e:
        rep.add("x_accounts.json", False, str(e)[:60])

    # caractères de contrôle : la classe de bug qui a cassé la regex protocolaire
    stray = []
    for f in (settings.root / "politiscope").glob("*.py"):
        data = f.read_bytes()
        if any(bytes([c]) in data for c in (0x07, 0x08, 0x0b, 0x0c, 0x1b)):
            stray.append(f.name)
    rep.add("pas de caractère de contrôle", not stray,
            ", ".join(stray) if stray else "modules propres")

    r = subprocess.run([sys.executable, "-m", "pytest", "tests/", "-q"],
                       cwd=settings.root, capture_output=True, text=True)
    last = [l for l in r.stdout.strip().splitlines() if l.strip()]
    rep.add("suite de tests", r.returncode == 0, last[-1] if last else "")

    for cmd in (["fetch-x", "--dry-run"], ["fetch-rss", "--dry-run"],
                ["verify-handles", "--dry-run"], ["status"]):
        r = subprocess.run([sys.executable, "-m", "politiscope.cli", *cmd],
                           cwd=settings.root, capture_output=True, text=True)
        rep.add(f"commande `{' '.join(cmd)}`", r.returncode == 0,
                (r.stderr or r.stdout).strip().splitlines()[-1][:60] if r.returncode else "ok")


# --- niveau 2 : réseau gratuit -------------------------------------------
def check_network(rep: Report) -> None:
    print("\nRÉSEAU — lectures gratuites")

    import requests
    from . import rss
    try:
        url = rss.feed_url("Emmanuel Macron", 2, settings.rss_lang, settings.rss_country)
        r = requests.get(url, headers={"User-Agent": rss.UA}, timeout=25)
        n = r.text.count("<item>")
        rep.add("Google Actualités", r.ok and n > 0, f"HTTP {r.status_code}, {n} items")
    except Exception as e:
        rep.add("Google Actualités", False, str(e)[:60])

    try:
        from . import db
        with db.connect() as conn:
            st = db.stats(conn)
            with conn.cursor() as cur:
                cur.execute("select count(*) from schema_migrations")
                migs = cur.fetchone()[0]
        rep.add("Supabase (lecture)", True,
                f"{migs} migration(s), {st['tweets']} tweets, {st['candidates']} candidates")
    except Exception as e:
        rep.add("Supabase (lecture)", False, str(e).strip().splitlines()[0][:70])


# --- niveau 3 : payant ----------------------------------------------------
def check_api(rep: Report) -> None:
    print("\nAPI X — 1 lecture facturée 0,01 $")

    import requests
    token = settings.bearer_token
    if not token:
        rep.add("jeton X", None, "X_BEARER_TOKEN absent")
        return
    try:
        r = requests.get("https://api.x.com/2/users/by/username/EmmanuelMacron",
                         headers={"Authorization": f"Bearer {token.strip()}"}, timeout=25)
        if r.status_code == 200:
            rep.add("authentification X", True,
                    f"OK — quota restant {r.headers.get('x-rate-limit-remaining', '?')}",
                    cost=0.010)
        else:
            rep.add("authentification X", False, f"HTTP {r.status_code} {r.text[:60]}")
    except Exception as e:
        rep.add("authentification X", False, str(e)[:60])


def run(network: bool, api: bool) -> int:
    rep = Report()
    print("Politiscope — auto-diagnostic")
    check_offline(rep)
    if network:
        check_network(rep)
    else:
        print("\nRÉSEAU — ignoré (ajoutez --network)")
    if api:
        check_api(rep)
    else:
        print("\nAPI X — ignorée (ajoutez --api, coût 0,01 $)")

    total = len([r for r in rep.results if r.ok is not None])
    print(f"\n{total - rep.failed}/{total} vérifications passées"
          + (f" — dépense : {rep.spent:.2f} USD" if rep.spent else " — aucune dépense"))
    return 1 if rep.failed else 0
