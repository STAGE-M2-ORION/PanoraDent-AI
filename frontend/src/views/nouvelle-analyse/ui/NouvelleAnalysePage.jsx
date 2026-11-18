import { useEffect, useRef, useState } from "react";

import { createAnalysis, fetchAnalysisImageUrl, isMockAnalysis } from "@/entities/analysis";
import { isAnomaly } from "@/entities/detection";
import { Permission } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { Alert, Badge, Button, Icon } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".dcm,.jpg,.jpeg,.png,image/jpeg,image/png,application/dicom";
/** Une panoramique est nettement plus large que haute. */
const MIN_PANO_RATIO = 1.6;
const ANALYSIS_STEPS = ["Prétraitement", "Numérotation des dents", "Détection des anomalies", "Préparation de la relecture"];

/**
 * États de l'écran (repris de la maquette) :
 * attente → (invalide | invalide-taille | non-pano) → pret → import → analyse → terminee | echec
 */
const STEP_OF = { attente: 1, invalide: 1, "invalide-taille": 1, "non-pano": 1, pret: 2, import: 3, analyse: 3, echec: 3, terminee: 4 };

function fileKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".dcm") || file.type === "application/dicom") return "dicom";
  if (/\.(jpe?g|png)$/.test(name) || ["image/jpeg", "image/png"].includes(file.type)) return "image";
  return null;
}

const formatSize = (bytes) => `${(bytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

/** Dimensions d'une image locale (JPG/PNG) : `{ width, height }`. */
function readDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function Progress({ label, value }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={value}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

/** Import d'une panoramique, anonymisation et analyse par le modèle. */
export function NouvelleAnalysePage() {
  const [state, setState] = useState("attente");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { url, width, height }
  const [over, setOver] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [analysisPct, setAnalysisPct] = useState(0);
  const [result, setResult] = useState(null);
  const [resultImage, setResultImage] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  // Libère l'URL locale de l'aperçu.
  useEffect(() => () => preview?.url && URL.revokeObjectURL(preview.url), [preview]);
  useEffect(() => () => clearInterval(timerRef.current), []);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setResultImage(null);
    setError(null);
    setState("attente");
  };

  const pick = async (picked) => {
    if (!picked) return;
    setError(null);
    const kind = fileKind(picked);
    if (!kind) return setState("invalide");
    if (picked.size > MAX_BYTES) return setState("invalide-taille");
    setFile(picked);
    if (kind === "image") {
      const url = URL.createObjectURL(picked);
      const dims = await readDimensions(url);
      setPreview({ url, ...(dims ?? {}) });
      if (dims && dims.width / dims.height < MIN_PANO_RATIO) return setState("non-pano");
    } else {
      setPreview(null);
    }
    setState("pret");
  };

  const launch = async () => {
    if (!file) return;
    setError(null);
    setUploadPct(0);
    setAnalysisPct(0);
    setState("import");
    try {
      const analysis = await createAnalysis(file, {
        onProgress: (pct) => {
          setUploadPct(pct);
          if (pct >= 100) {
            // Le serveur anonymise puis interroge le modèle : progression estimée.
            setState("analyse");
            clearInterval(timerRef.current);
            timerRef.current = setInterval(() => setAnalysisPct((p) => Math.min(92, p + 2)), 400);
          }
        },
      });
      clearInterval(timerRef.current);
      setAnalysisPct(100);
      setResult(analysis);
      setState("terminee");
      fetchAnalysisImageUrl(analysis.id)
        .then(setResultImage)
        .catch(() => {});
    } catch (cause) {
      clearInterval(timerRef.current);
      setError(toAppError(cause));
      setState("echec");
    }
  };

  const is = (...states) => states.includes(state);
  const step = STEP_OF[state];
  const currentAnalysisStep = Math.min(3, Math.floor(analysisPct / 25));
  const anomalies = result ? result.detections.filter((d) => isAnomaly(d.label)).length : 0;
  const teeth = result ? result.detections.length - anomalies : 0;
  const shownImage = resultImage ?? preview?.url;
  const dims = result ? { width: result.width, height: result.height } : preview;

  return (
    <AppShell page="nouvelle-analyse" title="Nouvelle analyse" permission={Permission.ANALYSIS_CREATE} className="v-nouvelle-analyse">
      <div className="page-head">
        <div>
          <h2>Nouvelle analyse</h2>
          <p>Déposez une radiographie panoramique. Elle est anonymisée dès l’import, avant tout traitement.</p>
        </div>
      </div>

      <nav aria-label="Étapes de l’analyse">
        <ol className="steps">
          {["Importer", "Vérifier l’aperçu", "Analyser", "Relire"].map((label, i) => {
            const k = i + 1;
            return (
              <li key={label} data-done={k < step || (state === "terminee" && k <= 3) ? "true" : "false"} aria-current={k === step ? "step" : undefined}>
                <span className="n">{k}</span>
                {label}
              </li>
            );
          })}
        </ol>
      </nav>

      <input ref={inputRef} type="file" id="file" className="sr-only" accept={ACCEPT} onChange={(e) => (pick(e.target.files[0]), (e.target.value = ""))} />

      <div className="layout">
        <div className="stack" aria-live="polite">
          {state === "invalide" ? (
            <Alert tone="danger" icon="alert" role="alert" title="Fichier refusé">
              Ce format n’est pas pris en charge. Formats acceptés : DICOM, JPG, PNG.
            </Alert>
          ) : null}
          {state === "invalide-taille" ? (
            <Alert tone="danger" icon="alert" role="alert" title="Fichier refusé">
              Le fichier dépasse 20 Mo.
            </Alert>
          ) : null}

          {is("attente", "invalide", "invalide-taille") ? (
            <section
              className={over ? "dropzone is-over" : "dropzone"}
              aria-label="Zone de dépôt de la radiographie"
              onDragEnter={(e) => (e.preventDefault(), setOver(true))}
              onDragOver={(e) => (e.preventDefault(), setOver(true))}
              onDragLeave={(e) => (e.preventDefault(), setOver(false))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                pick(e.dataTransfer?.files?.[0]);
              }}
            >
              <span className="dz-icon">
                <Icon name="upload" />
              </span>
              <h3>Glissez votre radiographie ici</h3>
              <p className="muted">ou</p>
              <Button onClick={() => inputRef.current?.click()}>Parcourir les fichiers</Button>
              <p className="formats">DICOM (.dcm), JPG, PNG · 20 Mo maximum</p>
              <p className="hint">Radiographies panoramiques uniquement.</p>
            </section>
          ) : null}

          {state === "non-pano" ? (
            <section className="stack">
              <Alert tone="warning" icon="alert" role="alert" title="Image à vérifier">
                Cette image ne ressemble pas à une radiographie panoramique (format ou proportions inhabituels). L’analyse n’est fiable que sur des panoramiques.
              </Alert>
              <div className="card card-pad stack">
                <p className="mono" style={{ fontSize: "var(--text-sm)" }}>
                  {file?.name} · {file ? formatSize(file.size) : ""}
                </p>
                <div className="actions">
                  <Button variant="secondary" onClick={() => inputRef.current?.click()}>
                    Choisir une autre image
                  </Button>
                  <button className="btn btn-ghost" type="button" onClick={() => setState("pret")}>
                    Continuer quand même
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {state === "import" ? (
            <section className="card card-pad stack" aria-label="Import en cours">
              <div className="file-line">
                <strong className="mono" style={{ fontWeight: 500 }}>
                  {file?.name} · {file ? formatSize(file.size) : ""}
                </strong>
                <span className="mono">{uploadPct} %</span>
              </div>
              <Progress label="Téléversement" value={uploadPct} />
              <p className="hint">Import et anonymisation en cours. Ne fermez pas la page.</p>
            </section>
          ) : null}

          {is("pret", "analyse", "terminee", "echec") ? (
            <section className="stack">
              {state === "terminee" ? (
                <Alert tone="success" icon="check" role="status" title="Anonymisation appliquée">
                  <ul className="ok-list">
                    <li>
                      <Icon name="check" />
                      Balises DICOM identifiantes supprimées
                    </li>
                    <li>
                      <Icon name="check" />
                      Métadonnées du fichier effacées
                    </li>
                    <li>
                      <Icon name="check" />
                      Identifiant anonyme attribué : <span className="mono">{result.ref}</span>
                    </li>
                  </ul>
                </Alert>
              ) : null}

              <div className="card card-pad stack">
                <h3 style={{ fontSize: "var(--text-lg)" }}>{state === "terminee" ? "Aperçu de l’image anonymisée" : "Aperçu de l’image"}</h3>
                <div className="preview-grid">
                  <div className="viewer">
                    {shownImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="pano" src={shownImage} alt={state === "terminee" ? "Radiographie panoramique anonymisée" : "Aperçu de la radiographie importée"} style={{ width: "100%", height: "auto", display: "block" }} />
                    ) : (
                      <div style={{ aspectRatio: "2 / 1", display: "grid", placeItems: "center", color: "var(--color-viewer-muted)", fontSize: "var(--text-sm)", padding: "var(--space-6)", textAlign: "center" }}>
                        Fichier DICOM : l’aperçu s’affiche une fois l’image anonymisée par le serveur.
                      </div>
                    )}
                  </div>
                  <dl className="info-list">
                    <div>
                      <dt>ID anonyme</dt>
                      <dd className="mono">{result ? result.ref : "attribué à l’import"}</dd>
                    </div>
                    <div>
                      <dt>Dimensions</dt>
                      <dd className="mono">{dims?.width ? `${dims.width.toLocaleString("fr-FR")} × ${dims.height.toLocaleString("fr-FR")} px` : "—"}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>
                        <Badge tone="success">Panoramique</Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>Fichier</dt>
                      <dd className="mono" style={{ overflowWrap: "anywhere" }}>
                        {file?.name}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {state === "pret" ? (
                <div className="actions">
                  <Button onClick={launch}>
                    <Icon name="sparkle" />
                    Lancer l’analyse
                  </Button>
                  <Button variant="secondary" onClick={reset}>
                    Remplacer l’image
                  </Button>
                </div>
              ) : null}

              {state === "analyse" ? (
                <div className="card card-pad stack" aria-label="Analyse en cours">
                  <div className="file-line" style={{ alignItems: "baseline" }}>
                    <strong>Analyse en cours</strong>
                    <span className="big-pct">{analysisPct} %</span>
                  </div>
                  <Progress label="Progression de l’analyse" value={analysisPct} />
                  <ol className="astep-list">
                    {ANALYSIS_STEPS.map((label, i) => {
                      const s = analysisPct >= 100 || i < currentAnalysisStep ? "done" : i === currentAnalysisStep ? "now" : "";
                      return (
                        <li key={label} data-s={s} aria-current={s === "now" ? "step" : undefined}>
                          <span className="dot" />
                          {label}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="actions">
                    <span className="hint">Environ 20 secondes. Ne fermez pas la page.</span>
                  </div>
                </div>
              ) : null}

              {state === "terminee" ? (
                <div className="stack">
                  <Alert tone="success" icon="check" role="status" title="Analyse terminée">
                    {teeth} dent{teeth > 1 ? "s" : ""} numérotée{teeth > 1 ? "s" : ""}, {anomalies} anomalie{anomalies > 1 ? "s" : ""} proposée{anomalies > 1 ? "s" : ""}.
                  </Alert>
                  {isMockAnalysis(result) ? (
                    <Alert tone="warning" icon="info" title="Mode démonstration">
                      Le service d’inférence tourne sans modèle entraîné : ces détections sont factices et n’ont aucune valeur diagnostique.
                    </Alert>
                  ) : null}
                  <div className="actions">
                    <Button href={`/analyse?id=${result.id}`}>
                      Ouvrir la relecture
                      <Icon name="chevron" />
                    </Button>
                  </div>
                </div>
              ) : null}

              {state === "echec" ? (
                <div className="stack">
                  <Alert tone="danger" icon="alert" role="alert" title="Échec de l’analyse">
                    L’analyse n’a pas pu aboutir : {error?.message} Votre fichier est toujours sélectionné, vous pouvez relancer.
                  </Alert>
                  <div className="actions">
                    <Button onClick={launch}>
                      <Icon name="refresh" />
                      Relancer l’analyse
                    </Button>
                    <Button variant="secondary" onClick={reset}>
                      Remplacer l’image
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {result ? <p className="hint">Modèle utilisé : {result.modelVersion}</p> : null}
        </div>

        <aside className="card card-pad side" aria-labelledby="side-h">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="illus"
            src="/medias/anonymisation.webp"
            width="1232"
            height="896"
            alt="Illustration : document dont le nom est masqué, cadenas et coins de cadre"
            loading="lazy"
            style={{ maxWidth: 220, margin: "0 auto var(--space-4)" }}
          />
          <h3 id="side-h">Ce qui se passe à l’import</h3>
          <ol>
            <li>Suppression des balises DICOM identifiantes (nom, date de naissance, identifiant patient, établissement).</li>
            <li>Effacement des métadonnées du fichier (EXIF).</li>
            <li>Masquage du texte incrusté dans l’image.</li>
            <li>Attribution d’un identifiant anonyme.</li>
          </ol>
          <p className="hint" style={{ marginTop: "var(--space-4)" }}>
            L’image reste sur le serveur du cabinet : elle n’est jamais envoyée à un service externe.
          </p>
        </aside>
      </div>
    </AppShell>
  );
}
