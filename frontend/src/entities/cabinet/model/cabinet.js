import { API_BASE_URL } from "@/shared/config";

/**
 * Paramètres du cabinet (sprint 8) : en-tête des comptes rendus. DTO
 * `GET /cabinet` → modèle applicatif. `logoUrl` change à chaque import
 * (`?v=`), le navigateur peut donc garder le logo en cache sans risque.
 */
export function normalizeCabinet(dto = {}) {
  return {
    name: dto.nom ?? "",
    address: dto.adresse ?? "",
    notes: dto.mentions ?? "",
    hasLogo: Boolean(dto.logo),
    logoUrl: dto.logo && dto.logo_version ? `${API_BASE_URL}/cabinet/logo?v=${encodeURIComponent(dto.logo_version)}` : null,
    updatedAt: dto.maj_le ?? null,
    updatedBy: dto.maj_par_nom ?? null,
  };
}

/** Modèle → corps de `PUT /cabinet`. */
export function toCabinetPayload({ name, address, notes }) {
  return { nom: name.trim(), adresse: (address ?? "").trim(), mentions: (notes ?? "").trim() };
}

export const CABINET_LIMITS = { name: 120, address: 500, notes: 1000, logoBytes: 1024 * 1024 };

/** Contrôle avant envoi (le serveur vérifie aussi) ; message d'erreur ou null. */
export function validateCabinet({ name, address, notes }) {
  if (!name.trim()) return "Indiquez le nom du cabinet.";
  if (name.trim().length > CABINET_LIMITS.name) return `Le nom ne dépasse pas ${CABINET_LIMITS.name} caractères.`;
  if ((address ?? "").length > CABINET_LIMITS.address) return `L’adresse ne dépasse pas ${CABINET_LIMITS.address} caractères.`;
  if ((notes ?? "").length > CABINET_LIMITS.notes) return `Les mentions ne dépassent pas ${CABINET_LIMITS.notes} caractères.`;
  return null;
}

/** Logo choisi : type et poids, avant tout envoi. */
export function validateLogoFile(file) {
  if (!file) return "Choisissez une image.";
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Formats acceptés : PNG, JPEG ou WebP.";
  if (file.size > CABINET_LIMITS.logoBytes) return "Le logo dépasse 1 Mo.";
  return null;
}
