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

> **Ce projet est en Python, pas en Node.** Il n'y a ni `package.json`, ni
> `npm run dev`, ni étape de build : l'interface est un unique fichier HTML
> autonome. L'équivalent le plus proche est `python -m politiscope.cli preview`.

## Installation

```bash
pip install -r requirements.txt
cp .env.example .env        # puis renseignez X_BEARER_TOKEN
```

Toutes les commandes se lancent depuis `C:\politoscope` — la racine du projet,
pas depuis le sous-dossier `politiscope/` qui est le package Python.

## Voir l'interface

```bash
python -m politiscope.cli preview            # http://127.0.0.1:8000
python -m politiscope.cli preview --port 8080 --no-open
```

Sert `politiscope.html` en local et l'ouvre dans le navigateur. Le fichier étant
autonome, un double-clic fonctionne aussi — mais `http://` se comporte mieux que
`file://` pour les polices Google et le chargement de d3 depuis le CDN.

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

**Rien n'est publié automatiquement.** Le workflow remplit `candidates` ; le
passage en `entries` reste manuel, parce qu'il exige un jugement.

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

## Publier une citation sur le site

La seule étape du pipeline qui exige un jugement humain. Une candidate porte des
faits — qui a dit quoi, quand, avec quelle URL. Une entrée porte en plus une
lecture : le `sujet`, et la `justif` qui dit ce qu'il faut comprendre de la
citation. Rien de cela ne se déduit du texte, et l'inventer reviendrait à
fabriquer l'analyse que le baromètre prétend offrir.

```bash
python -m politiscope.cli publish --limit 5 --since-hours 48   # écrit publish_draft.json
#   … remplir sujet / justif dans le fichier …
python -m politiscope.cli publish --apply --dry-run            # valide sans insérer
python -m politiscope.cli publish --apply                      # insère
```

Le brouillon pré-remplit ce qui est déductible (nom, parti, famille, citation,
date, source, thème détecté) et laisse vides les champs de jugement. Supprimez
une entrée du tableau pour ne pas la publier.

### Publier depuis GitHub

Sans identifiants Supabase en local, les deux mêmes étapes existent en
workflows manuels — les secrets sont déjà dans le dépôt :

1. *Draft Publication* se lance seule chaque matin après l'ingestion — ou à la
   main via *Actions -> Draft Publication -> Run workflow*, avec `limit`,
   `since_hours` et `min_score`. Le brouillon est commité sur `main` ; s'il
   n'y a aucune candidate, le résumé du job le dit et rien n'est commité. Un
   brouillon déjà rempli n'est jamais écrasé — voir plus bas.
2. Éditez `publish_draft.json` directement sur github.com : remplissez
   `sujet` et `justif`. Ne touchez ni à `citation` ni à `source`
   — l'application les recompare à la candidate d'origine et refuse toute
   retouche. Commitez.
3. *Actions -> Publish Draft -> Run workflow*. La validation passe en
   `--dry-run` d'abord : en cas de refus, les erreurs s'affichent dans le
   résumé du job et rien n'est inséré. Sinon les entrées partent en base et le
   brouillon est retiré du dépôt, pour ne jamais être appliqué deux fois.

Si un brouillon rempli attend déjà sur `main`, *Draft Publication* — qu'elle
soit relancée à la main ou par l'ingestion du lendemain — refuse de le
régénérer et le dit dans le résumé du job, plutôt que d'effacer la relecture
en cours. Cocher `force` passe outre pour repartir de zéro.

Le brouillon ne contient que des tweets publics et leur URL : le commiter
n'expose rien.

### Ce que la validation refuse

| Refus | Pourquoi |
|---|---|
| `sujet`, `justif` ou `theme` vide | une entrée sans lecture n'est pas une entrée |
| `theme` absent de `topics` | clé étrangère |
| **citation modifiée** | le brouillon ne peut pas réécrire les faits |
| **source modifiée** ou non-https | idem |
| citation déjà publiée, ou en double | évite les doublons sur le site |

Les deux refus en gras sont l'essentiel : le brouillon est un fichier éditable,
et rien ne doit permettre d'y retoucher une citation avant insertion. La citation
et la source sont recomparées à la candidate d'origine à chaque application.

Publier inscrit la citation dans `publications` : elle ne sera plus jamais
reproposée, même si elle est ensuite retirée du site.

### Une personne, plusieurs citations

Rien n'empêche de publier plusieurs citations d'une même personne — c'est même
l'intérêt d'un baromètre suivi dans le temps. Le site affiche alors plusieurs
bulles pour elle, et compte « N citations · M personnalités ».

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
x_accounts.json   les 26 comptes suivis
politiscope.html  l'artifact publié
```
