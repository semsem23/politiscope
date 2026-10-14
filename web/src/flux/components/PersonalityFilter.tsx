import { useEffect, useRef, useState } from "react";
import type { Personality } from "../shared";
import type { Filters } from "../lib/filters";

interface Props {
  personalities: Personality[];
  counts: Map<string, number>;
  filters: Filters;
  setFilters: (f: Filters) => void;
}

/**
 * Filtre « Personnalités » : un événement passe le filtre si l'une des personnes cochées est CITÉE
 * dans ses titres ou extraits (mention exacte). Ce n'est pas une preuve de participation.
 */
export default function PersonalityFilter({ personalities, counts, filters: f, setFilters }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const n = f.personalities.size;
  const none = personalities.length === 0;
  const toggle = (id: string) => {
    const s = new Set(f.personalities);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setFilters({ ...f, personalities: s });
  };
  const shown = personalities.filter((p) => `${p.name} ${p.role ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="popwrap" ref={ref}>
      <button
        type="button"
        className={n > 0 ? "pill pill-people pill-on" : "pill pill-people"}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={none}
        title={none ? "Aucune personnalité configurée (variable PERSONALITIES du serveur)" : undefined}
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7.5.5a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM9 13c-3.2 0-6.5 1.6-6.5 4.2V19h13v-1.8C15.5 14.6 12.2 13 9 13zm7.5.7c-.6 0-1.2.1-1.8.2 1.2.9 1.8 2.1 1.8 3.3V19h6v-1.5c0-2-2.3-3.8-6-3.8z" fill="currentColor" /></svg>
        Personnalités
        {n > 0 && <span className="count-pill">{n}</span>}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="popover popover-left" role="dialog" aria-label="Filtrer par personnalité">
          {personalities.length > 7 && (
            <input type="search" className="pop-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une personnalité" aria-label="Rechercher une personnalité" />
          )}
          <ul className="people">
            {shown.map((p) => {
              const c = counts.get(p.id) ?? 0;
              const on = f.personalities.has(p.id);
              return (
                <li key={p.id}>
                  <label className={c === 0 && !on ? "person person-zero" : "person"}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                    <span className="person-name">
                      {p.name}
                      {p.role && <span className="mute small"> · {p.role}</span>}
                    </span>
                    <span className="pill-count" title={`${c} activité${c > 1 ? "s" : ""} sur la période`}>{c}</span>
                  </label>
                </li>
              );
            })}
            {shown.length === 0 && <li className="small mute">Aucune personnalité ne correspond.</li>}
          </ul>
          <p className="small mute pop-foot">
            Retient les activités où la personne est <strong>citée</strong> dans un titre ou un extrait collecté. Une mention n'est pas une preuve de participation.
          </p>
          {n > 0 && <button type="button" className="fchip fchip-reset" onClick={() => setFilters({ ...f, personalities: new Set() })}>Tout décocher</button>}
        </div>
      )}
    </div>
  );
}
