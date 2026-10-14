# Flux Macron

Tableau de bord de veille sur les **activités publiques** d'Emmanuel Macron : « Dernières activités » à gauche,
frise en réseau centrée sur Macron au centre, détail de l'événement à droite, densité des mentions en bas.
Sources visées : X et Google Actualités. Fenêtre glissante 24 h / 7 j / 30 j, heure de Paris.

> **Règle d'or du projet :** ne jamais inventer ni simuler. Sans source configurée, l'application
> n'affiche *rien* (état vide explicite). Le mode démonstration utilise des données **fictives**
> étiquetées `DEMO` partout (bandeau, cartes, nœuds, détail, URL `example.org`).

## Ce qui fonctionne, ce qui est simulé, ce qui reste à connecter

| Élément | État |
|---|---|
| Interface (liste, frise zoomable, détail, densité, filtres, légende, états vide/erreur/chargement, mobile, mode sombre, clavier) | ✅ Fonctionnelle, vérifiée dans un navigateur (bureau clair/sombre, mobile) |
| Pipeline : normalisation, assainissement, doublons exacts, quasi-doublons, indépendance des sources, regroupement, statuts, indice de recoupement, résumé extractif | ✅ Implémenté et testé (voir « Tests ») |
| Serveur : API, SQLite, planification, limites de fréquence, état des sources, corrections manuelles | ✅ Implémenté et testé (API testée en local) |
| Données de démonstration | 🟠 **Simulées** (fictives, marquées `DEMO`) — passent par le vrai pipeline |
| Connecteur X (API v2) | 🔴 **Non testé contre l'API réelle** (jeton et accès requis) — analyse des réponses testée |
| Connecteur Google Actualités (RSS public) | 🔴 **Non testé contre le service réel** — désactivé par défaut, voir [docs/SOURCES.md](docs/SOURCES.md) |
| Résumé « rédigé » par un modèle de langage | ⚪ Non fourni : le résumé est extractif (titres collectés), pour ne rien ajouter aux sources |

## Installation

Prérequis : **Node.js ≥ 22.13** (SQLite intégré `node:sqlite`) et npm.

```bash
npm install
```

### 1. Voir l'interface avec les données de démonstration

```bash
npm run dev:demo        # serveur en mode démo + interface → http://localhost:5173
```

Sous Windows (PowerShell) : `$env:DEMO_MODE="true"; npm run dev`.
Sans serveur du tout, l'interface bascule d'elle-même sur une démonstration locale (bandeau « Serveur injoignable »),
et `http://localhost:5173/?demo=1` force la démonstration.

### 2. Mode réel (sources autorisées)

```bash
cp .env.example .env     # puis éditez .env : jamais de secret ailleurs
npm run dev              # développement : serveur :8787 + interface :5173
# ou, en production locale :
npm run build && npm start   # tout sur http://127.0.0.1:8787
```

Tant que `.env` ne configure aucune source, l'application affiche un état vide honnête.
Pour connecter X et Google Actualités **de manière autorisée**, suivez pas à pas
[docs/SOURCES.md](docs/SOURCES.md), puis vérifiez dans « État des sources » que chaque source passe à
*opérationnelle* après une vraie collecte.

### Variables d'environnement

Toutes sont documentées dans [.env.example](.env.example). Principales :

| Variable | Rôle |
|---|---|
| `DEMO_MODE` | `true` : démonstration fictive, aucune collecte |
| `X_BEARER_TOKEN`, `X_ACCOUNTS`, `X_MAX_POSTS_PER_REFRESH` | Source X (secret côté serveur) |
| `GOOGLE_NEWS_RSS_ENABLED`, `GOOGLE_NEWS_QUERY`… | Source Google Actualités (désactivée par défaut) |
| `PERSONALITIES` | Liste des personnalités du filtre : `Nom\|alias1\|alias2 ; Autre Nom` (vide par défaut) |
| `OFFICIAL_ACCOUNTS` | Comptes X traités comme sources primaires |
| `REFRESH_INTERVAL_MINUTES` | Planification (minimum 10) |
| `ADMIN_TOKEN` | Active les corrections manuelles (sinon désactivées) |
| `HOST`, `PORT`, `DB_PATH`, `RETENTION_DAYS`, `HTTP_CONTACT` | Serveur et stockage |

## Architecture

```
shared/src            Code pur partagé serveur + navigateur
  types.ts            Modèle de données (Article, ActivityEvent, SourceStatus…)
  pipeline/           normalize → dedupe → cluster → classify → confidence → events
  time.ts             Fenêtre glissante, heure de Paris, graduations, histogramme
  demo.ts             Données de démonstration FICTIVES (isDemo)
server/src            Node + Express 5 + SQLite (node:sqlite)
  collectors/         x.ts · googleNews.ts · rss.ts (interface Collector)
  collect.ts          Service de collecte : limites de fréquence, limites de débit, curseurs
  state.ts · api.ts   État des sources, API HTTP, en-têtes de sécurité, administration
web/src               React 19 + TypeScript + Vite, SVG fait main (aucune bibliothèque de graphes)
  components/         Timeline · EventList · DetailPanel · DensityChart · SourceBar · FilterMenu · …
docs/                 SOURCES.md (connexion autorisée) · CONFIDENCE.md (méthode)
```

Décisions : React/TypeScript/Vite pour l'interface ; frise et densité en SVG direct (contrôle total
des interactions, zéro dépendance) ; SQLite intégré à Node pour un prototype local sans compilation native ;
pipeline pur et déterministe, partagé avec le navigateur pour que la démonstration exerce le *vrai* code.

### Pipeline (cahier des charges §6)

1. **Collecte** par connecteurs autorisés → éléments bruts.
2. **Normalisation** : texte brut (balises, entités, caractères de contrôle et marques bidirectionnelles retirés),
   dates en ISO 8601 (UTC), URL http(s) seulement, paramètres de suivi retirés, extrait limité à 280 caractères.
3. **Doublons exacts** : identifiant, URL canonique, même titre chez le même média.
4. **Quasi-doublons** : similarité ≥ 85 % → *marqués* (jamais supprimés), exclus du compte d'articles distincts.
5. **Regroupement** : rattachement seulement si ≥ 3 mots significatifs communs et score ≥ 50 %, ou même
   source initiale citée ; écart ≤ 48 h. Les rapprochements plus faibles deviennent des **liens suggérés** (pointillés).
6. **Provenance** conservée pour chaque rattachement (visible dans le détail) ; correction manuelle possible (API admin).
7. **Résumé extractif** : uniquement des titres réellement collectés.
8. **Statuts** : « à vérifier » si démenti/rumeur détecté ou titre trop court ; « annoncé » si marqueurs de futur.
9. **Erreurs de collecte** enregistrées et affichées par source.

Méthode de l'indice de recoupement : [docs/CONFIDENCE.md](docs/CONFIDENCE.md).

### Choix de lecture de la frise

- Un nœud = un événement, placé à l'heure de **publication** du premier article (jamais l'heure de collecte).
  La date de l'événement décrit n'est pas déduite (`eventTime` reste vide sans source explicite) : le détail l'indique.
- Taille et chiffre du nœud = articles **distincts** (quasi-doublons exclus), plafonnée.
- Plein = lien établi ; pointillés violets = rapprochement suggéré, à confirmer ; cercle pointillé = événement annoncé.
- Le statut est toujours signalé par un glyphe **et** un libellé (✓ recoupé · 1 source unique · ? à vérifier · ◷ annoncé · ✕ démenti).
- Le disque central « EM » (initiales, aucune photo) relie les événements par des rayons gris : il matérialise le périmètre de collecte, pas une relation factuelle.
- Pastilles sous chaque nœud : un point par article distinct, coloré par source (5 max, puis « +n »). Icône du nœud : nature (déclaration, déplacement, réunion, publication).
- Liens suggérés : pointillés bleu clair (masquables via le menu ⋮). Filtres de catégorie/statut/nature : bouton « Filtres » ; sources : pastilles du haut.
- « Confiance » dans le détail : Élevée ≥ 70 %, Moyenne ≥ 40 %, Faible sinon, « non évalué » sans calcul — libellé d'affichage de l'indice de recoupement, pas une probabilité de véracité.

### Design
Fidèle à la maquette fournie (disposition, hiérarchie, couleurs de catégories). Les pastilles de sources sont des lettres neutres
(X, G, Y) : aucun logo de marque n'est reproduit. Pour afficher une photo officielle dans l'en-tête, vérifiez d'abord ses droits d'usage, puis remplacez
l'avatar d'initiales dans `web/src/App.tsx`.

## API

| Route | Rôle |
|---|---|
| `GET /api/state?window=24h\|7d\|30d` | Fenêtre, articles, événements, état des sources, notes de couverture |
| `POST /api/refresh` | Collecte manuelle (1 par minute) ; sans effet en démo ou sans source configurée |
| `GET /api/health` | Mode et disponibilité |
| `PATCH /api/events/:id` | Corriger `status`, `category`, `title` (**`ADMIN_TOKEN` requis**) |
| `POST /api/events/:id/detach` | Détacher un article d'un événement : `{"articleId": "…"}` (admin) |
| `POST /api/links` | Créer un lien établi entre deux événements : `{"a": "…", "b": "…"}` (admin) |

```bash
curl -X PATCH localhost:8787/api/events/EVT_ID -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"status":"disputed"}'
```

## Sécurité et neutralité

- Secrets uniquement dans `.env` (ignoré par git), lus côté serveur ; jamais envoyés au navigateur ni journalisés
  (messages d'erreur expurgés des jetons). Le serveur écoute sur `127.0.0.1` par défaut.
- Contenus externes traités comme **données non fiables** : texte brut, URL validées, liens `rel="noopener noreferrer"`,
  rendu React (échappement), CSP stricte. Aucune instruction présente dans un article n'est exécutée ni interprétée
  (le pipeline n'utilise aucun modèle de langage).
- Aucune inférence sur la vie privée, les déplacements non publics ou des profils : périmètre = activités publiques.
- Extraits courts uniquement ; pas de reproduction d'articles.
- Collecte espacée (≥ 10 min par source, 15 min pour les flux RSS), limites de débit respectées et affichées.
- Administration désactivée sans `ADMIN_TOKEN`, comparaison à temps constant.
- Pas d'authentification utilisateur : **ne pas exposer** publiquement sans reverse proxy authentifié.

## Tests

```bash
npm test            # 44 tests : pipeline, filtres, connecteurs (formats), collecte, API
npm run typecheck
npm run build
```

Correspondance avec les critères d'acceptation (§11) :

| Critère | Où c'est vérifié |
|---|---|
| Ordinateur et mobile | Captures navigateur 1600 px et 390 px (mise en page adaptative) |
| Fenêtre 24 h exacte ; 7 j / 30 j | `computeWindow` (test), API (test), frise et densité recalculées |
| Filtres source / catégorie | `filters.test.ts` + test navigateur |
| Article ↔ nœud ; nœud → sources et URL | Test navigateur (clic, clavier) ; panneau de détail |
| Liens établis vs suggérés ; annoncé vs réalisé | Légende + styles distincts (trait plein / pointillé ; cercle pointillé) |
| Doublons ne gonflent pas les confirmations | Tests « reprises », « quasi-doublons » |
| États chargement / erreur / vide | Bandeaux et superpositions ; test API « mode réel sans source » |
| Démo signalée ; rien d'inventé | Test « tout est DEMO » ; mode réel renvoie 0 élément sans source |
| Secrets côté serveur ; limites d'accès | Test configuration/erreurs ; limites de débit et de fréquence testées |

## Limites connues

- Connecteurs réels non testés de bout en bout (voir tableau en tête).
- Classification, nature et « annoncé » par mots-clés : approximatifs (corrigeables manuellement par l'API).
- Regroupement lexical : peut séparer à tort des articles paraphrasés (choix prudent) ou, rarement, en rapprocher.
- Pas d'interface d'édition manuelle : les corrections passent par l'API.
- Pas d'authentification applicative, pas de multi-utilisateur.
- `node:sqlite` est marqué « expérimental » par Node 22 (avertissement au démarrage) ; passer à PostgreSQL est prévu pour un déploiement partagé.
