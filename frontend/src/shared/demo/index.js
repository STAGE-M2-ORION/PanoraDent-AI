/**
 * Données de DÉMONSTRATION — fictives, aucune vraie donnée de santé.
 *
 * Elles alimentent les écrans de la maquette pour lesquels le backend n'expose
 * pas encore de route : journal d'audit, supervision, statut de relecture des
 * analyses, indicateurs du tableau de bord, notifications. Elles sont toutes
 * regroupées ici pour être remplacées sans fouiller le reste du code : le jour
 * où une route existe, l'entité concernée appelle l'API et ce module recule.
 *
 * Les classes de détection reprennent les libellés du backend
 * (`tooth`, `caries`, `deep_caries`, `periapical_lesion`, `impacted_tooth`).
 */

export const DEMO_NOTICE = "Données de démonstration";

const today = new Date();
export const daysAgo = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
};

/** Neuf détections d'anomalies sur l'image simulée — 6 relues, 3 non revues. */
export const demoDetections = [
  { id: "d1", fdi: 36, label: "deep_caries", confidence: 91, status: "validated", source: "ai" },
  { id: "d7", fdi: 36, label: "periapical_lesion", confidence: 58, status: "validated", source: "ai" },
  { id: "d3", fdi: 38, label: "impacted_tooth", confidence: 94, status: "validated", source: "ai" },
  { id: "d5", fdi: 48, label: "impacted_tooth", confidence: 88, status: "validated", source: "ai" },
  { id: "d2", fdi: 46, label: "periapical_lesion", confidence: 78, status: "pending", source: "ai" },
  { id: "d4", fdi: 26, label: "caries", confidence: 63, status: "pending", source: "ai" },
  { id: "d6", fdi: 17, label: "caries", confidence: 72, status: "corrected", source: "ai", note: "Type corrigé : carie profonde → carie (atteinte limitée à l'émail).", was: "deep_caries" },
  { id: "d8", fdi: 24, label: "caries", confidence: 41, status: "pending", source: "ai" },
  { id: "d9", fdi: 45, label: "caries", confidence: null, status: "added", source: "user", note: "Ajoutée à la relecture : zone distale." },
];

export const demoAnalysis = {
  number: "0042",
  patientId: "7F3A",
  model: "panoradent-yolo v0.3.1 (fictif)",
  modelShort: "v0.3.1",
  dataset: "DENTEX (MICCAI 2023, jeu public)",
  teethCount: 31,
  reviewer: "Dr Rakoto",
  threshold: 50,
};

/** Statut de relecture d'une analyse (absent du backend pour l'instant). */
export const HISTORY_STATUS = {
  pending: { label: "À relire", tone: "warning" },
  inprogress: { label: "Relecture en cours", tone: "info" },
  closed: { label: "Clôturée", tone: "success" },
  failed: { label: "Échec de l'analyse", tone: "danger" },
};

/** Notifications de la cloche, par profil (aucune route de notification côté serveur). */
export const demoNotifications = {
  practitioner: [
    { title: "Analyse n° 0042 à terminer", text: "3 détections attendent votre décision", href: "/historique" },
    { title: "Modèle v0.3.1 en service", text: "Voir comment il a été évalué", href: "/performance" },
  ],
  viewer: [
    { title: "Analyse n° 0037 clôturée", text: "Compte rendu disponible", href: "/historique" },
    { title: "Modèle v0.3.1 en service", text: "Voir comment il a été évalué", href: "/performance" },
  ],
  admin: [
    { title: "2 demandes d’accès", text: "Cabinet Andria, Cabinet Mahafaly", href: "/admin/comptes" },
    { title: "Inférence : temps de réponse élevé", text: "Incident en cours depuis 6 h", href: "/admin/supervision" },
  ],
};
