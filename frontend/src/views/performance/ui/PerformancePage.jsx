import { useEffect, useMemo, useState } from "react";

import {
  activeVersion, compareVersions, fetchModelVersions, formatDelta, formatScore, formatShare, performanceOf, shortHash,
  thresholdSentence,
} from "@/entities/model-version";
import { Permission } from "@/entities/session";
import { formatDate, useAsyncResource } from "@/shared/lib";
import { Alert, Badge, DataDetails, KpiRing, Select, VizEmpty } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

import { ConfusionMatrix } from "./ConfusionMatrix";
import { ThresholdCurve } from "./ThresholdCurve";

function kpi(label, sub, icon, value, { share = true } = {}) {
  if (value === null || value === undefined) {
    return { icon, label: `${label} · ${sub}`, value: "non publiée", ring: null, ringText: `${label} : mesure non publiée`, dir: "flat" };
  }
  if (!share) return { icon, label: `${label} · ${sub}`, value, ring: 100, ringText: `${value} ${label.toLowerCase()}`, dir: "flat" };
  return { icon, label: `${label} · ${sub}`, value: formatScore(value), ring: Math.round(value * 100), ringText: `${label} : ${formatShare(value)}`, dir: "flat" };
}

/**
 * Performance du modèle (sprint 10) : les mesures publiées au registre avec
 * chaque version, lues telles quelles — jamais recalculées ici. Par défaut la
 * version en service ; les versions passées se consultent et se comparent,
 * à jeu de test identique seulement.
 */
export function PerformancePage() {
  const { data: versions, error } = useAsyncResource(fetchModelVersions);
  const active = activeVersion(versions);
  const [shownId, setShownId] = useState(null);
  const [pair, setPair] = useState({ a: null, b: null });

  useEffect(() => {
    if (!versions?.length) return;
    setShownId((id) => id ?? (active ?? versions[0]).version);
    setPair((p) => (p.a ? p : { a: versions[1]?.version ?? versions[0].version, b: (active ?? versions[0]).version }));
  }, [versions, active]);

  const shown = versions?.find((v) => v.version === shownId) ?? null;
  const perf = useMemo(() => performanceOf(shown), [shown]);
  const comparison = useMemo(() => {
    const a = versions?.find((v) => v.version === pair.a);
    const b = versions?.find((v) => v.version === pair.b);
    return a && b && a !== b ? compareVersions(a, b) : null;
  }, [versions, pair]);
  const g = perf.global;

  return (
    <AppShell page="performance" title="Performance du modèle" permission={Permission.MODEL_READ} className="v-performance">
      <Alert tone="warning" role="note" title="Prototype de recherche non certifié">
        Ces mesures décrivent le modèle sur des radiographies publiques (DENTEX). Elles ne garantissent pas sa performance sur vos
        clichés : le diagnostic et la conduite à tenir relèvent du praticien.
      </Alert>

      <div className="page-head">
        <div>
          <h2>Performance du modèle</h2>
          <p>Ce que le modèle sait faire, mesuré honnêtement, et ce qu’il ne sait pas faire.</p>
        </div>
        {versions?.length ? (
          <div className="perf-version">
            <label className="label" htmlFor="perf-version">
              Version affichée
            </label>
            <Select id="perf-version" value={shownId ?? ""} onChange={(e) => setShownId(e.target.value)}>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                  {v.active ? " (en service)" : ""}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert tone="danger" role="alert">
          {error.message}
        </Alert>
      ) : null}

      <section className="kpi-row" aria-label="Mesures globales du modèle">
        <KpiRing {...kpi("mAP@50", "Toutes classes", "chart", g?.map50)} />
        <KpiRing {...kpi("Rappel", "Part des anomalies trouvées", "search", g?.recall)} />
        <KpiRing {...kpi("Précision", "Part des détections justes", "detect", g?.precision)} />
        <KpiRing {...kpi("Images de test", "Jamais vues à l’entraînement", "pano", g?.testImages, { share: false })} />
      </section>

      <div className="perf-grid">
        <section className="card card-pad" aria-labelledby="t-modele">
          <div className="card-head">
            <h3 className="section-title" id="t-modele">
              Version {shown?.version ?? ""}
            </h3>
            {shown ? (
              shown.active ? (
                <Badge tone="success" dot>
                  En service
                </Badge>
              ) : (
                <Badge>Archivée</Badge>
              )
            ) : (
              <Badge>Aucune version publiée</Badge>
            )}
          </div>
          <dl className="meta">
            <div>
              <dt>Architecture</dt>
              <dd>YOLO (détection d’objets)</dd>
            </div>
            <div>
              <dt>Publiée le</dt>
              <dd>{shown ? formatDate(shown.createdAt) : "—"}</dd>
            </div>
            <div>
              <dt>Jeu de données</dt>
              <dd>{shown?.dataset || "DENTEX — radiographies panoramiques publiques"}</dd>
            </div>
            <div>
              <dt>Jeu de test (empreinte)</dt>
              <dd className="mono" title={shown?.splitHash ?? ""}>
                {shortHash(shown?.splitHash)}
              </dd>
            </div>
            <div>
              <dt>mAP@50:95</dt>
              <dd>{formatScore(g?.map5095)}</dd>
            </div>
            <div>
              <dt>Jeu externe (mAP@50)</dt>
              <dd>{perf.external ? formatScore(perf.external.map50) : "non évalué"}</dd>
            </div>
            {shown?.notes ? (
              <div style={{ gridColumn: "1 / -1" }}>
                <dt>Notes</dt>
                <dd>{shown.notes}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="card card-pad" aria-labelledby="t-lexique">
          <h3 className="section-title" id="t-lexique">
            Petit lexique
          </h3>
          <dl className="lexicon" style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <dt>mAP@50 (précision moyenne)</dt>
              <dd>À quel point les cadres proposés tombent juste, toutes confiances confondues (recouvrement d’au moins 50 %).</dd>
            </div>
            <div>
              <dt>Rappel (sensibilité)</dt>
              <dd>Part des anomalies réelles que le modèle retrouve : ce qu’il « ne laisse pas passer ».</dd>
            </div>
            <div>
              <dt>Précision</dt>
              <dd>Part des propositions du modèle qui sont justes : ce qui n’est pas une fausse alerte.</dd>
            </div>
            <div>
              <dt>Seuil de confiance</dt>
              <dd>Confiance minimale pour qu’une détection soit proposée. Plus bas : moins d’oublis, plus de fausses alertes.</dd>
            </div>
          </dl>
        </section>
      </div>

      <section aria-labelledby="t-classes">
        <h3 className="section-title" id="t-classes">
          Mesures par classe
        </h3>
        <p className="section-lead">
          Mesurées une seule fois sur le jeu de test, au moment de la publication. Par cliché : le modèle signale-t-il la classe sur un cliché qui
          la porte (sensibilité), et s’en abstient-il sur un cliché qui ne la porte pas (spécificité) ?
        </p>
        {perf.perClass.length ? (
          <div className="table-wrap">
            <table className="table stack">
              <caption className="sr-only">Mesures par classe sur le jeu de test</caption>
              <thead>
                <tr>
                  <th scope="col">Classe</th>
                  <th scope="col" className="num">mAP@50</th>
                  <th scope="col" className="num">Rappel</th>
                  <th scope="col" className="num">Précision</th>
                  <th scope="col" className="num">Sensibilité par cliché</th>
                  <th scope="col" className="num">Spécificité par cliché</th>
                  <th scope="col" className="num">Anomalies du test</th>
                </tr>
              </thead>
              <tbody>
                {perf.perClass.map((r) => (
                  <tr key={r.cls}>
                    <th scope="row">{r.label}</th>
                    <td data-label="mAP@50" className="num mono">{formatScore(r.map50)}</td>
                    <td data-label="Rappel" className="num mono">{formatShare(r.recall)}</td>
                    <td data-label="Précision" className="num mono">{formatShare(r.precision)}</td>
                    <td data-label="Sensibilité par cliché" className="num mono">{formatShare(r.sensitivity)}</td>
                    <td data-label="Spécificité par cliché" className="num mono">{formatShare(r.specificity)}</td>
                    <td data-label="Anomalies du test" className="num mono">{r.instances ?? "—"}</td>
                  </tr>
                ))}
                {g ? (
                  <tr className="total">
                    <th scope="row">Toutes classes</th>
                    <td data-label="mAP@50" className="num mono">{formatScore(g.map50)}</td>
                    <td data-label="Rappel" className="num mono">{formatShare(g.recall)}</td>
                    <td data-label="Précision" className="num mono">{formatShare(g.precision)}</td>
                    <td className="num mono">—</td>
                    <td className="num mono">—</td>
                    <td data-label="Images de test" className="num mono">{g.testImages ?? "—"} images</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <VizEmpty title="Mesures par classe non publiées">Cette version a été publiée sans le détail par classe. Aucun chiffre n’est inventé.</VizEmpty>
        )}
      </section>

      <section className="card card-pad" aria-labelledby="t-seuil">
        <h3 className="section-title" id="t-seuil">
          Effet du seuil de confiance
        </h3>
        <p className="section-lead">
          Abaisser le seuil fait proposer davantage : moins d’anomalies manquées, mais plus de fausses alertes. Chaque classe a son seuil, choisi
          sur la <strong>validation</strong> (jamais sur le test) ; les courbes ci-dessous sont celles de la validation, à quelques seuils.
        </p>
        {perf.thresholds?.length ? (
          <>
            <ul className="seuil-phrases">
              {perf.thresholds.map((t) => (
                <li key={t.cls}>
                  <strong>{t.label}.</strong> {thresholdSentence(t)}
                </li>
              ))}
            </ul>
            <div className="pr-grid">
              {perf.thresholds.filter((t) => t.curve.length).map((t) => (
                <ThresholdCurve key={t.cls} item={t} />
              ))}
            </div>
            <DataDetails
              caption="Courbes de seuil de la validation, par classe"
              head={["Classe et seuil", "Rappel", "Précision"]}
              rows={perf.thresholds.flatMap((t) => t.curve.map((p) => [`${t.label} — seuil ${formatScore(p.threshold)}`, formatShare(p.recall), formatShare(p.precision)]))}
            />
          </>
        ) : (
          <VizEmpty title="Seuils non publiés avec cette version">
            Cette version a été publiée avant le choix des seuils par classe : ni seuils, ni courbes de validation au registre. Ils le seront avec la
            prochaine publication. Aucune courbe n’est inventée.
          </VizEmpty>
        )}
      </section>

      <section className="card card-pad" aria-labelledby="t-matrice">
        <h3 className="section-title" id="t-matrice">
          Matrice de confusion
        </h3>
        <p className="section-lead">
          Sur le jeu de test. Ligne : ce que le modèle a proposé ; colonne : ce qui était vraiment là. La diagonale compte les bonnes
          détections ; « fond » regroupe les anomalies manquées (colonne) et les propositions sans anomalie (ligne).
        </p>
        {perf.confusion ? (
          <ConfusionMatrix confusion={perf.confusion} />
        ) : (
          <VizEmpty title="Matrice non publiée">Cette version a été publiée sans matrice de confusion.</VizEmpty>
        )}
      </section>

      <section className="card card-pad" aria-labelledby="t-comparer">
        <h3 className="section-title" id="t-comparer">
          Comparer deux versions
        </h3>
        <p className="section-lead">Un écart de mAP ne veut dire quelque chose que si les deux versions ont été mesurées sur le même jeu de test.</p>
        {versions?.length >= 2 ? (
          <>
            <div className="perf-pair">
              <div>
                <label className="label" htmlFor="cmp-a">
                  Version A
                </label>
                <Select id="cmp-a" value={pair.a ?? ""} onChange={(e) => setPair((p) => ({ ...p, a: e.target.value }))}>
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="label" htmlFor="cmp-b">
                  Version B
                </label>
                <Select id="cmp-b" value={pair.b ?? ""} onChange={(e) => setPair((p) => ({ ...p, b: e.target.value }))}>
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {!comparison ? (
              <p className="hint">Choisissez deux versions différentes.</p>
            ) : (
              <>
                {comparison.comparable ? null : (
                  <Alert tone="warning" role="note" title="Jeux de test différents : pas de conclusion">
                    Les deux versions n’ont pas été mesurées sur le même jeu de test (empreintes {shortHash(comparison.a.splitHash)} et{" "}
                    {shortHash(comparison.b.splitHash)}). Leurs mesures sont montrées côte à côte, sans écart : les comparer ne voudrait rien dire.
                  </Alert>
                )}
                <div className="table-wrap">
                  <table className="table stack" data-testid="comparaison">
                    <caption className="sr-only">Comparaison de deux versions du modèle</caption>
                    <thead>
                      <tr>
                        <th scope="col">Mesure</th>
                        <th scope="col" className="num">{comparison.a.version}</th>
                        <th scope="col" className="num">{comparison.b.version}</th>
                        {comparison.comparable ? <th scope="col" className="num">Écart (B − A)</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows.map((r) => (
                        <tr key={r.label}>
                          <th scope="row">{r.label}</th>
                          <td data-label={comparison.a.version} className="num mono">{formatScore(r.a)}</td>
                          <td data-label={comparison.b.version} className="num mono">{formatScore(r.b)}</td>
                          {comparison.comparable ? (
                            <td data-label="Écart (B − A)" className="num mono">{formatDelta(r.delta)}</td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        ) : (
          <VizEmpty title="Une seule version publiée">La comparaison sera possible dès la publication d’une seconde version.</VizEmpty>
        )}
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
              <strong>Un jeu de test séparé, évalué une seule fois</strong>Des images jamais vues pendant l’entraînement ; les réglages se font sur la
              validation, jamais sur le test.
            </li>
            <li>
              <strong>Comparaison aux annotations de référence</strong>Un cadre proposé compte comme juste si sa classe est la bonne et qu’il recouvre
              le cadre de référence à 50 % au moins.
            </li>
            <li>
              <strong>Publié avec la version</strong>Les mesures sont écrites au registre à la publication et lues ici telles quelles.
            </li>
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
