/** Confiance en pourcentage entier → « 91 % » (« — » si absente). */
export function formatConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${Math.round(value)} %`;
}

/** Accord en nombre, sans dépendance i18n. */
export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count > 1 ? plural : singular}`;
}

/** Les dates du backend sont en UTC sans fuseau : on le rend explicite. */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
}

/** « 16/11/2026 » */
export function formatDate(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

/** « 14:32 » */
export function formatTime(value) {
  const d = toDate(value);
  return d ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
}

/** « 16/11/2026 à 14:32 » */
export function formatDateTime(value) {
  const d = toDate(value);
  return d ? `${formatDate(d)} à ${formatTime(d)}` : "—";
}
