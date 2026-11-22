/* PanoraDent AI — structure commune de l'application connectée (maquette).
   Utilisation dans une page :
   <body data-page="historique" data-allow="admin praticien lecteur">
     <div class="app"><aside class="sidebar" id="sidebar"></aside>
       <div class="main"><header class="topbar"><h1>Titre</h1></header><main class="page">…</main></div></div>
   - Rôle de démonstration : ?role=admin|praticien|lecteur (gardé dans tous les liens internes).
   - data-roles="admin praticien" sur un élément : visible seulement pour ces rôles.
   - data-allow sur <body> : rôle non autorisé → écran « Accès refusé (403) ».
   - <i data-icon="nom"></i> : remplacé par l'icône SVG. */
(function () {
  const P = {
    arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    arrowDownRight: '<path d="m7 7 10 10"/><path d="M17 7v10H7"/>',
    minus: '<path d="M5 12h14"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
    printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/><path d="M10 11v6M14 11v6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    chevronleft: '<path d="m15 6-6 6 6 6"/>',
    chevrondown: '<path d="m6 9 6 6 6-6"/>',
    zoomin: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M11 8v6M8 11h6"/>',
    zoomout: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M8 11h6"/>',
    maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
    message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    thumbup: '<path d="M7 10v11H3V10z"/><path d="M7 10l4-7a2.5 2.5 0 0 1 3 3l-1 4h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7"/>',
    thumbdown: '<path d="M7 14V3H3v11z"/><path d="M7 14l4 7a2.5 2.5 0 0 0 3-3l-1-4h6a2 2 0 0 0 2-2.3l-1.3-7A2 2 0 0 0 17.7 3H7"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    move: '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/>',
    hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6"/><path d="M11 11V3.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V5a1.5 1.5 0 0 1 3 0v8"/><path d="M17 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.6 15a1.5 1.5 0 0 1 2.3-2L8 15"/>',
    book: '<path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h14"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    box: '<path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    tooth: '<path d="M7 3c-2.5 0-4 2-4 4.5 0 3 1.5 5 2 8 .4 2.8 1 5.5 2.5 5.5S9.5 17 12 17s3 4 4.5 4 2.1-2.7 2.5-5.5c.5-3 2-5 2-8C21 5 19.5 3 17 3c-2 0-3 1-5 1S9 3 7 3z"/>'
  };
  // ── Jeu d'icônes PanoraDent (duotone) ────────────────────────────────────
  // Même grille (24), même trait (1,8), extrémités arrondies, currentColor.
  // Chaque icône de contenu = un aplat discret (.ic-f) + un trait (le corps) + un détail d'accent (.ic-a).
  // Les icônes d'interface (flèches, croix, chevrons, plus) restent en trait simple.
  const duo = (fill, line, accent) => {
    const arr = (v) => (v ? (Array.isArray(v) ? v : [v]) : []);
    return arr(fill).map((d) => `<path class="ic-f" d="${d}"/>`).join("") +
      arr(line).map((d) => `<path d="${d}"/>`).join("") +
      arr(accent).map((d) => `<path class="ic-a" d="${d}"/>`).join("");
  };
  const TOOTH = "M7.6 3.5c-2.4 0-4.1 1.9-4.1 4.5 0 2 .6 3.4 1.3 5.1l1 5.5c.2 1 .9 1.9 1.8 1.9s1.4-.8 1.8-2l.6-2.6c.2-.8.6-1.2 1.4-1.2s1.2.4 1.4 1.2l.6 2.6c.4 1.2.9 2 1.8 2s1.6-.9 1.8-1.9l1-5.5c.7-1.7 1.3-3.1 1.3-5.1 0-2.6-1.7-4.5-4.1-4.5-1.5 0-2.3.7-3.5.7s-2-.7-3.5-.7z";
  const DUO = {
    home: duo("M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z", "M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z", "M10 20v-4.5a2 2 0 0 1 4 0V20"),
    upload: duo("M4 15h16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3", ["M12 15V4", "m8 8 4-4 4 4"]),
    download: duo("M4 15h16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3", ["M12 4v11", "m8 11 4 4 4-4"]),
    history: duo("M12 3.5a8.5 8.5 0 1 1-8.5 8.5A8.5 8.5 0 0 1 12 3.5z", ["M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5", "M3.5 4v4.5H8"], "M12 8v4l2.5 1.5"),
    clock: duo("M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z", "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z", "M12 8v4.2l2.8 1.7"),
    chart: duo(["M7.5 12h3v6h-3z", "M13 8h3v10h-3z", "M18.5 13h2v5h-2z"], "M4 4v15a1 1 0 0 0 1 1h15", ["M7.5 12h3v6h-3z", "M13 8h3v10h-3z"]),
    users: duo(["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1z"], ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"], ["M16 4.3a3.5 3.5 0 0 1 0 6.4", "M18 14.2a5 5 0 0 1 3 4.8v1"]),
    user: duo(["M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20.5v-.5a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6v.5z"], "M4.5 20.5v-.5a6 6 0 0 1 6-6h3a6 6 0 0 1 6 6v.5", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"),
    shield: duo("M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z", "M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z", "m9 12 2.2 2.2L15.5 10"),
    key: duo("M8.5 11.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M8.5 11.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", ["M11.3 12.7 19.5 4.5", "M16.5 7.5 19 10", "M14 10l2 2"]),
    list: duo("", ["M9 6h11", "M9 12h11", "M9 18h11"], ["M4.5 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z", "M4.5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z", "M4.5 17a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"]),
    activity: duo("", ["M3 12h2.5", "M18.5 12H21"], "M5.5 12H8l2-5.5 4 11 2-5.5h2.5"),
    alert: duo("M10.3 4.9 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0z", "M10.3 4.9 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0z", ["M12 9.5v4", "M12 17h.01"]),
    info: duo("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", ["M12 11v5", "M12 7.8h.01"]),
    lock: duo("M5 11h14a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a1 1 0 0 1 1-1z", ["M5 11h14a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a1 1 0 0 1 1-1z", "M8 11V8a4 4 0 0 1 8 0v3"], "M12 15v2"),
    unlock: duo("M5 11h14a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a1 1 0 0 1 1-1z", ["M5 11h14a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a1 1 0 0 1 1-1z", "M8 11V8a4 4 0 0 1 7.6-1.7"], "M12 15v2"),
    database: duo("M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z", ["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z", "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"], "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"),
    server: duo(["M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M5 13h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z"], ["M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M5 13h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z"], ["M7.5 7.5h.01", "M7.5 16.5h.01", "M11.5 7.5H16", "M11.5 16.5H16"]),
    cpu: duo("M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", ["M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M9 2v3", "M15 2v3", "M9 19v3", "M15 19v3", "M2 9h3", "M2 15h3", "M19 9h3", "M19 15h3"], "M10 10h4v4h-4z"),
    box: duo("M21 8 12 3 3 8v8l9 5 9-5z", ["M21 8 12 3 3 8v8l9 5 9-5z", "m3 8 9 5 9-5", "M12 13v8"], "m7.5 5.5 9 5"),
    mail: duo("M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "m3.5 7 8.5 6 8.5-6"),
    file: duo("M6 3h8l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", ["M6 3h8l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M14 3v5h5"], ["M8 13h8", "M8 17h5"]),
    sparkle: duo("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M19 16.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"),
    bell: duo("M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z", "M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z", "M10 20a2 2 0 0 0 4 0"),
    printer: duo("M6 15H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1", ["M6 15H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1", "M7 9V4h10v5"], "M7 14h10v6H7z"),
    eye: duo("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z"),
    message: duo("M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-4 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-4 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", ["M8 10.5h.01", "M12 10.5h.01", "M16 10.5h.01"]),
    trash: duo("M6 8h12l-1 11a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19z", ["M6 8h12l-1 11a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19z", "M4 8h16", "M9.5 8V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V8"], ["M10 12v5", "M14 12v5"]),
    edit: duo("M4 20h4L19 9l-4-4L4 16z", "M4 20h4L19 9l-4-4L4 16z", "m13.5 6.5 4 4"),
    search: duo("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "m16.5 16.5 4 4"),
    // Icônes propres à PanoraDent : dessinées dans le même style
    tooth: duo(TOOTH, TOOTH, "M8 7.3c.3-.9 1-1.4 1.9-1.4"),
    pano: duo("M3 16c0-6.2 4-10.5 9-10.5s9 4.3 9 10.5z", ["M3 16c0-6.2 4-10.5 9-10.5s9 4.3 9 10.5", "M3 19.5h18"], ["M7 16v-2.6", "M10.2 16v-4.2", "M13.8 16v-4.2", "M17 16v-2.6"]),
    detect: duo("", "M9.6 8.8c-.9 0-1.6.7-1.6 1.8 0 .9.2 1.4.5 2.1l.4 2.2c.1.4.3.7.7.7s.6-.3.8-.8l.2-1c.1-.3.3-.5.6-.5s.5.2.6.5l.2 1c.2.5.4.8.8.8s.6-.3.7-.7l.4-2.2c.3-.7.5-1.2.5-2.1 0-1.1-.7-1.8-1.6-1.8-.6 0-.9.2-1.3.2s-.8-.2-1.3-.2z", ["M4 8V6a2 2 0 0 1 2-2h2", "M16 4h2a2 2 0 0 1 2 2v2", "M20 16v2a2 2 0 0 1-2 2h-2", "M8 20H6a2 2 0 0 1-2-2v-2"])
  };
  Object.assign(P, DUO);

  function icon(name, cls) {
    return `<svg class="${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
  }
  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0E7490"/><path d="M7 11.5c3.2 5.5 14.8 5.5 18 0" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M7 21c3.2-5 14.8-5 18 0" stroke="#A5F3FC" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>';
  const GOOGLE_G = '<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  function logo(href, variant) {
    const src = variant === "dark" ? "brand/Logo_sombre_transparent.svg" : variant === "icon" ? "brand/Icone.svg" : "brand/Logo_clair_transparent.svg";
    return `<a class="logo" href="${href || "accueil.html"}"><img src="${src}" alt="PanoraDent AI"></a>`;
  }
  try { if (!document.querySelector('link[rel="icon"]')) { const l = document.createElement("link"); l.rel = "icon"; l.type = "image/svg+xml"; l.href = "brand/Icone.svg"; document.head.appendChild(l); } } catch (e) {}

  // ----- Rôle de démonstration -----
  const ROLES = ["praticien", "admin", "lecteur"];
  const params = new URLSearchParams(location.search);
  let role = params.get("role");
  try { if (!role) role = localStorage.getItem("pd-role"); } catch (e) {}
  if (!ROLES.includes(role)) role = "praticien";
  try { localStorage.setItem("pd-role", role); } catch (e) {}

  const NAV = {
    praticien: [
      { href: "tableau-de-bord.html", page: "tableau-de-bord", label: "Tableau de bord", icon: "home" },
      { href: "nouvelle-analyse.html", page: "nouvelle-analyse", label: "Nouvelle analyse", icon: "upload" },
      { href: "historique.html", page: "historique", label: "Historique", icon: "history" },
      { href: "performance.html", page: "performance", label: "Performance du modèle", icon: "chart" }
    ],
    lecteur: [
      { href: "tableau-de-bord.html", page: "tableau-de-bord", label: "Tableau de bord", icon: "home" },
      { href: "historique.html", page: "historique", label: "Historique", icon: "history" },
      { href: "performance.html", page: "performance", label: "Performance du modèle", icon: "chart" }
    ],
    admin: [
      { href: "tableau-de-bord.html", page: "tableau-de-bord", label: "Tableau de bord", icon: "home" },
      { href: "historique.html", page: "historique", label: "Historique", icon: "history" },
      { href: "performance.html", page: "performance", label: "Performance du modèle", icon: "chart" },
      { group: "Administration" },
      { href: "admin-comptes.html", page: "admin-comptes", label: "Comptes", icon: "users" },
      { href: "admin-roles.html", page: "admin-roles", label: "Rôles et permissions", icon: "key" },
      { href: "admin-audit.html", page: "admin-audit", label: "Journal d'audit", icon: "list" },
      { href: "admin-supervision.html", page: "admin-supervision", label: "Supervision", icon: "activity" }
    ]
  };

  function withRole(href) {
    if (!href || /^(https?:|mailto:|#|javascript:)/.test(href) || !/\.html(\?|#|$)/.test(href)) return href;
    const [path, hash] = href.split("#");
    const u = new URL(path, location.href);
    if (!u.searchParams.has("role")) u.searchParams.set("role", role);
    return u.pathname.split("/").pop() + u.search + (hash ? "#" + hash : "");
  }

  function renderSidebar(sb) {
    const page = document.body.dataset.page;
    const u = window.DEMO ? window.DEMO.users[role] : { name: role, initials: "?", role };
    let html = `<div class="brand">${logo("tableau-de-bord.html", sb.classList.contains("rail") ? "icon" : "dark")}</div><nav aria-label="Navigation principale" style="display:grid;gap:2px">`;
    NAV[role].forEach((n) => {
      if (n.group) { html += `<div class="nav-label">${n.group}</div>`; return; }
      const cur = page === n.page || (page === "analyse" && n.page === "historique" && false) ? ' aria-current="page"' : "";
      html += `<a class="nav-link" href="${n.href}"${cur}><span class="nav-ic">${icon(n.icon)}</span><span>${n.label}</span></a>`;
    });
    html += `</nav><div class="sidebar-foot">
      <div class="user-chip"><span class="avatar">${u.initials}</span><span style="min-width:0"><span style="display:block;font-weight:600;font-size:var(--text-sm)">${u.name}</span><span class="muted" style="font-size:var(--text-xs)">${u.role}</span></span></div>
      <a class="nav-link" href="profil.html"${page === "profil" ? ' aria-current="page"' : ""}><span class="nav-ic">${icon("user")}</span><span>Profil et mot de passe</span></a>
      <a class="nav-link" href="connexion.html?etat=deconnecte"><span class="nav-ic">${icon("logout")}</span><span>Se déconnecter</span></a>
      <p class="muted" style="font-size:var(--text-xs);padding:var(--space-2) var(--space-3) 0">Modèle ${window.DEMO ? window.DEMO.analysis.modelShort : ""} · données fictives</p>
    </div>`;
    sb.innerHTML = html;
  }

  function banner() {
    const b = document.createElement("div");
    b.className = "proto-banner";
    b.setAttribute("role", "note");
    b.innerHTML = `${icon("info")}<span><strong>Prototype non certifié</strong> · aide à la décision, ne remplace pas le jugement du praticien · données fictives</span>`;
    return b;
  }

  function demoSwitch() {
    const w = document.createElement("label");
    w.className = "demo-switch";
    w.innerHTML = `<span class="maq-note" title="Outil de la maquette, absent du produit">Profil de démo</span>
      <select aria-label="Changer de profil de démonstration">
        <option value="praticien">Dr Rakoto (praticien)</option>
        <option value="admin">Administrateur</option>
        <option value="lecteur">Lecteur</option>
      </select>`;
    const s = w.querySelector("select");
    s.value = role;
    s.addEventListener("change", () => { const u = new URL(location.href); u.searchParams.set("role", s.value); location.href = u.toString(); });
    return w;
  }

  // Cloche de notifications et avatar : dans la barre du haut de toutes les pages
  const NOTIFS = {
    praticien: [["Analyse n° 0042 à terminer", "3 détections attendent votre décision", "analyse.html"], ["Modèle v0.3.1 en service", "Voir comment il a été évalué", "performance.html"]],
    lecteur: [["Analyse n° 0037 clôturée", "Compte rendu disponible", "compte-rendu.html"], ["Modèle v0.3.1 en service", "Voir comment il a été évalué", "performance.html"]],
    admin: [["2 demandes d’accès", "Cabinet Andria, Cabinet Mahafaly", "admin-comptes.html"], ["Inférence : temps de réponse élevé", "Incident en cours depuis 6 h", "admin-supervision.html"]]
  };
  function topActions() {
    const u = (window.DEMO && window.DEMO.users[role]) || { initials: "DR", name: "Profil" };
    const list = NOTIFS[role] || NOTIFS.praticien;
    const w = document.createElement("div");
    w.className = "top-actions";
    w.innerHTML = `<div class="notif">
        <button type="button" class="icon-btn" id="bell" aria-expanded="false" aria-controls="notif-pop" aria-label="Notifications : ${list.length} nouvelles">${icon("bell")}<span class="dot" aria-hidden="true"></span></button>
        <div class="notif-pop" id="notif-pop" hidden>${list.map((n) => `<a href="${withRole(n[2])}"><strong>${n[0]}</strong><span>${n[1]}</span></a>`).join("")}</div>
      </div>
      <a class="icon-btn avatar-btn" href="${withRole("profil.html")}" aria-label="Mon profil : ${u.name}">${u.initials}</a>`;
    const bell = w.querySelector("#bell"), pop = w.querySelector("#notif-pop"), dot = w.querySelector(".dot");
    const close = (focus) => { pop.hidden = true; bell.setAttribute("aria-expanded", "false"); if (focus) bell.focus(); };
    bell.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = pop.hidden; pop.hidden = !open; bell.setAttribute("aria-expanded", String(open));
      if (open) { dot.hidden = true; bell.setAttribute("aria-label", "Notifications : aucune nouvelle non lue"); }
    });
    document.addEventListener("click", (e) => { if (!pop.hidden && !e.target.closest(".notif")) close(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) close(true); });
    return w;
  }

  function forbidden(main) {
    main.innerHTML = `<div class="card card-pad" style="max-width:560px;margin:var(--space-12) auto;text-align:center;display:grid;gap:var(--space-4);justify-items:center">
      <span class="avatar" style="width:52px;height:52px;background:var(--color-danger-soft);color:var(--color-danger)">${icon("lock")}</span>
      <p class="mono muted" style="font-size:var(--text-sm)">Erreur 403</p>
      <h2 style="font-size:var(--text-2xl)">Accès refusé</h2>
      <p class="muted">Votre rôle (${window.DEMO ? window.DEMO.users[role].role : role}) ne donne pas accès à cette fonction. Si vous pensez qu'il s'agit d'une erreur, contactez l'administrateur de votre cabinet.</p>
      <a class="btn btn-primary" href="${withRole("tableau-de-bord.html")}">Retour au tableau de bord</a>
    </div>`;
  }

  // Mode sombre (application connectée)
  function getTheme() { const q = new URLSearchParams(location.search).get("theme"); if (q === "dark" || q === "light") return q; try { return localStorage.getItem("pd-theme") || "light"; } catch (e) { return "light"; } }
  function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem("pd-theme", t); } catch (e) {} }
  if (document.querySelector(".app") || document.readyState === "loading") {
    const t0 = getTheme(); if (t0 === "dark") document.documentElement.dataset.theme = "dark";
  }
  // Bouton lumière : libellé doublé (repos + copie allumée), nom accessible en aria-label
  function lumiere(b) {
    if (!b || b.classList.contains("btn-google") || b.classList.contains("btn-danger") || b.classList.contains("no-lumiere")) return;
    if (b.querySelector(":scope > .bl-base")) return;
    const html = b.innerHTML.trim(); const label = b.textContent.replace(/\s+/g, " ").trim();
    if (!label) return;
    b.classList.add("btn-lumiere"); if (b.classList.contains("btn-secondary")) b.classList.add("discret");
    if (!b.hasAttribute("aria-label") || b.dataset.blAuto) { b.setAttribute("aria-label", label); b.dataset.blAuto = "1"; }
    b.innerHTML = `<span class="bl-base" aria-hidden="true">${html}</span><span class="bl-on" aria-hidden="true">${html}</span>`;
  }
  function lumiereTout(root) { (root || document).querySelectorAll(".btn-primary, .btn-secondary").forEach(lumiere); }
  function init() {
    if (!document.querySelector(".app")) delete document.documentElement.dataset.theme;
    document.querySelectorAll("i[data-icon]").forEach((i) => { i.outerHTML = icon(i.dataset.icon, i.className); });
    const app = document.querySelector(".app");
    if (app) {
      if (!document.querySelector(".proto-banner")) app.parentNode.insertBefore(banner(), app);
      const sb = document.getElementById("sidebar");
      if (sb) renderSidebar(sb);
      const tb = document.querySelector(".topbar");
      if (tb && sb) {
        const mb = document.createElement("button");
        mb.className = "btn btn-ghost btn-sm menu-btn"; mb.setAttribute("aria-label", "Ouvrir le menu"); mb.innerHTML = icon("menu");
        mb.addEventListener("click", () => { sb.dataset.open = sb.dataset.open === "true" ? "false" : "true"; });
        tb.prepend(mb);
        if (!tb.querySelector(".spacer")) { const sp = document.createElement("div"); sp.className = "spacer"; tb.appendChild(sp); }
        const tg = document.createElement("button");
        tg.className = "btn btn-ghost btn-sm theme-toggle"; tg.type = "button";
        const paint = () => { const d = document.documentElement.dataset.theme === "dark"; tg.innerHTML = icon(d ? "sun" : "contrast"); tg.setAttribute("aria-label", d ? "Passer en mode clair" : "Passer en mode sombre"); tg.title = tg.getAttribute("aria-label"); };
        tg.addEventListener("click", () => { setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); paint(); });
        paint();
        const tools = document.createElement("div"); tools.className = "top-tools";
        tools.appendChild(demoSwitch());
        tools.appendChild(tg);
        tools.appendChild(topActions());
        tb.appendChild(tools);
      }
      const main = document.querySelector(".main");
      if (main && !main.querySelector(".app-foot")) { const f = document.createElement("footer"); f.className = "app-foot"; f.innerHTML = icon("info") + "<span>Prototype d’aide à la décision — non certifié. Le praticien garde la décision.</span>"; main.appendChild(f); }
      const allow = document.body.dataset.allow;
      if (allow && !allow.split(/\s+/).includes(role)) { const m = document.querySelector("main"); if (m) forbidden(m); }
    }
    document.querySelectorAll("[data-roles]").forEach((e) => { if (!e.dataset.roles.split(/\s+/).includes(role)) e.remove(); });
    document.querySelectorAll("[data-hide-roles]").forEach((e) => { if (e.dataset.hideRoles.split(/\s+/).includes(role)) e.remove(); });
    document.querySelectorAll("a[href]").forEach((a) => { a.setAttribute("href", withRole(a.getAttribute("href"))); });
    // Outils de maquette repliés : le jury voit d'abord l'écran, pas les coulisses
    document.querySelectorAll('[role="group"][aria-label="États de la maquette"]').forEach((bar) => {
      if (bar.closest(".maq-details")) return;
      const d = document.createElement("details"); d.className = "maq-details";
      d.innerHTML = '<summary>États de la maquette</summary>';
      bar.parentNode.insertBefore(d, bar); d.appendChild(bar);
      bar.querySelectorAll(".maq-note").forEach((n) => { if (/États de la maquette/.test(n.textContent)) n.remove(); });
    });
    lumiereTout();
    // Boutons créés ou réécrits plus tard par les scripts de page
    new MutationObserver((muts) => {
      muts.forEach((m) => {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        const own = t && t.closest && t.closest(".btn-primary, .btn-secondary");
        if (own) lumiere(own);
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches(".btn-primary, .btn-secondary")) lumiere(n); lumiereTout(n); } });
      });
      muts.forEach((m) => {
        if (m.type === "attributes" && m.target.querySelector && m.target.querySelector(":scope > .bl-base") && !m.target.classList.contains("btn-lumiere")) {
          m.target.classList.add("btn-lumiere"); m.target.classList.toggle("discret", m.target.classList.contains("btn-secondary"));
        }
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    // Fenêtres modales : data-open-modal="id", data-close-modal
    document.addEventListener("click", (e) => {
      const o = e.target.closest("[data-open-modal]");
      if (o) { const m = document.getElementById(o.dataset.openModal); if (m) { m.dataset.open = "true"; const f = m.querySelector("button, input, a"); f && f.focus(); } }
      const c = e.target.closest("[data-close-modal]");
      if (c) { const m = c.closest(".modal-backdrop"); if (m) m.dataset.open = "false"; }
      if (e.target.classList && e.target.classList.contains("modal-backdrop")) e.target.dataset.open = "false";
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll('.modal-backdrop[data-open="true"]').forEach((m) => (m.dataset.open = "false")); });
  }

  window.PD = { role, icon, ICONS: P, logo, LOGO, withRole, GOOGLE_G };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
