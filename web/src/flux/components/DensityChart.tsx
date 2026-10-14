import { useEffect, useMemo, useRef, useState } from "react";
import type { Article, ActivityEvent, SourceKind, TimeWindow } from "../shared";
import { CATEGORY_LABEL, CATEGORY_ORDER, SOURCE_LABEL, binSizeFor, formatParis, makeBins, niceTicks, relDayLabel } from "../shared";
import { catVar, srcVar } from "../lib/palette";

interface Props {
  articles: Article[];
  eventsById: Map<string, ActivityEvent>;
  windowKey: TimeWindow;
  startMs: number;
  endMs: number;
  zoom: [number, number] | null;
}

const SOURCES: SourceKind[] = ["x", "google_news", "other"];
const H = 104;
const M = { l: 30, r: 12, t: 8, b: 22 };
const BIN_LABEL: Record<TimeWindow, string> = { "24h": "15 min", "7d": "6 h", "30d": "1 jour" };
const PERIOD: Record<TimeWindow, string> = { "24h": "24 h", "7d": "7 jours", "30d": "30 jours" };

export default function DensityChart({ articles, eventsById, windowKey, startMs, endMs, zoom }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [by, setBy] = useState<"source" | "category">("source");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(320, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const series = by === "source" ? SOURCES.map(String) : CATEGORY_ORDER.map(String);
  const label = (k: string) => (by === "source" ? SOURCE_LABEL[k as SourceKind] : CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL]);
  const color = (k: string) => (by === "source" ? srcVar(k as SourceKind) : catVar(k as never));
  const keyOf = (a: Article) => (by === "source" ? a.sourceKind : eventsById.get(a.eventId ?? "")?.category ?? "other");

  const bins = useMemo(
    () => makeBins(articles, (a) => Date.parse(a.publishedAt), startMs, endMs, binSizeFor(windowKey)),
    [articles, startMs, endMs, windowKey],
  );
  const stacks = useMemo(
    () =>
      bins.map((b) => {
        const counts: Record<string, number> = {};
        for (const a of b.items) counts[keyOf(a)] = (counts[keyOf(a)] ?? 0) + 1;
        return { bin: b, counts, total: b.items.length };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bins, by, eventsById],
  );

  const max = Math.max(1, ...stacks.map((s) => s.total));
  const yMax = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const plotW = w - M.l - M.r;
  const plotH = H - M.t - M.b;
  const x = (t: number) => M.l + ((t - startMs) / (endMs - startMs)) * plotW;
  const y = (v: number) => M.t + plotH - (v / yMax) * plotH;
  const total = articles.length;
  const { ticks, step } = useMemo(() => niceTicks(startMs, endMs, w < 560 ? 4 : 8), [startMs, endMs, w]);

  return (
    <section className="panel density" aria-label="Densité des mentions">
      <div className="density-head">
        <h2 className="panel-h">Densité des mentions sur {PERIOD[windowKey]}</h2>
        <div className="seg seg-small" role="group" aria-label="Séries">
          <button type="button" aria-pressed={by === "source"} onClick={() => setBy("source")}>Par source</button>
          <button type="button" aria-pressed={by === "category"} onClick={() => setBy("category")}>Par catégorie</button>
        </div>
      </div>

      <div ref={ref} className="density-chart">
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`Histogramme : ${total} articles collectés sur la période`}>
          {zoom && <rect x={x(zoom[0])} y={M.t} width={Math.max(2, x(zoom[1]) - x(zoom[0]))} height={plotH} className="hl-zone" />}
          {!zoom && <rect x={M.l} y={M.t} width={plotW} height={plotH} className="hl-zone" />}
          <line x1={M.l} x2={w - M.r} y1={y(0)} y2={y(0)} className="axis" />
          {[0, yMax].map((v) => (
            <g key={v}>
              <line x1={M.l} x2={w - M.r} y1={y(v)} y2={y(v)} className="gridline" />
              <text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="tick-label">{v}</text>
            </g>
          ))}
          {stacks.map(({ bin, counts, total: n }) => {
            if (n === 0) return null;
            const bw = Math.max(1, x(bin.end) - x(bin.start) - 2);
            let acc = 0;
            return (
              <g key={bin.start}>
                <title>{`${formatParis(bin.start)} → ${formatParis(bin.end, "time")} : ${n} article${n > 1 ? "s" : ""}\n` +
                  series.filter((s) => counts[s]).map((s) => `${label(s)} : ${counts[s]}`).join("\n")}</title>
                {series.map((s) => {
                  const c = counts[s];
                  if (!c) return null;
                  const y0 = y(acc);
                  acc += c;
                  const y1 = y(acc);
                  return <rect key={s} x={x(bin.start) + 1} y={y1} width={bw} height={Math.max(0.5, y0 - y1)} fill={color(s)} className="bar" />;
                })}
              </g>
            );
          })}
          {ticks.map((t) => (
            <text key={t.t} x={x(t.t)} y={H - 6} textAnchor="middle" className="tick-label">
              {step >= 24 * 3600_000 ? formatParis(t.t, "day") : t.midnight ? relDayLabel(t.t, endMs) : formatParis(t.t, "time")}
            </text>
          ))}
        </svg>
        {total === 0 && <p className="overlay overlay-empty small">Aucune donnée collectée sur cette période — rien n'est estimé.</p>}
      </div>

      <p className="small mute density-note">Articles collectés par tranche de {BIN_LABEL[windowKey]} : volume de collecte, pas une mesure de popularité ni une preuve de véracité.</p>
      <ul className="legend-inline" aria-label="Légende des séries">
        {series.map((s) => (
          <li key={s}><i className="sq" style={{ background: color(s) }} aria-hidden="true" />{label(s)}</li>
        ))}
      </ul>
    </section>
  );
}
