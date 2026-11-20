/**
 * Jeu d'icônes PanoraDent — repris de la maquette validée.
 *
 * Grille 24, trait 1,8, extrémités arrondies, `currentColor`.
 * Icônes de contenu en duotone : un aplat discret (`.ic-f`), un trait (le
 * corps) et un détail d'accent (`.ic-a`). Les icônes d'interface (flèches,
 * croix, chevrons, plus) restent en trait simple.
 *
 * Chaque valeur est un fragment SVG statique (aucune donnée utilisateur) :
 * il est injecté tel quel par <Icon>.
 */
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
  "eye-off": '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="m2 2 20 20"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
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

export const ICONS = P;
export const ICON_NAMES = Object.keys(P);
