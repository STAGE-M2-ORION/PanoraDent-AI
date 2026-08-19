import { Boxes, FileDown, ScanSearch, ShieldCheck } from "lucide-react";

/**
 * Contenu éditorial de la vitrine, isolé des composants qui le rendent.
 *
 * Les classes utilitaires sont écrites **en toutes lettres**, y compris les
 * valeurs arbitraires de position : Tailwind scanne le texte source et ne
 * génère que les classes qu'il y trouve littéralement.
 */

export const FEATURES = [
  {
    icon: ScanSearch,
    title: "Détection assistée",
    description:
      "Le service d'inférence localise les dents et les anomalies — caries, lésions périapicales, dents incluses. Chaque proposition porte son score de confiance.",
  },
  {
    icon: ShieldCheck,
    title: "Anonymisation à l'import",
    description:
      "Les champs identifiants du DICOM sont retirés avant la moindre écriture. Rien d'identifiant n'atteint le stockage.",
  },
  {
    icon: FileDown,
    title: "Rapport PDF",
    description:
      "Un compte rendu daté reprend l'image annotée et la liste des détections retenues, généré à la demande depuis l'analyse affichée.",
  },
  {
    icon: Boxes,
    title: "Inférence isolée",
    description:
      "Le modèle tourne dans un service séparé du backend. En mode mock, toute la chaîne se teste sans GPU ni modèle entraîné.",
  },
];

export const PIPELINE_STEPS = [
  {
    title: "Import",
    description: "Une panoramique DICOM, JPG ou PNG est déposée depuis le poste de travail.",
  },
  {
    title: "Anonymisation",
    description: "Les métadonnées identifiantes sont supprimées avant toute persistance.",
  },
  {
    title: "Stockage",
    description: "L'image rejoint le stockage objet S3 ; ses métadonnées, PostgreSQL.",
  },
  {
    title: "Inférence",
    description: "Le service isolé renvoie les boîtes détectées, leur classe et leur confiance.",
  },
  {
    title: "Rapport",
    description: "Le praticien arbitre, puis exporte le compte rendu PDF.",
  },
];

/**
 * Boîtes de détection du visuel d'en-tête — décoratives, elles n'illustrent
 * aucune analyse réelle. `tone` est résolu en classes littérales par
 * `HeroVisual`, jamais concaténé.
 */
export const HERO_DETECTIONS = [
  { id: "tooth", tone: "normal", label: "Dent 36", className: "left-[16%] top-[52%] h-[26%] w-[12%]" },
  { id: "caries", tone: "anomaly", label: "Carie 0.88", className: "left-[43%] top-[22%] h-[22%] w-[11%]" },
  { id: "lesion", tone: "anomaly", label: "Lésion 0.71", className: "left-[70%] top-[56%] h-[24%] w-[13%]" },
];
