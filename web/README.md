# Politiscope — site

Front React du baromètre. Lit **directement Supabase** : aucun serveur
intermédiaire, aucune clé secrète dans le navigateur.

```
pipeline Python  ──écrit──>  Supabase  ──lit──>  ce site React
 (ingestion X/RSS)            (Postgres)          (Vite, statique)
```

## Démarrer

```bash
cd web
npm install
cp .env.example .env.local     # puis renseignez les deux variables
npm run dev                    # http://localhost:5173
```

```bash
npm run build       # tsc + bundle dans dist/
npm run preview     # sert dist/ pour vérifier avant déploiement
npm run typecheck   # types seuls, sans bundle
```

## Déploiement

Le projet Vercel `politiscope` est lié à `semsem23/politiscope`. **Tout push sur
`main` déclenche un build et une mise en production.** Il n'y a plus d'envoi
manuel de fichiers.

La configuration du build vit dans `vercel.json` à la racine du dépôt
(`installCommand`, `buildCommand`, `outputDirectory`) : rien à régler à la main
dans l'interface Vercel, tout est versionné.

Un seul réglage compte côté projet Vercel, et il doit **rester vide** : Root
Directory. Le mettre à `web` ferait ignorer `vercel.json` par Vercel (qui ne le
cherche alors que dans `web/`, où il n'est pas), et casserait le build.

Les variables `VITE_*` viennent de `.env.production`, **commité volontairement** :
Vite les inline dans le bundle, donc la clé publishable est déjà servie à chaque
visiteur. La commiter n'ajoute aucune exposition et rend le build autonome —
sans elle, un build depuis Git produirait un bundle sans configuration Supabase,
donc une page blanche.

## Pages pré-générées (référencement)

`npm run build` enchaîne `vite build` puis `scripts/prerender.mjs`, qui lit
`entries` dans Supabase (clé publishable) et écrit dans `dist/` une page HTML
par personnalité (`/p/:id`) et par citation (`/c/:id`), avec `<title>`,
description, Open Graph, URL canonique et le texte de la citation dans le HTML
servi, plus `sitemap.xml`. React remplace ce contenu au chargement : l'interface
est inchangée. Si Supabase est injoignable, le script prévient et sort en 0 :
le site reste une SPA classique.

Chaque page de citation reçoit aussi une image de partage 1200×630
(`dist/og/:id.png`, générée par `scripts/shareImage.mjs` avec satori + resvg),
branchée sur `twitter:image` **seulement** : `og:image` reste l'image générique,
donc Bluesky et les autres réseaux ne voient pas l'image par citation. Le texte
n'est jamais réécrit ; les emoji sont retirés de l'image (la police n'en a pas)
et un texte de plus de 330 caractères est coupé par « … ».

Les données changent chaque nuit, mais les pages ne sont refaites qu'à chaque
déploiement : c'est le commit « Retire le brouillon publié » qui pousse sur
`main` après la publication, et qui relance donc le build Vercel. Un
identifiant qui demanderait un encodage d'URL n'est pas pré-généré.

Local : sur ce poste, le build a besoin de `NODE_TLS_REJECT_UNAUTHORIZED=0`
pour joindre Supabase (interception TLS).

## Inscription à la newsletter

`NewsletterForm` intègre le formulaire hébergé par Brevo (Contacts >
Formulaires > Partager > lien ; double opt-in et désinscription chez eux).
Il ne s'affiche que si `VITE_BREVO_FORM_URL` est défini au build, et seulement
pour une adresse `https://….sibforms.com/…` : dans `.env.local` en local, dans
les variables du projet Vercel en production.

## Données

The site reads three tables/views, all read-only via RLS:

| Table | Content |
|---|---|
| `entries` | the editorialized citations — theme retained |
| `topics` | mapping from long theme -> short graph label |
| `site_context` | masthead eyebrow/paragraph text (migration 008); falls back to hardcoded strings in `usePolitiscope.ts` if missing |

`personnalites` (a view, migration 006) is read too — see its own fallback in `usePolitiscope.ts`.

`entries` est distincte de `candidates` : cette dernière est la matière brute
sortie de l'ingestion, sans jugement humain. Le site n'affiche que ce qui a été
relu.

La clé `VITE_SUPABASE_PUBLISHABLE_KEY` est **faite pour être exposée** : les
policies RLS n'autorisent que `select`, et seulement sur les entrées publiées.
Aucune écriture n'est possible depuis le navigateur — vérifié : un `INSERT`
anonyme renvoie 401.

## Structure

```
src/
  types.ts                    modèle, familles
  lib/supabase.ts             client public
  lib/fluxScope.ts            périmètre de la vue Flux live (éditeurs, sujets)
  lib/subjects.json           sujets et termes, générés depuis le lexique Python (scripts/export_subjects.py)
  lib/buildEvents.ts          dérive les événements reliés des articles (heuristique, remplaçable)
  hooks/useMediaMentions.ts   lit `press_mentions` (Google Actualités, collecte nocturne `fetch-media`)
  hooks/usePolitiscope.ts     chargement, filtrage, tri
  components/
    FilterBar.tsx             familles, thème, tri, recherche
    PersonGrid.tsx            la grille de cartes (vue Personnalités)
    CitationsTable.tsx        le tableau (vue Citations)
    PersonModal.tsx           la fiche (Échap, clic extérieur, focus)
    FluxLive.tsx              fil + frise chronologique + bande de densité
    EventTimeline.tsx         la frise des événements reliés (SVG fait main)
  App.tsx
  index.css                   design system, thèmes clair et sombre
```

## Pièges rencontrés

**Binding natif manquant sur Windows.** npm omet parfois
`@rolldown/binding-win32-x64-msvc` (dépendance optionnelle de Vite 8). Le build
échoue alors sur `Cannot find module`. Il est déclaré dans
`optionalDependencies` pour rendre `npm ci` reproductible ; sur Linux npm
l'ignore, la plateforme ne correspondant pas.

**`vite preview` écoute en IPv6.** Par défaut il se lie à `localhost` (`::1`) :
`http://127.0.0.1:4173` ne répond pas. Utilisez `localhost`, ou
`--host 127.0.0.1`.

**Node 20.17 déclenche un avertissement.** Vite 8 demande 20.19+. Le build
passe quand même ; `engines` documente l'attendu.

## Poids

`dist/` fait 471 Ko (136 Ko gzip). La frise est en SVG écrit à la main : plus
aucun module `d3` n'est chargé par le bundle. `d3-scale` ne servait plus qu'à
l'ancienne carte radiale (retirée, elle reposait sur les entités) ;
`d3-force`, `d3-drag` et `d3-selection` ne servaient qu'à l'ancien graphe des
sujets. Tous peuvent être retirés de
`package.json`.
