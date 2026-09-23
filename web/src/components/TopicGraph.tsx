import { drag } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { scaleSqrt } from "d3-scale";
import { select } from "d3-selection";
import { useEffect, useMemo, useRef, useState } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { initials } from "../hooks/usePolitiscope";
import { FAMILLES, familleOf, figureKeyOf, type Entry, type FamilleId, type Topic } from "../types";

type Mode = "pol" | "parti" | "matrice";

interface GNode extends SimulationNodeDatum {
  id: string;
  type: "topic" | "sec";
  label: string;
  fullName: string;
  r: number;
  count?: number;
  famille?: Entry["famille"];
  /** Nœud « sec » seulement : citation la plus récente — pour onSelect au clic. */
  ref?: Entry;
  /** Toutes les citations regroupées sous ce nœud (une personne ou un parti). */
  members?: Entry[];
}

interface GLink extends SimulationLinkDatum<GNode> {
  ref: Entry;
  /** Nombre de citations derrière ce lien (personne/parti, sujet) — épaissit le trait. */
  count: number;
}

interface Props {
  entries: Entry[];
  topics: Topic[];
  onSelect: (e: Entry) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  /** Pour la vue Matrice, qui respecte famille + recherche comme le reste de la page. */
  familles: Record<FamilleId, boolean>;
  search: string;
}

/** En dessous, le graphe de force devient inutilisable au doigt : repli en liste. */
const COMPACT_BREAKPOINT = 600;
/** Marge de la détection de collision au-delà du rayon visuel de chaque nœud. */
const COLLIDE_PADDING = 3;

// --- repli liste / lecteur d'écran -----------------------------------------

interface TopicGroupItem {
  key: string;
  label: string;
  entry?: Entry;
}

interface TopicGroup {
  theme: string;
  shortLabel: string;
  items: TopicGroupItem[];
}

/**
 * Sujet -> personnalités (ou partis) qui en parlent, dédupliqué. Sert à la
 * fois de repli visuel sous 600px et de liste accessible aux lecteurs
 * d'écran pour la version graphe — un seul calcul pour les deux usages.
 */
function buildTopicGroups(entries: Entry[], topics: Topic[], mode: Mode): TopicGroup[] {
  const shortOf = new Map(topics.map((t) => [t.theme, t.libelle_court]));
  const byTheme = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = byTheme.get(e.theme);
    if (list) list.push(e);
    else byTheme.set(e.theme, [e]);
  }

  const groups: TopicGroup[] = [];
  for (const [themeName, list] of byTheme) {
    const items: TopicGroupItem[] = [];
    if (mode === "parti") {
      const seen = new Set<string>();
      for (const e of list) {
        const code = e.code_parti ?? e.parti;
        if (seen.has(code)) continue;
        seen.add(code);
        items.push({ key: code, label: code });
      }
    } else {
      const byPerson = new Map<string, Entry>();
      for (const e of list) {
        const key = figureKeyOf(e);
        const prev = byPerson.get(key);
        if (!prev || (e.date_tri ?? "") > (prev.date_tri ?? "")) byPerson.set(key, e);
      }
      for (const [key, e] of byPerson) items.push({ key, label: e.nom, entry: e });
    }
    items.sort((a, b) => a.label.localeCompare(b.label, "fr"));
    groups.push({ theme: themeName, shortLabel: shortOf.get(themeName) ?? themeName, items });
  }

  groups.sort((a, b) => b.items.length - a.items.length || a.shortLabel.localeCompare(b.shortLabel, "fr"));
  return groups;
}

interface TopicListProps {
  groups: TopicGroup[];
  theme: string;
  noun: string;
  onThemeChange: (theme: string) => void;
  onSelect: (e: Entry) => void;
  visuallyHidden?: boolean;
}

/**
 * Rendu textuel du graphe : sujet -> personnalités. Utilisé visible en repli
 * compact (< 600px, voir COMPACT_BREAKPOINT) et visuellement masqué comme
 * alternative accessible à côté du graphe SVG (voir aria-hidden plus bas —
 * un graphe de force n'est de toute façon pas opérable au clavier).
 */
function TopicList({ groups, theme, noun, onThemeChange, onSelect, visuallyHidden }: TopicListProps) {
  return (
    <ul
      className={visuallyHidden ? "topic-list sr-only" : "topic-list"}
      aria-label={`Sujets et ${noun}s qui en parlent`}
    >
      {groups.map((g) => (
        <li key={g.theme} className="topic-list-group">
          <button
            type="button"
            className="topic-list-theme"
            aria-pressed={g.theme === theme}
            onClick={() => onThemeChange(g.theme)}
          >
            {g.shortLabel} <span className="topic-list-count">{g.items.length}</span>
          </button>
          <ul className="topic-list-members">
            {g.items.map((item) => (
              <li key={item.key}>
                {item.entry ? (
                  <button type="button" onClick={() => onSelect(item.entry!)}>
                    {item.label}
                  </button>
                ) : (
                  item.label
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// --- vue Matrice -------------------------------------------------------------

interface MatrixCell {
  count: number;
  latest: Entry;
}

interface MatrixRow {
  key: string;
  nom: string;
  famille: FamilleId;
  /** Citation la plus récente de cette personne, tous sujets confondus — pour le nom cliquable. */
  latest: Entry;
  cells: Map<string, MatrixCell>;
  total: number;
}

function buildMatrix(entries: Entry[]): { rows: MatrixRow[]; colTotals: Map<string, number>; grandTotal: number } {
  const byPerson = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = figureKeyOf(e);
    const list = byPerson.get(key);
    if (list) list.push(e);
    else byPerson.set(key, [e]);
  }

  const newer = (a: Entry, b: Entry) => (b.date_tri ?? "").localeCompare(a.date_tri ?? "") || b.id - a.id;
  const famIndex = new Map(FAMILLES.map((f, i) => [f.id, i]));

  const rows: MatrixRow[] = [];
  for (const [key, list] of byPerson) {
    const latest = [...list].sort(newer)[0];
    const cells = new Map<string, MatrixCell>();
    for (const e of list) {
      const c = cells.get(e.theme);
      if (c) {
        c.count += 1;
        if (newer(e, c.latest) < 0) c.latest = e;
      } else {
        cells.set(e.theme, { count: 1, latest: e });
      }
    }
    rows.push({ key, nom: latest.nom, famille: latest.famille, latest, cells, total: list.length });
  }

  rows.sort(
    (a, b) => (famIndex.get(a.famille) ?? 0) - (famIndex.get(b.famille) ?? 0) || a.nom.localeCompare(b.nom, "fr")
  );

  const colTotals = new Map<string, number>();
  let grandTotal = 0;
  for (const row of rows) {
    for (const [th, cell] of row.cells) {
      colTotals.set(th, (colTotals.get(th) ?? 0) + cell.count);
      grandTotal += cell.count;
    }
  }

  return { rows, colTotals, grandTotal };
}

interface MatrixViewProps {
  entries: Entry[];
  topics: Topic[];
  theme: string;
  onThemeChange: (theme: string) => void;
  onSelect: (e: Entry) => void;
}

/**
 * Personnalités x sujets, en grille HTML — pas de simulation de force ici,
 * juste un tableau : une bulle vaut mieux qu'un graphe de force pour comparer
 * tout le monde d'un coup d'œil. Scroll horizontal propre à son conteneur
 * sous mobile, colonne des noms fixée (voir index.css .matrix-*).
 */
function MatrixView({ entries, topics, theme, onThemeChange, onSelect }: MatrixViewProps) {
  const { rows, colTotals, grandTotal } = useMemo(() => buildMatrix(entries), [entries]);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        Aucune personnalité ne correspond à ces filtres. Élargissez les filtres ou cliquez sur
        Réinitialiser.
      </div>
    );
  }

  let maxCell = 1;
  for (const row of rows) for (const c of row.cells.values()) if (c.count > maxCell) maxCell = c.count;
  const cellSize = scaleSqrt().domain([0, maxCell]).range([6, 32]);

  return (
    <div className="matrix-scroll">
      <table className="matrix-table">
        <thead>
          <tr>
            <th className="matrix-name-col" scope="col">
              Personnalité
            </th>
            {topics.map((t) => (
              <th key={t.theme} scope="col">
                <button
                  type="button"
                  className="matrix-col-btn"
                  aria-pressed={t.theme === theme}
                  onClick={() => onThemeChange(t.theme)}
                  title={t.theme}
                >
                  {t.libelle_court}
                </button>
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const fam = familleOf(row.famille);
            return (
              <tr key={row.key}>
                <th className="matrix-name-col" scope="row">
                  <button type="button" className="matrix-name-btn" onClick={() => onSelect(row.latest)}>
                    <span className="dot" style={{ background: fam.color }} />
                    {row.nom}
                  </button>
                </th>
                {topics.map((t) => {
                  const cell = row.cells.get(t.theme);
                  const size = cell ? cellSize(cell.count) : 0;
                  return (
                    <td key={t.theme} className="matrix-cell">
                      {cell && (
                        <button
                          type="button"
                          className="matrix-dot"
                          style={{ width: size, height: size, background: fam.color }}
                          title={`${row.nom} · ${t.libelle_court} · ${cell.count} citation${cell.count > 1 ? "s" : ""}`}
                          onClick={() => onSelect(cell.latest)}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="matrix-total">{row.total}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th className="matrix-name-col" scope="row">
              Total
            </th>
            {topics.map((t) => (
              <td key={t.theme} className="matrix-total">
                {colTotals.get(t.theme) || ""}
              </td>
            ))}
            <td className="matrix-total">{grandTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// --- graphe de force ---------------------------------------------------------

export function TopicGraph({ entries, topics, onSelect, theme, onThemeChange, familles, search }: Props) {
  const [mode, setMode] = useState<Mode>("pol");
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Anti-rebond : un redimensionnement continu ne doit pas relancer la
  // simulation à chaque frame (voir useContainerSize).
  const { width, height } = useContainerSize(containerRef, 150);
  const compact = width != null && width < COMPACT_BREAKPOINT;

  // Le graphe de force suit uniquement le filtre Thème (comportement
  // existant, affiché dans section-sub) ; `entries` reçu ici est donc la
  // totalité, filtrée ici même pour ce seul usage.
  const graphEntries = useMemo(
    () => (theme === "all" ? entries : entries.filter((e) => e.theme === theme)),
    [entries, theme]
  );
  const groups = useMemo(() => buildTopicGroups(graphEntries, topics, mode), [graphEntries, topics, mode]);

  // La Matrice, elle, respecte famille + recherche comme le reste de la
  // page (mais pas le thème : comparer tous les sujets à la fois est son
  // intérêt même).
  const matrixEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!familles[e.famille]) return false;
      if (!q) return true;
      const hay = `${e.nom} ${e.parti} ${e.citation} ${e.theme}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, familles, search]);

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    const tip = tipRef.current;
    if (mode === "matrice" || compact) return;
    if (!container || !svgEl || !tip || !width || !height || graphEntries.length === 0) return;

    const shortOf = new Map(topics.map((t) => [t.theme, t.libelle_court]));
    const svg = select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // --- construction : un nœud par personne (ou parti), un lien par (elle, sujet) ---
    const idFor = (d: Entry): string => (mode === "parti" ? `sec:${d.code_parti ?? d.parti}` : `sec:pol:${figureKeyOf(d)}`);

    const secondaryOf = new Map<string, Entry[]>();
    for (const d of graphEntries) {
      const id = idFor(d);
      const list = secondaryOf.get(id);
      if (list) list.push(d);
      else secondaryOf.set(id, [d]);
    }

    let secondary: GNode[];
    let labelMaxLen: number;

    if (mode === "parti") {
      secondary = [...secondaryOf].map(([id, members]) => {
        const code = members[0].code_parti ?? members[0].parti;
        return {
          id,
          type: "sec" as const,
          label: code,
          fullName: code,
          r: 16 + members.length * 6,
          famille: members[0].famille,
          members,
          count: members.length,
        };
      });
      labelMaxLen = 15;
    } else {
      // Rayon personne = racine du nombre total de ses citations : l'aire
      // reste proportionnelle au compte, comme pour les bulles-sujet.
      const maxPersonQuotes = Math.max(1, ...[...secondaryOf.values()].map((m) => m.length));
      const personRadius = scaleSqrt().domain([0, maxPersonQuotes]).range([12, 24]);
      secondary = [...secondaryOf].map(([id, members]) => {
        const latest = [...members].sort(
          (a, b) => (b.date_tri ?? "").localeCompare(a.date_tri ?? "") || b.id - a.id
        )[0];
        return {
          id,
          type: "sec" as const,
          label: initials(latest.nom),
          fullName: latest.nom,
          r: personRadius(members.length),
          famille: latest.famille,
          ref: latest,
          members,
          count: members.length,
        };
      });
      labelMaxLen = 4;
    }

    // Un lien par (nœud secondaire, sujet), pas par citation : le compte
    // épaissit le trait plutôt que de dupliquer des arêtes qui, en mode
    // « pol », faisaient aussi réapparaître le même nœud une fois par
    // citation (le bug corrigé ici).
    const linksBy = new Map<string, GLink>();
    for (const d of graphEntries) {
      const target = idFor(d);
      const source = `topic:${d.theme}`;
      const key = `${source}->${target}`;
      const existing = linksBy.get(key);
      if (existing) existing.count += 1;
      else linksBy.set(key, { source, target, ref: d, count: 1 } as unknown as GLink);
    }
    const links = [...linksBy.values()];

    // Compte de citations total par sujet (pas dédupliqué — pour le tooltip
    // "M citations", distinct du nombre de personnalités N).
    const topicQuoteTotal = new Map<string, number>();
    for (const d of graphEntries) {
      const tid = `topic:${d.theme}`;
      topicQuoteTotal.set(tid, (topicQuoteTotal.get(tid) ?? 0) + 1);
    }

    // Degré = nombre de personnes/partis distincts par sujet, directement
    // exact maintenant que les liens sont dédupliqués par (cible, sujet) —
    // c'est ce que la légende appelle "nombre de personnalités".
    const degree = new Map<string, Set<string>>();
    for (const l of links) {
      const s = l.source as unknown as string;
      const t = l.target as unknown as string;
      if (!degree.has(s)) degree.set(s, new Set());
      degree.get(s)!.add(t);
    }

    const maxEntityCount = Math.max(1, ...[...degree.values()].map((s) => s.size));
    const topicRadius = scaleSqrt().domain([0, maxEntityCount]).range([18, 56]);

    const topicNodes: GNode[] = [...degree].map(([tid, targets]) => {
      const themeId = tid.replace("topic:", "");
      return {
        id: tid,
        type: "topic",
        label: shortOf.get(themeId) ?? themeId,
        fullName: themeId,
        count: targets.size,
        r: topicRadius(targets.size),
      };
    });

    const nodes = [...topicNodes, ...secondary];

    const simulation = forceSimulation<GNode>(nodes)
      .force(
        "link",
        forceLink<GNode, GLink>(links)
          .id((d) => d.id)
          .distance((l) => 58 + ((l.target as GNode).r ?? 15))
          .strength(0.6)
      )
      .force("charge", forceManyBody().strength(-170))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<GNode>().radius((d) => d.r + COLLIDE_PADDING));

    const linkSel = svg
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", "graph-link")
      .attr("stroke-width", (d) => Math.min(1 + 0.8 * d.count, 6))
      .attr("stroke", (d) => familleOf(d.ref.famille).color);

    let dragDistance = 0;
    let lastPointerType = "mouse";
    let pinnedId: string | null = null;

    const nodeSel = svg
      .append("g")
      .selectAll<SVGGElement, GNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", (d) => {
        const base = `graph-node ${d.type === "topic" ? "graph-node-topic" : "graph-node-pol"}`;
        return d.type === "topic" && d.fullName === theme ? `${base} is-selected` : base;
      })
      .style("cursor", (d) => (d.type === "topic" || (d.type === "sec" && mode === "pol") ? "pointer" : "grab"))
      .call(
        drag<SVGGElement, GNode>()
          .on("start", (event, d) => {
            dragDistance = 0;
            if (!event.active) simulation.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            dragDistance += Math.abs(event.dx) + Math.abs(event.dy);
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    nodeSel
      .append("circle")
      .attr("r", (d) => d.r)
      .style("stroke", (d) => (d.type !== "sec" ? null : familleOf(d.famille!).color))
      .style("fill", (d) => (d.type !== "sec" ? null : "var(--surface-raised)"));

    nodeSel
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.32em")
      .style("font-size", (d) => (d.type === "topic" ? "11px" : mode === "parti" ? "10px" : "10.5px"))
      .style("pointer-events", "none")
      .text((d) => d.label);

    // --- contenu des infobulles ---------------------------------------------
    const personTip = (d: GNode): string => {
      const fam = familleOf(d.famille!);
      const byTheme = new Map<string, number>();
      for (const m of d.members!) byTheme.set(m.theme, (byTheme.get(m.theme) ?? 0) + 1);
      const breakdown = [...byTheme].map(([th, n]) => `${shortOf.get(th) ?? th} ${n}`).join(" · ");
      return (
        `<strong>${d.fullName}</strong>${fam.label}<br>` +
        `${d.members!.length} citation${d.members!.length > 1 ? "s" : ""}<br>` +
        `<span style="opacity:.65">${breakdown}</span>`
      );
    };
    const partyTip = (d: GNode): string => {
      const th = [...new Set(d.members!.map((m) => shortOf.get(m.theme) ?? m.theme))];
      return `<strong>${d.fullName}</strong>${d.members!.length} citation${d.members!.length > 1 ? "s" : ""} · ${th.join(", ")}`;
    };
    const topicTip = (d: GNode): string => {
      const noun = mode === "parti" ? "parti" : "personnalité";
      const total = topicQuoteTotal.get(d.id) ?? 0;
      return (
        `<strong>${d.label}</strong>${d.count} ${noun}${d.count! > 1 ? "s" : ""}<br>` +
        `${total} citation${total > 1 ? "s" : ""}`
      );
    };
    const tipFor = (d: GNode): string =>
      d.type === "topic" ? topicTip(d) : mode === "parti" ? partyTip(d) : personTip(d);

    // --- interactions ------------------------------------------------------
    const positionTip = (x: number, y: number) => {
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    const showTip = (html: string, x: number, y: number) => {
      tip.innerHTML = html;
      tip.hidden = false;
      positionTip(x, y);
    };
    const hideTip = () => {
      tip.hidden = true;
    };

    // Met en évidence un nœud, ses liens, et les sujets/personnes à l'autre
    // bout de ceux-ci ; estompe le reste. Chaque personne (ou parti) n'étant
    // plus qu'un seul nœud, un seul id suffit désormais — plus besoin de
    // regrouper plusieurs nœuds par personne comme quand chaque citation en
    // créait un.
    const highlightFrom = (id: string) => {
      const connected = new Set([id]);
      for (const l of links) {
        const s = (l.source as GNode).id;
        const t = (l.target as GNode).id;
        if (s === id) connected.add(t);
        if (t === id) connected.add(s);
      }
      nodeSel.classed("is-dim", (n) => !connected.has(n.id));
      linkSel.classed("is-dim", (l) => {
        const s = (l.source as GNode).id;
        const t = (l.target as GNode).id;
        return s !== id && t !== id;
      });
    };
    const clearHighlight = () => {
      nodeSel.classed("is-dim", false);
      linkSel.classed("is-dim", false);
    };

    nodeSel
      .on("pointerdown", (event: PointerEvent) => {
        lastPointerType = event.pointerType;
      })
      .on("mouseenter", (event: MouseEvent, d) => {
        if (lastPointerType === "touch") return; // le tap gère déjà son propre survol
        const rect = container.getBoundingClientRect();
        showTip(tipFor(d), event.clientX - rect.left, event.clientY - rect.top);
        highlightFrom(d.id);
      })
      .on("mousemove", (event: MouseEvent) => {
        if (lastPointerType === "touch") return;
        const rect = container.getBoundingClientRect();
        positionTip(event.clientX - rect.left, event.clientY - rect.top);
      })
      .on("mouseleave", () => {
        if (lastPointerType === "touch") return;
        hideTip();
        if (!pinnedId) clearHighlight();
      })
      .on("click", (_event, d) => {
        if (dragDistance > 4) return;
        if (d.type === "topic") {
          onThemeChange(d.fullName);
          return;
        }
        if (d.type !== "sec") return;
        const canOpen = mode === "pol";

        if (lastPointerType !== "touch") {
          if (canOpen) onSelect(d.ref!);
          return;
        }

        // Tactile, pas de survol : un premier tap met en évidence (comme le
        // survol côté souris) ; un second tap sur le même nœud confirme
        // (ouvre sa fiche, si ouvrable).
        if (pinnedId === d.id) {
          pinnedId = null;
          hideTip();
          clearHighlight();
          if (canOpen) onSelect(d.ref!);
          return;
        }
        pinnedId = d.id;
        highlightFrom(d.id);
        showTip(tipFor(d), d.x ?? width / 2, (d.y ?? height / 2) - d.r - 10);
      });

    // Tap/clic sur le fond du graphe (pas sur un nœud) : efface l'épinglage.
    svg.on("click", (event: MouseEvent) => {
      if (event.target !== svgEl) return;
      pinnedId = null;
      hideTip();
      clearHighlight();
    });

    // --- placement, avec bornes de sécurité ---------------------------------
    // Chaque nœud reste dans [r, largeur - r] / [r, hauteur - r] — la marge
    // d'un sujet ou d'un libellé de parti est élargie pour laisser la place
    // au texte, mais jamais au-delà de la moitié du conteneur (sinon, sur un
    // conteneur étroit avec une grosse bulle, la marge se retournerait et le
    // nœud "collerait" au bord au lieu d'être contenu par lui).
    const xMarginFor = (d: GNode): number => {
      const base = d.type === "topic" ? Math.max(d.r, 60) : mode === "parti" ? Math.max(d.r, labelMaxLen * 4 + 8) : d.r;
      return Math.min(base, width / 2 - 2);
    };
    const yMarginFor = (d: GNode): number => Math.min(d.r, height / 2 - 2);

    simulation.on("tick", () => {
      for (const d of nodes) {
        const mx = xMarginFor(d);
        const my = yMarginFor(d);
        d.x = Math.max(mx, Math.min(width - mx, d.x ?? width / 2));
        d.y = Math.max(my, Math.min(height - my, d.y ?? height / 2));
      }
      linkSel
        .attr("x1", (d) => (d.source as GNode).x!)
        .attr("y1", (d) => (d.source as GNode).y!)
        .attr("x2", (d) => (d.target as GNode).x!)
        .attr("y2", (d) => (d.target as GNode).y!);
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
      svg.selectAll("*").remove();
    };
    // `width`/`height` sont debounced par useContainerSize : un redimensionnement
    // relance donc entièrement la mise en page, sans la reconstruire à chaque frame.
  }, [graphEntries, topics, mode, onSelect, theme, onThemeChange, compact, width, height]);

  const noun = mode === "parti" ? "parti" : "personnalité";
  const legend =
    mode === "parti"
      ? ["taille = nombre de partis qui en parlent", "anneau et lien = famille politique", "Parti"]
      : ["taille = nombre de personnalités qui en parlent", "anneau et lien = famille politique", "Personnalité"];

  const subtitle =
    mode === "matrice"
      ? "Chaque bulle croise une personnalité et un sujet ; sa taille est le nombre de citations. Cliquez un nom pour ouvrir sa fiche, un sujet pour filtrer toute la page."
      : compact
        ? "Touchez un sujet pour filtrer toute la page, un nom pour ouvrir sa fiche."
        : "Glissez un nœud, survolez (ou touchez) pour voir les liens. Suit uniquement le filtre" +
          " Thème ci-dessus : cliquez un sujet pour filtrer toute la page, recliquez pour tout" +
          " réafficher.";

  const containerClass =
    mode === "matrice" ? "graph-container is-matrix" : compact ? "graph-container is-compact" : "graph-container";

  return (
    <section className="topic-graph-section" aria-label="Carte des sujets">
      <div className="section-head">
        <div className="section-head-top">
          <div>
            <h2 className="section-title">Carte des sujets</h2>
            <p className="section-sub">Les grands sujets de la rentrée, reliés à ceux qui les portent. {subtitle}</p>
          </div>
          <div className="graph-toggle" role="tablist" aria-label="Niveau du graphe">
            {(["pol", "parti", "matrice"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                className="toggle-btn"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "pol" ? "Personnalités" : m === "parti" ? "Partis" : "Matrice"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={containerClass} ref={containerRef}>
        {mode === "matrice" ? (
          <MatrixView entries={matrixEntries} topics={topics} theme={theme} onThemeChange={onThemeChange} onSelect={onSelect} />
        ) : compact ? (
          <TopicList groups={groups} theme={theme} noun={noun} onThemeChange={onThemeChange} onSelect={onSelect} />
        ) : (
          <>
            {/* Décoratif : un graphe de force glissé/survolé n'est pas opérable au
                clavier ou au lecteur d'écran — la liste ci-dessous, masquée
                visuellement, porte la même information de façon utilisable. */}
            <svg className="graph-svg" ref={svgRef} aria-hidden="true" />
            <div className="graph-tooltip" ref={tipRef} hidden />
          </>
        )}
      </div>

      {mode !== "matrice" && !compact && (
        <TopicList
          groups={groups}
          theme={theme}
          noun={noun}
          onThemeChange={onThemeChange}
          onSelect={onSelect}
          visuallyHidden
        />
      )}

      <div className="graph-legend">
        {mode === "matrice" ? (
          <>
            <span className="legend-item">
              <span className="node-swatch pol" />
              Bulle <span style={{ opacity: 0.65 }}>— taille = nombre de citations</span>
            </span>
            <span className="legend-item">
              <span className="node-swatch pol" />
              Couleur <span style={{ opacity: 0.65 }}>— famille politique</span>
            </span>
          </>
        ) : (
          <>
            <span className="legend-item">
              <span className="node-swatch topic" />
              Sujet <span style={{ opacity: 0.65 }}>— {legend[0]}</span>
            </span>
            <span className="legend-item">
              <span className="node-swatch pol" />
              {legend[2]} <span style={{ opacity: 0.65 }}>— {legend[1]}</span>
            </span>
          </>
        )}
      </div>
    </section>
  );
}
