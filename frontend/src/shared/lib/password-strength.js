/**
 * Indicateur de robustesse d'un mot de passe.
 *
 * Il GUIDE sans imposer de caractère spécial : la seule règle bloquante est
 * celle du serveur (12 caractères au moins, 72 octets au plus, pas de mot de
 * passe répétitif ni égal à l'adresse). Une phrase de passe longue et simple
 * est donc bien notée ; une suite courte et « compliquée » ne l'est pas.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

const LABELS = ["Trop court", "Faible", "Moyen", "Bon", "Très bon"];

const COMMON = ["motdepasse", "password", "azerty", "qwerty", "123456", "panoradent", "dentiste", "cabinet"];

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

/**
 * @returns {{ score: 0|1|2|3|4, label: string, valid: boolean, problem: string|null }}
 * `valid` reprend exactement les refus du serveur ; `problem` explique le
 * premier refus en français.
 */
export function evaluatePassword(password = "", email = "") {
  const value = String(password);
  const lower = value.toLowerCase();
  const local = String(email).toLowerCase().split("@")[0];

  let problem = null;
  if (value.length < PASSWORD_MIN_LENGTH) {
    problem = `Au moins ${PASSWORD_MIN_LENGTH} caractères (${value.length} pour l’instant).`;
  } else if (byteLength(value) > PASSWORD_MAX_BYTES) {
    problem = `Pas plus de ${PASSWORD_MAX_BYTES} octets (les lettres accentuées comptent double).`;
  } else if (new Set(value).size < 4) {
    problem = "Trop répétitif.";
  } else if (email && (lower.trim() === String(email).toLowerCase() || (local && lower.trim() === local))) {
    problem = "Ne reprenez pas votre adresse e-mail.";
  }
  if (problem) return { score: 0, label: LABELS[0], valid: false, problem };

  let points = 0;
  if (value.length >= 16) points += 1;
  if (value.length >= 20) points += 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((re) => re.test(value)).length;
  if (classes >= 2) points += 1;
  if (classes >= 3 || /\s/.test(value)) points += 1;
  if (new Set(lower).size >= 10) points += 1;
  if (COMMON.some((word) => lower.includes(word))) points -= 2;
  if (local && local.length >= 4 && lower.includes(local)) points -= 1;

  const score = Math.max(1, Math.min(4, points));
  return { score, label: LABELS[score], valid: true, problem: null };
}
