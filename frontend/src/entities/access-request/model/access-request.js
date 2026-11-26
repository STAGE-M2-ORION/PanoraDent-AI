/**
 * Demandes d'accès (sprint 13) : il n'y a pas d'inscription libre ; le
 * visiteur demande, l'administrateur accepte (et choisit le rôle) ou refuse.
 */
export const AccessRequestStatus = Object.freeze({ PENDING: "en_attente", ACCEPTED: "acceptee", REFUSED: "refusee" });

export const STATUS_LABELS = {
  [AccessRequestStatus.PENDING]: { label: "En attente", tone: "warning" },
  [AccessRequestStatus.ACCEPTED]: { label: "Acceptée", tone: "success" },
  [AccessRequestStatus.REFUSED]: { label: "Refusée", tone: "danger" },
};

export const PROFILES = ["Chirurgien-dentiste", "Enseignant ou jury", "Autre"];

/** Rôle proposé à l'acceptation selon le profil déclaré (l'administrateur peut le changer). */
export function suggestedRoleName(profile) {
  return profile === "Chirurgien-dentiste" ? "Praticien" : "Lecteur";
}

export function normalizeAccessRequest(dto) {
  return {
    id: dto.id,
    name: dto.nom,
    email: dto.email,
    profile: dto.profil,
    office: dto.etablissement ?? "",
    city: dto.ville ?? "",
    message: dto.message ?? "",
    status: dto.statut,
    createdAt: dto.cree_le,
    decidedAt: dto.traitee_le ?? null,
    refusalReason: dto.motif_refus ?? "",
    accountId: dto.utilisateur_id ?? null,
  };
}

/** Contrôle avant envoi, mêmes bornes que le serveur ; null si tout va bien. */
export function validateAccessRequest(form) {
  if (!form.name.trim() || form.name.trim().length < 2) return "Indiquez votre nom et votre prénom.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Indiquez une adresse e-mail valide.";
  if (!PROFILES.includes(form.profile)) return "Choisissez votre profil.";
  if (form.message.length > 1000) return "Le message ne doit pas dépasser 1 000 caractères.";
  return null;
}
