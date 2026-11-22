import { describe, expect, it } from "vitest";

import { markPath } from "../lib/marks";
import { ANOMALY_LABELS, ANOMALY_TYPOLOGY, DETECTION_TYPES, URGENCY, anomalyTypology, typeTooltip } from "./detection";

/** Gris perçu d'une couleur (luminance relative, WCAG). */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("typologie des anomalies", () => {
  it("chaque anomalie a une définition, une urgence connue et une forme", () => {
    for (const label of ANOMALY_LABELS) {
      const t = anomalyTypology(label);
      expect(t.definition.length).toBeGreaterThan(30);
      expect(URGENCY[t.urgency]).toBeDefined();
      expect(t.urgencyText).toBe(URGENCY[t.urgency].label);
    }
    expect(anomalyTypology("tooth")).toBeNull();
  });

  it("l'infobulle donne le nom, la définition et l'urgence indicative", () => {
    expect(typeTooltip("deep_caries")).toMatch(/^Carie profonde — .*pulpe.* Urgence indicative : prioritaire\.$/);
    expect(typeTooltip("tooth")).toBe("Dent (numéro FDI)");
  });

  it("en niveaux de gris, deux types restent distincts : forme et abréviation uniques", () => {
    const shapes = ANOMALY_LABELS.map((l) => ANOMALY_TYPOLOGY[l].shape);
    const abbrs = ANOMALY_LABELS.map((l) => DETECTION_TYPES[l].abbr);
    expect(new Set(shapes).size).toBe(ANOMALY_LABELS.length);
    expect(new Set(abbrs).size).toBe(ANOMALY_LABELS.length);
    // Les couleurs seules ne suffisent pas : au moins une paire se confond en gris.
    const proches = [];
    ANOMALY_LABELS.forEach((a, i) =>
      ANOMALY_LABELS.slice(i + 1).forEach((b) => {
        if (Math.abs(luminance(DETECTION_TYPES[a].color) - luminance(DETECTION_TYPES[b].color)) < 0.05) proches.push([a, b]);
      }),
    );
    expect(proches).toContainEqual(["deep_caries", "impacted_tooth"]);
    for (const [a, b] of proches) expect(ANOMALY_TYPOLOGY[a].shape).not.toBe(ANOMALY_TYPOLOGY[b].shape);
  });

  it("chaque marque est un tracé fermé centré sur le point demandé", () => {
    for (const label of ANOMALY_LABELS) {
      const d = markPath(label, 10, 20, 4);
      expect(d).toMatch(/^M[\d.]+ [\d.]+.*Z$/);
    }
    expect(markPath("deep_caries", 10, 20, 4)).toBe("M6.4 16.4H13.6V23.6H6.4Z");
  });
});
