# Connecter les sources d'actualité de manière autorisée

Principe : **aucune collecte ne démarre tant que vous n'avez pas configuré une source**, et aucune
donnée n'est jamais simulée en mode réel. L'écran « État des sources » indique pour chaque source :
*non configurée*, *en attente de la 1re collecte*, *opérationnelle* (seulement après une collecte réelle
réussie), *limitée* ou *indisponible*.

> Les informations sur les offres et conditions d'accès ci-dessous proviennent de recherches web
> menées lors du développement, en partie de blogs tiers. **Elles peuvent avoir changé : vérifiez
> toujours la documentation et les conditions officielles avant d'activer une source.**
> Les connecteurs n'ont **pas** pu être testés contre les services réels dans l'environnement de
> développement (pas d'identifiants, accès réseau sortant restreint). Seuls l'analyse des formats et
> le comportement face aux erreurs sont couverts par des tests.

## 1. X (Twitter) — API officielle v2

| | |
|---|---|
| Méthode | API officielle `api.x.com/2`, jeton « Bearer » d'application (lecture seule) |
| Variables | `X_BEARER_TOKEN`, `X_ACCOUNTS` (défaut `EmmanuelMacron`), `X_MAX_POSTS_PER_REFRESH` |
| Ce qui est lu | Publications publiques de ces comptes (hors réponses et republications) |
| Statut | **Non testé contre l'API réelle** |

Étapes :

1. Créez un compte développeur et une application sur <https://developer.x.com>.
2. Consultez la **formule d'accès et la tarification en vigueur** dans la documentation officielle.
   D'après un article tiers consulté pendant le développement (à vérifier), l'accès par défaut serait
   désormais à l'usage (environ 0,005 $ par publication lue et 0,01 $ par recherche d'utilisateur) et
   l'offre gratuite supprimée. Chaque lecture peut donc être facturée.
3. Générez un **Bearer Token** et placez-le dans `.env` (`X_BEARER_TOKEN=…`). Ne le mettez jamais
   dans le code ni dans le dépôt.
4. Le connecteur limite le coût : identifiants d'utilisateur mémorisés, lecture seulement des
   publications plus récentes que la dernière collectée (`since_id`), volume borné par rafraîchissement.
5. En cas de `429`, la source passe en « limitée » et n'est plus interrogée avant l'heure de reprise
   indiquée par X (`x-rate-limit-reset`).

## 2. Google Actualités — pas d'API officielle

Google ne propose pas d'API publique de recherche d'actualités (l'ancienne API a été arrêtée en 2016).
Le connecteur lit le **flux RSS public de recherche** (`news.google.com/rss/search`), qui n'est
documenté ni comme API ni avec un engagement de disponibilité ou de stabilité.

| | |
|---|---|
| Activation | `GOOGLE_NEWS_RSS_ENABLED=true` (désactivé par défaut) |
| Réglages | `GOOGLE_NEWS_QUERY`, `GOOGLE_NEWS_LANGUAGE`, `GOOGLE_NEWS_COUNTRY` |
| Fréquence | une requête au plus toutes les 15 minutes |
| Limites | liens redirigeant via Google (l'URL éditeur n'est pas fournie) ; extraits souvent absents ; format susceptible de changer |

**Avant d'activer** : lisez les conditions d'utilisation de Google et décidez si cet usage vous convient.
Si ce n'est pas le cas, laissez la source désactivée. Alternatives autorisées : flux RSS officiels des
médias eux-mêmes (nécessite d'ajouter un connecteur, voir §5), ou une API d'actualités sous licence.

## 3. Yahoo Actualités — retiré

Ce connecteur a été supprimé du projet : il n'existe plus de source Yahoo. Si vous disposez un jour d'un flux
RSS/Atom autorisé, le lecteur générique `server/src/collectors/rss.ts` (`parseFeed`) permet d'écrire un
connecteur en quelques lignes (voir §5).

## 4. Vérifier qu'une source fonctionne réellement

1. `npm start`, ouvrez l'application, déroulez « État des sources » : la source doit être *en attente*.
2. Cliquez sur « Rafraîchir » (limité à une fois par minute) ou attendez la collecte planifiée.
3. L'état doit passer à *opérationnelle* avec l'heure de la dernière collecte réussie et le nombre
   d'éléments reçus. En cas d'échec : *indisponible* + message d'erreur (sans secret).
4. Les journaux serveur (`[collecte] source=… reçus=… insérés=… rejetés=…`) détaillent chaque passage,
   sans contenu sensible ni secret.

## 5. Ajouter une autre source

Un connecteur implémente l'interface `Collector` (`server/src/collectors/types.ts`) : `isConfigured`,
`collect` (renvoie des `RawItem` bruts) et un délai minimal entre deux appels. La validation,
l'assainissement, le dédoublonnage et le regroupement sont communs. Enregistrez-le dans
`server/src/collectors/index.ts`. Les types de source affichés dans les filtres sont dans
`shared/src/types.ts` (`SourceKind`).
