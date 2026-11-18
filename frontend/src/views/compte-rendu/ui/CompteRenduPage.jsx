import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

import { ANOMALY_LABELS, DETECTION_TYPES, REVIEW_STATUS, SimulatedPanoImage, detectionType } from "@/entities/detection";
import { Permission, displayName, useCurrentUser } from "@/entities/session";
import { useGenerateReport } from "@/features/generate-report";
import { formatDate } from "@/shared/lib";
import { Alert, Button, Icon, Logo } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";
import { isDashed, useAnalysisViewModel } from "@/widgets/analysis-workspace";

/** Image annotée de la feuille : détections retenues, étiquettes lisibles à l'impression. */
function SheetImage({ vm, retained }) {
  const unit = vm.width / 1200;
  return (
    <svg viewBox={`0 0 ${vm.width} ${vm.height}`} role="img" aria-label="Radiographie panoramique avec les cadres des détections retenues">
      {vm.demo ? <SimulatedPanoImage /> : vm.imageUrl ? <image href={vm.imageUrl} width={vm.width} height={vm.height} /> : <rect width={vm.width} height={vm.height} fill="#111417" />}
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

/** Compte rendu : aperçu A4, en-tête du cabinet, options et export PDF. */
export function CompteRenduPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const { user, can } = useCurrentUser();
  const { vm, loading, error } = useAnalysisViewModel(id, router.isReady);
  const { generate, reportUrl, isPending, error: reportError } = useGenerateReport(id);
  const [head, setHead] = useState({ name: "Cabinet dentaire de démonstration", city: "Toliara", line: "" });
  const [opts, setOpts] = useState({ image: true, comments: true, rejected: false });
  const [live, setLive] = useState("");
  const canCustomize = can(Permission.DETECTION_REVIEW);
  const canGenerate = can(Permission.REPORT_GENERATE);

  // Démonstration : les non revues sont exclues. Réel : la relecture n'est pas
  // encore enregistrée côté serveur, le PDF reprend toutes les détections.
  const retained = vm ? [...(vm.demo ? vm.dets.filter((d) => d.status !== "pending") : vm.dets)].sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0) || String(a.id).localeCompare(String(b.id))) : [];
  const pendingN = vm?.demo ? vm.dets.filter((d) => d.status === "pending").length : 0;
  const today = formatDate(new Date());
  const reviewer = vm?.demo ? "Dr Rakoto" : displayName(user);
  const sheetState = loading || isPending ? "loading" : error || reportError ? "error" : "closed";

  const download = async () => {
    if (vm?.demo) {
      setLive("Démonstration : aucun PDF n’est généré pour l’analyse fictive. Ouvrez une analyse réelle depuis l’historique.");
      return;
    }
    setLive("");
    const url = await generate();
    if (url) {
      setLive(`Compte rendu généré : téléchargement de compte-rendu-${vm.number}.pdf.`);
      window.open(url, "_blank", "noopener");
    }
  };

  let status;
  if (loading || isPending) {
    status = (
      <Alert tone="info" icon="clock">
        {isPending ? "Génération du compte rendu en cours…" : "Chargement de l’analyse…"}
      </Alert>
    );
  } else if (error || reportError) {
    status = (
      <>
        <Alert tone="danger" icon="x" title="La génération a échoué.">
          {(error ?? reportError).message} Aucun fichier n’a été créé. Réessayez ; si le problème persiste, signalez-le à l’administrateur.
        </Alert>
        {reportError ? (
          <Button variant="secondary" onClick={download}>
            <Icon name="refresh" /> Réessayer
          </Button>
        ) : null}
      </>
    );
  } else if (vm?.demo) {
    status = (
      <Alert tone="success" icon="check">
        Analyse clôturée le {today} par {reviewer}.
      </Alert>
    );
  } else if (vm && !vm.closed) {
    status = (
      <Alert tone="warning" icon="alert">
        Aucun compte rendu n’a encore été généré pour cette analyse. Le PDF reprend toutes les détections du modèle : la relecture n’est pas encore enregistrée sur le serveur.
      </Alert>
    );
  } else if (vm) {
    status = (
      <Alert tone="success" icon="check">
        Un compte rendu a déjà été généré. Le télécharger le régénère avec les données actuelles.
      </Alert>
    );
  }

  const busy = loading || isPending || Boolean(error);
  const used = ANOMALY_LABELS;

  return (
    <AppShell
      page="historique"
      title={`Compte rendu · Analyse n° ${vm?.number ?? "…"}`}
      permission={Permission.ANALYSIS_READ}
      className="v-compte-rendu"
      headerContent={
        <div>
          <Link className="back-link" href={id ? `/analyse?id=${id}` : "/analyse"}>
            <span aria-hidden="true">←</span> Revenir à l’analyse
          </Link>
          <h1>Compte rendu · Analyse n° {vm?.number ?? "…"}</h1>
        </div>
      }
    >
      <div className="cr-grid">
        <section aria-label="Aperçu du compte rendu" className="sheet-zone">
          <div className="sheet-frame">
            <article className="sheet" data-state={sheetState} data-comments={opts.comments ? "on" : "off"} aria-label="Aperçu du compte rendu PDF, page 1 sur 1">
              {vm ? (
                <>
                  <header className="sh-head">
                    <div>
                      <Logo href="#" />
                      <p className="sh-cab">
                        {head.name.trim() || "Cabinet dentaire de démonstration"}
                        {head.city.trim() ? ` · ${head.city.trim()}` : ""}
                      </p>
                      <p className="muted" style={{ fontSize: "1.6cqw" }}>
                        {head.line}
                      </p>
                    </div>
                    <div className="sh-meta">
                      <p>
                        Analyse n° <b className="mono">{vm.number}</b>
                      </p>
                      <p>
                        ID anonyme <b className="mono">{vm.ref}</b>
                      </p>
                      <p>
                        Date : <b>{vm.date}</b>
                      </p>
                      <p>
                        Relu par <b>{reviewer}</b>
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
                        {[used[1], used[0], used[2], used[3]].map((k) => (
                          <span key={k}>
                            <i className={`det-swatch ${DETECTION_TYPES[k].cls}`} />
                            {DETECTION_TYPES[k].short}
                          </span>
                        ))}
                        <span>
                          <i className="ln" />
                          Trait plein : détection de l’IA validée
                        </span>
                        <span>
                          <i className="ln dash" />
                          Pointillé : ajoutée ou corrigée par le praticien
                        </span>
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

                  <section aria-label="Synthèse chiffrée">
                    <h3>Synthèse</h3>
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
                  </section>

                  <p className="sh-trace">
                    <b>Traçabilité.</b> Modèle {vm.modelVersion} · seuil de confiance 50 % · entraîné sur DENTEX (jeu public)
                  </p>
                  <p className="sh-legal">
                    Document d’aide à la décision généré par un prototype académique non certifié. Il ne constitue pas un diagnostic et ne remplace pas le jugement clinique du praticien, seul responsable de
                    l’interprétation.
                  </p>
                  <footer className="sh-foot">
                    <span>Page 1 / 1</span>
                    <span>Généré le {today}</span>
                  </footer>
                </>
              ) : null}
              <div className="sheet-skel" aria-hidden="true">
                <div className="skeleton" style={{ height: "5cqw", width: "60%" }} />
                <div className="skeleton" style={{ height: "3.5cqw", width: "90%" }} />
                <div className="skeleton" style={{ height: "42cqw" }} />
                <div className="skeleton" style={{ height: "2.5cqw", width: "70%" }} />
                <div className="skeleton" style={{ height: "20cqw" }} />
                <div className="skeleton" style={{ height: "3cqw", width: "50%" }} />
                <div className="skeleton" style={{ height: "9cqw", marginTop: "auto" }} />
              </div>
              <div className="sheet-err">
                <p>L’aperçu n’a pas pu être généré.</p>
              </div>
            </article>
          </div>
        </section>

        <aside className="actions" aria-label="Actions sur le compte rendu">
          <div className="card card-pad">
            <h2>Exporter</h2>
            <div aria-live="polite">{status}</div>
            <div className="btn-row">
              <Button onClick={download} disabled={busy || (!vm?.demo && !canGenerate)}>
                <Icon name="download" /> Télécharger le PDF
              </Button>
              <Button variant="secondary" onClick={() => window.print()} disabled={busy}>
                <Icon name="printer" /> Imprimer
              </Button>
            </div>
            <p className="live" role="status">
              {reportUrl && !live ? "" : live}
            </p>
          </div>

          {canCustomize ? (
            <div className="card card-pad">
              <h2>Personnaliser l’en-tête du cabinet</h2>
              <div className="field">
                <label className="label" htmlFor="f-name">
                  Nom du cabinet
                </label>
                <input className="input" id="f-name" type="text" autoComplete="off" value={head.name} onChange={(e) => setHead((h) => ({ ...h, name: e.target.value }))} />
              </div>
              <div className="field">
                <label className="label" htmlFor="f-city">
                  Ville
                </label>
                <input className="input" id="f-city" type="text" autoComplete="off" value={head.city} onChange={(e) => setHead((h) => ({ ...h, city: e.target.value }))} />
              </div>
              <div className="field">
                <label className="label" htmlFor="f-line">
                  Ligne libre
                </label>
                <input className="input" id="f-line" type="text" placeholder="Exemple : horaires ou adresse du cabinet" autoComplete="off" value={head.line} onChange={(e) => setHead((h) => ({ ...h, line: e.target.value }))} />
                <span className="hint">Facultatif. L’aperçu se met à jour en direct (le PDF serveur n’intègre pas encore l’en-tête).</span>
              </div>
            </div>
          ) : null}

          <div className="card card-pad">
            <h2>Contenu du compte rendu</h2>
            <div>
              <label className="opt">
                <input type="checkbox" checked={opts.image} onChange={(e) => setOpts((o) => ({ ...o, image: e.target.checked }))} />
                <span>Inclure l’image annotée</span>
              </label>
              <label className="opt">
                <input type="checkbox" checked={opts.comments} onChange={(e) => setOpts((o) => ({ ...o, comments: e.target.checked }))} />
                <span>Inclure les commentaires du praticien</span>
              </label>
              <label className="opt">
                <input type="checkbox" checked={opts.rejected} onChange={(e) => setOpts((o) => ({ ...o, rejected: e.target.checked }))} />
                <span>
                  Inclure les détections rejetées<small>Aucune détection rejetée dans cette analyse.</small>
                </span>
              </label>
            </div>
            <Alert tone="info" icon="shield">
              Aucune donnée identifiante : le compte rendu ne contient que l’identifiant anonyme.
            </Alert>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
