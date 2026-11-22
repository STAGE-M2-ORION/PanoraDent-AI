import { describe, expect, it } from "vitest";

import { normalizeModelSwitch, normalizeModelVersion } from "../api/model-version-api";
import { activationBlocker, activeVersion, headlineMetrics, shortHash } from "./model-version";

const dto = (over = {}) => ({
  id: "x",
  version: "dentex-2026.11",
  dataset: "DENTEX",
  metrics: { map50: 0.61, precision: 0.7, recall: 0.55, test_images: 109, partition: "test" },
  created_at: "2026-11-22T10:00:00",
  actif: false,
  servable: true,
  empreinte_decoupage: "f22d373ede0ff715aaaa",
  sha256: { dents: "a".repeat(64), anomalies: "b".repeat(64) },
  ...over,
});

describe("registre des modèles", () => {
  it("normalise une version (paire de poids, découpage, état)", () => {
    const v = normalizeModelVersion(dto({ actif: true, active_le: "2026-11-22T11:00:00" }));
    expect(v.active).toBe(true);
    expect(v.servable).toBe(true);
    expect(v.splitHash).toBe("f22d373ede0ff715aaaa");
    expect(v.sha256).toEqual({ teeth: "a".repeat(64), anomalies: "b".repeat(64) });
  });

  it("ne suppose jamais qu'une version est active", () => {
    const versions = [normalizeModelVersion(dto({ version: "v2" })), normalizeModelVersion(dto({ version: "v1" }))];
    expect(activeVersion(versions)).toBeNull();
    versions[1].active = true;
    expect(activeVersion(versions).version).toBe("v1");
  });

  it("explique pourquoi une version ne peut pas être activée", () => {
    expect(activationBlocker(normalizeModelVersion(dto()))).toBeNull();
    expect(activationBlocker(normalizeModelVersion(dto({ actif: true })))).toMatch(/déjà active/);
    expect(activationBlocker(normalizeModelVersion(dto({ servable: false })))).toMatch(/poids/);
  });

  it("résume les mesures publiées, ou rien si elles manquent", () => {
    expect(headlineMetrics(normalizeModelVersion(dto()))).toEqual({ map50: 0.61, precision: 0.7, recall: 0.55, testImages: 109, partition: "test" });
    expect(headlineMetrics(normalizeModelVersion(dto({ metrics: {} })))).toBeNull();
  });

  it("abrège les empreintes et normalise le journal des bascules", () => {
    expect(shortHash("abcdef0123456789")).toBe("abcdef012345");
    expect(shortHash(null)).toBe("—");
    expect(normalizeModelSwitch({ horodatage: "t", version_precedente: null, version: "v1", motif: "m", auteur_nom: "Dr R" }))
      .toEqual({ at: "t", from: null, to: "v1", reason: "m", author: "Dr R" });
  });
});
