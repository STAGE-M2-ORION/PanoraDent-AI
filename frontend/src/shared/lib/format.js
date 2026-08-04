/** Confiance 0–1 → pourcentage lisible. */
export function formatConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)} %`;
}

/** Accord en nombre, sans dépendance i18n. */
export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count > 1 ? plural : singular}`;
}
