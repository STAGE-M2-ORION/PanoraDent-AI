/**
 * Règles d'un nouveau mot de passe, cochées en direct à la saisie.
 * Plus strictes que le minimum du backend (8 caractères) : c'est l'interface
 * qui pousse vers un mot de passe solide, le serveur garde son propre plancher.
 */
export const PASSWORD_RULES = [
  { id: "length", label: "12 caractères minimum", test: (v) => v.length >= 12 },
  { id: "case", label: "Une majuscule et une minuscule", test: (v) => /[A-Z]/.test(v) && /[a-z]/.test(v) },
  { id: "digit", label: "Un chiffre", test: (v) => /\d/.test(v) },
  { id: "special", label: "Un caractère spécial", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

const STRENGTH_LABELS = ["à saisir", "faible", "moyenne", "bonne", "solide"];

/** `{ rules: [{…, ok}], level (0-4), levelLabel, valid }` pour une saisie. */
export function evaluatePassword(value) {
  const rules = PASSWORD_RULES.map((rule) => ({ ...rule, ok: rule.test(value) }));
  const passed = rules.filter((r) => r.ok).length;
  const level = value ? Math.max(1, passed) : 0;
  return { rules, level, levelLabel: STRENGTH_LABELS[level], valid: passed === rules.length };
}
