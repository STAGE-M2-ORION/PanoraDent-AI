/** Version active de la liste ; à défaut, aucune (jamais « la plus récente » par supposition). */
export function activeVersion(versions) {
  return (versions ?? []).find((v) => v.active) ?? null;
}

/** Empreinte abrégée pour l'affichage (12 caractères), « — » si absente. */
export function shortHash(hash) {
  return hash ? String(hash).slice(0, 12) : "—";
}

/**
 * Pourquoi une version ne peut pas être activée, ou `null` si elle le peut.
 * Le serveur revérifie tout : ceci n'évite qu'un clic inutile.
 */
export function activationBlocker(version) {
  if (!version) return "Version inconnue.";
  if (version.active) return "Cette version est déjà active.";
  if (!version.servable) return "Les deux fichiers de poids (dents et anomalies) ne sont pas publiés.";
  return null;
}

/** Mesures résumées publiées avec la version (modèle anomalies), ou `null` si absentes. */
export function headlineMetrics(version) {
  const m = version?.metrics ?? {};
  if (typeof m.map50 !== "number") return null;
  return { map50: m.map50, precision: m.precision ?? null, recall: m.recall ?? null, testImages: m.test_images ?? null, partition: m.partition ?? null };
}
