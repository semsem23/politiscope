import { describe, expect, it } from "vitest";
import { buildDemoState, detectPersonalities, parsePersonalities } from "./index";

describe("personnalités", () => {
  it("lit la liste configurée, ignore les entrées trop courtes et les doublons", () => {
    const l = parsePersonalities("Camille Démo|C. Démo|ab ; ab ; Camille Démo ; Alex Exemple");
    expect(l.map((p) => p.id)).toEqual(["camille-demo", "alex-exemple"]);
    expect(l[0].aliases).toEqual(["C. Démo"]);
    expect(parsePersonalities(undefined)).toEqual([]);
  });

  it("repère les mentions en mot entier, sans accents ni casse, sans deviner", () => {
    const l = parsePersonalities("Camille Démo|Mme Démo");
    expect(detectPersonalities("Rencontre avec CAMILLE DEMO à Lyon", l)).toEqual(["camille-demo"]);
    expect(detectPersonalities("Visite de Mme Démo", l)).toEqual(["camille-demo"]);
    expect(detectPersonalities("Camille Démoulin arrive", l)).toEqual([]);
    expect(detectPersonalities("Camille seule", l)).toEqual([]);
    expect(detectPersonalities("texte", [])).toEqual([]);
  });

  it("la démo ne cite que des personnalités fictives, présentes dans les titres", () => {
    const s = buildDemoState(new Date("2026-10-13T12:00:00Z"), "30d");
    expect(s.personalities.every((p) => p.isDemo)).toBe(true);
    const withP = s.events.filter((e) => e.personalityIds.length > 0);
    expect(withP.length).toBeGreaterThan(5);
    for (const e of withP) {
      const arts = s.articles.filter((a) => a.eventId === e.id);
      for (const id of e.personalityIds) {
        const name = s.personalities.find((p) => p.id === id)!.name;
        expect(arts.some((a) => a.title.includes(name))).toBe(true);
      }
    }
  });
});
