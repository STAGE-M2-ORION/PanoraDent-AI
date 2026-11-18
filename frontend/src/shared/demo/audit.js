/**
 * Journal d'audit de DÉMONSTRATION (le backend n'enregistre pas encore de
 * journal). Sessions d'utilisateur et entrées, valeurs fictives de la maquette.
 */
const P1 = "Poste cabinet 1";
const P2 = "Poste cabinet 2";
const P3 = "Poste cabinet 3";

/** `state` : active | closed | expired | none (tentatives sans session ouverte). */
export const AUDIT_SESSIONS = {
  s1: { who: "Administrateur", n: "0187", poste: P2, method: "mail", state: "active" },
  s2: { who: "Dr Rakoto", n: "0188", poste: P1, method: "google", state: "active" },
  s3: { who: "Dr Rakoto", n: "0181", poste: P1, method: "mail", state: "closed" },
  s4: { who: "Dr Andria", n: "0182", poste: P3, method: "mail", state: "expired" },
  s5: { who: "Administrateur", n: "0176", poste: P2, method: "mail", state: "closed" },
  s6: { who: "Lecteur", n: "0171", poste: P3, method: "mail", state: "expired" },
  g1: { who: "Dr Fara", poste: P3, method: "mail", state: "none", title: "Tentatives de connexion" },
  g2: { who: "Non authentifié", poste: P3, method: "mail", state: "none", title: "Tentatives de connexion" },
};

const row = (days, time, author, action, target, detail, poste, type, result, session) => ({ days, time, author, action, target, detail, poste, type, result, session });

export const AUDIT_ENTRIES = [
  row(0, "10:12", "Administrateur", "Export du journal d’audit", "Journal · 7 derniers jours", "", P2, "Comptes et rôles", "ok", "s1"),
  row(0, "09:58", "Dr Rakoto", "Génération du compte rendu", "Analyse 0041", "", P1, "Comptes rendus", "ok", "s2"),
  row(0, "09:40", "Dr Rakoto", "Clôture d’analyse", "Analyse 0040", "", P1, "Analyses", "ok", "s2"),
  row(0, "09:12", "Dr Rakoto", "Connexion avec Google", "Compte Dr Rakoto", "Adresse Google vérifiée", P1, "Connexions", "ok", "s2"),
  row(0, "08:47", "Administrateur", "Modification d’un rôle personnalisé", "Rôle « Assistant de recherche »", "", P2, "Comptes et rôles", "ok", "s1"),
  row(0, "08:12", "Administrateur", "Connexion", "Compte Administrateur", "", P2, "Connexions", "ok", "s1"),
  row(1, "17:30", "Dr Andria", "Changement de mot de passe", "Compte Dr Andria", "", P3, "Comptes et rôles", "ok", "s4"),
  row(1, "17:28", "Dr Andria", "Connexion", "Compte Dr Andria", "", P3, "Connexions", "ok", "s4"),
  row(1, "16:20", "Dr Rakoto", "Déconnexion", "Compte Dr Rakoto", "", P1, "Connexions", "ok", "s3"),
  row(1, "16:05", "Dr Rakoto", "Réouverture d’analyse", "Analyse 0035", "Motif : « Correction d’un type de détection après relecture »", P1, "Analyses", "ok", "s3"),
  row(1, "15:20", "Dr Rakoto", "Suppression d’analyse", "Analyse 0031", "", P1, "Analyses", "ok", "s3"),
  row(1, "14:58", "Dr Rakoto", "Connexion", "Compte Dr Rakoto", "", P1, "Connexions", "ok", "s3"),
  row(2, "16:41", "Système", "Verrouillage temporaire du compte", "Compte Dr Fara", "Après 5 échecs de connexion", "Serveur", "Connexions", "ok", "g1"),
  row(2, "16:40", "Dr Fara", "Connexion", "Compte Dr Fara", "5e échec consécutif", P3, "Connexions", "ko", "g1"),
  row(2, "16:39", "Dr Fara", "Connexion", "Compte Dr Fara", "4e échec consécutif", P3, "Connexions", "ko", "g1"),
  row(2, "14:24", "Administrateur", "Déconnexion", "Compte Administrateur", "", P2, "Connexions", "ok", "s5"),
  row(2, "14:20", "Administrateur", "Changement de rôle", "Compte Lecteur 2", "Praticien → Lecteur", P2, "Comptes et rôles", "ok", "s5"),
  row(2, "14:15", "Administrateur", "Création de compte", "Compte Lecteur 2", "", P2, "Comptes et rôles", "ok", "s5"),
  row(2, "14:10", "Administrateur", "Connexion", "Compte Administrateur", "", P2, "Connexions", "ok", "s5"),
  row(3, "08:36", "Lecteur", "Consultation d’analyse", "Analyse 0038", "", P3, "Analyses", "ok", "s6"),
  row(3, "08:30", "Lecteur", "Connexion", "Compte Lecteur", "", P3, "Connexions", "ok", "s6"),
  row(4, "18:03", "Non authentifié", "Connexion", "Adresse inconnue", "Compte inexistant", P3, "Connexions", "ko", "g2"),
  row(4, "17:55", "Non authentifié", "Connexion avec Google", "Adresse Google inconnue", "Aucun compte associé, aucun compte créé", P3, "Connexions", "ko", "g2"),
];

export const AUDIT_AUTHORS = ["Administrateur", "Dr Rakoto", "Dr Andria", "Dr Fara", "Lecteur", "Système"];
export const AUDIT_TYPES = ["Connexions", "Comptes et rôles", "Analyses", "Comptes rendus"];
