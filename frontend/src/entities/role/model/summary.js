/**
 * Résumé en clair de ce qu'un rôle autorise, pour qu'un administrateur sache
 * ce qu'il accorde sans lire la matrice.
 */

const ACTIONS = [
  { codes: ["analysis:read"], text: "consulter les analyses" },
  { codes: ["analysis:create"], text: "importer et lancer des analyses" },
  { codes: ["analysis:delete"], text: "supprimer des analyses" },
  { codes: ["detection:review"], text: "relire et corriger les détections" },
  { codes: ["report:generate"], text: "générer les comptes rendus" },
  { codes: ["model:read"], text: "consulter la performance du modèle" },
  { codes: ["user:manage"], text: "créer et gérer les comptes" },
  { codes: ["role:manage"], text: "modifier les rôles et leurs permissions" },
];

/** « a », « a et b », « a, b et c ». */
export function frenchList(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`;
}

/**
 * @param {string[]} codes permissions du rôle
 * @returns {{ can: string, cannot: string, admin: boolean }}
 */
export function summarizeRole(codes = []) {
  const set = new Set(codes);
  const allowed = ACTIONS.filter((a) => a.codes.every((c) => set.has(c))).map((a) => a.text);
  const denied = ACTIONS.filter((a) => !a.codes.every((c) => set.has(c))).map((a) => a.text);
  return {
    can: allowed.length ? `Peut ${frenchList(allowed)}.` : "N’accorde aucune permission : ce rôle ne donne accès à rien.",
    cannot: allowed.length && denied.length ? `Ne peut pas ${frenchList(denied)}.` : "",
    admin: set.has("user:manage") || set.has("role:manage"),
  };
}
