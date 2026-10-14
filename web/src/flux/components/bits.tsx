import type { ReactNode } from "react";
import type { ActivityCategory, SourceKind, VerificationStatus } from "../shared";
import { CATEGORY_LABEL, STATUS_LABEL } from "../shared";
import { SOURCE_BADGE, STATUS_GLYPH, catVar } from "../lib/palette";

export function StatusBadge({ status }: { status: VerificationStatus }) {
  return (
    <span className={`tag tag-status tag-${status}`} title={STATUS_LABEL[status]}>
      <span aria-hidden="true" className="glyph">{STATUS_GLYPH[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CategoryTag({ category }: { category: ActivityCategory }) {
  return (
    <span className="tag tag-cat" style={{ ["--c" as string]: catVar(category) }}>
      <i className="fdot" aria-hidden="true" />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function DemoTag() {
  return <span className="tag tag-demo" title="Donnée de démonstration fictive">DEMO</span>;
}

/** Pastille neutre (lettre) : n'imite pas les logos des services. */
export function SourceBadge({ kind }: { kind: SourceKind }) {
  const b = SOURCE_BADGE[kind];
  return <span className={`sbadge ${b.className}`} aria-hidden="true">{b.letter}</span>;
}

export function Panel({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {title && <h2 className="panel-title mono">{title}</h2>}
      {children}
    </section>
  );
}
