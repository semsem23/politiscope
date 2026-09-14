"""Accès Postgres (Supabase) : migrations, upserts idempotents, lectures.

Le pipeline se connecte avec le rôle `postgres` en direct — il contourne donc
RLS, qui ne protège que les accès faits avec la clé publishable.

Réseau : l'hôte direct `db.<ref>.supabase.co` ne résout qu'en **IPv6**. Sur un
réseau ou un runner CI sans IPv6, il faut basculer sur le pooler (IPv4) —
d'où le repli automatique de `connect()`.
"""
from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import psycopg2
import psycopg2.extras

log = logging.getLogger("politiscope.db")

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


class DatabaseUnavailable(RuntimeError):
    pass


def _dsns() -> list[tuple[str, str]]:
    """DSN à essayer, dans l'ordre : celui fourni, puis les poolers IPv4."""
    out: list[tuple[str, str]] = []
    direct = os.getenv("SUPABASE_DB_URL", "").strip()
    if direct:
        out.append(("direct", direct))

    ref = os.getenv("SUPABASE_PROJECT_REF", "").strip()
    pwd = os.getenv("SUPABASE_DB_PASSWORD", "").strip()
    region = os.getenv("SUPABASE_REGION", "eu-west-2").strip()
    if ref and pwd:
        base = f"postgresql://postgres.{ref}:{pwd}@aws-0-{region}.pooler.supabase.com"
        out.append(("pooler session (IPv4)", f"{base}:5432/postgres"))
        out.append(("pooler transaction (IPv4)", f"{base}:6543/postgres"))
    return out


@contextmanager
def connect() -> Iterator[Any]:
    """Connexion, avec repli sur le pooler si le direct est injoignable."""
    candidates = _dsns()
    if not candidates:
        raise DatabaseUnavailable(
            "Aucune configuration base. Renseignez SUPABASE_DB_URL dans .env "
            "(ou SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD)."
        )

    errors = []
    for label, dsn in candidates:
        try:
            conn = psycopg2.connect(dsn, connect_timeout=15, sslmode="require")
        except psycopg2.Error as e:
            errors.append(f"  {label}: {str(e).strip()[:120]}")
            continue
        log.debug("connecté via %s", label)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        return

    raise DatabaseUnavailable("Connexion impossible :\n" + "\n".join(errors))


def migrate(conn) -> list[str]:
    """Applique les fichiers de migrations/ non encore appliqués."""
    with conn.cursor() as cur:
        cur.execute("""
            create table if not exists schema_migrations (
              filename    text primary key,
              applied_at  timestamptz not null default now()
            )""")
        cur.execute("select filename from schema_migrations")
        done = {r[0] for r in cur.fetchall()}

    applied = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name in done:
            continue
        log.info("migration %s", path.name)
        with conn.cursor() as cur:
            cur.execute(path.read_text(encoding="utf-8"))
            cur.execute("insert into schema_migrations (filename) values (%s)", (path.name,))
        applied.append(path.name)
    return applied


# --- écritures idempotentes ----------------------------------------------
def _executemany(conn, sql: str, rows: Sequence[tuple]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, rows, page_size=200)
    return len(rows)


def upsert_accounts(conn, accounts: Iterable[dict]) -> int:
    rows = [(a["handle"], a["nom"], a["famille"], a["parti"]) for a in accounts]
    return _executemany(conn, """
        insert into accounts (handle, nom, famille, parti)
        values (%s, %s, %s, %s)
        on conflict (handle) do update
          set nom = excluded.nom,
              famille = excluded.famille,
              parti = excluded.parti
    """, rows)


def set_user_ids(conn, mapping: dict[str, str]) -> int:
    rows = [(uid, handle) for handle, uid in mapping.items()]
    return _executemany(conn,
                        "update accounts set user_id = %s where handle = %s", rows)


def upsert_tweets(conn, tweets: Iterable[dict]) -> int:
    rows = [(t["id"], t["handle"], t["date"], t["texte"], t.get("lang"),
             psycopg2.extras.Json(t.get("metrics")), t["source"]) for t in tweets]
    return _executemany(conn, """
        insert into tweets (id, handle, created_at, texte, lang, metrics, source)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (id) do nothing
    """, rows)


def upsert_rss(conn, items: Iterable[dict]) -> int:
    rows = [(i["id"], i["nom"], i["titre"], i.get("date"), i.get("media"),
             i.get("media_url"), i.get("google_link")) for i in items]
    return _executemany(conn, """
        insert into rss_items (id, nom, titre, published_at, media, media_url, google_link)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (id) do nothing
    """, rows)


def upsert_candidates(conn, cands: Iterable[dict], citation_key) -> int:
    rows = []
    for c in cands:
        rows.append((
            c["origine"], c["nom"], c.get("famille"), c.get("parti"),
            c["citation"], citation_key(c["citation"]), c.get("date"),
            c.get("source"), c.get("media"), c.get("theme_suggere"),
            bool(c.get("protocolaire")), bool(c.get("verifie")),
            int(c["score"]), psycopg2.extras.Json(c.get("pourquoi")),
            c.get("tweet_id"),
        ))
    return _executemany(conn, """
        insert into candidates (origine, nom, famille, parti, citation, citation_key,
                                date, source, media, theme_suggere, protocolaire,
                                verifie, score, pourquoi, tweet_id)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (nom, citation_key) do update
          set score = excluded.score,
              theme_suggere = excluded.theme_suggere,
              protocolaire = excluded.protocolaire,
              pourquoi = excluded.pourquoi
    """, rows)


def set_last_tweet_ids(conn, mapping: dict[str, str]) -> int:
    rows = [(h, tid) for h, tid in mapping.items()]
    return _executemany(conn, """
        insert into ingest_state (handle, last_tweet_id, updated_at)
        values (%s, %s, now())
        on conflict (handle) do update
          set last_tweet_id = excluded.last_tweet_id, updated_at = now()
    """, rows)


def log_run(conn, kind: str, items: int, reads: int, cost_usd: float) -> None:
    with conn.cursor() as cur:
        cur.execute("""insert into ingest_runs (kind, items, reads, cost_usd)
                       values (%s, %s, %s, %s)""", (kind, items, reads, cost_usd))


# --- lectures -------------------------------------------------------------
def fetch_last_tweet_ids(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("select handle, last_tweet_id from ingest_state "
                    "where last_tweet_id is not null")
        return dict(cur.fetchall())


def fetch_user_ids(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("select handle, user_id from accounts where user_id is not null")
        return dict(cur.fetchall())


def table_counts(conn, tables: Sequence[str]) -> dict[str, int]:
    """Effectifs actuels, pour mesurer ce qu'un versement a réellement ajouté.

    Le dédoublonnage local s'appuie sur les fichiers JSONL, absents d'un runner
    neuf : il y déclare « 0 déjà connu » alors que la base, elle, en écarte
    beaucoup. Seul l'écart avant/après dit la vérité.
    """
    out: dict[str, int] = {}
    with conn.cursor() as cur:
        for t in tables:
            cur.execute(f"select count(*) from {t}")   # noqa: S608 — liste figée
            out[t] = cur.fetchone()[0]
    return out


def fetch_month_spend(conn, month: str) -> tuple[float, int]:
    """Dépense et lectures déjà engagées ce mois-ci, d'après `ingest_runs`.

    Indispensable en exécution planifiée : le runner est neuf à chaque nuit,
    `x_state.json` y repart de zéro, et le plafond mensuel ne se déclencherait
    jamais s'il ne s'appuyait que sur le fichier local.
    """
    with conn.cursor() as cur:
        cur.execute("""
            select coalesce(sum(cost_usd), 0), coalesce(sum(reads), 0)
              from ingest_runs
             where to_char(started_at at time zone 'UTC', 'YYYY-MM') = %s
        """, (month,))
        cost, reads = cur.fetchone()
    return (float(cost), int(reads))


def fetch_published_keys(conn) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("select citation_key from publications")
        return {r[0] for r in cur.fetchall()}


def stats(conn) -> dict[str, Any]:
    q = {
        "accounts": "select count(*) from accounts",
        "tweets": "select count(*) from tweets",
        "rss_items": "select count(*) from rss_items",
        "candidates": "select count(*) from candidates",
        "publications": "select count(*) from publications",
        "cost_usd": "select coalesce(sum(cost_usd), 0) from ingest_runs",
        "derniere_ingestion": "select max(started_at) from ingest_runs",
    }
    out: dict[str, Any] = {}
    with conn.cursor() as cur:
        for k, sql in q.items():
            cur.execute(sql)
            out[k] = cur.fetchone()[0]
    return out
