/** Concatène des noms de classes en ignorant les valeurs fausses. */
export function cx(...values) {
  return values.flat().filter(Boolean).join(" ");
}

/** Initiales (2 lettres max) d'un nom ou d'un e-mail : « Dr Rakoto » → « DR ». */
export function initials(value) {
  const text = String(value ?? "").split("@")[0].trim();
  if (!text) return "?";
  const words = text.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((w) => w[0]).join("") : text.slice(0, 2);
  return letters.slice(0, 2).toUpperCase();
}
