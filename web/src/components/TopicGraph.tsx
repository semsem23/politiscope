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
import { familleOf, figureKeyOf, type Entry, type Topic } from "../types";

type Mode = "pol" | "parti";

interface GNode extends SimulationNodeDatum {
  id: string;
  type: "topic" | "sec";
  label: string;
  fullName: string;
  r: number;
  count?: number;
  famille?: Entry["famille"];
  ref?: Entry;
  members?: Entry[];
}

interface GLink extends SimulationLinkDatum<GNode> {
  ref: Entry;
}

interface Props {
  entries: Entry[];
  topics: Topic[];
  onSelect: (e: Entry) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
}

/** En dessous, le graphe de force devient inutilisable au doigt : repli en liste. */
const COMPACT_BREAKPOINT = 600;
const COLLIDE_PADDING = 6;

/**
 * Clé de regroupement d'un nœud secondaire à travers les sujets : en mode
 * « pol », plusieurs citations de la même personne sous des sujets
 * différents sont des nœuds distincts (un par citation) — cette clé les
 * relie pour le survol/tap groupé. En mode « parti », chaque parti n'a déjà
 * qu'un seul nœud : la clé est simplement son id.
 */
function personKeyOf(n: GNode, mode: Mode): string {
  if (n.type === "sec" && mode === "pol" && n.ref) return `p:${figureKeyOf(n.ref)}`;
  return n.id;
}

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
    if (mode === "pol") {
      const byPerson = new Map<string, Entry>();
      for (const e of list) {
        const key = figureKeyOf(e);
        const prev = byPerson.get(key);
        if (!prev || (e.date_tri ?? "") > (prev.date_tri ?? "")) byPerson.set(key, e);
      }
      for (const [key, e] of byPerson) items.push({ key, label: e.nom, entry: e });
    } else {
      const seen = new Set<string>();
      for (const e of list) {
        const code = e.code_parti ?? e.parti;
        if (seen.has(code)) continue;
        seen.add(code);
        items.push({ key: code, label: code });
      }
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
 * alternative accessible à côté du graphe SVG (voir role="img" retiré plus
 * bas — un graphe de force n'est de toute façon pas opérable au clavier).
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

export function TopicGraph({ entries, topics, onSelect, theme, onThemeChange }: Props) {
  const [mode, setMode] = useState<Mode>("pol");
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Anti-rebond : un redimensionnement continu ne doit pas relancer la
  // simulation à chaque frame (voir useContainerSize).
  const { width, height } = useContainerSize(containerRef, 150);
  const compact = width != null && width < COMPACT_BREAKPOINT;

  const groups = useMemo(() => buildTopicGroups(entries, topics, mode), [entries, topics, mode]);

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    const tip = tipRef.current;
    if (compact || !container || !svgEl || !tip || !width || !height || entries.length === 0) return;

    const shortOf = new Map(topics.map((t) => [t.theme, t.libelle_court]));
    const svg = select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // --- construction des nœuds selon le niveau choisi ---------------------
    let secondary: GNode[];
    let links: GLink[];
    let labelMaxLen: number;

    if (mode === "parti") {
      const famOf = new Map<string, Entry["famille"]>();
      const membersOf = new Map<string, Entry[]>();
      for (const d of entries) {
        const code = d.code_parti ?? d.parti;
        famOf.set(code, d.famille);
        const list = membersOf.get(code);
        if (list) list.push(d);
        else membersOf.set(code, [d]);
      }
      secondary = [...membersOf].map(([code, members]) => ({
        id: `sec:${code}`,
        type: "sec" as const,
        label: code,
        fullName: code,
        r: 16 + members.length * 6,
        famille: famOf.get(code),
        members,
      }));
      links = entries.map((d) => ({
        source: `topic:${d.theme}`,
        target: `sec:${d.code_parti ?? d.parti}`,
        ref: d,
      })) as unknown as GLink[];
      labelMaxLen = 15;
    } else {
      secondary = entries.map((d) => ({
        id: `sec:pol:${d.id}`,
        type: "sec" as const,
        label: initials(d.nom),
        fullName: d.nom,
        r: 15,
        famille: d.famille,
        ref: d,
      }));
      links = entries.map((d) => ({
        source: `topic:${d.theme}`,
        target: `sec:pol:${d.id}`,
        ref: d,
      })) as unknown as GLink[];
      labelMaxLen = 4;
    }

    const degree = new Map<string, Set<string>>();
    for (const l of links) {
      const s = l.source as unknown as string;
      const t = l.target as unknown as string;
      if (!degree.has(s)) degree.set(s, new Set());
      degree.get(s)!.add(t);
    }

    // Nombre de personnalités (ou de partis) distincts par sujet — pas le
    // nombre de citations : en mode « pol », une même personne peut avoir
    // plusieurs citations sous un même sujet (plusieurs nœuds), et la taille
    // de la bulle doit rester "qui en parle", pas "combien de fois".
    const topicEntityCount = new Map<string, number>();
    if (mode === "pol") {
      const byTopic = new Map<string, Set<string>>();
      for (const e of entries) {
        const tid = `topic:${e.theme}`;
        if (!byTopic.has(tid)) byTopic.set(tid, new Set());
        byTopic.get(tid)!.add(figureKeyOf(e));
      }
      for (const [tid, set] of byTopic) topicEntityCount.set(tid, set.size);
    } else {
      for (const [tid, targets] of degree) topicEntityCount.set(tid, targets.size);
    }

    // Rayon des bulles-sujet proportionnel à la racine du compte : l'aire,
    // donc la lecture visuelle, reste proportionnelle au nombre de
    // personnalités (la légende l'annonce). Plage bornée : un sujet très
    // suivi ne doit pas produire une bulle plus grande que le conteneur.
    const maxEntityCount = Math.max(1, ...topicEntityCount.values());
    const topicRadius = scaleSqrt().domain([0, maxEntityCount]).range([18, 56]);

    const topicNodes: GNode[] = [...degree].map(([tid, targets]) => {
      const themeId = tid.replace("topic:", "");
      const count = topicEntityCount.get(tid) ?? targets.size;
      return {
        id: tid,
        type: "topic",
        label: shortOf.get(themeId) ?? themeId,
        fullName: themeId,
        count,
        r: topicRadius(count),
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
      .attr("stroke-width", 1.6)
      .attr("stroke", (d) => familleOf(d.ref.famille).color);

    let dragDistance = 0;
    let lastPointerType = "mouse";
    let pinnedKey: string | null = null;

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

    // Un ensemble de nœuds "source" (un seul en survol, potentiellement
    // plusieurs pour un tap groupé — les citations d'une même personne sous
    // plusieurs sujets) -> met en évidence ces nœuds, leurs sujets liés, et
    // estompe le reste.
    const highlightFrom = (selfIds: Set<string>) => {
      const connected = new Set(selfIds);
      for (const l of links) {
        const s = (l.source as GNode).id;
        const t = (l.target as GNode).id;
        if (selfIds.has(s)) connected.add(t);
        if (selfIds.has(t)) connected.add(s);
      }
      nodeSel.classed("is-dim", (n) => !connected.has(n.id));
      linkSel.classed("is-dim", (l) => {
        const s = (l.source as GNode).id;
        const t = (l.target as GNode).id;
        return !(selfIds.has(s) || selfIds.has(t));
      });
    };
    const clearHighlight = () => {
      nodeSel.classed("is-dim", false);
      linkSel.classed("is-dim", false);
    };
    const selfIdsFor = (d: GNode): Set<string> => {
      const key = personKeyOf(d, mode);
      return new Set(nodes.filter((n) => n.type === "sec" && personKeyOf(n, mode) === key).map((n) => n.id));
    };

    nodeSel
      .on("pointerdown", (event: PointerEvent) => {
        lastPointerType = event.pointerType;
      })
      .on("mouseenter", (event: MouseEvent, d) => {
        if (lastPointerType === "touch") return; // le tap gère déjà son propre survol
        const rect = container.getBoundingClientRect();
        if (d.type === "topic") {
          const noun = mode === "parti" ? "parti" : "personnalité";
          showTip(
            `<strong>${d.label}</strong>${d.count} ${noun}${d.count! > 1 ? "s" : ""} en parlent`,
            event.clientX - rect.left,
            event.clientY - rect.top
          );
        } else if (mode === "parti") {
          const th = [...new Set(d.members!.map((m) => shortOf.get(m.theme) ?? m.theme))];
          showTip(
            `<strong>${d.fullName}</strong>${d.members!.length} citation${d.members!.length > 1 ? "s" : ""} · ${th.join(", ")}`,
            event.clientX - rect.left,
            event.clientY - rect.top
          );
        } else {
          showTip(
            `<strong>${d.fullName}</strong>${shortOf.get(d.ref!.theme) ?? d.ref!.theme}<br><span style="opacity:.65">${d.ref!.date_texte}</span>`,
            event.clientX - rect.left,
            event.clientY - rect.top
          );
        }
        highlightFrom(new Set([d.id]));
      })
      .on("mousemove", (event: MouseEvent) => {
        if (lastPointerType === "touch") return;
        const rect = container.getBoundingClientRect();
        positionTip(event.clientX - rect.left, event.clientY - rect.top);
      })
      .on("mouseleave", () => {
        if (lastPointerType === "touch") return;
        hideTip();
        if (!pinnedKey) clearHighlight();
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

        // Tactile, pas de survol : un premier tap met en évidence toutes les
        // citations de cette personne à travers les sujets et affiche son
        // nom (repli tactile de ce que le survol montre côté souris) ; un
        // second tap sur la même personne confirme (ouvre sa fiche).
        const key = personKeyOf(d, mode);
        if (pinnedKey === key) {
          pinnedKey = null;
          hideTip();
          clearHighlight();
          if (canOpen) onSelect(d.ref!);
          return;
        }
        pinnedKey = key;
        highlightFrom(selfIdsFor(d));
        showTip(`<strong>${d.fullName}</strong>`, d.x ?? width / 2, (d.y ?? height / 2) - d.r - 10);
      });

    // Tap/clic sur le fond du graphe (pas sur un nœud) : efface l'épinglage.
    svg.on("click", (event: MouseEvent) => {
      if (event.target !== svgEl) return;
      pinnedKey = null;
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
  }, [entries, topics, mode, onSelect, theme, onThemeChange, compact, width, height]);

  const noun = mode === "parti" ? "parti" : "personnalité";
  const legend =
    mode === "pol"
      ? ["taille = nombre de personnalités qui en parlent", "anneau et lien = famille politique", "Personnalité"]
      : ["taille = nombre de partis qui en parlent", "anneau et lien = famille politique", "Parti"];

  return (
    <section className="topic-graph-section" aria-label="Carte des sujets">
      <div className="section-head">
        <div className="section-head-top">
          <div>
            <h2 className="section-title">Carte des sujets</h2>
            <p className="section-sub">
              Les grands sujets de la rentrée, reliés à ceux qui les portent.
              {compact
                ? " Touchez un sujet pour filtrer toute la page, un nom pour ouvrir sa fiche."
                : " Glissez un nœud, survolez (ou touchez) pour voir les liens. Suit uniquement le" +
                  " filtre Thème ci-dessus : cliquez un sujet pour filtrer toute la page, recliquez" +
                  " pour tout réafficher."}
            </p>
          </div>
          <div className="graph-toggle" role="tablist" aria-label="Niveau du graphe">
            {(["pol", "parti"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                className="toggle-btn"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "pol" ? "Personnalités" : "Partis"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={compact ? "graph-container is-compact" : "graph-container"} ref={containerRef}>
        {compact ? (
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

      {!compact && (
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
        <span className="legend-item">
          <span className="node-swatch topic" />
          Sujet <span style={{ opacity: 0.65 }}>— {legend[0]}</span>
        </span>
        <span className="legend-item">
          <span className="node-swatch pol" />
          {legend[2]} <span style={{ opacity: 0.65 }}>— {legend[1]}</span>
        </span>
      </div>
    </section>
  );
}
