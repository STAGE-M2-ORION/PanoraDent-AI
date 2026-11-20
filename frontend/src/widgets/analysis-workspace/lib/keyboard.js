/** Raccourcis clavier de la visionneuse. */

const NOT_TEXT = new Set(["range", "checkbox", "radio", "button", "submit", "reset"]);
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * La touche appartient au champ ciblé : saisie de texte, liste déroulante, ou
 * flèches sur un curseur (seuil de confiance). Les raccourcis s'effacent alors.
 */
export function keyBelongsToField(el, key) {
  if (!el?.closest) return false;
  if (el.closest("textarea, select, [contenteditable='true']")) return true;
  const input = el.closest("input");
  if (!input) return false;
  if (!NOT_TEXT.has(input.type)) return true;
  return input.type === "range" && ARROWS.has(key);
}
