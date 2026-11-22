import { useEffect, useRef, useState } from "react";

import { ANOMALY_LABELS, TypeMark, detectionType, markPath, typeTooltip } from "@/entities/detection";
import { Icon } from "@/shared/ui";

import { ToothState, VIEWBOX, nextTooth, toothKind, toothLabel } from "../model/odontogram";

const typeText = (label) => detectionType(label).label;

/** Une dent : couronne vers le plan d'occlusion, racines vers l'extérieur. */
function Tooth({ s, selected, focusable, choosing, onActivate, onKey, setRef }) {
  const upper = s.fdi < 30;
  const kind = toothKind(s.fdi);
  const largeur = kind === "molaire" ? 26 : kind === "prémolaire" ? 20 : 16;
  const couronne = upper ? 52 : 108; // haut de la couronne
  const x = (s.cx ?? 0) - largeur / 2;
  const racines =
    kind === "molaire"
      ? [x + 6, x + largeur - 6]
      : [s.cx];
  const yNum = upper ? 18 : 164;
  const classes = ["tooth", `t-${s.state}`, s.doubtful ? "t-doubtful" : "", choosing ? "t-choosing" : ""].join(" ");
  return (
    <g
      ref={setRef}
      className={classes}
      role="button"
      tabIndex={focusable ? 0 : -1}
      aria-pressed={selected}
      aria-label={toothLabel(s, typeText)}
      data-fdi={s.fdi}
      data-etat={s.state}
      data-douteux={s.doubtful ? "oui" : undefined}
      onClick={() => onActivate(s.fdi)}
      onKeyDown={(e) => onKey(e, s.fdi)}
    >
      <title>{toothLabel(s, typeText)}</title>
      <rect className="cell" x={s.cx - 19} y={upper ? 4 : 92} width={38} height={80} rx={6} />
      {racines.map((rx) => (
        <line key={rx} className="root" x1={rx} y1={upper ? couronne : couronne + 18} x2={rx} y2={upper ? couronne - 22 : couronne + 40} />
      ))}
      <rect className="crown" x={x} y={couronne} width={largeur} height={18} rx={4} />
      {s.state === ToothState.ABSENT ? <line className="cross" x1={x - 2} y1={couronne - 2} x2={x + largeur + 2} y2={couronne + 20} /> : null}
      <text className="num" x={s.cx} y={yNum} textAnchor="middle">
        {s.fdi}
      </text>
      {s.anomalies.slice(0, 3).map((d, i) => (
        <path key={d.id} className="mark" d={markPath(d.label, s.cx - 9 + i * 9, upper ? 80 : 98, 4)} fill={detectionType(d.label).color} />
      ))}
      {s.reviewed ? <path className="ok" d={`M${s.cx + 10} ${upper ? 8 : 150} l3 3 l6 -6`} /> : null}
    </g>
  );
}

/**
 * Schéma dentaire FDI en SVG (sprint 7).
 *
 * - Un clic ou Entrée sur une dent la retrouve sur l'image et dans la liste,
 *   et ouvre sa fiche ; ← → ↑ ↓ Début Fin déplacent le focus d'une dent à
 *   l'autre (une seule dent dans l'ordre de tabulation à la fois).
 * - `choosing` : mode « choisir le nouveau numéro » d'une dent ; le prochain
 *   clic désigne le numéro, Échap annule.
 * - États : présente, porteuse d'anomalie (pastilles), déclarée absente
 *   (barrée), non détectée (atténuée) ; contour orange : numéro à vérifier.
 */
export function Odontogram({ states, positions, selectedTooth, onPick, choosing, onChoose, onCancelChoose, onExport, exporting }) {
  const [focus, setFocus] = useState(selectedTooth ?? 11);
  const refs = useRef({});

  useEffect(() => {
    if (selectedTooth) setFocus(selectedTooth);
  }, [selectedTooth]);

  const activate = (fdi) => (choosing ? onChoose(fdi) : onPick(fdi));
  const onKey = (e, fdi) => {
    if (e.key === "Escape" && choosing) {
      e.preventDefault();
      onCancelChoose();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(fdi);
      return;
    }
    const cible = nextTooth(fdi, e.key);
    if (cible) {
      e.preventDefault();
      setFocus(cible);
      refs.current[cible]?.focus();
    }
  };

  return (
    <div className={`odonto${choosing ? " choosing" : ""}`}>
      <div className="odonto-head">
        <h3 id="odonto-titre">Schéma dentaire (FDI)</h3>
        {choosing ? (
          <p className="choose-hint" role="status">
            Choisissez le nouveau numéro de la dent {choosing.fdi} dans le schéma ·{" "}
            <button type="button" className="linkish" onClick={onCancelChoose}>
              Annuler (Échap)
            </button>
          </p>
        ) : (
          <p>Cliquez sur une dent pour la retrouver sur l&apos;image, dans la liste et dans sa fiche. Flèches : dent voisine.</p>
        )}
        {onExport ? (
          <button type="button" className="vbtn outline" onClick={onExport} disabled={exporting} aria-label="Exporter le schéma dentaire en image (PNG)">
            <Icon name="download" />
            Exporter le schéma
          </button>
        ) : null}
      </div>
      <svg className="odonto-svg" viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} role="group" aria-labelledby="odonto-titre">
        <line className="midline" x1={VIEWBOX.width / 2} y1={2} x2={VIEWBOX.width / 2} y2={VIEWBOX.height - 2} />
        <line className="occlusal" x1={4} y1={VIEWBOX.height / 2} x2={VIEWBOX.width - 4} y2={VIEWBOX.height / 2} />
        {Object.values(states).map((s) => (
          <Tooth
            key={s.fdi}
            s={{ ...s, cx: positions[s.fdi].cx }}
            selected={selectedTooth === s.fdi}
            focusable={focus === s.fdi}
            choosing={Boolean(choosing)}
            onActivate={activate}
            onKey={onKey}
            setRef={(el) => {
              refs.current[s.fdi] = el;
            }}
          />
        ))}
      </svg>
      <ul className="odonto-legend" aria-label="Légende du schéma">
        <li>
          <span className="lg lg-present" aria-hidden="true" /> présente
        </li>
        <li>
          <span className="lg lg-anomaly" aria-hidden="true" /> porteuse d&apos;anomalie
        </li>
        <li>
          <span className="lg lg-absent" aria-hidden="true" /> déclarée absente
        </li>
        <li>
          <span className="lg lg-undetected" aria-hidden="true" /> non détectée
        </li>
        <li>
          <span className="lg lg-doubtful" aria-hidden="true" /> numéro à vérifier
        </li>
      </ul>
      <ul className="odonto-legend odonto-types" aria-label="Marques des anomalies">
        {ANOMALY_LABELS.map((label) => (
          <li key={label} title={typeTooltip(label)}>
            <TypeMark label={label} /> {detectionType(label).label}
          </li>
        ))}
      </ul>
    </div>
  );
}
