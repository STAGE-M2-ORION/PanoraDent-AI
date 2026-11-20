/** Filtrage, tri, pagination et indicateurs de la liste des comptes (sans interface). */

export const PAGE_SIZE = 10;

export function filterAccounts(users, { q = "", role = "", status = "" } = {}) {
  const needle = q.trim().toLowerCase();
  return users.filter(
    (u) =>
      (!needle || `${u.fullName} ${u.email}`.toLowerCase().includes(needle)) &&
      (!role || String(u.roleId) === role) &&
      (!status || (status === "actif" ? u.isActive : status === "jamais" ? u.isActive && !u.lastLoginAt : !u.isActive)),
  );
}

const KEYS = {
  name: (u) => (u.fullName || u.email).toLocaleLowerCase("fr"),
  role: (u) => (u.role || "").toLocaleLowerCase("fr"),
  status: (u) => (u.isActive ? 0 : 1),
  // Jamais connecté : en dernier dans l'ordre décroissant, en premier dans l'ordre croissant.
  lastLogin: (u) => (u.lastLoginAt ? u.lastLoginAt.getTime() : -Infinity),
};

/** Tri stable ; `dir` vaut `asc` ou `desc`. Égalités départagées par le nom. */
export function sortAccounts(users, { key = "name", dir = "asc" } = {}) {
  const get = KEYS[key] ?? KEYS.name;
  const sign = dir === "desc" ? -1 : 1;
  return [...users].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return KEYS.name(a).localeCompare(KEYS.name(b), "fr");
  });
}

/** Indicateurs d'administration : comptes par rôle, jamais connectés, désactivés. */
export function accountStats(users) {
  const byRole = new Map();
  for (const u of users) byRole.set(u.role || "—", (byRole.get(u.role || "—") ?? 0) + 1);
  return {
    total: users.length,
    byRole: [...byRole.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")),
    neverLoggedIn: users.filter((u) => u.isActive && !u.lastLoginAt).length,
    disabled: users.filter((u) => !u.isActive).length,
  };
}
