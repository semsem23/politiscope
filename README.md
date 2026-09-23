# Politiscope — pipeline d'ingestion

Alimente le baromètre [Politiscope](https://claude.ai/code/artifact/f19d7318-d4a5-446e-ae05-a2cd3acccfdf)
en citations politiques françaises sourcées.

## Principe

Deux sources complémentaires, réunies par une étape de sélection :

| Source | Coût | Apporte | Statut |
|---|---|---|---|
| **X API** (`fetch-x`) | ~0,005 $/tweet | Les mots propres de l'élu, URL directe | **vérifié** |
| **Google Actualités** (`fetch-rss`) | gratuit | Déclarations orales : meetings, plateaux, interviews | **à vérifier** |

Un tweet est verbatim par construction et porte une URL citable : il alimente
directement le champ `source` de `DATA`. Un titre de presse, lui, ne fournit
qu'une piste — les liens Google News sont des redirections chiffrées qui ne se
résolvent pas côté serveur. L'URL réelle doit être retrouvée sur le site du média
avant publication.

> **La pipeline d'ingestion (ce README) est en Python** : ni `package.json`,
> ni `npm run dev`, ni étape de build ici — les commandes se lancent avec
> `python -m politiscope.cli`. **Le site**, lui, est une application
> React/Vite dans `web/` (build, `npm run dev`, tout le nécessaire) — voir
> `web/README.md`.

## Installation

```bash
pip install -r requirements.txt
cp .env.example .env        # puis renseignez X_BEARER_TOKEN
```

Toutes les commandes se lancent depuis `C:\politoscope` — la racine du projet,
pas depuis le sous-dossier `politiscope/` qui est le package Python.

## Voir l'interface

```bash
cd web && npm install && npm run dev   # http://localhost:5173
```

Le site (`web/`) lit directement Supabase — voir `web/README.md` pour la
configuration (`.env.local`) et le déploiement.

`python -m politiscope.cli preview` existe encore mais ne sert que
`archive/politiscope.html`, la version d'origine (données codées en dur,
remplacée par le site React) conservée pour référence — voir
`archive/README.md`.

## Utilisation

```bash
python -m politiscope.cli status                  # état, volumes, dépense
python -m politiscope.cli verify-handles          # ⚠ à faire en premier
python -m politiscope.cli fetch-rss --days 7      # gratuit
python -m politiscope.cli fetch-x                 # payant, incrémental
python -m politiscope.cli candidates              # citations triées
```

Toutes les commandes d'ingestion acceptent `--dry-run` : volumes et coût estimé,
sans aucun appel réseau.

`candidates` accepte `--per-person N` (défaut 1), `--famille <id>`, `--min-score N`
et `--json` pour chaîner avec un autre outil.

### Prises de position des dernières 24 h

```bash
python -m politiscope.cli candidates \
  --since-hours 24 --verified-only --no-ceremonial --require-theme --per-person 1
```

Les quatre filtres composent la définition d'une *prise de position attribuable
à l'auteur du compte* :

| Filtre | Écarte |
|---|---|
| `--since-hours 24` | fenêtre glissante depuis l'heure d'exécution ; toute candidate sans date exploitable est écartée |
| `--verified-only` | tout ce qui n'est pas un tweet — donc tout ce qui n'a pas d'URL directe |
| `--no-ceremonial` | vœux, remerciements, hommages, résultats sportifs |
| `--require-theme` | ce qui ne relève d'aucun sujet politique identifié |

Les retweets et réponses sont déjà exclus en amont, au niveau de l'API
(`exclude=retweets,replies`), et les propos rapportés d'un tiers par
`quotes.py`. Chaque candidate sortie porte `verifie: true` et l'URL directe
du tweet.

### Toujours commencer par `verify-handles`

Un handle erroné attribuerait une citation à la mauvaise personne. Sur les
26 comptes d'origine, un seul était faux (`@SarahKnafo` au lieu de
`@knafo_sarah`) — un taux d'erreur de 4 % suffit à discréditer le baromètre.

## Maîtrise des coûts

Trois mécanismes, au-delà du tarif lui-même :

- **`since_id`** — seuls les tweets *nouveaux* sont lus, jamais deux fois les mêmes.
- **`exclude=retweets,replies`** — retweets et réponses forment l'essentiel du
  volume et n'ont aucune valeur citationnelle.
- **Plafond mensuel** (`BUDGET_USD_MONTH`, défaut 25 $) — l'ingestion s'arrête net
  quand il est atteint. `MAX_READS_PER_RUN` limite en plus chaque passage.

La dépense est comptée à la ressource, persistée par mois dans `x_state.json`
**et** journalisée en base dans `ingest_runs` à chaque passage — y compris
lorsqu'un passage est interrompu par le plafond, car il a quand même coûté.

### L'état survit à la perte du fichier local

`x_state.json` est pratique mais fragile. Avant chaque ingestion, `fetch-x`
complète l'état local avec ce que la base connaît déjà : identifiants X résolus
(`accounts.user_id`) et dernière position de timeline (`ingest_state`). Seules
les clés manquantes sont récupérées — le local, plus frais, l'emporte.

Sans ce mécanisme, perdre `x_state.json` coûtait une re-résolution des 26
handles plus un re-téléchargement de `backfill_days` de tweets : **~1,58 $
mesurés** pour de la donnée déjà payée.

Mesure réelle : **298 tweets pour 1,62 $** sur 3 jours d'historique et 26 comptes,
soit environ **13 €/mois** en rythme quotidien.

La fréquence ne change quasiment rien à la facture : le coût suit le nombre de
tweets ingérés, pas le nombre de passages (et X déduplique sur 24 h UTC). Autant
tourner tous les jours.

## Ce que fait la sélection — et ce qu'elle refuse de faire

`quotes.py` est délibérément conservateur : mieux vaut écarter une bonne citation
que d'en fabriquer une mauvaise. Trois protections issues de bugs réels observés
sur les données du 14 septembre 2026 :

1. **Appariement des guillemets.** `… des "Verts" recyclée … est une "lubie
   xénophobe"` contient deux paires. Un filtrage par longueur appliqué *avant*
   l'appariement sautait la première (trop courte) et capturait le texte qui
   sépare les deux — une citation qui n'a jamais été prononcée.

2. **Attribution à un tiers.** Un élu cite constamment quelqu'un d'autre :
   « … », *a dit Raphaël Glucksmann*. Toute citation accompagnée du nom propre
   d'un tiers est écartée. De même, un titre de presse où le nom de la personne
   figure *dans* la citation parle d'elle sans la citer.

3. **Substance.** Vœux, hommages et résultats sportifs sont fortement dépréciés ;
   une citation sans thème politique identifiable l'est aussi. Le thème détecté
   (`theme_suggere`) reprend les clés de `TOPIC_SHORT` et pré-remplit `DATA`.

Le champ `verifie` distingue ce qui est publiable en l'état (tweets) de ce qui
demande une vérification humaine (presse).

## Ingestion automatique

`.github/workflows/ingestion.yml` lance chaque nuit à 04h00 UTC (06h00 à Paris
l'été, 05h00 l'hiver) : Google Actualités, puis les timelines X, puis le
versement en base. Déclenchable à la main via *Actions -> Nightly Ingestion ->
Run workflow*, avec une case pour sauter l'ingestion X (la seule payante).
Une fois terminée avec succès, elle déclenche automatiquement *Draft
Publication* ci-dessous — un brouillon frais chaque matin, sans rien à
lancer.

Cette ingestion ne fait que remplir `candidates`. Le passage en `entries` se
fait ensuite sans intervention par la chaîne *Draft Publication* -> *Publish
Draft* qu'elle déclenche — voir *Publishing a citation on the site* pour le
détail, et pour la différence avec un passage manuel de cette chaîne.

### Secrets à créer dans le dépôt

*Settings -> Secrets and variables -> Actions*

| Secret | Valeur |
|---|---|
| `SUPABASE_POOLER_URL` | `postgresql://postgres.<ref>:<mdp>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres` |
| `SUPABASE_PROJECT_REF` | la référence du projet Supabase |
| `SUPABASE_DB_PASSWORD` | le mot de passe Postgres |
| `X_BEARER_TOKEN` | le jeton X |

Deux *variables* facultatives ajustent les garde-fous sans toucher au code :
`BUDGET_USD_MONTH` (défaut 25) et `MAX_READS_PER_RUN` (défaut 600).

### Pourquoi le pooler et pas l'URL directe

`db.<ref>.supabase.co` ne résout qu'en **IPv6**, et les runners GitHub sont
IPv4. L'URL directe y échouerait à chaque connexion, perdant 15 s en tentative
vouée à l'échec avant de se rabattre sur le pooler. Autant viser juste.

### Lire les décomptes

`db-sync` annonce ce qui est **réellement entré en base**, pas ce qui a été
envoyé :

    items RSS      444 nouveau(x) sur 698 envoyé(s)  (254 déjà en base)

La distinction compte en exécution planifiée. Le dédoublonnage local s'appuie
sur les fichiers JSONL, absents d'un runner neuf : `fetch-rss` y annonçait
« 698 ajoutés, 0 déjà connu » alors que la base en écartait 254. Des logs
nocturnes qui gonflent les chiffres sont des logs auxquels on cesse de se fier.

### Le plafond budgétaire tient sur un runner neuf

Chaque exécution part d'un disque vierge : `x_state.json` y serait vide, et un
garde-fou fondé sur ce seul fichier ne se déclencherait jamais. Avant toute
ingestion, l'état est donc repris depuis la base — identifiants X déjà résolus,
positions de timeline, **et dépense du mois** lue dans `ingest_runs`.

C'est aussi ce qui évite de repayer : sans reprise, un runner neuf re-résoudrait
les 26 handles et re-téléchargerait `BACKFILL_DAYS` de tweets à chaque nuit.

## Publishing a citation on the site

A candidate carries facts — who said what, when, with which URL. An entry
also carries `theme`: the one the heuristic detected. By default nobody
reviews it — see *Publishing from GitHub* below — but the CLI and the
manual GitHub path both still support reading it by hand before it goes
live.

```bash
python -m politiscope.cli publish --limit 5 --since-hours 24   # writes publish_draft.json
#   … optionally check / correct theme in the file …
python -m politiscope.cli publish --apply --dry-run            # validates without inserting
python -m politiscope.cli publish --apply                      # inserts
```

The draft pre-fills what can be deduced (name, party, family, citation, date,
source, detected theme). `theme` must exist in the `topics` table for the
draft to validate. Remove an entry from the array to skip publishing it.

### Publishing from GitHub

Without Supabase credentials locally, the same steps exist as GitHub
workflows — the secrets are already in the repo. Two paths:

**Automatic, every night — no action needed.** *Nightly Ingestion* triggers
*Draft Publication*, which builds a draft and commits it to `main`; its
completion in turn triggers *Publish Draft*, which validates it
(`--dry-run` first) and inserts it. `theme` is only what the automatic
detection produced — nobody reads it in this path. If ingestion found
nothing publishable, the chain stops cleanly at whichever step has nothing
to do, and each job's summary says so.

**Manual, for review or testing.** Running *Draft Publication* by hand
(*Actions -> Draft Publication -> Run workflow*, with `limit`,
`since_hours`, `min_score`) does **not** auto-cascade into *Publish Draft* —
that's what keeps a manual run safe to use for reviewing or experimenting:

1. Run *Draft Publication* by hand. The draft is committed to `main`; if
   there's no candidate, the job summary says so and nothing is committed.
   An already-filled draft is never overwritten — see below.
2. Edit `publish_draft.json` directly on github.com: check `theme` if you
   want to. Don't touch `citation` or `source` — applying it re-compares
   them against the original candidate and refuses any tampering. Commit.
3. *Actions -> Publish Draft -> Run workflow*. Validation first runs in
   `--dry-run`: on refusal, the errors show up in the job summary and nothing
   is inserted. Otherwise the entries go into the database and the draft is
   removed from the repo, so it can never be applied twice.

If a filled draft is already waiting on `main`, *Draft Publication* —
whether re-run by hand or by the next morning's ingestion — refuses to
regenerate it and says so in the job summary, rather than erasing whatever
is sitting there unpublished. Checking `force` overrides that to start
fresh.

The draft only contains public tweets and their URL: committing it exposes
nothing.

### What validation refuses

| Refusal | Why |
|---|---|
| empty `theme` | an entry without a review isn't an entry |
| `theme` missing from `topics` | foreign key |
| **modified citation** | the draft can't rewrite the facts |
| **modified source** or non-https | same |
| citation already published, or duplicate | avoids duplicates on the site |

The two bold refusals are the essential ones: the draft is an editable file,
and nothing should allow tampering with a citation before insertion. The
citation and the source are re-compared against the original candidate on
every apply.

Publishing records the citation in `publications`: it will never be proposed
again, even if it's later removed from the site.

### One person, several citations

Nothing stops publishing several citations from the same person — that's
even the point of a barometer tracked over time. The site then shows several
bubbles for them, and counts "N citations · M personalities".

## Base de données (Supabase)

Le projet `politiscope` (région eu-west-2) stocke durablement comptes, tweets,
items RSS, candidates, publications et journal de dépense.

```bash
python -m politiscope.cli db-migrate    # applique migrations/*.sql
python -m politiscope.cli db-sync       # pousse le local vers Supabase
python -m politiscope.cli db-stats      # volumes en base
```

`db-sync` est **idempotent** : les tweets sont dédoublonnés sur l'id X, les
candidates sur `(nom, citation_key)`. Le rejouer ne crée pas de doublon.

### Connexion

`db.<ref>.supabase.co` ne résout qu'en **IPv6**. Sur un réseau ou un runner CI
sans IPv6, `connect()` bascule automatiquement sur le pooler
`aws-0-<region>.pooler.supabase.com` (IPv4), en session puis en transaction.

### Sécurité

RLS est actif sur **toutes** les tables. Le pipeline écrit avec le rôle
`postgres` (connexion directe), qui contourne RLS ; la clé publishable n'a que
des policies `select`, et uniquement sur le contenu éditorial :

| Table | Clé publishable |
|---|---|
| accounts, tweets, rss_items, candidates, publications | lecture seule |
| ingest_state, ingest_runs, schema_migrations | aucun accès |

Vérifié : `INSERT` renvoie 401. `DELETE` renvoie 204 — trompeur, mais c'est
PostgREST confirmant une suppression ayant porté sur **zéro ligne**, RLS ayant
filtré en amont. Décompte inchangé après tentative.

Un invariant est posé en base plutôt qu'en Python : `verifie_exige_source`
interdit qu'une candidate marquée vérifiée existe sans URL.

## Déploiement du site

Le dépôt est lié au projet Vercel : un push sur `main` reconstruit et met en
ligne le site. La configuration du build est versionnée dans `vercel.json` à
la racine — le Root Directory du projet Vercel doit rester vide, voir
`web/README.md`.

## Tests

### Le raccourci

```bash
python -m politiscope.cli selftest                    # hors-ligne, gratuit
python -m politiscope.cli selftest --network          # + RSS et Supabase, gratuit
python -m politiscope.cli selftest --network --api    # + jeton X, coûte 0,01 $
```

Aucun niveau n'écrit en base ni ne consomme de quota d'ingestion. Code de sortie
non nul si une vérification échoue — utilisable tel quel en CI.

### Les quatre niveaux, en détail

**1. Unitaire — instantané, hors-ligne**

```bash
python -m pytest tests/ -q
python -m pytest tests/ -q -k regression    # uniquement les bugs déjà rencontrés
```

50 tests, aucun accès réseau. Les `test_regression_*` rejouent des défauts
constatés sur données réelles : appariement des guillemets, attribution à un
tiers, citation tronquée, regex corrompue par un caractère de contrôle.

**2. Simulation — hors-ligne, chiffre le coût avant de le payer**

```bash
python -m politiscope.cli fetch-x --dry-run
python -m politiscope.cli fetch-rss --dry-run
python -m politiscope.cli verify-handles --dry-run
```

**3. Intégration gratuite**

```bash
python -m politiscope.cli fetch-rss --days 2   # écrit dans rss_items.jsonl
python -m politiscope.cli db-stats
python -m politiscope.cli candidates --limit 5
```

**4. Intégration payante**

```bash
python -m politiscope.cli verify-handles       # 0,010 $/handle non résolu
python -m politiscope.cli fetch-x              # ~0,005 $/tweet nouveau
```

Pour tester sans risque, abaissez le plafond avant :
`python -m politiscope.cli budget --set 1`.

### Ce qui n'est pas couvert

| Module | Fonctions testées |
|---|---|
| `store.py` | 80 % |
| `quotes.py` | 56 % |
| `rss.py` | 25 % |
| `xapi.py` | 16 % |
| `db.py` | 13 % |
| `cli.py` | 7 % |

La logique de correction (extraction, attribution, notation, état, budget) est
couverte. Les couches d'entrées/sorties ne le sont presque pas : il n'y a pas de
test qui simule un 429, une réponse X malformée, ou une coupure en cours
d'`upsert`. `selftest --network --api` les exerce en réel, ce qui n'est pas la
même garantie qu'un test déterministe.

## Sécurité

`.env` est exclu par `.gitignore`. Les quatre clés OAuth1.0a ne servent qu'à
*écrire* sur X : le pipeline ne fait que lire et n'a besoin que de
`X_BEARER_TOKEN`. Ne conservez les autres que si vous ajoutez une publication.

## Structure

```
politiscope/
  config.py    réglages, secrets, garde-fous
  store.py     état, JSONL, compteur de dépense
  xapi.py      client X : retries, rate-limit, facturation
  rss.py       Google Actualités, une requête par personnalité
  quotes.py    extraction, attribution, notation
  publish.py   brouillon, validation, insertion des entrées
  db.py        Postgres/Supabase : migrations, upserts, lectures
  cli.py       commandes
migrations/       schéma SQL versionné
web/              site React/Vite — voir web/README.md
archive/          politiscope.html, la version d'origine, conservée pour référence
x_accounts.json   les 26 comptes suivis
```
