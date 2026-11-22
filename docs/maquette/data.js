/* PanoraDent AI — données FICTIVES de la maquette. Aucune vraie donnée de santé, aucun vrai nom. */
(function () {
  const today = new Date();
  const fmt = (d) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };

  const TYPES = {
    tooth:      { label: "Dent (numéro FDI)",     short: "Dent",              cls: "det-tooth",      color: "#56B4E9" },
    caries:     { label: "Carie",                 short: "Carie",             cls: "det-caries",     color: "#F0E442" },
    deep:       { label: "Carie profonde",        short: "Carie profonde",    cls: "det-deep",       color: "#D55E00" },
    periapical: { label: "Lésion péri-apicale",   short: "Lésion péri-apicale", cls: "det-periapical", color: "#CC79A7" },
    impacted:   { label: "Dent incluse",          short: "Dent incluse",      cls: "det-impacted",   color: "#009E73" }
  };

  const STATUS = {
    pending:   { label: "Non revue",               badge: "badge" },
    validated: { label: "Validée",                 badge: "badge badge-success" },
    corrected: { label: "Corrigée",                badge: "badge badge-info" },
    added:     { label: "Ajoutée par le praticien", badge: "badge badge-primary" }
  };

  /* 9 détections d'anomalies — 6 relues, 3 non revues */
  const detections = [
    { id: "d1", fdi: 36, type: "deep",       conf: 91, status: "validated", source: "ai" },
    { id: "d7", fdi: 36, type: "periapical", conf: 58, status: "validated", source: "ai" },
    { id: "d3", fdi: 38, type: "impacted",   conf: 94, status: "validated", source: "ai" },
    { id: "d5", fdi: 48, type: "impacted",   conf: 88, status: "validated", source: "ai" },
    { id: "d2", fdi: 46, type: "periapical", conf: 78, status: "pending",   source: "ai" },
    { id: "d4", fdi: 26, type: "caries",     conf: 63, status: "pending",   source: "ai" },
    { id: "d6", fdi: 17, type: "caries",     conf: 72, status: "corrected", source: "ai", note: "Type corrigé : carie profonde → carie (atteinte limitée à l'émail).", was: "deep" },
    { id: "d8", fdi: 24, type: "caries",     conf: 41, status: "pending",   source: "ai" },
    { id: "d9", fdi: 45, type: "caries",     conf: null, status: "added",   source: "user", note: "Ajoutée à la relecture : zone distale." }
  ];

  const analysis = {
    number: "0042",
    patientId: "7F3A",
    date: fmt(today),
    model: "panoradent-yolo v0.3.1 (fictif)",
    modelShort: "v0.3.1",
    dataset: "DENTEX (MICCAI 2023, jeu public)",
    teethCount: 31,
    reviewer: "Dr Rakoto",
    threshold: 50
  };

  const history = [
    { n: "0042", id: "7F3A", date: fmt(today),       status: "inprogress", count: 9, types: ["deep","periapical","impacted","caries"] },
    { n: "0041", id: "2C91", date: fmt(daysAgo(1)),  status: "closed",     count: 3, types: ["caries"] },
    { n: "0040", id: "B07E", date: fmt(daysAgo(1)),  status: "closed",     count: 5, types: ["caries","impacted"] },
    { n: "0039", id: "51DA", date: fmt(daysAgo(2)),  status: "pending",    count: 4, types: ["periapical","caries"] },
    { n: "0038", id: "E4F2", date: fmt(daysAgo(4)),  status: "closed",     count: 0, types: [] },
    { n: "0037", id: "9A6C", date: fmt(daysAgo(5)),  status: "closed",     count: 2, types: ["deep"] },
    { n: "0036", id: "C3B8", date: fmt(daysAgo(6)),  status: "failed",     count: 0, types: [] },
    { n: "0035", id: "7D10", date: fmt(daysAgo(8)),  status: "closed",     count: 6, types: ["caries","deep","periapical"] },
    { n: "0034", id: "40EF", date: fmt(daysAgo(9)),  status: "closed",     count: 1, types: ["impacted"] },
    { n: "0033", id: "A82B", date: fmt(daysAgo(11)), status: "closed",     count: 3, types: ["caries","periapical"] }
  ];
  const HISTORY_STATUS = {
    pending:    { label: "À relire",           badge: "badge badge-warning badge-dot" },
    inprogress: { label: "Relecture en cours", badge: "badge badge-info badge-dot" },
    closed:     { label: "Clôturée",           badge: "badge badge-success badge-dot" },
    failed:     { label: "Échec de l'analyse", badge: "badge badge-danger badge-dot" }
  };

  const users = {
    admin:     { key: "admin",     name: "Administrateur",          initials: "AD", role: "Administrateur", email: "admin@demo.panoradent.test" },
    praticien: { key: "praticien", name: "Dr Rakoto",               initials: "DR", role: "Praticien",      email: "rakoto@demo.panoradent.test" },
    lecteur:   { key: "lecteur",   name: "Lecteur",                 initials: "LE", role: "Lecteur",        email: "lecteur@demo.panoradent.test" }
  };

  window.DEMO = { TYPES, STATUS, detections, analysis, history, HISTORY_STATUS, users, fmt, daysAgo };
})();
