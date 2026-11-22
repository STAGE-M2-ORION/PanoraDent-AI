import { useRef, useState } from "react";

import { Alert, Button, Icon } from "@/shared/ui";

import { MAX_MASKS, detectionMethodNotice, isUsable, rectFromPoints, round, toFraction, toStyle } from "../model/masks";

/**
 * Aperçu avant / après anonymisation, avec les zones masquées superposées.
 *
 * - zones automatiques (détection des inscriptions) : cadre orange, verrouillées ;
 * - masques manuels : tracés à la souris ou au doigt sur l'image « après »
 *   (glisser), noirs comme le seront les pixels, retirables un par un.
 *
 * Rien n'est stocké tant que l'import n'est pas confirmé : les masques
 * partent avec la confirmation, et le serveur les applique.
 */
export function MaskEditor({ preview, masks, onChange, disabled }) {
  const [view, setView] = useState("after");
  const [drawing, setDrawing] = useState(null); // { start, current }
  const surface = useRef(null);
  const canDraw = view === "after" && !disabled && masks.length < MAX_MASKS;

  const point = (event) => toFraction(event.clientX, event.clientY, surface.current.getBoundingClientRect());

  const onPointerDown = (event) => {
    if (!canDraw || event.button > 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const p = point(event);
    setDrawing({ start: p, current: p });
  };
  const onPointerMove = (event) => drawing && setDrawing((d) => ({ ...d, current: point(event) }));
  const onPointerUp = () => {
    if (!drawing) return;
    const rect = rectFromPoints(drawing.start, drawing.current);
    setDrawing(null);
    if (isUsable(rect)) onChange([...masks, round(rect)]);
  };

  const ghost = drawing ? rectFromPoints(drawing.start, drawing.current) : null;
  const ratio = preview.width && preview.height ? `${preview.width} / ${preview.height}` : "2 / 1";

  return (
    <div className="mask-editor">
      <div className="mask-toolbar">
        <div className="segmented" role="group" aria-label="Image affichée">
          <button type="button" aria-pressed={view === "before"} onClick={() => setView("before")}>
            Avant
          </button>
          <button type="button" aria-pressed={view === "after"} onClick={() => setView("after")}>
            Après anonymisation
          </button>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {view === "after"
            ? canDraw
              ? "Une inscription a échappé au masquage ? Tracez un rectangle dessus (glisser)."
              : disabled
                ? ""
                : `${MAX_MASKS} masques au plus.`
            : "Image telle que reçue : elle n’est ni conservée ni transmise ailleurs."}
        </p>
      </div>

      <div
        ref={surface}
        className={canDraw ? "mask-surface can-draw" : "mask-surface"}
        style={{ aspectRatio: ratio }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrawing(null)}
        data-testid="mask-surface"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={view === "after" ? preview.after : preview.before}
          alt={view === "after" ? "Radiographie après anonymisation, zones masquées en noir" : "Radiographie avant anonymisation"}
          draggable={false}
        />
        {view === "after"
          ? preview.autoZones.map((z, i) => <span key={`a${i}`} className="zone zone-auto" style={toStyle(z)} title="Inscription masquée automatiquement" />)
          : null}
        {view === "after" ? masks.map((z, i) => <span key={`m${i}`} className="zone zone-manual" style={toStyle(z)} />) : null}
        {ghost ? <span className="zone zone-ghost" style={toStyle(ghost)} /> : null}
      </div>

      <div className="mask-legend" aria-live="polite">
        <span>
          <span className="swatch swatch-auto" aria-hidden="true" />
          {preview.autoZones.length
            ? `${preview.autoZones.length} inscription${preview.autoZones.length > 1 ? "s" : ""} masquée${preview.autoZones.length > 1 ? "s" : ""} automatiquement`
            : "Aucune inscription détectée automatiquement : vérifiez l’image."}
        </span>
        {detectionMethodNotice(preview.detectionMethod).tone === "warning" ? (
          <Alert tone="warning" role="note" data-methode={preview.detectionMethod}>
            {detectionMethodNotice(preview.detectionMethod).text}
          </Alert>
        ) : (
          <span className="mask-method" data-methode={preview.detectionMethod}>
            {detectionMethodNotice(preview.detectionMethod).text}
          </span>
        )}
        {masks.length ? (
          <ul className="mask-list" aria-label="Masques ajoutés à la main">
            {masks.map((m, i) => (
              <li key={`l${i}`}>
                <span className="swatch swatch-manual" aria-hidden="true" />
                Masque {i + 1}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Retirer le masque ${i + 1}`}
                  onClick={() => onChange(masks.filter((_, k) => k !== i))}
                >
                  <Icon name="x" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
