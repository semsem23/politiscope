// Image de partage 1200x630 d'une citation, pour la carte X (twitter:image).
//
// Mise en page unique pour tout le monde : seule la barre de couleur change
// avec la famille politique. Le texte n'est jamais réécrit ; s'il est trop
// long il est coupé par « … » et la page de la citation donne le texte entier.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve("@fontsource/inter/package.json")), "files");

// Couleurs de famille : celles du site (index.css, thème clair).
const COULEURS = {
  majorite: "#2a78d6",
  "droite-rep": "#eb6834",
  "extreme-droite": "#1baf7a",
  "gauche-radicale": "#eda100",
  "gauche-social": "#e87ba4",
};

let fonts;
async function loadFonts() {
  fonts ??= [
    { name: "Inter", weight: 400, style: "normal", data: await readFile(path.join(fontDir, "inter-latin-400-normal.woff")) },
    { name: "Inter", weight: 600, style: "normal", data: await readFile(path.join(fontDir, "inter-latin-600-normal.woff")) },
  ];
  return fonts;
}

/** Les polices embarquées n'ont pas d'emoji : on les retire du rendu de l'image. */
function sansEmoji(s) {
  return String(s)
    .replace(/[\p{Extended_Pictographic}️‍\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function coupe(s, max) {
  return s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

const h = (type, style, children) => ({ type, props: { style: { display: "flex", ...style }, children } });

function tailleDe(n) {
  if (n <= 110) return 56;
  if (n <= 190) return 46;
  if (n <= 280) return 38;
  return 33;
}

export async function shareImage({ citation, nom, parti, dateTexte, famille }) {
  const texte = coupe(sansEmoji(citation), 330);
  const couleur = COULEURS[famille] ?? "#52514e";

  const tree = h(
    "div",
    { width: 1200, height: 630, background: "#f9f9f7", fontFamily: "Inter", color: "#0b0b0b" },
    [
      h("div", { width: 18, height: 630, background: couleur }, ""),
      h(
        "div",
        { flexDirection: "column", justifyContent: "space-between", flex: 1, padding: "52px 72px 48px 60px" },
        [
          h("div", { fontSize: 24, fontWeight: 600, letterSpacing: 4, color: "#898781" }, "POLITISCOPE"),
          h(
            "div",
            { fontSize: tailleDe(texte.length), lineHeight: 1.3, fontWeight: 400 },
            `« ${texte} »`
          ),
          h("div", { alignItems: "flex-end", justifyContent: "space-between" }, [
            h("div", { flexDirection: "column" }, [
              h("div", { fontSize: 36, fontWeight: 600 }, nom),
              h("div", { fontSize: 24, color: "#52514e", marginTop: 6 }, coupe(`${sansEmoji(parti)} · ${dateTexte}`, 80)),
            ]),
            h("div", { fontSize: 24, color: "#898781" }, "politiscope.app"),
          ]),
        ]
      ),
    ]
  );

  const svg = await satori(tree, { width: 1200, height: 630, fonts: await loadFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}
