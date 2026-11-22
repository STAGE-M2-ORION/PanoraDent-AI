/* PanoraDent AI — radiographie panoramique SIMULÉE (dessin vectoriel, aucune vraie image).
   Pano.draw(svg)            : dessine l'image fictive dans un <svg viewBox="0 0 1200 600">
   Pano.teeth[fdi]           : géométrie de chaque dent (box, crown, apex)
   Pano.boxFor(fdi, type)    : cadre d'une détection, en coordonnées de l'image
   Convention radiologique : la droite du patient est à gauche de l'image. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const W = 1200, H = 600, MID = 600, GAP = 4;
  const width = { 1: 42, 2: 40, 3: 44, 4: 46, 5: 48, 6: 62, 7: 62, 8: 60 };
  const crownUp = { 1: 70, 2: 64, 3: 76, 4: 64, 5: 62, 6: 58, 7: 56, 8: 54 };
  const crownLo = { 1: 56, 2: 56, 3: 70, 4: 62, 5: 60, 6: 56, 7: 54, 8: 52 };
  const rootUp = { 1: 110, 2: 100, 3: 140, 4: 112, 5: 110, 6: 96, 7: 92, 8: 80 };
  const rootLo = { 1: 104, 2: 108, 3: 132, 4: 118, 5: 120, 6: 108, 7: 102, 8: 72 };
  const missing = new Set([18]);
  const impacted = { 38: { rot: -38, dx: 16, dy: 48 }, 48: { rot: 38, dx: -16, dy: 48 } };
  // Ce que « contient » l'image fictive (indépendant du statut des détections)
  const lesions = [
    { fdi: 36, kind: "deep" }, { fdi: 36, kind: "periapical" }, { fdi: 46, kind: "periapical" },
    { fdi: 26, kind: "caries" }, { fdi: 17, kind: "caries" }, { fdi: 24, kind: "caries", faint: true }, { fdi: 45, kind: "caries", faint: true }
  ];

  const occ = (x) => 300 + 22 * (1 - Math.pow((x - MID) / 460, 2));

  function slotX(q, k) {
    let off = GAP / 2;
    for (let i = 1; i < k; i++) off += width[i] + GAP;
    off += width[k] / 2;
    const leftSide = q === 1 || q === 4; // droite du patient = gauche de l'image
    return leftSide ? MID - off : MID + off;
  }

  const teeth = {};
  [1, 2, 3, 4].forEach((q) => {
    for (let k = 1; k <= 8; k++) {
      const fdi = q * 10 + k;
      if (missing.has(fdi)) continue;
      const upper = q <= 2;
      let cx = slotX(q, k);
      const w = width[k];
      const ch = upper ? crownUp[k] : crownLo[k];
      const rl = upper ? rootUp[k] : rootLo[k];
      const yo = occ(cx);
      let y0 = upper ? yo - 6 : yo + 6;
      const dir = upper ? -1 : 1;
      const imp = impacted[fdi];
      const t = { fdi, q, k, upper, cx, w, ch, rl, y0, dir, impacted: !!imp, rot: 0 };
      if (imp) {
        t.cx = cx = cx + imp.dx; t.y0 = y0 = y0 + imp.dy; t.rot = imp.rot;
        const Hh = ch + rl, th = Math.abs(imp.rot) * Math.PI / 180;
        const bw = w * Math.cos(th) + Hh * Math.sin(th), bh = w * Math.sin(th) + Hh * Math.cos(th);
        const ccy = y0 + Hh / 2;
        t.box = { x: cx - bw / 2, y: ccy - bh / 2, w: bw, h: bh };
        t.crown = { x: cx - bw / 2, y: ccy - bh / 2, w: bw, h: bh * 0.45 };
        t.apex = { x: cx, y: ccy + bh / 2 - 10 };
      } else {
        const total = ch + rl + 6;
        t.box = upper ? { x: cx - w / 2 - 3, y: y0 - total, w: w + 6, h: total + 2 } : { x: cx - w / 2 - 3, y: y0 - 2, w: w + 6, h: total + 2 };
        t.crown = upper ? { x: cx - w / 2, y: y0 - ch, w, h: ch } : { x: cx - w / 2, y: y0, w, h: ch };
        t.apex = upper ? { x: cx, y: y0 - ch - rl } : { x: cx, y: y0 + ch + rl };
      }
      teeth[fdi] = t;
    }
  });

  function boxFor(fdi, type) {
    const t = teeth[fdi]; if (!t) return null;
    const c = t.crown;
    if (type === "tooth" || type === "impacted") return { ...t.box };
    if (type === "caries") {
      const h = c.h * 0.48, w = c.w * 0.62;
      return t.upper ? { x: t.cx - w / 2 + 4, y: c.y + c.h - h - 2, w, h } : { x: t.cx - w / 2 + 4, y: c.y + 2, w, h };
    }
    if (type === "deep") {
      const h = c.h * 0.92, w = c.w * 0.84;
      return t.upper ? { x: t.cx - w / 2, y: c.y + c.h - h, w, h } : { x: t.cx - w / 2, y: c.y, w, h };
    }
    if (type === "periapical") {
      const s = 58; const ax = t.apex.x - (t.k >= 6 ? 12 : 0);
      return { x: ax - s / 2, y: t.apex.y - s / 2, w: s, h: s };
    }
    return { ...t.box };
  }

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const a in attrs) e.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function toothPath(w, ch) {
    const l = -w / 2, r = w / 2;
    return `M ${l + 3} ${ch} L ${l + 1} 16 Q ${l + 1} 2 ${l + 13} 2 L ${r - 13} 2 Q ${r - 1} 2 ${r - 1} 16 L ${r - 3} ${ch} Z`;
  }
  function rootPaths(k, w, ch, rl) {
    if (k >= 6) {
      const a = w * 0.28;
      return [
        `M ${-w / 2 + 4} ${ch - 4} Q ${-w / 2 + 2} ${ch + rl * 0.55} ${-a - 4} ${ch + rl} Q ${-a} ${ch + rl + 6} ${-a + 5} ${ch + rl - 2} Q ${-3} ${ch + rl * 0.5} ${-2} ${ch - 4} Z`,
        `M ${2} ${ch - 4} Q ${3} ${ch + rl * 0.5} ${a - 5} ${ch + rl - 2} Q ${a} ${ch + rl + 6} ${a + 4} ${ch + rl} Q ${w / 2 - 2} ${ch + rl * 0.55} ${w / 2 - 4} ${ch - 4} Z`
      ];
    }
    const rw = w * 0.62;
    return [`M ${-rw / 2} ${ch - 4} Q ${-rw / 2 + 2} ${ch + rl * 0.6} ${-3} ${ch + rl} Q 0 ${ch + rl + 7} 3 ${ch + rl} Q ${rw / 2 - 2} ${ch + rl * 0.6} ${rw / 2} ${ch - 4} Z`];
  }

  function draw(svg, opts = {}) {
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const uid = "p" + Math.random().toString(36).slice(2, 7);
    const defs = el("defs", {}, svg);
    defs.innerHTML = `
      <radialGradient id="${uid}bone" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#5a636b"/><stop offset=".55" stop-color="#3b4249"/><stop offset="1" stop-color="#1b1f23"/></radialGradient>
      <linearGradient id="${uid}dentin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7dde1"/><stop offset=".35" stop-color="#b5bec4"/><stop offset="1" stop-color="#7f8990"/></linearGradient>
      <linearGradient id="${uid}root" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8b1b8"/><stop offset="1" stop-color="#6d767d"/></linearGradient>
      <filter id="${uid}soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.1"/></filter>
      <filter id="${uid}blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
      <filter id="${uid}blur8" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="${uid}grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .6  0 0 0 0 .6  0 0 0 0 .6  0 0 0 .22 0"/></filter>`;

    const g = el("g", { class: "pano-image" }, svg);
    el("rect", { x: 0, y: 0, width: W, height: H, fill: "#111417" }, g);
    // Os : maxillaire, mandibule, branches montantes (formes floues)
    const bone = el("g", { filter: `url(#${uid}blur)` }, g);
    el("path", { d: "M 70 560 C 120 420 150 330 210 300 C 400 380 800 380 990 300 C 1050 330 1080 420 1130 560 Z", fill: `url(#${uid}bone)` }, bone);
    el("path", { d: "M 60 130 C 70 260 90 330 120 560 L 210 560 C 190 420 180 300 170 140 Z", fill: "#3e454c" }, bone);
    el("path", { d: "M 1140 130 C 1130 260 1110 330 1080 560 L 990 560 C 1010 420 1020 300 1030 140 Z", fill: "#3e454c" }, bone);
    el("path", { d: "M 170 300 C 300 120 900 120 1030 300 C 900 250 300 250 170 300 Z", fill: "#4d555c" }, bone);
    el("ellipse", { cx: 600, cy: 470, rx: 380, ry: 60, fill: "#555e66", opacity: .6 }, bone);
    // Sinus maxillaires et fosses nasales (zones sombres)
    const dark = el("g", { filter: `url(#${uid}blur8)` }, g);
    el("ellipse", { cx: 395, cy: 120, rx: 125, ry: 52, fill: "#1d2125", opacity: .9 }, dark);
    el("ellipse", { cx: 805, cy: 120, rx: 125, ry: 52, fill: "#1d2125", opacity: .9 }, dark);
    el("path", { d: "M 520 20 C 540 90 660 90 680 20 Z", fill: "#16191c" }, dark);
    el("path", { d: "M 230 165 C 400 128 800 128 970 165", stroke: "#6c757d", "stroke-width": 7, fill: "none", opacity: .7 }, dark);
    // Ombres de la colonne cervicale (fantômes latéraux)
    const ghost = el("g", { filter: `url(#${uid}blur)`, opacity: .45 }, g);
    el("rect", { x: 0, y: 60, width: 50, height: 520, fill: "#6b737a" }, ghost);
    el("rect", { x: 1150, y: 60, width: 50, height: 520, fill: "#6b737a" }, ghost);
    // Canal mandibulaire
    el("path", { d: "M 150 380 C 260 470 420 505 600 512 C 780 505 940 470 1050 380", stroke: "#2a3035", "stroke-width": 10, fill: "none", opacity: .55, filter: `url(#${uid}blur8)` }, g);

    // Dents
    const tg = el("g", { filter: `url(#${uid}soft)` }, g);
    Object.values(teeth).forEach((t) => {
      const cy = t.y0;
      let tf = `translate(${t.cx} ${cy}) scale(1 ${t.dir})`;
      if (t.impacted) tf = `translate(${t.cx} ${cy}) rotate(${t.rot} 0 ${(t.ch + t.rl) / 2}) scale(1 ${t.dir})`;
      const tooth = el("g", { transform: tf }, tg);
      rootPaths(t.k, t.w, t.ch, t.rl).forEach((d) => el("path", { d, fill: `url(#${uid}root)` }, tooth));
      el("path", { d: toothPath(t.w, t.ch), fill: `url(#${uid}dentin)` }, tooth);
      el("path", { d: `M ${-t.w / 2 + 2} 18 Q ${-t.w / 2 + 2} 3 ${-t.w / 2 + 13} 3 L ${t.w / 2 - 13} 3 Q ${t.w / 2 - 2} 3 ${t.w / 2 - 2} 18 L ${t.w / 2 - 4} 24 L ${-t.w / 2 + 4} 24 Z`, fill: "#eef1f3", opacity: .85 }, tooth);
      // Chambre pulpaire et canaux (radio-clairs, donc sombres)
      el("path", { d: `M ${-t.w * 0.2} ${t.ch * 0.45} Q 0 ${t.ch * 0.32} ${t.w * 0.2} ${t.ch * 0.45} L ${t.w * 0.12} ${t.ch + 4} L ${-t.w * 0.12} ${t.ch + 4} Z`, fill: "#5b646b", opacity: .8 }, tooth);
      if (t.k >= 6) {
        el("path", { d: `M ${-t.w * 0.1} ${t.ch} L ${-t.w * 0.26} ${t.ch + t.rl - 6}`, stroke: "#5b646b", "stroke-width": 2.5, fill: "none" }, tooth);
        el("path", { d: `M ${t.w * 0.1} ${t.ch} L ${t.w * 0.26} ${t.ch + t.rl - 6}`, stroke: "#5b646b", "stroke-width": 2.5, fill: "none" }, tooth);
      } else {
        el("path", { d: `M 0 ${t.ch} L 0 ${t.ch + t.rl - 6}`, stroke: "#5b646b", "stroke-width": 2.5, fill: "none" }, tooth);
      }
    });

    // Anomalies visibles sur l'image fictive
    const lg = el("g", {}, g);
    lesions.forEach((l) => {
      const t = teeth[l.fdi]; if (!t) return;
      if (l.kind === "periapical") {
        const ax = t.apex.x - (t.k >= 6 ? 12 : 0);
        el("ellipse", { cx: ax, cy: t.apex.y + (t.upper ? -4 : 4), rx: 19, ry: 16, fill: "#1a1e22", opacity: .85, filter: `url(#${uid}blur8)` }, lg);
      } else {
        const b = boxFor(l.fdi, l.kind);
        const rx = l.kind === "deep" ? b.w * 0.34 : b.w * 0.26, ry = l.kind === "deep" ? b.h * 0.36 : b.h * 0.3;
        el("ellipse", { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx, ry, fill: "#23292e", opacity: l.faint ? .5 : .82, filter: `url(#${uid}soft)` }, lg);
      }
    });

    // Grain de film
    el("rect", { x: 0, y: 0, width: W, height: H, filter: `url(#${uid}grain)`, opacity: .5 }, g);
    // Repères latéraux et mention « image simulée »
    const lbl = { fill: "#AAB4BC", "font-family": "Satoshi, sans-serif", "font-size": 18, "font-weight": 600 };
    el("text", { ...lbl, x: 24, y: 40 }, g).textContent = "D";
    el("text", { ...lbl, x: 1162, y: 40 }, g).textContent = "G";
    if (opts.watermark !== false) {
      const wm = el("text", { x: 1176, y: 584, "text-anchor": "end", fill: "#AAB4BC", "font-family": "Satoshi, sans-serif", "font-size": 15, "letter-spacing": "1" }, g);
      wm.textContent = "IMAGE SIMULÉE — FICTIVE, NON CLINIQUE";
    }
    return g;
  }

  window.Pano = { W, H, teeth, boxFor, draw, el };
})();
