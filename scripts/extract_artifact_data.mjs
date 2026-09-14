/**
 * Extrait DATA, TOPIC_SHORT et PARTY_CODE de l'artifact HTML vers du JSON.
 *
 * L'artifact est la source de vérité éditoriale actuelle : ces 26 entrées ont
 * été relues et jugées à la main. On les récupère pour les verser en base, d'où
 * le site React les lira ensuite.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync("politiscope.html", "utf8");

function block(name, open, close) {
  const start = html.indexOf(`var ${name} = ${open}`);
  if (start < 0) throw new Error(`${name} introuvable dans l'artifact`);
  const from = html.indexOf(open, start);
  let depth = 0;
  for (let i = from; i < html.length; i++) {
    if (html[i] === open) depth++;
    else if (html[i] === close) {
      depth--;
      if (depth === 0) return html.slice(from, i + 1);
    }
  }
  throw new Error(`bloc ${name} non refermé`);
}

// Le contenu vient de notre propre fichier : évaluation dans un contexte vide,
// sans accès au système de fichiers ni au réseau.
const ctx = {};
runInNewContext(
  `DATA = ${block("DATA", "[", "]")};` +
  `TOPIC_SHORT = ${block("TOPIC_SHORT", "{", "}")};` +
  `PARTY_CODE = ${block("PARTY_CODE", "{", "}")};`,
  ctx
);

const { DATA, TOPIC_SHORT, PARTY_CODE } = ctx;

for (const d of DATA) {
  d.code_parti = PARTY_CODE[d.nom] ?? null;
}

const out = { entries: DATA, topics: TOPIC_SHORT, party_codes: PARTY_CODE };
writeFileSync("artifact_data.json", JSON.stringify(out, null, 2), "utf8");

console.log(`entrées      ${DATA.length}`);
console.log(`thèmes       ${Object.keys(TOPIC_SHORT).length}`);
console.log(`codes partis ${new Set(Object.values(PARTY_CODE)).size}`);
const missing = DATA.filter((d) => !d.code_parti).map((d) => d.nom);
if (missing.length) console.log(`⚠ sans code parti : ${missing.join(", ")}`);
const badTheme = DATA.filter((d) => !(d.theme in TOPIC_SHORT)).map((d) => d.nom);
if (badTheme.length) console.log(`⚠ thème absent de TOPIC_SHORT : ${badTheme.join(", ")}`);
