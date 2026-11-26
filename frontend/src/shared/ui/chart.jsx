/**
 * Visualisations PanoraDent — portage React de `charts.js` (maquette).
 *
 * Règles suivies : une seule couleur d'accent par graphique (la comparaison est
 * en gris pointillé), légende dès 2 séries, infobulle au survol ET au clavier,
 * tableau des données toujours accessible, aucun texte coloré par la série,
 * mouvement coupé si « mouvement réduit ». Couleurs : variables `--viz-*`.
 */
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cx } from "../lib/cx";
import { Icon } from "./icon";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function formatNumber(value, unit) {
  const text = typeof value === "number" ? value.toLocaleString("fr-FR") : String(value);
  return unit ? `${text} ${unit}` : text;
}

/** Graduation « propre » : 0, pas de 1/2/2,5/5 × 10^k, environ 4 intervalles. */
function niceScale(max, integer) {
  if (max <= 0) return { max: integer ? 4 : 1, step: integer ? 1 : 0.25 };
  if (integer && max <= 4) return { max: 4, step: 1 };
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  let step = p;
  for (const s of [1, 2, 2.5, 5, 10]) {
    if (s * p >= raw) {
      step = s * p;
      break;
    }
  }
  if (integer) step = Math.max(1, Math.round(step));
  return { max: Math.ceil(max / step) * step, step };
}

/** Courbe lissée monotone (pas de dépassement au-delà des données). */
function monotonePath(pts) {
  const n = pts.length;
  if (n < 2) return "";
  const dx = [];
  const m = [];
  const t = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i += 1) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const c = dx[i] / 3;
    d += `C${(pts[i][0] + c).toFixed(1)},${(pts[i][1] + t[i] * c).toFixed(1)} ${(pts[i + 1][0] - c).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * c).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Tracé progressif d'un chemin SVG (une seule fois, au premier rendu). */
function useDrawIn(ref, delay, deps) {
  const done = useRef(false);
  useEffect(() => {
    const path = ref.current;
    if (done.current || !path || prefersReducedMotion() || !path.getTotalLength) return;
    done.current = true;
    const length = path.getTotalLength();
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
    path.getBoundingClientRect();
    path.style.transition = `stroke-dashoffset 700ms cubic-bezier(.22,1,.36,1) ${delay}ms`;
    path.style.strokeDashoffset = "0";
    const clear = () => {
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "";
    };
    path.addEventListener("transitionend", clear, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Largeur observée d'un conteneur (le SVG est redessiné à la bonne taille). */
function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return undefined;
    let last = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(node.clientWidth - last) > 4) {
        last = node.clientWidth;
        setWidth(last);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/* ------------------------------------------------------------------------ */
/* Export CSV et tableau des données                                         */
/* ------------------------------------------------------------------------ */

/** Télécharge un vrai fichier CSV (séparateur « ; », BOM pour Excel). */
export function exportCsv(name, head, rows) {
  const esc = (v) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = `﻿${[head, ...rows].map((r) => r.map(esc).join(";")).join("\n")}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** « Voir les données » : le tableau reste accessible sans survol. */
export function DataDetails({ caption, head, rows }) {
  return (
    <details className="viz-data">
      <summary>Voir les données</summary>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((c, i) => (
                <th key={c} scope="col" className={i ? "num" : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                {r.map((c, i) =>
                  i === 0 ? (
                    <th key={i} scope="row">
                      {c}
                    </th>
                  ) : (
                    <td key={i} className="num mono">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------------ */
/* Infobulle                                                                 */
/* ------------------------------------------------------------------------ */

function Tooltip({ hostRef, tip }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useIsoLayoutEffect(() => {
    if (!tip || !ref.current || !hostRef.current) return;
    const W = hostRef.current.clientWidth;
    const tw = ref.current.offsetWidth;
    const th = ref.current.offsetHeight;
    const left = Math.min(Math.max(tip.x - tw / 2, 4), W - tw - 4);
    let top = tip.y - th - 14;
    if (top < 0) top = tip.y + 16;
    setPos({ left, top });
  }, [tip, hostRef]);
  return (
    <div ref={ref} className="viz-tip" role="status" aria-live="polite" hidden={!tip} style={{ left: pos.left, top: pos.top }}>
      {tip ? (
        <>
          <strong className="viz-tip-t">{tip.title}</strong>
          {tip.rows.map((r) => (
            <div key={r.name} className="viz-tip-r">
              <span className={cx("viz-key", r.keyClass ?? "k-accent")} aria-hidden="true" />
              <b>{r.value}</b>
              <span>{r.name}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

/** Navigation clavier/pointeur commune aux graphiques à index. */
function useIndexNav(count) {
  const [index, setIndex] = useState(-1);
  const focusAt = useCallback((i) => setIndex(Math.max(0, Math.min(count - 1, i))), [count]);
  const onKeyDown = (event) => {
    const keys = {
      ArrowRight: () => focusAt(index < 0 ? 0 : index + 1),
      ArrowLeft: () => focusAt(index < 0 ? count - 1 : index - 1),
      Home: () => focusAt(0),
      End: () => focusAt(count - 1),
    };
    if (keys[event.key]) {
      event.preventDefault();
      keys[event.key]();
    } else if (event.key === "Escape") setIndex(-1);
  };
  return { index, setIndex, focusAt, onKeyDown };
}

/* ------------------------------------------------------------------------ */
/* 1. Carte KPI à anneau                                                     */
/* ------------------------------------------------------------------------ */

/**
 * `ring` (0-100, ou null pour l'état vide), `tone` : accent | warning | navy,
 * `delta` + `dir` (up | down | flat) + `good` (true | false | undefined).
 */
export function KpiRing({ label, value, unit, ring, ringText, delta, dir, good, tone = "accent", href, icon }) {
  const p = Math.max(0, Math.min(100, ring ?? 0));
  const empty = ring == null;
  const Tag = href ? Link : "article";
  const iconName = icon ?? (dir === "down" ? "arrowDownRight" : dir === "flat" ? "minus" : "arrowUpRight");
  return (
    <Tag className={cx("kpi-ring", `tone-${tone}`, empty && "is-empty")} href={href} title={ringText}>
      <div className="kr-ring" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <circle className="kr-trk" cx="32" cy="32" r="27" pathLength="100" />
          <circle className="kr-val" cx="32" cy="32" r="27" pathLength="100" style={{ "--p": p }} />
        </svg>
        <span className={cx("kr-ic", icon && "kr-duo")}>
          <Icon name={iconName} />
        </span>
      </div>
      <div className="kr-txt">
        <span className="kr-v">{formatNumber(value, unit)}</span>
        <span className="kr-l">{label}</span>
        {delta ? (
          <span className={cx("kr-d", good === false ? "is-bad" : good === true ? "is-good" : "is-neutral")}>
            <span className="sr-only">{dir === "down" ? "En baisse : " : dir === "up" ? "En hausse : " : ""}</span>
            {delta}
          </span>
        ) : null}
        {ringText ? <span className="sr-only">. {ringText}</span> : null}
      </div>
    </Tag>
  );
}

/* ------------------------------------------------------------------------ */
/* 2. Courbe                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * `labels[]`, `year[]` (optionnel), `series: [{ name, values[], role: "accent" | "context" }]`.
 * `exportRef` : ref d'un bouton existant qui déclenchera l'export CSV.
 */
export function LineChart({ title, summary, labels, year, series, unit, exportRef, fictive = false }) {
  const plotRef = useRef(null);
  const width = useWidth(plotRef);
  const nav = useIndexNav(labels.length);
  const areaRef = useRef(null);

  const geom = useMemo(() => {
    const W = Math.max(280, width || 600);
    const H = W < 520 ? 200 : 240;
    const m = { t: 12, r: 12, b: 28, l: 40 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const all = series.flatMap((s) => s.values);
    const sc = niceScale(Math.max(...all), all.every((v) => v % 1 === 0));
    const X = (i) => m.l + (labels.length === 1 ? iw / 2 : (i * iw) / (labels.length - 1));
    const Y = (v) => m.t + ih - (v / sc.max) * ih;
    const ticks = [];
    for (let v = 0; v <= sc.max + 1e-9; v += sc.step) ticks.push(v);
    return { W, H, m, iw, ih, X, Y, ticks, every: iw / labels.length < 44 ? 2 : 1 };
  }, [width, series, labels.length]);

  useDrawIn(areaRef, 120, [width > 0]);

  const rows = labels.map((l, i) => [`${l}${year ? ` ${year[i]}` : ""}`, ...series.map((s) => formatNumber(s.values[i]))]);
  const head = ["Mois", ...series.map((s) => s.name)];
  useExportButton(exportRef, title, head, rows);

  const ordered = [...series].sort((a, b) => (a.role === "context" ? 0 : 1) - (b.role === "context" ? 0 : 1));
  const accent = series.find((s) => s.role !== "context");
  const { X, Y, m, ih, W, H } = geom;
  const idx = nav.index;
  const tip =
    idx >= 0
      ? {
          x: X(idx),
          y: Math.min(...series.map((s) => Y(s.values[idx]))),
          title: `${labels[idx]}${year ? ` ${year[idx]}` : ""}`,
          rows: series.map((s) => ({ keyClass: s.role === "context" ? "k-context" : "k-accent", value: formatNumber(s.values[idx], unit), name: s.name })),
        }
      : null;

  return (
    <div className="viz">
      <ul className="viz-legend">
        {series.map((s) => (
          <li key={s.name}>
            <span className={cx("viz-key", s.role === "context" ? "k-context" : "k-accent")} aria-hidden="true" />
            {s.name}
          </li>
        ))}
      </ul>
      <div
        ref={plotRef}
        className="viz-plot"
        tabIndex={0}
        role="group"
        aria-roledescription="graphique"
        aria-label={`${title}. ${summary} Flèches gauche et droite pour lire chaque mois.`}
        onPointerMove={(event) => {
          const r = event.currentTarget.getBoundingClientRect();
          const i = Math.round(((event.clientX - r.left - m.l) / geom.iw) * (labels.length - 1));
          if (i !== idx) nav.focusAt(i);
        }}
        onPointerLeave={(event) => {
          if (document.activeElement !== event.currentTarget) nav.setIndex(-1);
        }}
        onKeyDown={nav.onKeyDown}
        onFocus={() => {
          if (idx < 0) nav.focusAt(labels.length - 1);
        }}
        onBlur={() => nav.setIndex(-1)}
      >
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="viz-svg">
          {geom.ticks.map((v) => (
            <g key={v}>
              <line className="viz-grid" x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} />
              <text className="viz-tick" x={m.l - 8} y={Y(v) + 4} textAnchor="end">
                {formatNumber(Math.round(v * 10) / 10)}
              </text>
            </g>
          ))}
          {labels.map((lab, i) =>
            (labels.length - 1 - i) % geom.every ? null : (
              <text key={`${lab}${i}`} className="viz-tick" x={X(i)} y={H - 8} textAnchor="middle">
                {lab}
              </text>
            ),
          )}
          {ordered.map((s) => {
            const d = monotonePath(s.values.map((v, i) => [X(i), Y(v)]));
            const isContext = s.role === "context";
            return (
              <g key={s.name}>
                {!isContext ? <path className="viz-area" d={`${d}L${X(s.values.length - 1)},${Y(0)}L${X(0)},${Y(0)}Z`} /> : null}
                <path ref={isContext ? undefined : areaRef} className={isContext ? "viz-line is-context" : "viz-line"} d={d} />
              </g>
            );
          })}
          {accent ? <circle className="viz-dot" cx={X(accent.values.length - 1)} cy={Y(accent.values[accent.values.length - 1])} r="4.5" /> : null}
          <line className="viz-cross" x1={idx >= 0 ? X(idx) : 0} x2={idx >= 0 ? X(idx) : 0} y1={m.t} y2={m.t + ih} opacity={idx >= 0 ? 1 : 0} />
          {series.map((s) => (
            <circle
              key={s.name}
              className={s.role === "context" ? "viz-dot is-context" : "viz-dot"}
              r="5"
              cx={idx >= 0 ? X(idx) : 0}
              cy={idx >= 0 ? Y(s.values[idx]) : 0}
              opacity={idx >= 0 ? 1 : 0}
            />
          ))}
        </svg>
        <Tooltip hostRef={plotRef} tip={tip} />
      </div>
      <DataDetails caption={fictive ? `${title} (données fictives)` : title} head={head} rows={rows} />
    </div>
  );
}

/** Branche un bouton « Exporter » existant (ref) sur l'export CSV du graphique. */
function useExportButton(exportRef, name, head, rows) {
  const latest = useRef({ name, head, rows });
  latest.current = { name, head, rows };
  useEffect(() => {
    const button = exportRef?.current;
    if (!button) return undefined;
    const onClick = () => exportCsv(latest.current.name, latest.current.head, latest.current.rows);
    button.addEventListener("click", onClick);
    return () => button.removeEventListener("click", onClick);
  }, [exportRef]);
}

/* ------------------------------------------------------------------------ */
/* 3. Jauge en demi-cercle                                                    */
/* ------------------------------------------------------------------------ */

export function Gauge({ value, label, caption, icon = "check" }) {
  const p = Math.max(0, Math.min(100, value));
  return (
    <div className="viz gauge">
      <div className="gauge-wrap" role="img" aria-label={`${label} : ${value} %. ${caption ?? ""}`}>
        <svg viewBox="0 0 220 128" aria-hidden="true">
          <path className="g-trk" d="M 22 112 A 88 88 0 0 1 198 112" pathLength="100" />
          <path className="g-val" d="M 22 112 A 88 88 0 0 1 198 112" pathLength="100" style={{ "--p": p }} />
          <text className="viz-tick" x="22" y="126" textAnchor="middle">
            0 %
          </text>
          <text className="viz-tick" x="198" y="126" textAnchor="middle">
            100 %
          </text>
        </svg>
        <div className="gauge-center">
          <span className="gauge-ic">
            <Icon name={icon} />
          </span>
          <span className="gauge-v">{formatNumber(value)} %</span>
        </div>
      </div>
      {caption ? <p className="gauge-cap">{caption}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* 4. Barres de progression                                                   */
/* ------------------------------------------------------------------------ */

/** `items: [{ name, abbr, cls (det-*), value (0-100), detail }]`. */
export function ProgressList({ title, items, exportRef, fictive = false }) {
  const head = ["Élément", "Part"];
  const rows = items.map((it) => [it.name, `${formatNumber(it.value)} %`]);
  useExportButton(exportRef, title, head, rows);
  return (
    <>
      <ul className="prog">
        {items.map((it, i) => (
          <li key={it.name}>
            <div className="prog-top">
              <span className="prog-name">
                {it.cls ? <span className={cx("det-swatch", it.cls)} aria-hidden="true" /> : null}
                {it.abbr ? <span className="prog-abbr">{it.abbr}</span> : null}
                {it.name}
              </span>
              <span className="prog-v mono">
                {it.detail ? `${it.detail} · ` : ""}
                {formatNumber(it.value)} %
              </span>
            </div>
            <div className="prog-trk" role="img" aria-label={`${it.name} : ${it.value} %`}>
              <span className={cx("prog-fill", it.cls)} style={{ "--w": `${it.value}%`, animationDelay: `${i * 80}ms` }} />
            </div>
          </li>
        ))}
      </ul>
      <DataDetails caption={fictive ? `${title} (données fictives)` : title} head={head} rows={rows} />
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* 5. Histogramme + moyenne mobile                                            */
/* ------------------------------------------------------------------------ */

export function BarChart({ title, summary, labels, year, values, name, trendName, unit, exportRef, fictive = false }) {
  const plotRef = useRef(null);
  const width = useWidth(plotRef);
  const nav = useIndexNav(values.length);
  const trendRef = useRef(null);
  const [animate] = useState(() => !prefersReducedMotion());

  const trend = useMemo(
    () =>
      values.map((_, i) => {
        const a = values.slice(Math.max(0, i - 2), i + 1);
        return Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10;
      }),
    [values],
  );

  const geom = useMemo(() => {
    const W = Math.max(280, width || 600);
    const H = W < 520 ? 200 : 240;
    const m = { t: 12, r: 8, b: 28, l: 36 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = values.length;
    const sc = niceScale(Math.max(...values), values.every((v) => v % 1 === 0));
    const slot = iw / n;
    const bw = Math.min(24, slot * 0.56);
    const Y = (v) => m.t + ih - (v / sc.max) * ih;
    const X = (i) => m.l + slot * i + slot / 2;
    const ticks = [];
    for (let v = 0; v <= sc.max + 1e-9; v += sc.step) ticks.push(v);
    return { W, H, m, n, slot, bw, X, Y, ticks, every: slot < 34 ? 2 : 1 };
  }, [width, values]);

  useDrawIn(trendRef, 400, [width > 0]);

  const head = ["Période", name, trendName];
  const rows = labels.map((l, i) => [`${l}${year ? ` ${year[i]}` : ""}`, formatNumber(values[i]), formatNumber(trend[i])]);
  useExportButton(exportRef, title, head, rows);

  const { X, Y, W, H, m, n, bw } = geom;
  const idx = nav.index;
  const tip =
    idx >= 0
      ? {
          x: X(idx),
          y: Y(values[idx]),
          title: `${labels[idx]}${year ? ` ${year[idx]}` : ""}`,
          rows: [
            { keyClass: "k-bar", value: formatNumber(values[idx], unit), name },
            { keyClass: "k-trend", value: formatNumber(trend[idx], unit), name: trendName },
          ],
        }
      : null;

  return (
    <div className="viz">
      <ul className="viz-legend">
        <li>
          <span className="viz-key k-bar" aria-hidden="true" />
          {name}
        </li>
        <li>
          <span className="viz-key k-trend" aria-hidden="true" />
          {trendName}
        </li>
      </ul>
      <div
        ref={plotRef}
        className="viz-plot"
        tabIndex={0}
        role="group"
        aria-roledescription="graphique"
        aria-label={`${title}. ${summary} Flèches gauche et droite pour lire chaque colonne.`}
        onPointerMove={(event) => {
          const r = event.currentTarget.getBoundingClientRect();
          const i = Math.floor((event.clientX - r.left - m.l) / geom.slot);
          if (i >= 0 && i < n && i !== idx) nav.focusAt(i);
        }}
        onPointerLeave={(event) => {
          if (document.activeElement !== event.currentTarget) nav.setIndex(-1);
        }}
        onKeyDown={nav.onKeyDown}
        onFocus={() => {
          if (idx < 0) nav.focusAt(n - 1);
        }}
        onBlur={() => nav.setIndex(-1)}
      >
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="viz-svg">
          {geom.ticks.map((v) => (
            <g key={v}>
              <line className="viz-grid" x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} />
              <text className="viz-tick" x={m.l - 8} y={Y(v) + 4} textAnchor="end">
                {formatNumber(v)}
              </text>
            </g>
          ))}
          {values.map((val, i) => {
            const x = X(i) - bw / 2;
            const y = Y(val);
            const hh = Y(0) - y;
            const r = Math.min(4, bw / 2, hh);
            const d = `M${x},${Y(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${Y(0)}Z`;
            return (
              <g key={`${labels[i]}${i}`}>
                <path
                  className={cx("viz-bar", i === n - 1 && "is-current", i === idx && "is-hover")}
                  d={d}
                  style={animate ? { transformOrigin: `0 ${Y(0)}px`, animation: `viz-grow 600ms cubic-bezier(.22,1,.36,1) ${i * 35}ms both` } : undefined}
                />
                {(n - 1 - i) % geom.every === 0 ? (
                  <text className="viz-tick" x={X(i)} y={H - 8} textAnchor="middle">
                    {labels[i]}
                  </text>
                ) : null}
              </g>
            );
          })}
          <path ref={trendRef} className="viz-trend" d={monotonePath(trend.map((v, i) => [X(i), Y(v)]))} />
          <text className="viz-cap" x={X(n - 1)} y={Y(values[n - 1]) - 8} textAnchor="middle">
            {formatNumber(values[n - 1])}
          </text>
        </svg>
        <Tooltip hostRef={plotRef} tip={tip} />
      </div>
      <DataDetails caption={fictive ? `${title} (données fictives)` : title} head={head} rows={rows} />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* 6. État vide                                                               */
/* ------------------------------------------------------------------------ */

export function VizEmpty({ title, children }) {
  return (
    <div className="viz-empty">
      <span className="viz-empty-ic" aria-hidden="true">
        <Icon name="chart" />
      </span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

/** Les `n` derniers mois jusqu'au mois courant inclus : `{ labels, year }`. */
export function lastMonths(n) {
  const M = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const now = new Date();
  const out = { labels: [], year: [] };
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.labels.push(M[d.getMonth()]);
    out.year.push(d.getFullYear());
  }
  return out;
}
