import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

import { DETECTION_TYPES, SimulatedPanoImage, detectionType } from "@/entities/detection";
import { Icon } from "@/shared/ui";

import { boxFromPoints, isDashed, moveBox, pct, renderAnnotatedPng, resizeBox, screenToImage, zoomAround } from "@/widgets/analysis-workspace";

const LAYERS = ["tooth", "caries", "deep_caries", "periapical_lesion", "impacted_tooth"];

/**
 * Visionneuse : barre d'outils, scène zoomable (molette, glisser), réglages
 * d'image, calques, cadres des détections, tracé et correction de cadres.
 * Les tailles de trait et d'étiquette sont exprimées pour une image de 1200 px
 * de large, puis mises à l'échelle de l'image réelle.
 */
export const Viewer = forwardRef(function Viewer(
  { vm, dets, visible, show, onToggleLayer, onToggleAll, onExport, exporting, sel, hover, onHover, onSelect, mode, draft, onDraft, onDrawEnd, onBoxChange, focusTooth, onPickTooth, hint, panelClosed, onTogglePanel, loading, error, onRetry, children },
  ref,
) {
  const stageRef = useRef(null);
  const wsRef = useRef(null);
  const imageSvgRef = useRef(null);
  const ratio = vm ? vm.width / vm.height : 2;
  const W = vm?.width ?? 1200;
  const H = vm?.height ?? 600;
  const unit = W / 1200;
  const [view, setView] = useState({ zoom: 1, tx: 0, ty: 0, base: 800 });
  const [adjust, setAdjust] = useState({ open: false, bright: 100, contrast: 100, invert: false });
  const [panning, setPanning] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [vm?.imageUrl]);
  const drag = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const layout = useCallback(
    (reset) => {
      const stage = stageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const base = Math.max(200, Math.min(r.width, r.height * ratio));
      setView((v) => (reset ? { zoom: 1, tx: (r.width - base) / 2, ty: (r.height - base / ratio) / 2, base } : { ...v, base }));
    },
    [ratio],
  );

  useLayoutEffect(() => {
    layout(true);
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => layout(viewRef.current.zoom === 1));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [layout, panelClosed]);

  useEffect(() => {
    const onFull = () => setTimeout(() => layout(true), 60);
    document.addEventListener("fullscreenchange", onFull);
    return () => document.removeEventListener("fullscreenchange", onFull);
  }, [layout]);

  const zoomAt = useCallback((factor, px, py) => {
    const r = stageRef.current.getBoundingClientRect();
    const x = px ?? r.width / 2;
    const y = py ?? r.height / 2;
    setView((v) => zoomAround(v, factor, x, y));
  }, []);

  // Molette : zoom (écouteur non passif pour empêcher le défilement de la page).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - r.left, e.clientY - r.top);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const imageFilter = `brightness(${adjust.bright / 100}) contrast(${adjust.contrast / 100})${adjust.invert ? " invert(1)" : ""}`;

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomAt(1.25),
    zoomOut: () => zoomAt(0.8),
    fit: () => layout(true),
    /** PNG de l'image annotée, réglages de luminosité et contraste compris. */
    exportPng(shapes) {
      const source = vm.demo ? imageSvgRef.current : vm.imageUrl;
      return renderAnnotatedPng(vm, shapes, { source, filter: imageFilter });
    },
    /** Centre la vue sur un cadre (si l'image est zoomée). */
    centerOn(box) {
      const v = viewRef.current;
      if (v.zoom <= 1.2 || !box) return;
      const r = stageRef.current.getBoundingClientRect();
      const k = v.base / W;
      setView({ ...v, tx: r.width / 2 - (box.x + box.w / 2) * k * v.zoom, ty: r.height / 2 - (box.y + box.h / 2) * k * v.zoom });
    },
  }));

  const toImg = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    return screenToImage({ x: e.clientX - r.left, y: e.clientY - r.top }, view, W);
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const hit = e.target.closest("[data-det]");
    const handle = e.target.closest("[data-handle]");
    const p = toImg(e);
    if (mode === "draw") {
      drag.current = { kind: "draw", x0: p.x, y0: p.y };
      onDraft({ x: p.x, y: p.y, w: 0, h: 0 });
      stageRef.current.setPointerCapture(e.pointerId);
      return;
    }
    const current = dets.find((d) => d.id === sel);
    if (mode === "correct" && current && (handle || hit?.dataset.det === sel)) {
      drag.current = { kind: handle ? "resize" : "move", corner: handle?.dataset.handle, p0: p, b0: { ...current.box } };
      stageRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (hit) {
      onSelect(hit.dataset.det);
      return;
    }
    drag.current = { kind: "pan", x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    setPanning(true);
    stageRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) {
      const h = e.target.closest("[data-det]");
      const id = h ? h.dataset.det : null;
      if (id !== hover) onHover(id);
      return;
    }
    if (d.kind === "pan") {
      setView((v) => ({ ...v, tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y }));
      return;
    }
    const p = toImg(e);
    if (d.kind === "draw") {
      onDraft(boxFromPoints({ x: d.x0, y: d.y0 }, p, W, H));
    } else {
      // Cadre toujours contenu dans l'image : il part ensuite en fractions bornées à [0, 1].
      const dx = p.x - d.p0.x;
      const dy = p.y - d.p0.y;
      onBoxChange(sel, d.kind === "move" ? moveBox(d.b0, dx, dy, W, H) : resizeBox(d.b0, d.corner ?? "br", dx, dy, W, H, 14 * unit));
    }
  };

  const onPointerUp = () => {
    if (drag.current?.kind === "draw") onDrawEnd();
    drag.current = null;
    setPanning(false);
  };

  /* ---------- Cadres ---------- */
  const fs = (17 * unit) / view.zoom ** 0.75;
  const placed = [];
  const ordered = dets.filter(visible).sort((a, b) => (a.id === sel) - (b.id === sel));
  const allHidden = LAYERS.every((k) => !show[k]);

  return (
    <div className="viewer-col" ref={wsRef}>
      <div className="toolbar" role="toolbar" aria-label="Outils de la visionneuse">
        <button type="button" className="vbtn" aria-label="Dézoomer" onClick={() => zoomAt(0.8)}>
          <Icon name="zoomout" />
        </button>
        <span className="zoom-val" aria-live="polite">
          {Math.round(view.zoom * 100)}&nbsp;%
        </span>
        <button type="button" className="vbtn" aria-label="Zoomer" onClick={() => zoomAt(1.25)}>
          <Icon name="zoomin" />
        </button>
        <button type="button" className="vbtn outline" onClick={() => layout(true)}>
          Ajuster
        </button>
        <span className="vsep" />
        <button type="button" className="vbtn" aria-pressed="true" title="Déplacer l'image (glisser)">
          <Icon name="hand" />
          <span className="hide-sm">Déplacer</span>
        </button>
        <span className="adjust">
          <button type="button" className="vbtn" aria-expanded={adjust.open} aria-controls="adjPop" onClick={() => setAdjust((a) => ({ ...a, open: !a.open }))}>
            <Icon name="sun" />
            <span className="hide-sm">Luminosité / contraste</span>
          </button>
          <div className="pop" id="adjPop" data-open={adjust.open ? "true" : "false"}>
            <label htmlFor="bright">
              <span>
                Luminosité <output>{adjust.bright}&nbsp;%</output>
              </span>
              <input type="range" id="bright" min="50" max="160" value={adjust.bright} onChange={(e) => setAdjust((a) => ({ ...a, bright: Number(e.target.value) }))} />
            </label>
            <label htmlFor="contrast">
              <span>
                Contraste <output>{adjust.contrast}&nbsp;%</output>
              </span>
              <input type="range" id="contrast" min="50" max="200" value={adjust.contrast} onChange={(e) => setAdjust((a) => ({ ...a, contrast: Number(e.target.value) }))} />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--color-viewer-text)", fontSize: "var(--text-sm)" }}>
              <input type="checkbox" checked={adjust.invert} onChange={(e) => setAdjust((a) => ({ ...a, invert: e.target.checked }))} /> Inverser les niveaux de gris
            </label>
            <button type="button" className="vbtn outline" onClick={() => setAdjust((a) => ({ ...a, bright: 100, contrast: 100, invert: false }))}>
              Réinitialiser
            </button>
          </div>
        </span>
        <button
          type="button"
          className="vbtn"
          aria-label="Plein écran"
          onClick={() => {
            const ws = wsRef.current?.closest(".ws");
            if (document.fullscreenElement) document.exitFullscreen();
            else ws?.requestFullscreen?.();
          }}
        >
          <Icon name="maximize" />
        </button>
        <span className="vsep" />
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Afficher ou masquer les calques">
          {LAYERS.map((k) => {
            const n = k === "tooth" ? vm?.teeth.length ?? 0 : dets.filter((d) => d.label === k).length;
            const label = k === "tooth" ? "Dents" : DETECTION_TYPES[k].short;
            return (
              <button key={k} type="button" className="chip" aria-pressed={show[k]} title={`${show[k] ? "Masquer" : "Afficher"} : ${label}`} onClick={() => onToggleLayer(k)}>
                <span className={`det-swatch ${DETECTION_TYPES[k].cls}`} />
                {label} <span className="n">{n}</span>
              </button>
            );
          })}
        </span>
        <button
          type="button"
          className="vbtn outline"
          aria-label={allHidden ? "Tout afficher" : "Tout masquer"}
          title={`${allHidden ? "Tout afficher" : "Tout masquer"} (H)`}
          onClick={onToggleAll}
        >
          <Icon name={allHidden ? "eye" : "eye-off"} />
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="vbtn"
          onClick={onExport}
          disabled={!vm || exporting}
          aria-label={exporting ? "Export en cours" : "Exporter en PNG l’image annotée"}
          title="Exporter en PNG l’image annotée, telle qu’affichée"
        >
          <Icon name="download" />
        </button>
        <button type="button" className="vbtn" id="panelToggle" aria-label="Replier le panneau latéral" title="Replier le panneau" onClick={onTogglePanel}>
          <Icon name="panel" />
        </button>
      </div>

      <div
        ref={stageRef}
        className={`stage${panning ? " panning" : ""}${mode === "draw" ? " drawing" : ""}`}
        aria-label={vm?.demo ? "Radiographie panoramique simulée avec les détections superposées" : "Radiographie panoramique avec les détections superposées"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {vm ? (
          <div className="layer" style={{ width: view.base, height: view.base / ratio, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})` }}>
            {vm.demo ? (
              <svg ref={imageSvgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${vm.width} ${vm.height}`} width={vm.width} height={vm.height} aria-hidden="true" style={{ filter: imageFilter }}>
                <SimulatedPanoImage />
              </svg>
            ) : (
              <svg viewBox={`0 0 ${vm.width} ${vm.height}`} aria-hidden="true" style={{ filter: imageFilter }}>
                {vm.imageUrl && !imageFailed ? (
                  <image href={vm.imageUrl} x="0" y="0" width={vm.width} height={vm.height} onError={() => setImageFailed(true)} />
                ) : (
                  <>
                    <rect width={vm.width} height={vm.height} fill="#111417" />
                    <text className="img-missing" x={vm.width / 2} y={vm.height / 2} textAnchor="middle" fontSize={22 * unit}>
                      Image indisponible : le serveur de stockage ne répond pas.
                    </text>
                  </>
                )}
              </svg>
            )}
            <svg viewBox={`0 0 ${vm.width} ${vm.height}`} role="group" aria-label="Cadres des détections">
              {show.tooth ? (
                <g>
                  {vm.teeth.map((t) => {
                    const on = focusTooth === t.fdi;
                    // Numéro à vérifier (sprint 7) : contour orange, comme dans le schéma.
                    const couleur = t.doubtful ? "#F59E0B" : "#56B4E9";
                    const ly = t.upper ? t.box.y - 6 * unit : t.box.y + t.box.h + fs + 2 * unit;
                    return (
                      <g key={t.id ?? t.fdi} data-dent={t.fdi}>
                        <rect
                          x={t.box.x}
                          y={t.box.y}
                          width={t.box.w}
                          height={t.box.h}
                          rx={6 * unit}
                          fill="none"
                          stroke={couleur}
                          strokeWidth={(on ? (2.2 / view.zoom) * 1.4 : (1 / view.zoom) * 1.2) * unit}
                          opacity={on ? 1 : 0.45}
                        />
                        <text
                          x={t.cx}
                          y={ly}
                          textAnchor="middle"
                          fill={couleur}
                          fontSize={fs * 0.95}
                          fontFamily="JetBrains Mono, monospace"
                          fontWeight={on ? 700 : 500}
                          opacity={on ? 1 : 0.8}
                          style={onPickTooth ? { cursor: "pointer" } : undefined}
                          onClick={onPickTooth ? (e) => (e.stopPropagation(), onPickTooth(t.fdi)) : undefined}
                        >
                          {t.fdi}
                        </text>
                      </g>
                    );
                  })}
                </g>
              ) : null}
              {ordered.map((d) => {
                const b = d.box;
                const col = d.status === "rejected" ? "#94A3B8" : detectionType(d.label).color;
                const selected = d.id === sel;
                const hovered = d.id === hover;
                const rejected = d.status === "rejected";
                const dim = rejected ? (selected ? 0.75 : 0.35) : sel && !selected && !hovered ? 0.55 : 1;
                const cl = Math.min(b.w, b.h) * 0.32;
                const cw = ((selected || hovered ? 4.2 : 3.2) * unit) / view.zoom ** 0.6;
                const o = cw / 2;
                const text = `${d.fdi ?? "?"} · ${d.confidence == null ? "ajoutée" : pct(d.confidence)} · ${detectionType(d.label).short}${d.status === "rejected" ? " · rejetée" : ""}`;
                const tw = text.length * fs * 0.62 + fs * 1.6;
                const th = fs * 1.55;
                let lx = b.x;
                let lyy = b.y - th - 3 * unit;
                if (lyy < 2 * unit) lyy = b.y + b.h + 3 * unit;
                if (lx + tw > W - 2 * unit) lx = W - 2 * unit - tw;
                const hit = (y) => placed.some((p) => lx < p.x + p.w && lx + tw > p.x && y < p.y + p.h && y + th > p.y);
                if (hit(lyy)) {
                  const below = b.y + b.h + 3 * unit;
                  lyy = hit(below) ? lyy : below;
                }
                let guard = 0;
                while (hit(lyy) && guard < 8) {
                  lyy += th + 2 * unit;
                  guard += 1;
                }
                placed.push({ x: lx, y: lyy, w: tw, h: th });
                return (
                  <g key={d.id} data-det={d.id} style={{ cursor: "pointer" }} opacity={dim} aria-label={`Dent ${d.fdi}, ${detectionType(d.label).label}, confiance ${pct(d.confidence)}${d.status === "rejected" ? ", rejetée" : ""}`}>
                    {selected ? (
                      <rect x={b.x - 5 * unit} y={b.y - 5 * unit} width={b.w + 10 * unit} height={b.h + 10 * unit} rx={8 * unit} fill="none" stroke="#22D3EE" strokeWidth={((1.5 / view.zoom) * 1.3) * unit} strokeDasharray={`${2 * unit} ${3 * unit}`} />
                    ) : null}
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      rx={6 * unit}
                      fill={col}
                      fillOpacity={selected || hovered ? 0.14 : 0.05}
                      stroke={col}
                      strokeWidth={((selected || hovered ? 2 : 1.4) * unit) / view.zoom ** 0.6}
                      strokeDasharray={isDashed(d) ? `${7 * unit} ${5 * unit}` : "none"}
                    />
                    {rejected ? null : (
                    <path
                      d={`M${b.x - o} ${b.y + cl} V${b.y - o} H${b.x + cl} M${b.x + b.w - cl} ${b.y - o} H${b.x + b.w + o} V${b.y + cl} M${b.x + b.w + o} ${b.y + b.h - cl} V${b.y + b.h + o} H${b.x + b.w - cl} M${b.x + cl} ${b.y + b.h + o} H${b.x - o} V${b.y + b.h - cl}`}
                      fill="none"
                      stroke="#22D3EE"
                      strokeWidth={cw}
                      strokeLinecap="square"
                    />
                    )}
                    <rect x={lx} y={lyy} width={tw} height={th} rx={th * 0.3} fill="#0E7490" stroke={selected ? "#22D3EE" : "none"} strokeWidth={(1.5 / view.zoom) * unit} />
                    <rect x={lx + fs * 0.4} y={lyy + th / 2 - fs * 0.3} width={fs * 0.6} height={fs * 0.6} rx={1.5 * unit} fill={col} />
                    <text x={lx + fs * 1.25} y={lyy + th * 0.7} fill="#FFFFFF" fontSize={fs} fontFamily="JetBrains Mono, monospace" fontWeight="500">
                      {text}
                    </text>
                    {selected && mode === "correct"
                      ? [
                          ["tl", b.x, b.y, "nwse-resize"],
                          ["tr", b.x + b.w, b.y, "nesw-resize"],
                          ["bl", b.x, b.y + b.h, "nesw-resize"],
                          ["br", b.x + b.w, b.y + b.h, "nwse-resize"],
                        ].map(([corner, cx, cy, cursor]) => (
                          <circle
                            key={corner}
                            cx={cx}
                            cy={cy}
                            r={((7 / view.zoom) * 1.3) * unit}
                            fill="#22D3EE"
                            stroke="#0B1220"
                            strokeWidth={(2 / view.zoom) * unit}
                            data-handle={corner}
                            aria-label={`Poignée ${corner}`}
                            style={{ cursor }}
                          />
                        ))
                      : null}
                  </g>
                );
              })}
              {(() => {
                // Détection corrigée sélectionnée : cadre proposé à l'origine, en fantôme.
                const c = dets.find((d) => d.id === sel);
                const o = c?.status === "corrected" ? c.proposal?.box : null;
                if (!o || (o.x === c.box.x && o.y === c.box.y && o.w === c.box.w && o.h === c.box.h)) return null;
                return (
                  <rect
                    data-testid="cadre-origine"
                    x={o.x}
                    y={o.y}
                    width={o.w}
                    height={o.h}
                    rx={6 * unit}
                    fill="none"
                    stroke="#94A3B8"
                    strokeWidth={(1.4 * unit) / view.zoom ** 0.6}
                    strokeDasharray={`${3 * unit} ${4 * unit}`}
                    opacity={0.8}
                    pointerEvents="none"
                  >
                    <title>Cadre proposé à l&apos;origine par le modèle</title>
                  </rect>
                );
              })()}
              {draft ? (
                <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} rx={5 * unit} fill="#22D3EE" fillOpacity=".1" stroke="#22D3EE" strokeWidth={(2.4 / view.zoom) * unit} strokeDasharray={`${8 * unit} ${5 * unit}`} />
              ) : null}
            </svg>
          </div>
        ) : null}
        <div className="stage-hint" role="status" data-show={hint ? "true" : "false"}>
          {hint}
        </div>
        <span className="minimap-note">
          Molette ou + / − : zoom · 0 : ajuster · J / K : suivante / précédente · V / C / R : valider, corriger, rejeter · U : annuler · H : tout masquer{vm?.demo ? " · Image simulée" : ""}
        </span>
        <div className="overlay-state" data-show={loading ? "true" : "false"}>
          <div style={{ width: "70%", display: "grid", gap: 12 }}>
            <div className="vskel" style={{ height: 260 }} />
            <div className="vskel" style={{ height: 14, width: "40%" }} />
            <p style={{ color: "var(--color-viewer-muted)", fontSize: "var(--text-sm)" }}>Chargement de l&apos;analyse…</p>
          </div>
        </div>
        <div className="overlay-state" data-show={error ? "true" : "false"}>
          <div style={{ maxWidth: 420, textAlign: "center", display: "grid", gap: 12, justifyItems: "center", padding: "var(--space-6)" }}>
            <Icon name="alert" />
            <h2 style={{ fontSize: "var(--text-xl)" }}>L&apos;analyse n&apos;a pas pu être chargée</h2>
            <p style={{ color: "var(--color-viewer-muted)", fontSize: "var(--text-sm)" }}>{error?.message} Vos relectures enregistrées ne sont pas perdues.</p>
            <button type="button" className="vbtn accent" onClick={onRetry}>
              Réessayer
            </button>
          </div>
        </div>
      </div>

      <div className="legend" aria-label="Légende des traits">
        <span className="ln">
          <svg viewBox="0 0 28 10" aria-hidden="true">
            <line x1="1" y1="5" x2="27" y2="5" stroke="#E2E8F0" strokeWidth="2.5" />
          </svg>
          Trait plein : détection de l&apos;IA
        </span>
        <span className="ln">
          <svg viewBox="0 0 28 10" aria-hidden="true">
            <line x1="1" y1="5" x2="27" y2="5" stroke="#E2E8F0" strokeWidth="2.5" strokeDasharray="5 4" />
          </svg>
          Pointillé : ajoutée ou corrigée par le praticien
        </span>
        <span className="ln">Droite du patient à gauche de l&apos;image (D / G)</span>
      </div>
      {children}
    </div>
  );
});
