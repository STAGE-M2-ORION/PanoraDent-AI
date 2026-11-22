import { describe, expect, it } from "vitest";

import { canReplay, normalizeComparison } from "./comparison";

const dto = (parClasse) => ({
  seuil: 0.25,
  origine: { id: "a1", reference: "PDX-2026-0001", model_version: "v1" },
  rejeu: { id: "a2", reference: "PDX-2026-0002", statut: parClasse ? "terminee" : "en_file", model_version: "v2" },
  par_classe: parClasse,
});

describe("comparaison de deux modèles", () => {
  it("met les anomalies d'abord et additionne les totaux", () => {
    const c = normalizeComparison(dto({
      tooth: { origine: 28, rejeu: 30, communes: 27, seulement_origine: 1, seulement_rejeu: 3 },
      periapical_lesion: { origine: 0, rejeu: 1, communes: 0, seulement_origine: 0, seulement_rejeu: 1 },
      caries: { origine: 3, rejeu: 2, communes: 2, seulement_origine: 1, seulement_rejeu: 0 },
    }));
    expect(c.rows.map((r) => r.label)).toEqual(["caries", "periapical_lesion", "tooth"]);
    expect(c.rows[0]).toEqual({ label: "caries", before: 3, after: 2, common: 2, onlyBefore: 1, onlyAfter: 0 });
    expect(c.totals).toEqual({ before: 31, after: 33, common: 29, onlyBefore: 2, onlyAfter: 4 });
    expect(c.origin.modelVersion).toBe("v1");
    expect(c.replay.modelVersion).toBe("v2");
  });

  it("n'invente rien tant que le rejeu n'est pas terminé", () => {
    const c = normalizeComparison(dto(null));
    expect(c.rows).toBeNull();
    expect(c.totals).toBeNull();
    expect(c.replay.status).toBe("en_file");
  });
});

describe("proposer de rejouer", () => {
  const active = { version: "v2" };
  const faite = (over = {}) => ({ processing: "terminee", modelVersion: "v1", ...over });

  it("seulement pour une analyse terminée par un autre modèle que l'actif", () => {
    expect(canReplay(faite(), active)).toBe(true);
    expect(canReplay(faite({ modelVersion: "v2" }), active)).toBe(false);
    expect(canReplay(faite({ processing: "en_file" }), active)).toBe(false);
    expect(canReplay(faite(), null)).toBe(false);
  });
});
