import { describe, expect, it } from "vitest";

import { normalizeModelVersion } from "../api/model-version-api";
import { compareVersions, formatDelta, formatScore, formatShare, performanceOf, thresholdSentence } from "./performance";

// Extrait fidèle de la version publiée dentex-2026.11 (registre), plus des seuils.
const METRICS = {
  map50: 0.5097, precision: 0.5424, recall: 0.5166, test_images: 109, partition: "test",
  anomalies: {
    detection: {
      global: { precision: 0.5424, rappel: 0.5166, mAP50: 0.5097, mAP50_95: 0.3426 },
      par_classe: {
        tooth: null,
        caries: { instances: 332, precision: 0.4898, rappel: 0.4157, mAP50: 0.493, mAP50_95: 0.3458 },
        periapical_lesion: { instances: 22, precision: 0.3692, rappel: 0.3182, mAP50: 0.2479, mAP50_95: 0.1652 },
      },
      confusion: {
        etiquettes: ["tooth", "caries", "periapical_lesion", "fond"],
        matrice: [[0, 0, 0, 0], [0, 134, 1, 130], [0, 1, 4, 10], [0, 180, 12, 0]],
        lecture: "ligne = prédit, colonne = vrai ; fond = manqué ou inventé",
      },
    },
    niveau_image: { par_classe: { caries: { sensibilite: 0.883, specificite: 0.4667 } } },
  },
  externe: { detection: { global: { precision: 0.5726, rappel: 0.6043, mAP50: 0.5854 } } },
  seuils_exploitation: {
    par_classe: {
      caries: { seuil: 0.1, rappel: 0.597, precision: 0.37, fausses_alertes_par_cliche: 3.655, cible: 0.7, atteinte: false },
    },
    courbes: { caries: [[0.05, 0.71, 0.318], [0.1, 0.597, 0.37], [0.25, 0.388, 0.518]] },
  },
};

const version = (over = {}) =>
  normalizeModelVersion({ id: "x", version: "dentex-2026.11", metrics: METRICS, actif: true, servable: true,
    empreinte_decoupage: "f22d", sha256: {}, created_at: "2026-11-22T10:00:00", ...over });

describe("performances lues au registre", () => {
  it("mesures globales et par classe, identiques au registre", () => {
    const p = performanceOf(version());
    expect(p.global).toEqual({ map50: 0.5097, map5095: 0.3426, precision: 0.5424, recall: 0.5166, testImages: 109, partition: "test" });
    expect(p.perClass.map((r) => r.cls)).toEqual(["caries", "periapical_lesion"]);   // les dents ne sont pas une anomalie
    expect(p.perClass[0]).toEqual({ cls: "caries", label: "Carie", instances: 332, precision: 0.4898, recall: 0.4157,
      map50: 0.493, sensitivity: 0.883, specificity: 0.4667 });
    expect(p.external).toEqual({ map50: 0.5854, precision: 0.5726, recall: 0.6043 });
  });

  it("matrice de confusion sans lignes ni colonnes vides", () => {
    const { confusion } = performanceOf(version());
    expect(confusion.labels).toEqual(["Carie", "Lésion péri-apicale", "Fond (manqué ou inventé)"]);
    expect(confusion.matrix).toEqual([[134, 1, 130], [1, 4, 10], [180, 12, 0]]);
    expect(confusion.reading).toMatch(/ligne = prédit/);
  });

  it("seuils et courbes de validation, s'ils ont été publiés", () => {
    const [caries] = performanceOf(version()).thresholds;
    expect(caries.chosen).toMatchObject({ threshold: 0.1, recall: 0.597, reached: false });
    expect(caries.curve[1]).toEqual({ threshold: 0.1, recall: 0.597, precision: 0.37 });
    expect(thresholdSentence(caries)).toBe(
      "Au seuil retenu de 0,10, le modèle retrouve 60 % des caries de la validation ; 37 % de ses propositions sont justes ; " +
        "environ 3,7 fausses alertes par cliché. L’objectif de 70 % de rappel n’est pas atteint : des caries passeront inaperçues.",
    );
    const { seuils_exploitation: _, ...sansSeuils } = METRICS;
    expect(performanceOf(version({ metrics: sansSeuils })).thresholds).toBeNull();
  });

  it("aucune mesure : rien d'inventé", () => {
    const p = performanceOf(version({ metrics: {} }));
    expect(p).toMatchObject({ global: null, perClass: [], confusion: null, thresholds: null, external: null });
  });

  it("comparaison à jeu de test identique : écarts", () => {
    const b = version({ version: "v2", metrics: { ...METRICS, map50: 0.56 } });
    const c = compareVersions(version(), b);
    expect(c.comparable).toBe(true);
    expect(c.rows[0]).toEqual({ label: "Toutes classes — mAP@50", a: 0.5097, b: 0.56, delta: 0.05 });
  });

  it("comparaison sur des jeux différents : signalée, jamais conclue", () => {
    const b = version({ version: "v2", empreinte_decoupage: "autre", metrics: { ...METRICS, map50: 0.9 } });
    const c = compareVersions(version(), b);
    expect(c.comparable).toBe(false);
    expect(c.rows.every((r) => r.delta === null)).toBe(true);
    expect(c.rows[0]).toMatchObject({ a: 0.5097, b: 0.9 });
  });

  it("formats", () => {
    expect([formatScore(0.5), formatScore(null), formatShare(0.597), formatDelta(0.05), formatDelta(-0.12), formatDelta(0)])
      .toEqual(["0,50", "—", "60 %", "+0,05", "−0,12", "="]);
  });
});
