/* PanoraDent AI — composants de visualisation (maquette)
   Carte KPI à anneau, courbe, jauge, barres de progression, histogramme.
   SVG fait main, sans dépendance. Couleurs : variables --viz-* de theme.css.
   Règles suivies : une seule couleur d'accent par graphique (la comparaison
   est en gris pointillé), légende dès 2 séries, infobulle au survol ET au
   clavier, tableau des données toujours accessible, aucun texte coloré par
   la série, mouvement coupé si « mouvement réduit ». */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var uid = 0;

  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmt(n, unit) {
    var s = typeof n === "number" ? n.toLocaleString("fr-FR") : String(n);
    return unit ? s + " " + unit : s;
  }
  // Graduation « propre » : 0, pas de 1/2/2,5/5 × 10^k, environ 4 intervalles
  function nice(max, integer) {
    if (max <= 0) return { max: integer ? 4 : 1, step: integer ? 1 : 0.25 };
    if (integer && max <= 4) return { max: 4, step: 1 };
    var raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), steps = [1, 2, 2.5, 5, 10], step = p;
    for (var i = 0; i < steps.length; i++) { if (steps[i] * p >= raw) { step = steps[i] * p; break; } }
    if (integer) step = Math.max(1, Math.round(step));
    return { max: Math.ceil(max / step) * step, step: step };
  }
  // Courbe lissée monotone (pas de dépassement au-delà des données)
  function monotone(pts) {
    var n = pts.length, i;
    if (n < 2) return "";
    var dx = [], m = [], t = [];
    for (i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    var d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
    for (i = 0; i < n - 1; i++) {
      var c = dx[i] / 3;
      d += "C" + (pts[i][0] + c).toFixed(1) + "," + (pts[i][1] + t[i] * c).toFixed(1) + " " +
        (pts[i + 1][0] - c).toFixed(1) + "," + (pts[i + 1][1] - t[i + 1] * c).toFixed(1) + " " +
        pts[i + 1][0].toFixed(1) + "," + pts[i + 1][1].toFixed(1);
    }
    return d;
  }
  function drawIn(path, delay) {
    if (RM || !path.getTotalLength) return;
    var L = path.getTotalLength();
    path.style.strokeDasharray = L; path.style.strokeDashoffset = L;
    path.getBoundingClientRect();
    path.style.transition = "stroke-dashoffset 700ms cubic-bezier(.22,1,.36,1) " + (delay || 0) + "ms";
    path.style.strokeDashoffset = "0";
    path.addEventListener("transitionend", function () { path.style.strokeDasharray = ""; path.style.strokeDashoffset = ""; }, { once: true });
  }

  // ---------- Tableau des données (toujours accessible, sans survol) ----------
  function dataTable(parent, caption, head, rows) {
    var d = h("details", "viz-data", parent);
    h("summary", null, d, "Voir les données");
    var w = h("div", "table-wrap", d), t = h("table", "table", w);
    h("caption", "sr-only", t, caption);
    var tr = h("tr", null, h("thead", null, t));
    head.forEach(function (c, i) { var th = h("th", i ? "num" : null, tr, c); th.scope = "col"; });
    var tb = h("tbody", null, t);
    rows.forEach(function (r) {
      var row = h("tr", null, tb);
      r.forEach(function (c, i) { if (i === 0) { var th = h("th", null, row, c); th.scope = "row"; } else h("td", "num mono", row, c); });
    });
    return d;
  }
  // ---------- Export CSV (vrai fichier, données fictives) ----------
  function exportCsv(name, head, rows) {
    var esc = function (v) { v = String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = "﻿" + [head].concat(rows).map(function (r) { return r.map(esc).join(";"); }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function bindExport(btn, name, head, rows) {
    if (!btn) return;
    btn.onclick = function () { exportCsv(name, head, rows()); };
  }

  // ---------- Infobulle partagée par un graphique ----------
  function tooltip(host) {
    var t = h("div", "viz-tip", host);
    t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); t.hidden = true;
    return {
      show: function (x, y, title, rows) {
        t.textContent = "";
        h("strong", "viz-tip-t", t, title);
        rows.forEach(function (r) {
          var row = h("div", "viz-tip-r", t);
          var key = h("span", "viz-key " + (r.key || "k-accent"), row); key.setAttribute("aria-hidden", "true");
          h("b", null, row, r.value); h("span", null, row, r.name);
        });
        t.hidden = false;
        var W = host.clientWidth, tw = t.offsetWidth, th = t.offsetHeight;
        var left = Math.min(Math.max(x - tw / 2, 4), W - tw - 4), top = y - th - 14;
        if (top < 0) top = y + 16;
        t.style.left = left + "px"; t.style.top = top + "px";
      },
      hide: function () { t.hidden = true; }
    };
  }

  // =====================================================================
  // 1. Carte KPI à anneau
  //    o = { label, value, unit, ring (0-100), ringText, delta, dir: up|down|flat, good: true|false, tone: accent|warning|navy|muted, href }
  // =====================================================================
  function kpi(host, o) {
    var a = h(o.href ? "a" : "article", "kpi-ring tone-" + (o.tone || "accent"), host);
    if (o.href) a.href = o.href;
    var ring = h("div", "kr-ring", a);
    ring.setAttribute("aria-hidden", "true");
    var s = svg("svg", { viewBox: "0 0 64 64" }, ring);
    svg("circle", { class: "kr-trk", cx: 32, cy: 32, r: 27, pathLength: 100 }, s);
    var v = svg("circle", { class: "kr-val", cx: 32, cy: 32, r: 27, pathLength: 100 }, s);
    var p = Math.max(0, Math.min(100, o.ring == null ? 0 : o.ring));
    v.style.setProperty("--p", p);
    if (o.ring == null) a.classList.add("is-empty");
    var ic = h("span", "kr-ic", ring);
    ic.innerHTML = window.PD ? PD.icon(o.icon || (o.dir === "down" ? "arrowDownRight" : o.dir === "flat" ? "minus" : "arrowUpRight")) : "";
    if (o.icon) ic.classList.add("kr-duo");
    var tx = h("div", "kr-txt", a);
    h("span", "kr-v", tx, fmt(o.value, o.unit));
    h("span", "kr-l", tx, o.label);
    if (o.delta) {
      var d = h("span", "kr-d " + (o.good === false ? "is-bad" : o.good === true ? "is-good" : "is-neutral"), tx);
      var sign = o.dir === "down" ? "En baisse : " : o.dir === "up" ? "En hausse : " : "";
      var sr = h("span", "sr-only", d, sign); d.appendChild(document.createTextNode(o.delta));
    }
    if (o.ringText) { var r = h("span", "sr-only", tx, ". " + o.ringText); a.title = o.ringText; }
    return a;
  }

  // =====================================================================
  // 2. Courbe (une série d'accent + une série de comparaison en gris pointillé)
  //    o = { host, title, labels[], series:[{name, values[], role:"accent"|"context"}], unit, summary, exportBtn }
  // =====================================================================
  function line(o) {
    var host = o.host, first = true, idx = -1;
    host.classList.add("viz");
    var legend = h("ul", "viz-legend", host);
    o.series.forEach(function (s) {
      var li = h("li", null, legend);
      h("span", "viz-key " + (s.role === "context" ? "k-context" : "k-accent"), li).setAttribute("aria-hidden", "true");
      li.appendChild(document.createTextNode(s.name));
    });
    var plot = h("div", "viz-plot", host);
    plot.tabIndex = 0;
    plot.setAttribute("role", "group");
    plot.setAttribute("aria-roledescription", "graphique");
    plot.setAttribute("aria-label", o.title + ". " + o.summary + " Flèches gauche et droite pour lire chaque mois.");
    var tip = tooltip(plot), svgEl, geom;

    function render() {
      var W = Math.max(280, plot.clientWidth), H = W < 520 ? 200 : 240;
      var m = { t: 12, r: 12, b: 28, l: 40 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
      var all = []; o.series.forEach(function (s) { all = all.concat(s.values); });
      var sc = nice(Math.max.apply(null, all), all.every(function (v) { return v % 1 === 0; }));
      var X = function (i) { return m.l + (o.labels.length === 1 ? iw / 2 : (i * iw) / (o.labels.length - 1)); };
      var Y = function (v) { return m.t + ih - (v / sc.max) * ih; };
      if (svgEl) svgEl.remove();
      svgEl = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, "aria-hidden": "true", class: "viz-svg" });
      plot.insertBefore(svgEl, plot.firstChild);
      for (var v = 0; v <= sc.max + 1e-9; v += sc.step) {
        svg("line", { class: "viz-grid", x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, svgEl);
        svg("text", { class: "viz-tick", x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, svgEl).textContent = fmt(Math.round(v * 10) / 10);
      }
      var every = iw / o.labels.length < 44 ? 2 : 1;
      o.labels.forEach(function (lab, i) {
        if ((o.labels.length - 1 - i) % every) return;
        svg("text", { class: "viz-tick", x: X(i), y: H - 8, "text-anchor": "middle" }, svgEl).textContent = lab;
      });
      // Ordre de tracé : comparaison d'abord, accent par-dessus
      var order = o.series.slice().sort(function (a, b) { return (a.role === "context" ? 0 : 1) - (b.role === "context" ? 0 : 1); });
      order.forEach(function (s, k) {
        var pts = s.values.map(function (v, i) { return [X(i), Y(v)]; });
        var d = monotone(pts);
        if (s.role !== "context") {
          svg("path", { class: "viz-area", d: d + "L" + X(s.values.length - 1) + "," + Y(0) + "L" + X(0) + "," + Y(0) + "Z" }, svgEl);
        }
        var p = svg("path", { class: s.role === "context" ? "viz-line is-context" : "viz-line", d: d }, svgEl);
        if (first && s.role !== "context") drawIn(p, 120);
      });
      // Dernier point de la série d'accent, étiqueté (étiquette sélective)
      var acc = o.series.filter(function (s) { return s.role !== "context"; })[0];
      if (acc) {
        var li = acc.values.length - 1;
        svg("circle", { class: "viz-dot", cx: X(li), cy: Y(acc.values[li]), r: 4.5 }, svgEl);
      }
      var cross = svg("line", { class: "viz-cross", x1: 0, x2: 0, y1: m.t, y2: m.t + ih, opacity: 0 }, svgEl);
      var dots = o.series.map(function (s) { return svg("circle", { class: s.role === "context" ? "viz-dot is-context" : "viz-dot", r: 5, opacity: 0 }, svgEl); });
      geom = { X: X, Y: Y, m: m, iw: iw, cross: cross, dots: dots };
      first = false;
      if (idx >= 0) focusAt(idx);
    }
    function focusAt(i) {
      idx = Math.max(0, Math.min(o.labels.length - 1, i));
      var x = geom.X(idx);
      geom.cross.setAttribute("x1", x); geom.cross.setAttribute("x2", x); geom.cross.setAttribute("opacity", 1);
      var top = Infinity;
      o.series.forEach(function (s, k) {
        var y = geom.Y(s.values[idx]); top = Math.min(top, y);
        geom.dots[k].setAttribute("cx", x); geom.dots[k].setAttribute("cy", y); geom.dots[k].setAttribute("opacity", 1);
      });
      tip.show(x, top, o.labels[idx] + (o.year ? " " + o.year[idx] : ""), o.series.map(function (s) {
        return { key: s.role === "context" ? "k-context" : "k-accent", value: fmt(s.values[idx], o.unit), name: s.name };
      }));
    }
    function clear() { idx = -1; tip.hide(); if (geom) { geom.cross.setAttribute("opacity", 0); geom.dots.forEach(function (d) { d.setAttribute("opacity", 0); }); } }
    plot.addEventListener("pointermove", function (e) {
      var r = plot.getBoundingClientRect(), x = e.clientX - r.left;
      var i = Math.round(((x - geom.m.l) / geom.iw) * (o.labels.length - 1));
      if (i !== idx) focusAt(i);
    });
    plot.addEventListener("pointerleave", function () { if (document.activeElement !== plot) clear(); });
    plot.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); focusAt(idx < 0 ? 0 : idx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); focusAt(idx < 0 ? o.labels.length - 1 : idx - 1); }
      else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
      else if (e.key === "End") { e.preventDefault(); focusAt(o.labels.length - 1); }
      else if (e.key === "Escape") clear();
    });
    plot.addEventListener("focus", function () { if (idx < 0) focusAt(o.labels.length - 1); });
    plot.addEventListener("blur", clear);
    render();
    if (window.ResizeObserver) { var w0 = plot.clientWidth; new ResizeObserver(function () { if (Math.abs(plot.clientWidth - w0) > 4) { w0 = plot.clientWidth; render(); } }).observe(plot); }
    var head = ["Mois"].concat(o.series.map(function (s) { return s.name; }));
    var rows = function () { return o.labels.map(function (l, i) { return [l + (o.year ? " " + o.year[i] : "")].concat(o.series.map(function (s) { return fmt(s.values[i]); })); }); };
    dataTable(host, o.title + " (données fictives)", head, rows());
    bindExport(o.exportBtn, o.title, head, rows);
  }

  // =====================================================================
  // 3. Jauge en demi-cercle
  //    o = { host, value (0-100), label, caption, icon }
  // =====================================================================
  function gauge(o) {
    var host = o.host; host.classList.add("viz", "gauge");
    var wrap = h("div", "gauge-wrap", host);
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", o.label + " : " + o.value + " %. " + (o.caption || ""));
    var s = svg("svg", { viewBox: "0 0 220 128", "aria-hidden": "true" }, wrap);
    var arc = "M 22 112 A 88 88 0 0 1 198 112";
    svg("path", { class: "g-trk", d: arc, pathLength: 100 }, s);
    var v = svg("path", { class: "g-val", d: arc, pathLength: 100 }, s);
    v.style.setProperty("--p", Math.max(0, Math.min(100, o.value)));
    svg("text", { class: "viz-tick", x: 22, y: 126, "text-anchor": "middle" }, s).textContent = "0 %";
    svg("text", { class: "viz-tick", x: 198, y: 126, "text-anchor": "middle" }, s).textContent = "100 %";
    var c = h("div", "gauge-center", wrap);
    var ic = h("span", "gauge-ic", c); ic.innerHTML = window.PD ? PD.icon(o.icon || "check") : "";
    h("span", "gauge-v", c, fmt(o.value) + " %");
    if (o.caption) h("p", "gauge-cap", host, o.caption);
  }

  // =====================================================================
  // 4. Barres de progression horizontales
  //    o = { host, items:[{name, abbr, cls (det-*), value (0-100), detail}], title }
  // =====================================================================
  function progress(o) {
    var ul = h("ul", "prog", o.host);
    o.items.forEach(function (it, i) {
      var li = h("li", null, ul);
      var top = h("div", "prog-top", li);
      var nm = h("span", "prog-name", top);
      if (it.cls) { var sw = h("span", "det-swatch " + it.cls, nm); sw.setAttribute("aria-hidden", "true"); }
      if (it.abbr) h("span", "prog-abbr", nm, it.abbr);
      nm.appendChild(document.createTextNode(it.name));
      h("span", "prog-v mono", top, (it.detail ? it.detail + " · " : "") + fmt(it.value) + " %");
      var tr = h("div", "prog-trk", li);
      tr.setAttribute("role", "img"); tr.setAttribute("aria-label", it.name + " : " + it.value + " %");
      var f = h("span", "prog-fill" + (it.cls ? " " + it.cls : ""), tr);
      f.style.setProperty("--w", it.value + "%");
      f.style.animationDelay = (i * 80) + "ms";
    });
    var head = ["Élément", "Part"];
    var rows = function () { return o.items.map(function (it) { return [it.name, fmt(it.value) + " %"]; }); };
    dataTable(o.host, o.title + " (données fictives)", head, rows());
    bindExport(o.exportBtn, o.title, head, rows);
  }

  // =====================================================================
  // 5. Histogramme (colonnes) + moyenne mobile en pointillé
  //    o = { host, title, labels[], values[], name, trendName, unit, summary, exportBtn }
  // =====================================================================
  function bars(o) {
    var host = o.host, first = true, idx = -1;
    host.classList.add("viz");
    var legend = h("ul", "viz-legend", host);
    var l1 = h("li", null, legend); h("span", "viz-key k-bar", l1).setAttribute("aria-hidden", "true"); l1.appendChild(document.createTextNode(o.name));
    var l2 = h("li", null, legend); h("span", "viz-key k-trend", l2).setAttribute("aria-hidden", "true"); l2.appendChild(document.createTextNode(o.trendName));
    var trend = o.values.map(function (v, i) { var a = o.values.slice(Math.max(0, i - 2), i + 1); return Math.round((a.reduce(function (s, x) { return s + x; }, 0) / a.length) * 10) / 10; });
    var plot = h("div", "viz-plot", host);
    plot.tabIndex = 0;
    plot.setAttribute("role", "group");
    plot.setAttribute("aria-roledescription", "graphique");
    plot.setAttribute("aria-label", o.title + ". " + o.summary + " Flèches gauche et droite pour lire chaque colonne.");
    var tip = tooltip(plot), svgEl, geom;
    function render() {
      var W = Math.max(280, plot.clientWidth), H = W < 520 ? 200 : 240;
      var m = { t: 12, r: 8, b: 28, l: 36 }, iw = W - m.l - m.r, ih = H - m.t - m.b, n = o.values.length;
      var sc = nice(Math.max.apply(null, o.values), o.values.every(function (v) { return v % 1 === 0; }));
      var slot = iw / n, bw = Math.min(24, slot * 0.56);
      var Y = function (v) { return m.t + ih - (v / sc.max) * ih; };
      var X = function (i) { return m.l + slot * i + slot / 2; };
      if (svgEl) svgEl.remove();
      svgEl = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, "aria-hidden": "true", class: "viz-svg" });
      plot.insertBefore(svgEl, plot.firstChild);
      for (var v = 0; v <= sc.max + 1e-9; v += sc.step) {
        svg("line", { class: "viz-grid", x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, svgEl);
        svg("text", { class: "viz-tick", x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, svgEl).textContent = fmt(v);
      }
      var every = slot < 34 ? 2 : 1, rects = [];
      o.values.forEach(function (val, i) {
        var x = X(i) - bw / 2, y = Y(val), hh = Y(0) - y, r = Math.min(4, bw / 2, hh);
        // coins arrondis en haut, carrés sur la ligne de base
        var d = "M" + x + "," + Y(0) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y + "H" + (x + bw - r) + "Q" + (x + bw) + "," + y + " " + (x + bw) + "," + (y + r) + "V" + Y(0) + "Z";
        var g = svg("path", { class: "viz-bar" + (i === n - 1 ? " is-current" : ""), d: d }, svgEl);
        if (first && !RM) { g.style.transformOrigin = "0 " + Y(0) + "px"; g.style.animation = "viz-grow 600ms cubic-bezier(.22,1,.36,1) " + (i * 35) + "ms both"; }
        rects.push(g);
        if ((n - 1 - i) % every === 0) svg("text", { class: "viz-tick", x: X(i), y: H - 8, "text-anchor": "middle" }, svgEl).textContent = o.labels[i];
      });
      var tp = svg("path", { class: "viz-trend", d: monotone(trend.map(function (v, i) { return [X(i), Y(v)]; })) }, svgEl);
      if (first) drawIn(tp, 400);
      // valeur sur le chapeau de la dernière colonne (étiquette sélective)
      var li = n - 1;
      svg("text", { class: "viz-cap", x: X(li), y: Y(o.values[li]) - 8, "text-anchor": "middle" }, svgEl).textContent = fmt(o.values[li]);
      geom = { X: X, Y: Y, m: m, slot: slot, rects: rects };
      first = false;
      if (idx >= 0) focusAt(idx);
    }
    function focusAt(i) {
      idx = Math.max(0, Math.min(o.values.length - 1, i));
      geom.rects.forEach(function (r, k) { r.classList.toggle("is-hover", k === idx); });
      tip.show(geom.X(idx), geom.Y(o.values[idx]), o.labels[idx] + (o.year ? " " + o.year[idx] : ""), [
        { key: "k-bar", value: fmt(o.values[idx], o.unit), name: o.name },
        { key: "k-trend", value: fmt(trend[idx], o.unit), name: o.trendName }
      ]);
    }
    function clear() { idx = -1; tip.hide(); if (geom) geom.rects.forEach(function (r) { r.classList.remove("is-hover"); }); }
    plot.addEventListener("pointermove", function (e) {
      var r = plot.getBoundingClientRect(), i = Math.floor((e.clientX - r.left - geom.m.l) / geom.slot);
      if (i < 0 || i >= o.values.length) return;
      if (i !== idx) focusAt(i);
    });
    plot.addEventListener("pointerleave", function () { if (document.activeElement !== plot) clear(); });
    plot.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); focusAt(idx < 0 ? 0 : idx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); focusAt(idx < 0 ? o.values.length - 1 : idx - 1); }
      else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
      else if (e.key === "End") { e.preventDefault(); focusAt(o.values.length - 1); }
      else if (e.key === "Escape") clear();
    });
    plot.addEventListener("focus", function () { if (idx < 0) focusAt(o.values.length - 1); });
    plot.addEventListener("blur", clear);
    render();
    if (window.ResizeObserver) { var w0 = plot.clientWidth; new ResizeObserver(function () { if (Math.abs(plot.clientWidth - w0) > 4) { w0 = plot.clientWidth; render(); } }).observe(plot); }
    var head = ["Période", o.name, o.trendName];
    var rows = function () { return o.labels.map(function (l, i) { return [l + (o.year ? " " + o.year[i] : ""), fmt(o.values[i]), fmt(trend[i])]; }); };
    dataTable(host, o.title + " (données fictives)", head, rows());
    bindExport(o.exportBtn, o.title, head, rows);
  }

  // =====================================================================
  // 6. État vide (mesures « à renseigner ») : cadre de détection + texte
  // =====================================================================
  function empty(host, title, text) {
    var b = h("div", "viz-empty", host);
    var i = h("span", "viz-empty-ic", b); i.innerHTML = window.PD ? PD.icon("chart") : ""; i.setAttribute("aria-hidden", "true");
    h("strong", null, b, title);
    h("p", null, b, text);
  }

  // Les 12 derniers mois, jusqu'au mois courant inclus
  function months(n) {
    var out = { labels: [], year: [] }, d = new Date(), M = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    for (var i = n - 1; i >= 0; i--) { var x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.labels.push(M[x.getMonth()]); out.year.push(x.getFullYear()); }
    return out;
  }

  window.PDC = { kpi: kpi, line: line, gauge: gauge, progress: progress, bars: bars, empty: empty, months: months, fmt: fmt };
})();
