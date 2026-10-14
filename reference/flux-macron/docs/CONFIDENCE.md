# Indice de recoupement (« confiance ») — méthode

**Ce n'est pas une mesure de véracité.** C'est une mesure du recoupement de sources *indépendantes*.
Le nombre brut d'articles n'intervient jamais.

## Sources indépendantes

Chaque article reçoit une *clé d'indépendance*. Deux articles de même clé comptent pour **une seule** confirmation :

| Cas | Clé |
|---|---|
| L'article cite une source initiale qui figure dans la collecte | clé de cette source initiale |
| L'article cite une source initiale absente de la collecte | `orig:<url citée>` |
| Compte X officiel (`OFFICIAL_ACCOUNTS`) | `primary:x:<compte>` |
| Mention explicite d'une dépêche : « (AFP) », « selon l'AFP », « avec Reuters »… | `wire:<agence>` |
| Même titre diffusé par plusieurs médias | `text:<empreinte du titre>` |
| Quasi-doublon (similarité ≥ 85 %, moins de 12 h d'écart) d'un article plus ancien | clé de l'article ancien |
| Sinon | `pub:<média>` (deux articles du même média = une source) |

Ces règles ne peuvent que **réduire** le nombre de confirmations : un texte malveillant ne peut pas le gonfler.

## Calcul

- Événement « annoncé / prévu » ou sans source exploitable → **non évalué** (aucune valeur).
- Sinon : `+0,45` si une source primaire (compte officiel) relaie le fait, plus un palier selon le nombre de
  sources indépendantes *hors source primaire* : 1 → 0,25 ; 2 → 0,40 ; 3 → 0,50 ; 4 et plus → 0,55.
- Plafond 0,95.
- Mot-clé de démenti ou de rumeur détecté dans les titres/extraits : valeur × 0,5 et statut « à vérifier ».
  Cette détection n'établit pas un démenti ; le statut « démenti » n'existe que par correction manuelle.

## Statuts

| Statut | Règle |
|---|---|
| `scheduled` | marqueurs de futur (« se rendra », « prévu », « demain »…) et aucun marqueur de passé |
| `needs_review` | mot-clé de démenti/rumeur, ou titre trop court pour être documenté |
| `cross_checked` | au moins 2 sources indépendantes (la source primaire compte pour une) |
| `single_source` | une seule source indépendante |
| `disputed` | uniquement par correction manuelle |

Tous ces seuils sont dans `shared/src/pipeline/confidence.ts` et `events.ts`, et testés.


## Libellé affiché dans l'interface

L'interface traduit l'indice en mot : **Élevée** (≥ 70 %), **Moyenne** (≥ 40 %), **Faible** (< 40 %), **non évalué** (aucun calcul possible, ex. événement annoncé). C'est un confort de lecture ; le pourcentage et son explication restent affichés à côté.
