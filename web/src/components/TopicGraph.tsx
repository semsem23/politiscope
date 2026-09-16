import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";
import { initials } from "../hooks/usePolitiscope";
import { familleOf, type Entry, type Topic } from "../types";

type Mode = "pol" | "parti";

interface GNode extends d3.SimulationNodeDatum {
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

interface GLink extends d3.SimulationLinkDatum<GNode> {
  ref: Entry;
}

interface Props {
  entries: Entry[];
  topics: Topic[];
  onSelect: (e: Entry) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
}

export function TopicGraph({ entries, topics, onSelect, theme, onThemeChange }: Props) {
  const [mode, setMode] = useState<Mode>("pol");
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    const tip = tipRef.current;
    if (!container || !svgEl || !tip || entries.length === 0) return;

    const shortOf = new Map(topics.map((t) => [t.theme, t.libelle_court]));
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    let width = container.clientWidth;
    let height = container.clientHeight;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // --- construction des nœuds selon le niveau choisi ---------------------
    let secondary: GNode[];
    let links: GLink[];
    let labelMaxLen: number;

    if (mode === "parti") {
      const counts = new Map<string, number>();
      const famOf = new Map<string, Entry["famille"]>();
      for (const d of entries) {
        const code = d.code_parti ?? d.parti;
        counts.set(code, (counts.get(code) ?? 0) + 1);
        famOf.set(code, d.famille);
      }
      secondary = [...counts].map(([code, n]) => ({
        id: `sec:${code}`,
        type: "sec" as const,
        label: code,
        fullName: code,
        r: 16 + n * 6,
        famille: famOf.get(code),
        members: entries.filter((d) => (d.code_parti ?? d.parti) === code),
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
    const topicNodes: GNode[] = [...degree].map(([tid, targets]) => {
      const themeId = tid.replace("topic:", "");
      return {
        id: tid,
        type: "topic",
        label: shortOf.get(themeId) ?? themeId,
        fullName: themeId,
        count: targets.size,
        r: 20 + targets.size * 5,
      };
    });

    const nodes = [...topicNodes, ...secondary];

    const simulation = d3
      .forceSimulation<GNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GNode, GLink>(links)
          .id((d) => d.id)
          .distance((l) => 58 + ((l.target as GNode).r ?? 15))
          .strength(0.6)
      )
      .force("charge", d3.forceManyBody().strength(-170))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<GNode>().radius((d) => d.r + 6));

    const linkSel = svg
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", "graph-link")
      .attr("stroke-width", 1.6)
      .attr("stroke", (d) => familleOf(d.ref.famille).color);

    let dragDistance = 0;

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
        d3
          .drag<SVGGElement, GNode>()
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
    const positionTip = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      tip.style.left = `${event.clientX - rect.left}px`;
      tip.style.top = `${event.clientY - rect.top}px`;
    };

    nodeSel
      .on("mouseenter", (event: MouseEvent, d) => {
        tip.hidden = false;
        if (d.type === "topic") {
          const noun = mode === "parti" ? "parti" : "personnalité";
          tip.innerHTML = `<strong>${d.label}</strong>${d.count} ${noun}${d.count! > 1 ? "s" : ""} en parlent`;
        } else if (mode === "parti") {
          const th = [...new Set(d.members!.map((m) => shortOf.get(m.theme) ?? m.theme))];
          tip.innerHTML =
            `<strong>${d.fullName}</strong>${d.members!.length} citation${d.members!.length > 1 ? "s" : ""} · ${th.join(", ")}`;
        } else {
          tip.innerHTML = `<strong>${d.fullName}</strong>${shortOf.get(d.ref!.theme) ?? d.ref!.theme}<br><span style="opacity:.65">${d.ref!.date_texte}</span>`;
        }
        positionTip(event);

        const connected = new Set([d.id]);
        for (const l of links) {
          const s = l.source as GNode;
          const t = l.target as GNode;
          if (s.id === d.id) connected.add(t.id);
          if (t.id === d.id) connected.add(s.id);
        }
        nodeSel.classed("is-dim", (n) => !connected.has(n.id));
        linkSel.classed("is-dim", (l) => (l.source as GNode).id !== d.id && (l.target as GNode).id !== d.id);
      })
      .on("mousemove", (event: MouseEvent) => positionTip(event))
      .on("mouseleave", () => {
        tip.hidden = true;
        nodeSel.classed("is-dim", false);
        linkSel.classed("is-dim", false);
      })
      .on("click", (_e, d) => {
        if (dragDistance > 4) return;
        if (d.type === "topic") onThemeChange(d.fullName);
        else if (d.type === "sec" && mode === "pol") onSelect(d.ref!);
      });

    // Marge de bord : les libellés longs ne doivent pas déborder du cadre.
    const marginFor = (d: GNode) =>
      d.type === "topic"
        ? Math.max(d.r + 4, 72)
        : mode === "parti"
          ? Math.max(d.r + 4, labelMaxLen * 4 + 10)
          : d.r + 4;

    simulation.on("tick", () => {
      for (const d of nodes) {
        const mx = marginFor(d);
        d.x = Math.max(mx, Math.min(width - mx, d.x!));
        d.y = Math.max(d.r + 4, Math.min(height - d.r - 4, d.y!));
      }
      linkSel
        .attr("x1", (d) => (d.source as GNode).x!)
        .attr("y1", (d) => (d.source as GNode).y!)
        .attr("x2", (d) => (d.target as GNode).x!)
        .attr("y2", (d) => (d.target as GNode).y!);
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      width = w;
      height = h;
      svg.attr("viewBox", `0 0 ${w} ${h}`);
      simulation.force("center", d3.forceCenter(w / 2, h / 2));
      simulation.alpha(0.3).restart();
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      simulation.stop();
      svg.selectAll("*").remove();
    };
  }, [entries, topics, mode, onSelect, theme, onThemeChange]);

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
              Les grands sujets de la rentrée, reliés à ceux qui les portent. Glissez un nœud,
              survolez pour voir les liens. Suit uniquement le filtre Thème ci-dessus : cliquez un
              sujet pour filtrer toute la page, recliquez pour tout réafficher.
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

      <div className="graph-container" ref={containerRef}>
        <svg
          className="graph-svg"
          ref={svgRef}
          role="img"
          aria-label="Graphe reliant les sujets aux personnalités ou partis qui en parlent"
        />
        <div className="graph-tooltip" ref={tipRef} hidden />
      </div>

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
