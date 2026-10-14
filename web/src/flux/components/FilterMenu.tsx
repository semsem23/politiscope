import { useEffect, useRef, useState } from "react";
import type { ActivityCategory, EventKind, VerificationStatus } from "../shared";
import { CATEGORY_LABEL, CATEGORY_ORDER, KIND_LABEL } from "../shared";
import type { Filters } from "../lib/filters";
import { hasActiveFilters } from "../lib/filters";
import { catVar } from "../lib/palette";

const STATUS_CHIPS: { v: VerificationStatus; label: string }[] = [
  { v: "cross_checked", label: "Confirmé" },
  { v: "needs_review", label: "À vérifier" },
  { v: "scheduled", label: "Rendez-vous annoncé" },
];
const KIND_CHIPS: EventKind[] = ["declaration", "travel", "meeting", "publication"];

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

/** Bouton « Filtres » + fenêtre : catégories, statut, nature (les sources sont dans la barre du haut). */
export default function FilterMenu({ filters: f, setFilters, onReset }: { filters: Filters; setFilters: (f: Filters) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const n = f.categories.size + f.statuses.size + f.kinds.size;

  return (
    <div className="popwrap" ref={ref}>
      <button type="button" className="btn-outline" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
        Filtres{n > 0 && <span className="count-pill">{n}</span>}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Filtres">
          <h3 className="pop-h">Catégories</h3>
          <div className="chips">
            {CATEGORY_ORDER.map((c: ActivityCategory) => (
              <button key={c} type="button" className="fchip" aria-pressed={f.categories.has(c)} onClick={() => setFilters({ ...f, categories: toggle(f.categories, c) })}>
                <i className="fdot" style={{ background: catVar(c) }} aria-hidden="true" />{CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <h3 className="pop-h">Statut</h3>
          <div className="chips">
            {STATUS_CHIPS.map((s) => (
              <button key={s.v} type="button" className="fchip" aria-pressed={f.statuses.has(s.v)} onClick={() => setFilters({ ...f, statuses: toggle(f.statuses, s.v) })}>{s.label}</button>
            ))}
          </div>
          <h3 className="pop-h">Nature</h3>
          <div className="chips">
            {KIND_CHIPS.map((k) => (
              <button key={k} type="button" className="fchip" aria-pressed={f.kinds.has(k)} onClick={() => setFilters({ ...f, kinds: toggle(f.kinds, k) })}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          {hasActiveFilters(f) && <button type="button" className="fchip fchip-reset" onClick={onReset}>Effacer tous les filtres</button>}
        </div>
      )}
    </div>
  );
}
