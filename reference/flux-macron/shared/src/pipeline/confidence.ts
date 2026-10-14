// Indice de recoupement (« confiance ») — méthode documentée dans docs/CONFIDENCE.md.
//
// Ce n'est PAS une mesure de véracité : c'est une mesure de recoupement de sources indépendantes.
//
//   scheduled              -> non évalué (événement annoncé, pas encore constaté)
//   aucune source          -> non évalué
//   sinon :
//     + 0,45  si une source primaire (compte officiel configuré) publie le fait
//     + palier selon le nombre de sources INDÉPENDANTES hors source primaire :
//         0 -> 0 ; 1 -> 0,25 ; 2 -> 0,40 ; 3 -> 0,50 ; 4 et + -> 0,55
//     plafond 0,95
//     × 0,5 si un mot-clé de démenti/rumeur est détecté (vérification manuelle conseillée)
//
// Les reprises d'une même dépêche, d'un même texte ou d'un même média comptent UNE fois
// (voir assignIndependence). Le nombre brut d'articles n'intervient pas.

export interface ConfidenceInput {
  scheduled: boolean;
  hasPrimarySource: boolean;
  /** Clés d'indépendance distinctes (source primaire incluse). */
  independentCount: number;
  totalArticles: number;
  contradictionDetected: boolean;
}

export interface ConfidenceResult {
  value: number | null;
  explanation: string;
}

const TIERS = [0, 0.25, 0.4, 0.5, 0.55];

export function computeConfidence(i: ConfidenceInput): ConfidenceResult {
  if (i.scheduled) {
    return {
      value: null,
      explanation:
        "Non évalué : événement annoncé ou prévu, pas encore constaté. L'indice ne s'applique qu'aux faits déjà rapportés.",
    };
  }
  if (i.totalArticles === 0 || i.independentCount === 0) {
    return { value: null, explanation: "Non évalué : aucune source exploitable." };
  }

  const others = Math.max(0, i.independentCount - (i.hasPrimarySource ? 1 : 0));
  let value = (i.hasPrimarySource ? 0.45 : 0) + TIERS[Math.min(others, TIERS.length - 1)];
  value = Math.min(0.95, value);

  const parts: string[] = [];
  if (i.hasPrimarySource) parts.push("1 source primaire (compte officiel)");
  if (others > 0) parts.push(`${others} source${others > 1 ? "s" : ""} indépendante${others > 1 ? "s" : ""}`);
  let text = `${i.totalArticles} élément${i.totalArticles > 1 ? "s" : ""} collecté${i.totalArticles > 1 ? "s" : ""}, ` +
    `recoupés en ${parts.join(" + ")}. Reprises de dépêche, textes identiques et doublons comptés une seule fois.`;

  if (i.contradictionDetected) {
    value *= 0.5;
    text += " Mot-clé de démenti ou de rumeur détecté : indice divisé par deux, vérification manuelle conseillée.";
  }
  text += " Mesure du recoupement des sources, pas une preuve de véracité.";
  return { value: Math.round(value * 100) / 100, explanation: text };
}
