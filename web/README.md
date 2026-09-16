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

## Données

The site reads two tables, both read-only via RLS:

| Table | Content |
|---|---|
| `entries` | the editorialized citations — theme retained |
| `topics` | mapping from long theme -> short graph label |

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
  hooks/usePolitiscope.ts     chargement, filtrage, tri
  components/
    FilterBar.tsx             familles, thème, tri, recherche
    BubbleField.tsx           les bulles
    DetailModal.tsx           la fiche (Échap, clic extérieur, focus)
    TopicGraph.tsx            graphe d3 à deux niveaux
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

`dist/` fait 494 Ko (145 Ko gzip), dont l'essentiel est d3 pour le graphe de
forces. Si cela devient gênant, `TopicGraph` est le seul consommateur de d3 et
se prête bien à un `React.lazy`.
