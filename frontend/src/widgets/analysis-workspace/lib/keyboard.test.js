import { describe, expect, it } from "vitest";

import { keyBelongsToField } from "./keyboard";

/** Élément minimal : `closest` sur la balise et un éventuel ancêtre. */
const el = (tag, { type, ancestor } = {}) => {
  const self = { tagName: tag, type };
  self.closest = (selector) => {
    const tags = selector.split(",").map((s) => s.trim());
    if (tags.includes(tag)) return self;
    if (ancestor && tags.includes(ancestor)) return { tagName: ancestor };
    return null;
  };
  return self;
};

describe("raccourcis de la visionneuse et champs de saisie", () => {
  it("hors champ : les raccourcis s'appliquent", () => {
    expect(keyBelongsToField(el("div"), "j")).toBe(false);
    expect(keyBelongsToField(el("button"), "h")).toBe(false);
    expect(keyBelongsToField(null, "j")).toBe(false);
  });

  it("champ de texte, zone de commentaire, liste : la touche est au champ", () => {
    expect(keyBelongsToField(el("input", { type: "text" }), "j")).toBe(true);
    expect(keyBelongsToField(el("input", { type: "search" }), "0")).toBe(true);
    expect(keyBelongsToField(el("textarea"), "h")).toBe(true);
    expect(keyBelongsToField(el("select"), "ArrowDown")).toBe(true);
    expect(keyBelongsToField(el("span", { ancestor: "[contenteditable='true']" }), "k")).toBe(true);
  });

  it("curseur de seuil : les flèches le règlent, les autres touches restent des raccourcis", () => {
    const seuil = el("input", { type: "range" });
    expect(keyBelongsToField(seuil, "ArrowLeft")).toBe(true);
    expect(keyBelongsToField(seuil, "+")).toBe(false);
    expect(keyBelongsToField(seuil, "j")).toBe(false);
  });

  it("case à cocher : jamais une saisie", () => {
    expect(keyBelongsToField(el("input", { type: "checkbox" }), "h")).toBe(false);
  });
});
