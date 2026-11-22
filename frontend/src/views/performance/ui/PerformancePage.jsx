import { useState } from "react";

import { activeVersion, fetchModelVersions } from "@/entities/model-version";
import { Permission } from "@/entities/session";
import { formatDate, useAsyncResource } from "@/shared/lib";
import { Alert, Badge, KpiRing, VizEmpty } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

/**
 * Mesures globales lues dans `metrics` d'une version de modèle (JSON libre
 * côté backend). Clés reconnues : `map50`, `recall`, `precision` (0-1) et
 * `test_images` (entier). Absentes : « à renseigner », jamais de chiffre inventé.
 */
const GLOBAL_METRICS = [
  { key: "map50", label: "mAP@50", sub: "Toutes classes", icon: "chart" },
  { key: "recall", label: "Rappel", sub: "Part des anomalies trouvées", icon: "search" },
  { key: "precision", label: "Précision", sub: "Part des détections justes", icon: "detect" },
  { key: "test_images", label: "Images de test", sub: "Jamais vues à l’entraînement", icon: "pano" },
];

const CLASSES = [
  ["det-tooth", "Numérotation des dents", "0,90", "0,90", "0,90"],
  ["det-caries", "Carie", "0,70", "0,70", "0,90"],
  ["det-deep", "Carie profonde", "0,60", "0,60", "0,90"],
  ["det-periapical", "Lésion péri-apicale", "0,50", "0,50", "0,90"],
  ["det-impacted", "Dent incluse", "0,80", "0,80", "0,90"],
];
const MATRIX_NAMES = ["Dents", "Carie", "Carie profonde", "Péri-apicale", "Incluse", "Fond"];
const MATRIX = [
  [80, 2, 0, 0, 3, 15],
  [1, 60, 15, 2, 0, 22],
  [0, 20, 50, 5, 0, 25],
  [0, 3, 5, 55, 2, 35],
  [5, 0, 0, 2, 70, 23],
  [10, 8, 4, 3, 2, 73],
];

function Example({ value }) {
  return (
    <>
      <span className="cell-tbd">à renseigner</span>
      <span className="cell-ex">
        ex. fictif :{" "}
        <span className="fict" title="Valeur fictive">
          {value}
        </span>
      </span>
    </>
  );
}

function metricKpi(m, metrics) {
  const raw = metrics?.[m.key];
  if (typeof raw !== "number") {
    return { icon: m.icon, label: `${m.label} · ${m.sub}`, value: "à renseigner", ring: null, ringText: `${m.label} : mesure pas encore disponible`, dir: "flat" };
  }
  if (m.key === "test_images") return { icon: m.icon, label: `${m.label} · ${m.sub}`, value: raw, ring: 100, ringText: `${raw} images de test`, dir: "flat" };
  const pctValue = Math.round(raw * 100);
  return { icon: m.icon, label: `${m.label} · ${m.sub}`, value: raw.toLocaleString("fr-FR", { maximumFractionDigits: 2 }), ring: pctValue, ringText: `${m.label} : ${pctValue} %`, dir: "flat" };
}

/** Performance du modèle : ce qu'il sait faire, mesuré honnêtement, et ses limites. */
export function PerformancePage() {
  const { data: versions } = useAsyncResource(fetchModelVersions);
  const [threshold, setThreshold] = useState(50);
  // La version en service, jamais « la plus récente » par supposition.
  const active = activeVersion(versions);
  const x = 40 + (340 * threshold) / 100;
  const hasMetrics = active && GLOBAL_METRICS.some((m) => typeof active.metrics?.[m.key] === "number");

  return (
    <AppShell page="performance" title="Performance du modèle" permission={Permission.MODEL_READ} className="v-performance">
      <Alert tone="warning" role="note" title="Valeurs d’exemple fictives">
        Valeurs d’exemple fictives — les mesures réelles seront renseignées après l’évaluation du modèle sur le jeu de test.
      </Alert>

      <div className="page-head">
        <div>
          <h2>Performance du modèle</h2>
          <p>Ce que le modèle sait faire, mesuré honnêtement, et ce qu’il ne sait pas faire.</p>
        </div>
      </div>

      <section className="kpi-row" aria-label="Mesures globales du modèle">
        {GLOBAL_METRICS.map((m) => (
          <KpiRing key={m.key} {...metricKpi(m, active?.metrics)} />
        ))}
      </section>
      <div className="dash-grid">
        <section className="dcard span-12 signature" aria-labelledby="t-evol">
          <div className="dcard-h">
            <div>
              <h3 id="t-evol">Évolution de la mAP@50 par version</h3>
              <p>Une courbe par version du modèle, mesurée sur le même jeu de test</p>
            </div>
          </div>
          <div>
            {hasMetrics ? (
              <ul className="prog">
                {versions
                  .filter((v) => typeof v.metrics?.map50 === "number")
                  .map((v) => (
                    <li key={v.version}>
                      <div className="prog-top">
                        <span className="prog-name mono">{v.version}</span>
                        <span className="prog-v mono">{v.metrics.map50.toLocaleString("fr-FR")}</span>
                      </div>
                      <div className="prog-trk" role="img" aria-label={`${v.version} : mAP@50 ${v.metrics.map50}`}>
                        <span className="prog-fill" style={{ "--w": `${v.metrics.map50 * 100}%` }} />
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <VizEmpty title="Pas encore de mesure réelle">La courbe apparaîtra quand le modèle aura été évalué sur le jeu de test. Nous n’affichons aucun chiffre inventé.</VizEmpty>
            )}
          </div>
        </section>
      </div>

      <div className="perf-grid">
        <section className="card card-pad" aria-labelledby="t-modele">
          <div className="card-head">
            <h3 className="section-title" id="t-modele">
              Modèle actif
            </h3>
            {active ? (
              <Badge tone="success" dot>
                Actif
              </Badge>
            ) : (
              <Badge>Aucune version enregistrée</Badge>
            )}
          </div>
          <dl className="meta">
            <div>
              <dt>Nom</dt>
              <dd className="mono">panoradent-yolo</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd className={active ? "mono" : "tbd"}>{active?.version ?? "à renseigner"}</dd>
            </div>
            <div>
              <dt>Architecture</dt>
              <dd>YOLO (détection d’objets)</dd>
            </div>
            <div>
              <dt>Date d’entraînement</dt>
              <dd className={active ? undefined : "tbd"}>{active ? formatDate(active.createdAt) : "à renseigner"}</dd>
            </div>
            <div>
              <dt>Jeu de données</dt>
              <dd>{active?.dataset || "DENTEX — radiographies panoramiques publiques, challenge MICCAI 2023"}</dd>
            </div>
            <div>
              <dt>Nombre d’images</dt>
              <dd className="tbd">à renseigner</dd>
            </div>
            <div>
              <dt>Répartition entraînement / validation / test</dt>
              <dd className="tbd">à renseigner</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd className={active?.notes ? undefined : "tbd"}>{active?.notes || "à renseigner"}</dd>
            </div>
          </dl>
          <details className="versions">
            <summary>Historique des versions</summary>
            <ul>
              {(versions ?? []).map((v, i) => (
                <li key={v.version}>
                  <span className="mono">{v.version}</span>
                  <Badge tone={i === 0 ? "success" : undefined}>{i === 0 ? "Active" : "Archivée"}</Badge>
                  <span className="muted">{formatDate(v.createdAt)}</span>
                </li>
              ))}
              {versions?.length === 0 ? <li className="muted">Aucune version enregistrée.</li> : null}
            </ul>
          </details>
        </section>

        <section className="card card-pad" aria-labelledby="t-lexique">
          <h3 className="section-title" id="t-lexique">
            Petit lexique
          </h3>
          <p className="section-lead">Les mots utilisés plus bas, sans jargon.</p>
          <dl className="lexicon" style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <dt>mAP (précision moyenne)</dt>
              <dd>À quel point les cadres proposés tombent juste, toutes confiances confondues.</dd>
            </div>
            <div>
              <dt>Rappel (sensibilité)</dt>
              <dd>Part des anomalies réelles que le modèle retrouve : ce qu’il « ne laisse pas passer ».</dd>
            </div>
            <div>
              <dt>Précision</dt>
              <dd>Part des propositions du modèle qui sont justes. Pour un détecteur de cadres, elle remplace la spécificité, qui n’a pas de sens sans « vrais négatifs ».</dd>
            </div>
            <div>
              <dt>Seuil de confiance</dt>
              <dd>Niveau minimal de confiance au-dessous duquel une détection n’est pas affichée.</dd>
            </div>
            <div>
              <dt>IoU</dt>
              <dd>Recouvrement entre le cadre proposé et le cadre de référence.</dd>
            </div>
          </dl>
        </section>
      </div>

      <section aria-labelledby="t-classes">
        <h3 className="section-title" id="t-classes">
          Mesures par classe
        </h3>
        <p className="section-lead">Les mesures réelles sont à renseigner ; l’exemple fictif en dessous illustre seulement le format attendu.</p>
        <div className="table-wrap">
          <table className="table stack">
            <caption className="sr-only">Mesures par classe : mAP@50, rappel, précision, nombre d’exemples du jeu de test</caption>
            <thead>
              <tr>
                <th scope="col">Classe</th>
                <th scope="col">mAP@50</th>
                <th scope="col">Rappel</th>
                <th scope="col">Précision</th>
                <th scope="col">Exemples du jeu de test</th>
              </tr>
            </thead>
            <tbody>
              {CLASSES.map((c) => (
                <tr key={c[1]}>
                  <td>
                    <span className="cls">
                      <span className={`det-swatch ${c[0]}`} />
                      {c[1]}
                    </span>
                  </td>
                  <td>
                    <Example value={c[2]} />
                  </td>
                  <td>
                    <Example value={c[3]} />
                  </td>
                  <td>
                    <Example value={c[4]} />
                  </td>
                  <td>
                    <Example value="100" />
                  </td>
                </tr>
              ))}
              <tr className="total">
                <th scope="row">Toutes classes</th>
                <td data-label="mAP@50">
                  <Example value="0,70" />
                </td>
                <td data-label="Rappel">
                  <Example value="0,70" />
                </td>
                <td data-label="Précision">
                  <Example value="0,90" />
                </td>
                <td data-label="Exemples du jeu de test">
                  <Example value="500" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-pad" aria-labelledby="t-seuil">
        <h3 className="section-title" id="t-seuil">
          Seuil de confiance
        </h3>
        <p className="section-lead">Un seuil bas fait apparaître plus de détections (moins d’oublis, plus de fausses alertes) ; un seuil haut l’inverse.</p>
        <div className="perf-grid">
          <div className="field">
            <label className="label" htmlFor="seuil">
              Seuil de confiance
            </label>
            <div className="slider-row">
              <input type="range" id="seuil" min="0" max="100" step="1" value={threshold} aria-describedby="seuil-txt" onChange={(e) => setThreshold(Number(e.target.value))} />
              <output className="slider-val" htmlFor="seuil">
                {threshold} %
              </output>
            </div>
            <p className="hint" id="seuil-txt" aria-live="polite">
              {threshold < 35
                ? "Seuil bas : plus de détections affichées, moins d’oublis, plus de fausses alertes."
                : threshold > 65
                  ? "Seuil haut : moins de détections affichées, plus d’oublis possibles, moins de fausses alertes."
                  : "Seuil intermédiaire : compromis entre oublis et fausses alertes."}
            </p>
          </div>
          <figure style={{ margin: 0 }}>
            <svg className="curve" viewBox="0 0 400 230" role="img" aria-label="Schéma illustratif : le rappel baisse et la précision monte quand le seuil augmente. Courbe non mesurée.">
              <line x1="40" y1="190" x2="380" y2="190" stroke="var(--color-border-strong)" />
              <line x1="40" y1="20" x2="40" y2="190" stroke="var(--color-border-strong)" />
              <path d="M40 40 C150 42 260 80 380 170" fill="none" stroke="var(--color-primary)" strokeWidth="3" />
              <path d="M40 170 C150 120 260 70 380 36" fill="none" stroke="var(--color-ink)" strokeWidth="3" strokeDasharray="7 5" />
              <line x1={x} y1="20" x2={x} y2="190" stroke="var(--color-muted)" strokeWidth="1.5" />
              <text x="210" y="214" textAnchor="middle">
                Seuil de confiance (0 → 100 %)
              </text>
              <text x="12" y="105" transform="rotate(-90 12 105)" textAnchor="middle">
                Niveau
              </text>
            </svg>
            <figcaption className="legend">
              <span>
                <i />
                Rappel (oublis évités)
              </span>
              <span>
                <i className="dash" />
                Précision (fausses alertes évitées)
              </span>
            </figcaption>
            <p className="hint" style={{ marginTop: "var(--space-2)" }}>
              <Badge tone="warning">courbe illustrative, non mesurée</Badge>
            </p>
          </figure>
        </div>
      </section>

      <section className="card card-pad" aria-labelledby="t-matrice">
        <h3 className="section-title" id="t-matrice">
          Matrice de confusion — exemple fictif
        </h3>
        <p className="section-lead">
          Lecture : ligne = classe réelle, colonne = classe prédite ; plus la case est foncée, plus la part est grande. Chaque ligne est exprimée en pourcentage, valeurs fictives.
        </p>
        <p className="axis">Classe prédite →</p>
        <div className="matrix-wrap">
          <table className="matrix">
            <caption className="sr-only">Matrice de confusion fictive, lignes : classe réelle, colonnes : classe prédite</caption>
            <thead>
              <tr>
                <td style={{ background: "none" }} />
                {MATRIX_NAMES.map((n) => (
                  <th key={n} scope="col">
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row, i) => (
                <tr key={MATRIX_NAMES[i]}>
                  <th scope="row" className="rowh">
                    {MATRIX_NAMES[i]}
                  </th>
                  {row.map((v, j) => (
                    <td
                      // eslint-disable-next-line react/no-array-index-key
                      key={j}
                      title="Valeur fictive"
                      style={{
                        background: `color-mix(in srgb, var(--color-primary) ${Math.round(Math.max(0.06, v / 100) * 100)}%, var(--color-surface))`,
                        color: v >= 45 ? "var(--color-surface)" : "var(--color-ink)",
                      }}
                    >
                      <span className="fict">{v} %</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="perf-grid">
        <section className="card card-pad" aria-labelledby="t-limites">
          <h3 className="section-title" id="t-limites">
            Limites connues
          </h3>
          <ul className="limits">
            <li>Entraîné sur un jeu public dont les appareils et les populations diffèrent peut-être de ceux des cabinets de Toliara.</li>
            <li>Performance non évaluée sur des images du contexte local.</li>
            <li>Ne détecte que 4 types d’anomalies : pas les parodontopathies, fractures, kystes, tumeurs, restaurations…</li>
            <li>Sensible à la qualité de l’image (flou, mauvais positionnement, artefacts métalliques).</li>
            <li>Les dents incluses partiellement visibles peuvent être mal numérotées.</li>
            <li>Non certifié dispositif médical.</li>
            <li>Ne remplace pas un examen clinique ni d’autres examens d’imagerie.</li>
          </ul>
        </section>
        <section className="card card-pad" aria-labelledby="t-methode">
          <h3 className="section-title" id="t-methode">
            Comment ces mesures sont obtenues
          </h3>
          <ol className="steps" style={{ gridTemplateColumns: "1fr" }}>
            <li>
              <strong>Un jeu de test séparé</strong>Des images jamais vues par le modèle pendant l’entraînement.
            </li>
            <li>
              <strong>Comparaison aux annotations de référence</strong>Chaque cadre proposé est comparé à celui des annotations de référence de DENTEX.
            </li>
            <li>
              <strong>Calcul par classe</strong>Les mesures sont calculées séparément pour chaque classe, puis toutes classes confondues.
            </li>
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
