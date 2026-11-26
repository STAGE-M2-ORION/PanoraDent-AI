import { describe, expect, it } from "vitest";

import { normalizeCabinet, parseRetention, toCabinetPayload, validateCabinet, validateLogoFile } from "./cabinet";

describe("paramètres du cabinet", () => {
  it("DTO → modèle, avec l'URL versionnée du logo", () => {
    const c = normalizeCabinet({ nom: "Cabinet du Lac", adresse: "Rue 12", mentions: "", logo: true, logo_version: "logo-ab_c", maj_le: "2026-11-23T08:00:00", maj_par_nom: "Admin" });
    expect(c).toMatchObject({ name: "Cabinet du Lac", address: "Rue 12", hasLogo: true, updatedBy: "Admin" });
    expect(c.logoUrl).toMatch(/\/cabinet\/logo\?v=logo-ab_c$/);
    expect(normalizeCabinet({ nom: "", logo: false }).logoUrl).toBeNull();
  });

  it("modèle → corps envoyé, espaces retirés", () => {
    expect(toCabinetPayload({ name: "  Cabinet  ", address: " Rue ", notes: "" })).toEqual({ nom: "Cabinet", adresse: "Rue", mentions: "" });
  });

  it("contrôles avant envoi", () => {
    expect(validateCabinet({ name: "  ", address: "", notes: "" })).toMatch(/nom du cabinet/);
    expect(validateCabinet({ name: "x".repeat(121), address: "", notes: "" })).toMatch(/120/);
    expect(validateCabinet({ name: "Cabinet", address: "", notes: "m".repeat(1001) })).toMatch(/1000/);
    expect(validateCabinet({ name: "Cabinet", address: "", notes: "" })).toBeNull();
    expect(validateLogoFile({ type: "image/gif", size: 10 })).toMatch(/PNG, JPEG ou WebP/);
    expect(validateLogoFile({ type: "image/png", size: 2 * 1024 * 1024 })).toMatch(/1 Mo/);
    expect(validateLogoFile({ type: "image/webp", size: 2048 })).toBeNull();
  });
});

describe("durée de conservation du journal", () => {
  it("de 6 mois à 10 ans, en jours entiers", () => {
    expect(normalizeCabinet({ nom: "X", retention_jours: 730 }).retentionDays).toBe(730);
    expect(normalizeCabinet({ nom: "X" }).retentionDays).toBe(365);
    expect(parseRetention(" 400 ")).toEqual({ days: 400 });
    expect(parseRetention("179").error).toMatch(/180 \(6 mois\) à 3650 \(10 ans\)/);
    expect(parseRetention("3651").error).toBeTruthy();
    expect(parseRetention("365.5").error).toBeTruthy();
  });
});
