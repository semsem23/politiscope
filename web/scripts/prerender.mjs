// Pré-génère en HTML les pages /p/:figureId et /c/:entryId, sitemap.xml et
// l'aperçu de /methodologie, à partir de dist/index.html.
//
// Pourquoi : le site est une SPA, donc une page vide pour tout ce qui ne lance
// pas de JavaScript (premier passage de Google, aperçus de liens). Chaque page
// générée ici contient son propre <title>, sa description, ses balises Open
// Graph et le texte de la citation dans le HTML servi. React remplace ce
// contenu au chargement (createRoot, pas d'hydratation) : l'interface ne change
// pas pour le visiteur.
//
// Lancé après `vite build` (voir package.json). Lit Supabase avec la clé
// publishable, comme le site. Si Supabase est injoignable, on prévient et on
// sort en 0 : le site reste une SPA fonctionnelle plutôt que de bloquer un
// déploiement.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://politiscope.app";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(WEB, "dist");

const FAMILLES = {
  majorite: "Majorité présidentielle",
  "droite-rep": "Droite républicaine",
  "extreme-droite": "Droite radicale / souverainiste",
  "gauche-radicale": "Gauche radicale",
  "gauche-social": "Gauche social-démocrate / écologiste",
};

// ---------- configuration Supabase ----------------------------------------
async function loadEnv() {
  const env = { ...process.env };
  const file = path.join(WEB, ".env.production");
  if (existsSync(file)) {
    for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2];
    }
  }
  return env;
}

async function fetchAll(base, key, table, query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${base}/rest/v1/${table}?${query}`, {
      headers: { apikey: key, Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// ---------- HTML ----------------------------------------------------------
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const truncate = (s, n) => {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
};

/** Remplace le contenu d'une balise <meta> existante du gabarit. */
function setMeta(html, attr, name, content) {
  const re = new RegExp(`(<meta\\s+${attr}="${name}"\\s+content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`balise ${name} absente du gabarit`);
  return html.replace(re, (_, a, b) => a + esc(content) + b);
}

function render(template, { title, description, url, body }) {
  let html = template;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = setMeta(html, "name", "description", description);
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "property", "og:description", description);
  html = setMeta(html, "property", "og:url", url);
  html = setMeta(html, "name", "twitter:title", title);
  html = setMeta(html, "name", "twitter:description", description);
  html = html.replace("</head>", `    <link rel="canonical" href="${esc(url)}" />\n  </head>`);
  if (body !== undefined) {
    if (!html.includes('<div id="root"></div>')) throw new Error("#root vide absent du gabarit");
    html = html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  }
  return html;
}

const personUrl = (id) => `${SITE}/p/${id}`;
const citationUrl = (id) => `${SITE}/c/${id}`;

function citationBlock(e) {
  return `<section>
  <blockquote><p>${esc(e.citation)}</p></blockquote>
  <p>${esc(e.date_texte)} · ${esc(e.theme)} · <a href="${esc(e.source)}" rel="noopener nofollow">Source</a> · <a href="/c/${e.id}">Lien vers cette citation</a></p>
</section>`;
}

function personBody(f, entries) {
  return `<div class="wrap">
<header class="masthead">
  <p class="eyebrow"><a href="/" class="doc-back">← Politiscope</a></p>
  <h1 class="title">${esc(f.nom)}</h1>
  <p class="dek">${esc(f.parti)} · ${esc(FAMILLES[f.famille] ?? "")} · ${entries.length} citation${entries.length > 1 ? "s" : ""}</p>
</header>
<article class="doc-page">
${entries.map(citationBlock).join("\n")}
</article>
</div>`;
}

function citationBody(e, figureId) {
  const profile = figureId ? `<a href="/p/${figureId}">Toutes les citations de ${esc(e.nom)}</a> · ` : "";
  return `<div class="wrap">
<header class="masthead">
  <p class="eyebrow"><a href="/" class="doc-back">← Politiscope</a></p>
  <h1 class="title">${esc(e.nom)}</h1>
  <p class="dek">${esc(e.parti)}</p>
</header>
<article class="doc-page">
${citationBlock(e)}
<p>${profile}<a href="/methodologie">Méthodologie</a></p>
</article>
</div>`;
}

function homeBody(figures) {
  return `<div class="wrap">
<header class="masthead"><h1 class="title">Politiscope</h1></header>
<nav class="doc-page"><ul>
${figures.map((f) => `<li><a href="/p/${f.id}">${esc(f.nom)}</a> — ${esc(f.parti)}</li>`).join("\n")}
</ul></nav>
</div>`;
}

async function write(rel, html) {
  const file = path.join(DIST, rel, "index.html");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
}

// ---------- main ----------------------------------------------------------
async function main() {
  const template = await readFile(path.join(DIST, "index.html"), "utf8");
  const env = await loadEnv();
  const base = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY absents");

  const entries = await fetchAll(
    base,
    key,
    "entries",
    "select=id,nom,parti,famille,handle,theme,citation,date_texte,date_tri,source&publie=eq.true&order=date_tri.desc.nullslast,id.desc"
  );
  if (entries.length === 0) throw new Error("aucune entrée publiée : pages non générées");

  // Regroupement par personnalité, comme figureKeyOf (src/types.ts).
  const figures = new Map();
  for (const e of entries) {
    const id = e.handle ?? e.nom;
    if (!figures.has(id)) figures.set(id, { id, nom: e.nom, parti: e.parti, famille: e.famille, entries: [] });
    figures.get(id).entries.push(e);
  }
  // Un identifiant qui demanderait un encodage d'URL n'est pas pré-généré :
  // la SPA continue de le servir.
  const safe = (id) => /^[A-Za-z0-9_-]+$/.test(id);

  const urls = [{ loc: SITE + "/" }, { loc: SITE + "/methodologie" }];
  let nPeople = 0;
  let nCitations = 0;
  const idOfEntry = new Map();

  for (const f of figures.values()) {
    if (!safe(f.id)) continue;
    const last = f.entries[0];
    await write(
      `p/${f.id}`,
      render(template, {
        title: `${f.nom} — citations et prises de position | Politiscope`,
        description: truncate(
          `${f.entries.length} citation${f.entries.length > 1 ? "s" : ""} sourcée${f.entries.length > 1 ? "s" : ""} de ${f.nom} (${f.parti}). Dernière : ${last.date_texte} — « ${last.citation} »`,
          160
        ),
        url: personUrl(f.id),
        body: personBody(f, f.entries),
      })
    );
    urls.push({ loc: personUrl(f.id), lastmod: last.date_tri });
    nPeople++;
    for (const e of f.entries) idOfEntry.set(e.id, f.id);
  }

  for (const e of entries) {
    const fid = idOfEntry.get(e.id);
    await write(
      `c/${e.id}`,
      render(template, {
        title: `« ${truncate(e.citation, 80)} » — ${e.nom} | Politiscope`,
        description: truncate(`${e.nom}, ${e.date_texte} : « ${e.citation} » Thème : ${e.theme}. Source citée.`, 160),
        url: citationUrl(e.id),
        body: citationBody(e, fid),
      })
    );
    urls.push({ loc: citationUrl(e.id), lastmod: e.date_tri });
    nCitations++;
  }

  // Accueil : même page, avec la liste des personnalités en liens pour que les
  // robots découvrent les fiches sans exécuter de JavaScript.
  const home = render(template, {
    title: "Politiscope — baromètre politique",
    description: "Citations des personnalités politiques françaises, en bulles et en carte des sujets. Chaque citation est sourcée.",
    url: SITE + "/",
    body: homeBody([...figures.values()].filter((f) => safe(f.id))),
  });
  await writeFile(path.join(DIST, "index.html"), home, "utf8");

  await write(
    "methodologie",
    render(template, {
      title: "Méthodologie et à propos — Politiscope",
      description:
        "Comment Politiscope choisit, vérifie et classe les citations des responsables politiques français — et ce que le baromètre ne mesure pas.",
      url: SITE + "/methodologie",
    })
  );

  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`)
      .join("\n") +
    `\n</urlset>\n`;
  await writeFile(path.join(DIST, "sitemap.xml"), sitemap, "utf8");

  console.log(`prerender : ${nPeople} fiches, ${nCitations} citations, sitemap de ${urls.length} URL`);
}

main().catch((err) => {
  console.warn(`prerender IGNORÉ — le site reste une SPA classique : ${err.message}`);
});
