import { ANOMALY_LABELS, DETECTION_TYPES, REVIEW_STATUS, SimulatedPanoImage, detectionType } from "@/entities/detection";
import { Logo } from "@/shared/ui";
import { isDashed } from "@/widgets/analysis-workspace";

/** Image annotée de la feuille : détections retenues, étiquettes lisibles. */
function SheetImage({ vm, retained }) {
  const unit = vm.width / 1200;
  return (
    <svg viewBox={`0 0 ${vm.width} ${vm.height}`} role="img" aria-label="Radiographie panoramique avec les cadres des détections retenues">
      <SimulatedPanoImage />
      <g>
        {retained.map((d) => {
          const b = d.box;
          const col = detectionType(d.label).color;
          const txt = `${d.fdi ?? "?"} · ${detectionType(d.label).short}${d.confidence != null ? ` ${d.confidence} %` : " · ajoutée"}`;
          const w = (txt.length * 12.2 + 14) * unit;
          const h = 28 * unit;
          const below = d.label === "periapical_lesion" && (d.fdi ?? 0) >= 30;
          const x = Math.max(6 * unit, Math.min(vm.width - w - 6 * unit, b.x + b.w / 2 - w / 2));
          const y = below ? b.y + b.h + 4 * unit : b.y - h - 4 * unit;
          return (
            <g key={d.id}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={col} strokeWidth={3.5 * unit} strokeDasharray={isDashed(d) ? `${10 * unit} ${6 * unit}` : "none"} />
              <rect x={x} y={y} width={w} height={h} rx={4 * unit} fill="#0B1220" stroke={col} strokeWidth={1.5 * unit} opacity=".92" />
              <text x={x + 7 * unit} y={y + 20 * unit} fill="#fff" fontFamily="Satoshi, sans-serif" fontSize={19 * unit} fontWeight="600">
                {txt}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/**
 * Feuille de DÉMONSTRATION (analyse fictive, sans serveur) : une maquette du
 * compte rendu en HTML. Une analyse réelle affiche, elle, le PDF produit par
 * le serveur.
 */
export function DemoSheet({ vm, opts, today }) {
  const retained = vm.dets.filter((d) => d.status !== "pending").sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0) || String(a.id).localeCompare(String(b.id)));
  const pendingN = vm.dets.length - retained.length;
  return (
    <article className="sheet" data-comments={opts.comments ? "on" : "off"} aria-label="Aperçu du compte rendu de démonstration">
      <header className="sh-head">
        <div>
          <Logo href="#" />
          <p className="sh-cab">Cabinet dentaire de démonstration</p>
        </div>
        <div className="sh-meta">
          <p>
            Analyse n° <b className="mono">{vm.number}</b>
          </p>
          <p>
            Référence <b className="mono">{vm.ref}</b>
          </p>
          <p>
            Date : <b>{vm.date}</b>
          </p>
          <p>
            Relu par <b>Dr Rakoto</b>
          </p>
        </div>
      </header>
      <h2>Compte rendu d’aide à la lecture — radiographie panoramique</h2>
      {opts.image ? (
        <section aria-label="Image annotée">
          <h3>Image annotée</h3>
          <div className="sh-img">
            <SheetImage vm={vm} retained={retained} />
          </div>
          <div className="sh-legend">
            {ANOMALY_LABELS.map((k) => (
              <span key={k}>
                <i className={`det-swatch ${DETECTION_TYPES[k].cls}`} />
                {DETECTION_TYPES[k].short}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <section aria-label="Détections retenues">
        <h3>Détections retenues</h3>
        <table className="sh-table">
          <thead>
            <tr>
              <th>Dent (FDI)</th>
              <th>Anomalie</th>
              <th>Confiance</th>
              <th>Statut</th>
              <th className="col-comment">Commentaire</th>
            </tr>
          </thead>
          <tbody>
            {retained.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.fdi ?? "—"}</td>
                <td>
                  <i className={`det-swatch ${detectionType(d.label).cls}`} />
                  {detectionType(d.label).short}
                </td>
                <td className="mono">{d.confidence != null ? `${d.confidence} %` : "—"}</td>
                <td>{REVIEW_STATUS[d.status]?.label}</td>
                <td className="col-comment">{d.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="sh-sum">
        <span>
          <b>{vm.teeth.length}</b>dents numérotées
        </span>
        <span>
          <b>{retained.length}</b>détections retenues
        </span>
        <span>
          <b>{pendingN}</b>non revues, exclues
        </span>
      </p>
      <p className="sh-legal">
        Document d’aide à la décision généré par un prototype académique non certifié. Il ne constitue pas un diagnostic et ne remplace pas le jugement clinique du praticien, seul responsable de l’interprétation.
      </p>
      <footer className="sh-foot">
        <span>Page 1 / 1</span>
        <span>Généré le {today}</span>
      </footer>
    </article>
  );
}
