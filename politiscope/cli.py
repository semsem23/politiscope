"""Interface en ligne de commande de Politiscope."""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import PRICE_POST_READ, PRICE_USER_READ, settings
from .quotes import candidates_from_rss, candidates_from_tweet, normalise
from .store import BudgetExceeded, State, append_jsonl, read_json, read_jsonl


def _setup_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass


def _log(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(message)s",
        stream=sys.stdout,
    )


def load_accounts() -> list[dict]:
    cfg = read_json(settings.accounts_file, None)
    if not cfg:
        raise SystemExit(f"Fichier introuvable : {settings.accounts_file}")
    return cfg["accounts"]


# --- commandes -----------------------------------------------------------
def cmd_status(args) -> int:
    state = State(settings.state_file)
    accounts = load_accounts()
    resolved = sum(1 for a in accounts if a["handle"] in state.user_ids)
    primed = sum(1 for a in accounts if a["handle"] in state.last_id)
    n_tweets = sum(1 for _ in read_jsonl(settings.tweets_file))
    n_rss = sum(1 for _ in read_jsonl(settings.rss_file))

    print("Politiscope — état")
    print(f"  comptes suivis        {len(accounts)}")
    print(f"  handles résolus       {resolved}/{len(accounts)}")
    print(f"  timelines amorcées    {primed}/{len(accounts)}  (since_id connu)")
    print(f"  tweets collectés      {n_tweets}")
    print(f"  items RSS collectés   {n_rss}")
    print(f"  dernier passage       {state.last_run or '—'}")
    print()
    pct = 100 * state.spend_this_month / settings.budget_usd_month if settings.budget_usd_month else 0
    print(f"  dépense ce mois       {state.spend_this_month:.2f} / "
          f"{settings.budget_usd_month:.2f} USD  ({pct:.0f} %)")
    print(f"  lectures ce mois      {state.reads_this_month}")
    if state.spend:
        print("  historique            " + ", ".join(
            f"{m}: {v:.2f}$" for m, v in sorted(state.spend.items())))
    return 0


def cmd_verify(args) -> int:
    """Valide les handles contre l'API avant toute ingestion."""
    from .xapi import XClient

    accounts = load_accounts()
    state = State(settings.state_file)
    client = XClient(settings.require_token(), state, settings)

    handles = [a["handle"] for a in accounts]
    unknown = [h for h in handles if h not in state.user_ids]
    print(f"{len(unknown)} handle(s) à résoudre "
          f"({len(unknown) * PRICE_USER_READ:.2f} USD)")
    if args.dry_run:
        return 0

    client.resolve_users(handles)
    state.save()

    missing = [a for a in accounts if a["handle"] not in state.user_ids]
    print(f"\n✅ {len(accounts) - len(missing)}/{len(accounts)} résolus")
    for a in missing:
        print(f"❌ {a['nom']:<26} @{a['handle']} introuvable")
    if missing:
        print("\nCorrigez x_accounts.json avant d'ingérer : un handle erroné "
              "attribuerait une citation à la mauvaise personne.")
        return 1
    return 0


def _hydrate_state_from_db(state: State) -> str | None:
    """Complète l'état local avec ce que la base connaît déjà.

    `x_state.json` est pratique mais fragile : s'il est perdu ou si le
    pipeline tourne depuis une autre machine, les handles sont re-résolus
    (0,010 $ chacun) et `backfill_days` de tweets re-téléchargés pour chaque
    compte — de l'argent déjà dépensé une fois. La base garde la copie
    durable ; on s'en sert pour ne jamais repayer la même lecture.

    Renvoie un message d'anomalie si la base est injoignable, sinon None.
    """
    try:
        from . import db
        month = State._month()
        with db.connect() as conn:
            ids = db.fetch_user_ids(conn)
            last = db.fetch_last_tweet_ids(conn)
            spend, reads = db.fetch_month_spend(conn, month)
    except Exception as e:
        return str(e).splitlines()[0][:70]

    recovered_ids = {h: v for h, v in ids.items() if h not in state.user_ids}
    recovered_last = {h: v for h, v in last.items() if h not in state.last_id}
    state.user_ids.update(recovered_ids)
    state.last_id.update(recovered_last)
    if recovered_ids or recovered_last:
        print(f"  état récupéré depuis la base : {len(recovered_ids)} identifiant(s), "
              f"{len(recovered_last)} position(s) de timeline")

    # Le plafond mensuel doit se fonder sur ce qui a réellement été dépensé,
    # pas sur ce que le fichier local a mémorisé : en exécution planifiée le
    # runner est neuf chaque nuit, et le garde-fou serait sinon inopérant.
    if spend > state.spend.get(month, 0.0):
        state.spend[month] = spend
        state.reads[month] = max(state.reads.get(month, 0), reads)
        print(f"  dépense du mois reprise depuis la base : {spend:.2f} USD")
    return None


def _persist_state_to_db(state: State, kind: str, items: int,
                         reads: int, cost_usd: float) -> None:
    """Repousse l'état en base et journalise le passage."""
    try:
        from . import db
        with db.connect() as conn:
            if state.user_ids:
                db.set_user_ids(conn, state.user_ids)
            if state.last_id:
                db.set_last_tweet_ids(conn, state.last_id)
            db.log_run(conn, kind, items, reads, cost_usd)
    except Exception as e:
        logging.getLogger("politiscope").warning(
            "état non sauvegardé en base (%s) — x_state.json reste la seule copie",
            str(e).splitlines()[0][:70])


def cmd_fetch_x(args) -> int:
    from .xapi import XClient, ingest

    accounts = load_accounts()
    state = State(settings.state_file)
    if not args.dry_run:
        _hydrate_state_from_db(state)

    if args.dry_run:
        primed = sum(1 for a in accounts if a["handle"] in state.last_id)
        est = len(accounts) * 5 * PRICE_POST_READ
        print(f"[DRY-RUN] {len(accounts)} comptes, {primed} déjà amorcés")
        print(f"          estimation à 5 tweets/compte : {est:.2f} USD")
        print(f"          plafond/passage : {settings.max_reads_per_run} lectures")
        print(f"          budget restant  : "
              f"{settings.budget_usd_month - state.spend_this_month:.2f} USD")
        return 0

    client = XClient(settings.require_token(), state, settings)
    cost = 0.0
    try:
        rows = ingest(client, accounts, settings)
    except BudgetExceeded as e:
        state.save()
        # Même interrompu, le passage a coûté : il doit être journalisé.
        _persist_state_to_db(state, "x", 0, client.reads_this_run,
                             client.reads_this_run * PRICE_POST_READ)
        print(f"\n⛔ {e}")
        return 2

    # dédoublonnage sur l'id de tweet
    seen = {r["id"] for r in read_jsonl(settings.tweets_file)}
    fresh = [r for r in rows if r["id"] not in seen]
    append_jsonl(settings.tweets_file, fresh)
    state.save()

    cost = client.reads_this_run * PRICE_POST_READ
    _persist_state_to_db(state, "x", len(fresh), client.reads_this_run, cost)

    print(f"\n{len(fresh)} tweet(s) ajouté(s) ({len(rows) - len(fresh)} doublon(s) ignoré(s))")
    print(f"coût de ce passage : {cost:.2f} USD "
          f"| mois : {state.spend_this_month:.2f} / {settings.budget_usd_month:.2f} USD")
    return 0


def cmd_fetch_rss(args) -> int:
    from . import rss

    accounts = load_accounts()
    if args.dry_run:
        print(f"[DRY-RUN] {len(accounts)} requêtes Google Actualités "
              f"sur {args.days} jours — gratuit, sans clé")
        print("  exemple :", rss.feed_url(accounts[0]["nom"], args.days,
                                          settings.rss_lang, settings.rss_country))
        return 0

    rows = rss.ingest(accounts, args.days, settings.rss_lang, settings.rss_country)
    seen = {r["id"] for r in read_jsonl(settings.rss_file)}
    fresh = [r for r in rows if r["id"] not in seen]
    append_jsonl(settings.rss_file, fresh)

    # Gratuit, mais le passage est journalisé : sans lui, impossible de savoir
    # depuis la base quand le baromètre a été rafraîchi pour la dernière fois.
    _persist_state_to_db(State(settings.state_file), "rss", len(fresh), 0, 0.0)

    print(f"\n{len(fresh)} item(s) ajouté(s) ({len(rows) - len(fresh)} déjà connu(s)) — 0.00 USD")
    return 0


def _parse_iso(value: str | None) -> "datetime | None":
    """Date d'un tweet (ISO 8601, suffixe Z) -> datetime aware, ou None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def cmd_candidates(args) -> int:
    """Croise tweets + RSS et sort les citations candidates triées."""
    # Citations déjà publiées : la table `entries` fait foi depuis que le site
    # React a remplacé l'artifact figé. On retombe sur le HTML archivé si la
    # base est injoignable, pour que la commande reste utilisable hors ligne.
    existing: set[str] = set()
    try:
        from . import db
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select citation_key from entries")
                existing = {r[0] for r in cur.fetchall()}
            # `publications` retient aussi ce qui a été publié puis retiré du
            # site : sans cette union, une citation dépubliée reviendrait dans
            # les candidates au passage suivant.
            existing |= db.fetch_published_keys(conn)
    except Exception as e:
        logging.getLogger("politiscope").warning(
            "base injoignable (%s) — repli sur l'artifact archivé", str(e).splitlines()[0][:60])
        if settings.artifact_file.exists():
            html = settings.artifact_file.read_text(encoding="utf-8", errors="replace")
            for m in __import__("re").finditer(r'citation:"((?:[^"\\]|\\.)*)"', html):
                existing.add(normalise(m.group(1)))

    cands: list[dict] = []
    for row in read_jsonl(settings.tweets_file):
        cands.extend(candidates_from_tweet(row))
    for row in read_jsonl(settings.rss_file):
        cands.extend(candidates_from_rss(row))

    # retire ce qui est déjà publié, puis dédoublonne entre sources
    out, seen = [], set()
    for c in sorted(cands, key=lambda c: c["score"], reverse=True):
        k = normalise(c["citation"])[:120]
        if not k or k in seen or k in existing:
            continue
        seen.add(k)
        out.append(c)

    # --- prise de position attribuable à l'auteur --------------------------
    # Chaque filtre correspond à une exigence explicite, pas à une heuristique
    # de confort : ce qui sort d'ici doit être publiable tel quel.
    if args.verified_only:
        # Seuls les tweets portent verifie=true : mots propres + URL directe.
        out = [c for c in out if c.get("verifie") and c.get("source")]
    if args.no_ceremonial:
        out = [c for c in out if not c.get("protocolaire")]
    if args.require_theme:
        out = [c for c in out if c.get("theme_suggere")]

    if args.since_hours:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=args.since_hours)
        kept, undated = [], 0
        for c in out:
            dt = _parse_iso(c.get("date"))
            if dt is None:
                undated += 1          # sans date fiable, on n'affirme rien
                continue
            if dt >= cutoff:
                kept.append(c)
        out = kept
        if undated and not args.json:
            print(f"({undated} candidate(s) sans date exploitable, écartée(s))\n")

    if args.famille:
        out = [c for c in out if c.get("famille") == args.famille]
    out = [c for c in out if c["score"] >= args.min_score]

    # Diversité : Politiscope veut une personne par bulle et un spectre équilibré.
    # Sans plafond, le plus prolifique du jour occupe toute la liste.
    if args.per_person:
        per: dict[str, int] = {}
        kept = []
        for c in out:
            n = per.get(c["nom"], 0)
            if n >= args.per_person:
                continue
            per[c["nom"]] = n + 1
            kept.append(c)
        out = kept

    out = out[:args.limit]

    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if not out:
        print("Aucune citation candidate. Lancez d'abord `fetch-x` et/ou `fetch-rss`.")
        return 0

    print(f"{len(out)} citation(s) candidate(s) — déjà publiées exclues\n")
    for c in out:
        flag = "✔ vérifiée" if c["verifie"] else "⚠ à vérifier"
        date = (c.get("date") or "")[:10]
        print(f"[{c['score']:>3}] {c['nom']} · {date} · {c['origine']} · {flag}")
        print(f"      « {c['citation'][:170]} »")
        print(f"      {c.get('source') or c.get('media') or ''}")
        print()
    return 0


def cmd_budget(args) -> int:
    state = State(settings.state_file)
    if args.set is not None:
        env = settings.root / ".env"
        lines = [l for l in (env.read_text(encoding="utf-8").splitlines() if env.exists() else [])
                 if not l.startswith("BUDGET_USD_MONTH=")]
        lines.append(f"BUDGET_USD_MONTH={args.set}")
        env.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"Plafond mensuel porté à {args.set:.2f} USD")
        return 0
    print(f"dépense {state.spend_this_month:.2f} / plafond {settings.budget_usd_month:.2f} USD")
    return 0



# --- base de données ------------------------------------------------------
def cmd_db_migrate(args) -> int:
    from . import db
    with db.connect() as conn:
        applied = db.migrate(conn)
    if applied:
        print("Migrations appliquées : " + ", ".join(applied))
    else:
        print("Schéma déjà à jour.")
    return 0


def cmd_db_sync(args) -> int:
    """Pousse les données locales vers Supabase. Idempotent : rejouable sans risque."""
    from . import db
    from .quotes import normalise as _norm

    accounts = load_accounts()
    state = State(settings.state_file)

    tweets = list(read_jsonl(settings.tweets_file))
    rss = list(read_jsonl(settings.rss_file))

    cands: list[dict] = []
    for row in tweets:
        cands.extend(candidates_from_tweet(row))
    for row in rss:
        cands.extend(candidates_from_rss(row))

    with db.connect() as conn:
        db.migrate(conn)
        n_acc = db.upsert_accounts(conn, accounts)
        if state.user_ids:
            db.set_user_ids(conn, state.user_ids)
        n_tw = db.upsert_tweets(conn, tweets)
        n_rss = db.upsert_rss(conn, rss)
        n_cd = db.upsert_candidates(conn, cands, _norm)
        if state.last_id:
            db.set_last_tweet_ids(conn, state.last_id)
        st = db.stats(conn)

    print(f"  comptes      {n_acc:>5} envoyés")
    print(f"  tweets       {n_tw:>5} envoyés")
    print(f"  items RSS    {n_rss:>5} envoyés")
    print(f"  candidates   {n_cd:>5} envoyées")
    print()
    print("En base :")
    for k, v in st.items():
        print(f"  {k:<20} {v}")
    return 0


def cmd_db_stats(args) -> int:
    from . import db
    with db.connect() as conn:
        st = db.stats(conn)
    print("Supabase — politiscope")
    for k, v in st.items():
        print(f"  {k:<20} {v}")
    return 0


def cmd_preview(args) -> int:
    from .preview import serve
    return serve(port=args.port, open_browser=not args.no_open)


def cmd_selftest(args) -> int:
    from .selftest import run
    return run(network=args.network, api=args.api)


def cmd_publish(args) -> int:
    """Brouillon -> relecture humaine -> insertion. Voir politiscope/publish.py."""
    from . import db, publish

    path = Path(args.file) if args.file else settings.root / "publish_draft.json"

    if args.apply:
        entries = publish.load_draft(path)
        if not entries:
            print("Brouillon vide : rien à publier.")
            return 0
        with db.connect() as conn:
            problemes = publish.validate(conn, entries)
            if problemes:
                print(f"⛔ {len(problemes)} problème(s) — rien n'a été publié :")
                print()
                for p in problemes:
                    print(f"  · {p}")
                return 1
            if args.dry_run:
                print(f"[DRY-RUN] {len(entries)} entrée(s) valides, prêtes à publier :")
                for e in entries:
                    print(f"  {e['nom']:<24} {e['sentiment']:<8} {e['theme']}")
                return 0
            n = publish.apply_draft(conn, entries)
        print(f"✅ {n} entrée(s) publiée(s). Le site les affichera au rechargement.")
        return 0

    # --- mode brouillon ---
    with db.connect() as conn:
        draft = publish.build_draft(
            conn, limit=args.limit, min_score=args.min_score,
            per_person=args.per_person, since_hours=args.since_hours,
            famille=args.famille)
    if not draft:
        print("Aucune candidate publiable. Lancez `fetch-x` / `fetch-rss` puis `db-sync`.")
        return 0

    publish.write_draft(draft, path)
    print(f"{len(draft)} candidate(s) écrite(s) dans {path.name}")
    print()
    for e in draft:
        print(f"  [{e['_score']:>3}] {e['nom']:<24} {e['theme']}")
        print(f"        « {e['citation'][:110]} »")
    print()
    print("Remplissez sujet / sentiment / justif, puis :")
    print("  python -m politiscope.cli publish --apply")
    return 0


def main(argv: list[str] | None = None) -> int:
    _setup_console()
    p = argparse.ArgumentParser(prog="politiscope", description="Pipeline Politiscope")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="état, volumes et dépense").set_defaults(fn=cmd_status)

    v = sub.add_parser("verify-handles", help="valide les comptes X avant ingestion")
    v.add_argument("--dry-run", action="store_true")
    v.set_defaults(fn=cmd_verify)

    fx = sub.add_parser("fetch-x", help="ingère les nouveaux tweets (payant)")
    fx.add_argument("--dry-run", action="store_true")
    fx.set_defaults(fn=cmd_fetch_x)

    fr = sub.add_parser("fetch-rss", help="ingère Google Actualités (gratuit)")
    fr.add_argument("--days", type=int, default=7)
    fr.add_argument("--dry-run", action="store_true")
    fr.set_defaults(fn=cmd_fetch_rss)

    c = sub.add_parser("candidates", help="citations candidates triées")
    c.add_argument("--limit", type=int, default=25)
    c.add_argument("--min-score", type=int, default=45)
    c.add_argument("--famille")
    c.add_argument("--per-person", type=int, default=1,
                   help="citations max par personne (0 = sans limite)")
    c.add_argument("--since-hours", type=float,
                   help="fenêtre glissante en heures depuis l'heure d'exécution")
    c.add_argument("--verified-only", action="store_true",
                   help="uniquement verifie=true (tweets : mots propres + URL directe)")
    c.add_argument("--no-ceremonial", action="store_true",
                   help="exclut vœux, hommages et messages sportifs")
    c.add_argument("--require-theme", action="store_true",
                   help="exige un sujet politique identifié (prise de position)")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_candidates)

    pv = sub.add_parser("preview", help="sert l'artifact en local et l'ouvre")
    pv.add_argument("--port", type=int, default=8000)
    pv.add_argument("--no-open", action="store_true", help="ne pas ouvrir le navigateur")
    pv.set_defaults(fn=cmd_preview)

    t = sub.add_parser("selftest", help="auto-diagnostic de l'installation")
    t.add_argument("--network", action="store_true", help="teste RSS et Supabase (gratuit)")
    t.add_argument("--api", action="store_true", help="teste le jeton X (0,01 $)")
    t.set_defaults(fn=cmd_selftest)

    pb = sub.add_parser("publish", help="publie des citations sur le site")
    pb.add_argument("--apply", action="store_true", help="applique un brouillon rempli")
    pb.add_argument("--file", help="chemin du brouillon (defaut publish_draft.json)")
    pb.add_argument("--dry-run", action="store_true", help="valide sans inserer")
    pb.add_argument("--limit", type=int, default=10)
    pb.add_argument("--min-score", type=int, default=75)
    pb.add_argument("--per-person", type=int, default=1)
    pb.add_argument("--since-hours", type=float)
    pb.add_argument("--famille")
    pb.set_defaults(fn=cmd_publish)

    sub.add_parser("db-migrate", help="applique les migrations SQL").set_defaults(fn=cmd_db_migrate)
    sub.add_parser("db-sync", help="pousse les données locales vers Supabase").set_defaults(fn=cmd_db_sync)
    sub.add_parser("db-stats", help="volumes en base").set_defaults(fn=cmd_db_stats)

    b = sub.add_parser("budget", help="consulte ou modifie le plafond mensuel")
    b.add_argument("--set", type=float)
    b.set_defaults(fn=cmd_budget)

    args = p.parse_args(argv)
    _log(args.verbose)
    try:
        return args.fn(args)
    except KeyboardInterrupt:
        print("\ninterrompu", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
