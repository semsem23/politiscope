import { describe, expect, it } from "vitest";
import {
  assignIndependence,
  buildDemoState,
  buildEvents,
  canonicalUrl,
  clusterArticles,
  computeConfidence,
  computeWindow,
  dedupeExact,
  makeBins,
  markNearDuplicates,
  niceTicks,
  normalizeRaw,
  parisOffsetMs,
  stripHtml,
} from "./index";
import type { Article } from "./index";

const NOW = new Date("2026-10-13T12:00:00Z");

function art(over: Partial<Article> & { id: string; title: string; publishedAt: string }): Article {
  return {
    sourceKind: "google_news",
    publisherName: "Média " + over.id,
    url: `https://example.org/${over.id}`,
    collectedAt: NOW.toISOString(),
    ...over,
  };
}

describe("normalisation", () => {
  it("nettoie le HTML et convertit les dates en ISO", () => {
    const r = normalizeRaw(
      {
        sourceKind: "google_news",
        publisherName: "Le Journal",
        title: "Macron &amp; <b>l'Europe</b> : sommet prévu - Le Journal",
        excerpt: "<script>alert(1)</script>Texte &lt;i&gt;court&lt;/i&gt; de l'extrait",
        url: "https://exemple.fr/a?utm_source=x&id=3#frag",
        publishedAt: "Tue, 13 Oct 2026 10:00:00 +0200",
      },
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.article.title).toBe("Macron & l'Europe : sommet prévu");
      expect(r.article.excerpt).toBe("Texte court de l'extrait");
      expect(r.article.url).toBe("https://exemple.fr/a?id=3");
      expect(r.article.publishedAt).toBe("2026-10-13T08:00:00.000Z");
    }
  });

  it("rejette les URL dangereuses, les dates futures et les titres vides", () => {
    const base = { sourceKind: "other" as const, publisherName: "X", title: "Un titre suffisamment long", publishedAt: NOW };
    expect(normalizeRaw({ ...base, url: "javascript:alert(1)" }, NOW).ok).toBe(false);
    expect(normalizeRaw({ ...base, url: "https://u:p@exemple.fr/" }, NOW).ok).toBe(false);
    expect(normalizeRaw({ ...base, url: "https://exemple.fr/", publishedAt: "2026-10-14T12:00:00Z" }, NOW).ok).toBe(false);
    expect(normalizeRaw({ ...base, url: "https://exemple.fr/", title: "<b></b>" }, NOW).ok).toBe(false);
    expect(canonicalUrl("ftp://exemple.fr/x")).toBeNull();
  });

  it("supprime caractères de contrôle et marques bidirectionnelles", () => {
    expect(stripHtml("a‮b\u0000c")).toBe("a b c");
  });
});

describe("doublons", () => {
  it("supprime les doublons exacts (URL avec paramètres de suivi, même titre chez le même média)", () => {
    const a = art({ id: "1", title: "Un titre de test assez long", publishedAt: "2026-10-13T08:00:00Z" });
    const b = { ...a, id: "2", url: "https://example.org/1" };
    const c = { ...a, id: "3", url: "https://example.org/autre" };
    const d = art({ id: "4", title: "Un autre titre complètement différent", publishedAt: "2026-10-13T09:00:00Z" });
    const { kept, dropped } = dedupeExact([a, b, c, d]);
    expect(kept.map((x) => x.id)).toEqual(["1", "4"]);
    expect(dropped.map((x) => x.reason)).toEqual(["same_url", "same_title_same_publisher"]);
  });

  it("compte une reprise identique chez plusieurs médias comme UNE seule source", () => {
    const t = "Plan de soutien à l'industrie automobile européenne annoncé";
    const arts = assignIndependence(
      [
        art({ id: "1", title: t, publishedAt: "2026-10-13T08:00:00Z" }),
        art({ id: "2", title: t + " - Média 2", publishedAt: "2026-10-13T08:10:00Z" }),
        art({ id: "3", title: "Autre angle sur la question des batteries électriques", publishedAt: "2026-10-13T08:20:00Z" }),
      ],
      [],
    );
    expect(arts[0].independenceKey).toBe(arts[1].independenceKey);
    expect(arts[2].independenceKey).not.toBe(arts[0].independenceKey);
  });

  it("rattache une reprise à sa source initiale et reconnaît les mentions de dépêche", () => {
    const arts = assignIndependence(
      [
        art({ id: "1", title: "Titre de la première publication ici", publishedAt: "2026-10-13T08:00:00Z" }),
        art({ id: "2", title: "Reprise avec lien vers la source", publishedAt: "2026-10-13T08:10:00Z", originalSourceUrl: "https://example.org/1" }),
        art({ id: "3", title: "Réaction (AFP) lors d'un déplacement", publishedAt: "2026-10-13T08:20:00Z" }),
        art({ id: "4", title: "Autre texte, selon l'AFP, sur le même sujet", publishedAt: "2026-10-13T08:30:00Z" }),
      ],
      [],
    );
    expect(arts[1].independenceKey).toBe(arts[0].independenceKey);
    expect(arts[2].independenceKey).toBe("wire:afp");
    expect(arts[3].independenceKey).toBe("wire:afp");
  });

  it("marque les quasi-doublons sans les supprimer", () => {
    const t = "Plan de soutien industrie automobile européenne annoncé ce matin";
    const out = markNearDuplicates(
      assignIndependence(
        [
          art({ id: "1", title: t, publishedAt: "2026-10-13T08:00:00Z", publisherName: "Média A" }),
          art({ id: "2", title: t + " : suite", publishedAt: "2026-10-13T09:00:00Z", publisherName: "Média A" }),
        ],
        [],
      ),
    );
    expect(out).toHaveLength(2);
    expect(out[1].nearDuplicateOf).toBe("1");
  });
});

describe("regroupement", () => {
  const A = art({ id: "a", title: "Emmanuel Macron annonce un plan de soutien à l'industrie automobile européenne", publishedAt: "2026-10-13T08:00:00Z" });
  const B = art({ id: "b", title: "Industrie automobile : Macron dévoile un plan de soutien européen", publishedAt: "2026-10-13T09:00:00Z" });
  const C = art({ id: "c", title: "Macron attendu à Bruxelles pour le sommet sur le climat", publishedAt: "2026-10-13T09:30:00Z" });

  it("regroupe les titres paraphrasés et sépare les sujets distincts", () => {
    const { clusters } = clusterArticles([A, B, C]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].articleIds).toEqual(["a", "b"]);
    expect(clusters[0].provenance[1].joinedBy).toBe("similarity");
    expect(clusters[0].provenance[1].score).toBeGreaterThanOrEqual(0.5);
  });

  it("ne regroupe pas des articles éloignés de plus de 48 h", () => {
    const late = { ...B, publishedAt: "2026-10-16T09:00:00Z" };
    expect(clusterArticles([A, late]).clusters).toHaveLength(2);
  });

  it("n'applique pas de fusion sur un rapprochement faible : il devient un lien suggéré", () => {
    const weak = art({ id: "w", title: "Industrie automobile : débat sur les batteries et les usines", publishedAt: "2026-10-13T10:00:00Z" });
    const { clusters, suggested } = clusterArticles([A, weak]);
    expect(clusters).toHaveLength(2);
    expect(suggested.length).toBeGreaterThanOrEqual(1);
  });

  it("permet de détacher un article manuellement", () => {
    const res = buildEvents([A, B], { now: NOW, officialAccounts: [], detachedArticleIds: ["b"] });
    expect(res.events).toHaveLength(2);
  });
});

describe("indice de confiance", () => {
  it("est « non évalué » pour un événement annoncé ou sans source", () => {
    expect(computeConfidence({ scheduled: true, hasPrimarySource: false, independentCount: 3, totalArticles: 3, contradictionDetected: false }).value).toBeNull();
    expect(computeConfidence({ scheduled: false, hasPrimarySource: false, independentCount: 0, totalArticles: 0, contradictionDetected: false }).value).toBeNull();
  });

  it("applique les paliers documentés et le malus de démenti", () => {
    const f = (o: Partial<Parameters<typeof computeConfidence>[0]>) =>
      computeConfidence({ scheduled: false, hasPrimarySource: false, independentCount: 1, totalArticles: 1, contradictionDetected: false, ...o });
    expect(f({}).value).toBe(0.25);
    expect(f({ independentCount: 3, totalArticles: 5 }).value).toBe(0.5);
    expect(f({ hasPrimarySource: true, independentCount: 3, totalArticles: 3 }).value).toBe(0.85);
    expect(f({ contradictionDetected: true }).value).toBe(0.13);
    expect(f({ independentCount: 9, totalArticles: 9, hasPrimarySource: true }).value).toBe(0.95);
  });

  it("les reprises ne gonflent pas la confiance", () => {
    const t = "Déclaration commune sur la sécurité énergétique du continent";
    const res = buildEvents(
      [
        art({ id: "1", title: t, publishedAt: "2026-10-13T08:00:00Z", publisherName: "A" }),
        art({ id: "2", title: t, publishedAt: "2026-10-13T08:05:00Z", publisherName: "B" }),
        art({ id: "3", title: t, publishedAt: "2026-10-13T08:10:00Z", publisherName: "C" }),
      ],
      { now: NOW, officialAccounts: [] },
    );
    expect(res.events).toHaveLength(1);
    expect(res.events[0].independentSourceCount).toBe(1);
    expect(res.events[0].status).toBe("single_source");
    expect(res.events[0].confidence).toBe(0.25);
  });
});

describe("statuts et classification", () => {
  const build = (title: string, extra: Partial<Article> = {}) =>
    buildEvents([art({ id: "1", title, publishedAt: "2026-10-13T08:00:00Z", ...extra })], { now: NOW, officialAccounts: ["Compte"] }).events[0];

  it("détecte un rendez-vous annoncé mais pas un fait passé", () => {
    expect(build("Emmanuel Macron se rendra demain à Berlin pour un sommet").status).toBe("scheduled");
    expect(build("Emmanuel Macron s'est rendu hier à Berlin pour un sommet").status).not.toBe("scheduled");
  });

  it("un mot-clé de démenti impose « à vérifier » (jamais « démenti » automatiquement)", () => {
    expect(build("Un démenti de l'Élysée sur une rumeur de remaniement").status).toBe("needs_review");
  });

  it("classe par mots-clés et laisse « autres » par défaut", () => {
    expect(build("Conseil des ministres : un projet de loi sur la réforme présenté").category).toBe("institutions");
    expect(build("Un message sans thème particulier publié ce matin").category).toBe("other");
  });

  it("une publication d'un compte officiel seul est une « source unique » de nature « publication »", () => {
    const e = build("Publication d'un message sur un sujet important ce matin", {
      sourceKind: "x",
      authorOrAccount: "@Compte",
      publisherName: "@Compte (X)",
    });
    expect(e.kind).toBe("publication");
    expect(e.status).toBe("single_source");
    expect(e.confidence).toBe(0.45);
  });
});

describe("temps (Europe/Paris)", () => {
  it("fenêtre glissante exacte de 24 h", () => {
    const w = computeWindow("24h", NOW);
    expect(Date.parse(w.end) - Date.parse(w.start)).toBe(24 * 3600_000);
    expect(w.end).toBe(NOW.toISOString());
  });

  it("décalage horaire de Paris : +2 h en été, +1 h en hiver", () => {
    expect(parisOffsetMs(Date.parse("2026-07-01T12:00:00Z"))).toBe(2 * 3600_000);
    expect(parisOffsetMs(Date.parse("2026-01-15T12:00:00Z"))).toBe(3600_000);
  });

  it("graduations croissantes, dans la fenêtre, alignées sur l'heure de Paris", () => {
    const end = NOW.getTime();
    for (const span of [24, 168, 720]) {
      const start = end - span * 3600_000;
      const { ticks } = niceTicks(start, end);
      expect(ticks.length).toBeGreaterThan(2);
      for (let i = 0; i < ticks.length; i++) {
        expect(ticks[i].t).toBeGreaterThanOrEqual(start);
        expect(ticks[i].t).toBeLessThanOrEqual(end);
        if (i) expect(ticks[i].t).toBeGreaterThan(ticks[i - 1].t);
      }
    }
    const { ticks } = niceTicks(end - 24 * 3600_000, end);
    expect(ticks.every((t) => (t.t + parisOffsetMs(t.t)) % (3600_000) === 0)).toBe(true);
  });

  it("l'histogramme conserve tous les articles de la fenêtre", () => {
    const start = NOW.getTime() - 24 * 3600_000;
    const items = [0.2, 5, 5.1, 23.9].map((h) => ({ t: start + h * 3600_000 }));
    const bins = makeBins(items, (i) => i.t, start, NOW.getTime(), 3600_000);
    expect(bins).toHaveLength(24);
    expect(bins.reduce((n, b) => n + b.items.length, 0)).toBe(4);
  });
});

describe("données de démonstration", () => {
  const s24 = buildDemoState(NOW, "24h");
  const s30 = buildDemoState(NOW, "30d");

  it("tout est signalé DEMO, fictif et pointe vers example.org", () => {
    expect(s30.mode).toBe("demo");
    for (const a of s30.articles) {
      expect(a.isDemo).toBe(true);
      expect(a.url.startsWith("https://example.org/demo/")).toBe(true);
      expect(a.title.startsWith("DEMO")).toBe(true);
    }
    for (const e of s30.events) expect(e.isDemo).toBe(true);
    expect(s30.sources.every((x) => x.state === "not_configured")).toBe(true);
  });

  it("les fenêtres 7 j et 30 j contiennent plus d'événements que 24 h, sans événement vide", () => {
    expect(s24.events.length).toBeGreaterThan(5);
    expect(s30.events.length).toBeGreaterThan(s24.events.length);
    for (const e of s30.events) {
      expect(e.articleIds.length).toBeGreaterThan(0);
      expect(e.distinctArticleCount).toBeGreaterThan(0);
    }
  });

  it("illustre les statuts, la déduplication et plusieurs catégories", () => {
    const statuses = new Set(s30.events.map((e) => e.status));
    expect(statuses.has("scheduled")).toBe(true);
    expect(statuses.has("needs_review")).toBe(true);
    expect(statuses.has("cross_checked")).toBe(true);
    expect(new Set(s30.events.map((e) => e.category)).size).toBeGreaterThanOrEqual(5);
    expect(s30.articles.some((a) => a.nearDuplicateOf)).toBe(true);
    expect(s30.events.some((e) => e.suggestedRelations.length > 0)).toBe(true);
  });
});
