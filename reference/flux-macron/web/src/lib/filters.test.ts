import { describe, expect, it } from "vitest";
import { buildDemoState } from "../shared";
import { applyFilters, emptyFilters } from "./filters";

const state = buildDemoState(new Date("2026-10-13T12:00:00Z"), "30d");

describe("filtres de l'interface", () => {
  it("sans filtre, tout est visible", () => {
    const r = applyFilters(state, emptyFilters());
    expect(r.events).toHaveLength(state.events.length);
    expect(r.articles).toHaveLength(state.articles.length);
  });

  it("le filtre de source masque les événements sans article de cette source", () => {
    const f = emptyFilters();
    f.sources.add("x");
    const r = applyFilters(state, f);
    expect(r.articles.every((a) => a.sourceKind === "x")).toBe(true);
    const ids = new Set(r.articles.map((a) => a.eventId));
    expect(r.events.every((e) => ids.has(e.id))).toBe(true);
    expect(r.events.length).toBeLessThan(state.events.length);
  });

  it("catégories et statuts se combinent en ET", () => {
    const f = emptyFilters();
    f.categories.add("diplomacy");
    f.statuses.add("cross_checked");
    const r = applyFilters(state, f);
    expect(r.events.every((e) => e.category === "diplomacy" && e.status === "cross_checked")).toBe(true);
  });

  it("le filtre personnalités garde les événements qui citent l'une des personnes cochées (OU)", () => {
    const f = emptyFilters();
    f.personalities.add("camille-demo");
    f.personalities.add("alex-exemple");
    const r = applyFilters(state, f);
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.every((e) => e.personalityIds.some((id) => id === "camille-demo" || id === "alex-exemple"))).toBe(true);
    expect(r.events.length).toBeLessThan(state.events.length);
  });

  it("la recherche ignore accents et casse", () => {
    const f = emptyFilters();
    f.query = "SOMMET diplomatique";
    const r = applyFilters(state, f);
    expect(r.articles.length).toBeGreaterThan(0);
    expect(r.articles.every((a) => /sommet/i.test(a.title))).toBe(true);
  });
});
