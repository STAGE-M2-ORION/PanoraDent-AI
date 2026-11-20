import { describe, expect, it } from "vitest";

import { evaluatePassword } from "./password-strength";
import { resolveTheme } from "./theme";

describe("indicateur de robustesse", () => {
  it("reprend les refus du serveur", () => {
    expect(evaluatePassword("court")).toMatchObject({ valid: false, score: 0 });
    expect(evaluatePassword("court").problem).toMatch(/12 caractères/);
    expect(evaluatePassword("é".repeat(40)).problem).toMatch(/72 octets/);
    expect(evaluatePassword("abababababababab").problem).toMatch(/répétitif/);
    expect(evaluatePassword("dr.martin@cabinet.fr", "dr.martin@cabinet.fr").problem).toMatch(/adresse/);
  });

  it("n'impose aucun caractère spécial : une phrase de passe est bien notée", () => {
    const phrase = evaluatePassword("cheval correct batterie agrafe");
    expect(phrase.valid).toBe(true);
    expect(phrase.score).toBeGreaterThanOrEqual(3);
  });

  it("une suite courte mais « compliquée » n'est pas mieux notée qu'une phrase", () => {
    const court = evaluatePassword("Az3!kq9#Lm2?");
    expect(court.valid).toBe(true);
    expect(court.score).toBeLessThanOrEqual(evaluatePassword("cheval correct batterie agrafe").score);
  });

  it("pénalise les mots courants et l'adresse", () => {
    expect(evaluatePassword("motdepasse2026!!").score).toBeLessThanOrEqual(2);
    expect(evaluatePassword("rabe rabe rabe 2026 x", "rabe@cabinet.fr").score).toBeLessThan(
      evaluatePassword("lune verte sous la pluie", "rabe@cabinet.fr").score,
    );
  });
});

describe("thème", () => {
  it("préférence du compte → thème effectif", () => {
    expect(resolveTheme("sombre")).toBe("dark");
    expect(resolveTheme("clair", true)).toBe("light");
    expect(resolveTheme("systeme", true)).toBe("dark");
    expect(resolveTheme("systeme", false)).toBe("light");
    expect(resolveTheme(undefined, true)).toBe("dark");
  });
});
