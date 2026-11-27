import { useEffect, useRef, useState } from "react";

import { Processing, createAnalysis, fetchAnalysis, fetchReaders, isMockAnalysis, previewAnalysis, useAnalysisProgress } from "@/entities/analysis";
import { isAnomaly } from "@/entities/detection";
import { Permission } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { Alert, Button, Field, Icon } from "@/shared/ui";
import { ReaderChecklist } from "@/features/assign-readers";
import { AppShell } from "@/widgets/app-shell";

import { MaskEditor } from "./MaskEditor";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".dcm,.jpg,.jpeg,.png,image/jpeg,image/png,application/dicom";
/** Une panoramique est nettement plus large que haute. */
const MIN_PANO_RATIO = 1.6;
const NOTE_MAX = 500;

/**
 * États de l'écran :
 * attente → verification → (refuse | pret) → import → analyse → (terminee | echec-analyse)
 *                                                   ↘ echec (import refusé)
 *
 * `verification` : le serveur contrôle et anonymise le fichier et renvoie un
 * aperçu, SANS rien stocker. `pret` : le praticien vérifie l'aperçu, ajoute
 * des masques, puis confirme ; c'est seulement là que l'image anonymisée est
 * stockée. Abandonner avant ne laisse aucune trace.
 */
const STEP_OF = { attente: 1, verification: 1, refuse: 1, pret: 2, import: 3, analyse: 3, echec: 3, "echec-analyse": 3, terminee: 4 };

const formatSize = (bytes) => `${(bytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
const today = () => new Date().toISOString().slice(0, 10);

function Progress({ label, value }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={value}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

/** Import d'une panoramique : contrôle, aperçu anonymisé, masques, confirmation, analyse. */
export function NouvelleAnalysePage() {
  const [state, setState] = useState("attente");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [masks, setMasks] = useState([]);
  const [meta, setMeta] = useState({ examDate: "", note: "" });
  // Lecteurs du cabinet (facultatif : confier l'analyse dès l'import) ; null si indisponible.
  const [readers, setReaders] = useState(null);
  const [assigned, setAssigned] = useState([]);
  const [over, setOver] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [relaunching, setRelaunching] = useState(false);
  const inputRef = useRef(null);

  // Suivi de la file : l'analyse est mise en file à la confirmation, le worker la traite.
  const { progress, relaunch } = useAnalysisProgress(result?.id, {
    initial: result ? { processing: result.processing, error: result.error, position: 0 } : null,
    enabled: state === "analyse",
  });

  useEffect(() => {
    let cancelled = false;
    fetchReaders()
      .then((list) => !cancelled && setReaders(list))
      .catch(() => !cancelled && setReaders(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state !== "analyse" || !progress || !result) return;
    if (progress.processing === Processing.DONE) {
      fetchAnalysis(result.id)
        .then((full) => {
          setResult(full);
          setState("terminee");
        })
        .catch((cause) => {
          setError({ title: "Analyse terminée, mais illisible", message: toAppError(cause).message });
          setState("echec-analyse");
        });
    } else if (progress.processing === Processing.FAILED) {
      setError({ title: "Échec de l’analyse", message: progress.error });
      setState("echec-analyse");
    }
  }, [state, progress, result]);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setMasks([]);
    setMeta({ examDate: "", note: "" });
    setAssigned([]);
    setResult(null);
    setError(null);
    setState("attente");
  };

  const pick = async (picked) => {
    if (!picked) return;
    reset();
    setFile(picked);
    if (picked.size > MAX_BYTES) {
      setError({ title: "Fichier refusé", message: `Le fichier dépasse 20 Mo (${formatSize(picked.size)}).` });
      return setState("refuse");
    }
    setUploadPct(0);
    setState("verification");
    try {
      setPreview(await previewAnalysis(picked, { onProgress: setUploadPct }));
      setState("pret");
    } catch (cause) {
      const e = toAppError(cause);
      setError({ title: "Fichier refusé", message: e.message });
      setState("refuse");
    }
  };

  const confirm = async () => {
    if (!file) return;
    setError(null);
    setUploadPct(0);
    setState("import");
    try {
      // Réponse immédiate : image stockée, analyse mise en file.
      const analysis = await createAnalysis(file, { masks, examDate: meta.examDate, note: meta.note, readers: assigned, onProgress: setUploadPct });
      setResult(analysis);
      setState("analyse");
    } catch (cause) {
      setError({ title: "Échec de l’import", message: toAppError(cause).message });
      setState("echec");
    }
  };

  const retry = async () => {
    setRelaunching(true);
    try {
      await relaunch();
      setError(null);
      setState("analyse");
    } catch (cause) {
      setError({ title: "Relance impossible", message: toAppError(cause).message });
    } finally {
      setRelaunching(false);
    }
  };

  const is = (...states) => states.includes(state);
  const step = STEP_OF[state];
  const queued = progress?.processing === Processing.QUEUED;
  const anomalies = result ? result.detections.filter((d) => isAnomaly(d.label)).length : 0;
  const teeth = result ? result.detections.length - anomalies : 0;
  const notPano = preview && preview.width / preview.height < MIN_PANO_RATIO;

  return (
    <AppShell page="nouvelle-analyse" title="Nouvelle analyse" permission={Permission.ANALYSIS_CREATE} className="v-nouvelle-analyse">
      <div className="page-head">
        <div>
          <h2>Nouvelle analyse</h2>
          <p>Déposez une radiographie panoramique. Elle est anonymisée avant tout traitement, et rien n’est conservé tant que vous n’avez pas confirmé.</p>
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

      <input ref={inputRef} type="file" id="file" className="sr-only" accept={ACCEPT} aria-label="Choisir la radiographie panoramique (DICOM, PNG ou JPEG)" onChange={(e) => (pick(e.target.files[0]), (e.target.value = ""))} />

      <div className="layout">
        <div className="stack" aria-live="polite">
          {state === "refuse" ? (
            <Alert tone="danger" icon="alert" role="alert" title={error?.title} data-erreur="fichier-refuse">
              {error?.message}
            </Alert>
          ) : null}

          {is("attente", "refuse") ? (
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
              <p className="formats">DICOM (.dcm), JPG, PNG · 20 Mo maximum · 800 × 400 px minimum</p>
              <p className="hint">Radiographies panoramiques uniquement. Le nom du fichier n’est pas conservé.</p>
            </section>
          ) : null}

          {is("verification", "import") ? (
            <section className="card card-pad stack" aria-label={state === "import" ? "Import en cours" : "Vérification en cours"}>
              <div className="file-line">
                <strong className="mono" style={{ fontWeight: 500 }}>
                  {formatSize(file?.size ?? 0)}
                </strong>
                <span className="mono">{uploadPct} %</span>
              </div>
              <Progress label={state === "import" ? "Téléversement" : "Vérification"} value={uploadPct} />
              <p className="hint">
                {state === "import"
                  ? "Anonymisation et enregistrement de l’image masquée. Ne fermez pas la page."
                  : "Contrôle du fichier et repérage des inscriptions. Rien n’est enregistré à cette étape."}
              </p>
            </section>
          ) : null}

          {is("pret", "echec") && preview ? (
            <section className="stack">
              {notPano ? (
                <Alert tone="warning" icon="alert" title="Image à vérifier">
                  Cette image ne ressemble pas à une radiographie panoramique (proportions inhabituelles). L’analyse n’est fiable que sur des panoramiques.
                </Alert>
              ) : null}
              <div className="card card-pad stack">
                <h3 style={{ fontSize: "var(--text-lg)" }}>Vérifiez l’anonymisation</h3>
                <MaskEditor preview={preview} masks={masks} onChange={setMasks} disabled={state !== "pret"} />
                <p className="hint" style={{ margin: 0 }}>
                  {preview.width.toLocaleString("fr-FR")} × {preview.height.toLocaleString("fr-FR")} px · métadonnées et en-têtes DICOM retirés · seule l’image
                  masquée sera enregistrée.
                </p>
              </div>

              <div className="card card-pad stack">
                <h3 style={{ fontSize: "var(--text-lg)" }}>Informations de l’analyse</h3>
                <div className="meta-grid">
                  <Field label="Date de l’examen" htmlFor="m-date" hint="Facultative.">
                    <input className="input" id="m-date" type="date" max={today()} value={meta.examDate} onChange={(e) => setMeta((m) => ({ ...m, examDate: e.target.value }))} />
                  </Field>
                  <Field label="Note" htmlFor="m-note" hint={`N’y inscrivez aucune donnée qui identifie le patient (nom, date de naissance…). ${meta.note.length} / ${NOTE_MAX}`}>
                    <textarea className="textarea" id="m-note" rows={2} maxLength={NOTE_MAX} value={meta.note} onChange={(e) => setMeta((m) => ({ ...m, note: e.target.value }))} />
                  </Field>
                </div>
                {readers ? (
                  <>
                    <ReaderChecklist readers={readers} selected={assigned} onChange={setAssigned} disabled={state !== "pret"} legend="Confier à un lecteur (facultatif)" />
                    <p className="hint" style={{ margin: 0 }}>
                      Un lecteur ne voit que les analyses qui lui sont confiées, en lecture seule, et il en est prévenu. Vous pourrez aussi la confier plus tard, depuis la page
                      de l’analyse.
                    </p>
                  </>
                ) : null}
                <p className="hint" style={{ margin: 0 }}>
                  Une référence anonyme (« PDX-AAAA-NNNN ») est attribuée à la confirmation : c’est elle, et non le nom du fichier, qui désignera l’analyse.
                </p>
              </div>

              {state === "pret" ? (
                <div className="actions">
                  <Button onClick={confirm}>
                    <Icon name="sparkle" />
                    Confirmer et lancer l’analyse
                  </Button>
                  <Button variant="secondary" onClick={reset}>
                    Abandonner
                  </Button>
                  <span className="hint">Abandonner ne laisse aucune trace : rien n’a encore été enregistré.</span>
                </div>
              ) : null}

              {state === "echec" ? (
                <div className="stack">
                  <Alert tone="danger" icon="alert" role="alert" title={error?.title}>
                    {error?.message} Votre fichier et vos masques sont toujours là : vous pouvez réessayer.
                  </Alert>
                  <div className="actions">
                    <Button onClick={confirm}>
                      <Icon name="refresh" />
                      Réessayer
                    </Button>
                    <Button variant="secondary" onClick={reset}>
                      Abandonner
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {state === "analyse" ? (
            <div className="card card-pad stack" aria-label="Analyse en cours" data-etat={queued ? "en-file" : "en-cours"}>
              <Alert tone="success" icon="check" title="Image anonymisée enregistrée">
                Référence anonyme : <span className="mono">{result?.ref}</span>
              </Alert>
              <div className="file-line" style={{ alignItems: "baseline" }} role="status" aria-live="polite">
                <strong>
                  {queued
                    ? progress?.position
                      ? `En file d’attente : ${progress.position} analyse${progress.position > 1 ? "s" : ""} avant la vôtre`
                      : "En file d’attente : la vôtre est la prochaine"
                    : "Analyse par le modèle en cours…"}
                </strong>
              </div>
              <div className="progress indeterminate" role="progressbar" aria-label="Analyse en cours" aria-busy="true">
                <span />
              </div>
              <p className="hint" style={{ margin: 0 }}>
                Quelques secondes en général. Vous pouvez quitter cette page : l’analyse continue, et vous la retrouverez dans l’historique.
              </p>
            </div>
          ) : null}

          {state === "echec-analyse" ? (
            <div className="stack" data-etat="echec-analyse">
              <Alert tone="danger" icon="alert" role="alert" title={error?.title}>
                {error?.message} L’image anonymisée est conservée sous la référence <span className="mono">{result?.ref}</span> : relancez sans réimporter.
              </Alert>
              <div className="actions">
                <Button onClick={retry} disabled={relaunching}>
                  <Icon name="refresh" />
                  {relaunching ? "Relance…" : "Relancer l’analyse"}
                </Button>
                <Button variant="secondary" href="/historique">
                  Voir l’historique
                </Button>
              </div>
            </div>
          ) : null}

          {state === "terminee" ? (
            <div className="stack">
              <Alert tone="success" icon="check" role="status" title="Anonymisation appliquée" data-etat="import-termine">
                <ul className="ok-list">
                  <li>
                    <Icon name="check" />
                    Métadonnées et en-têtes DICOM retirés
                  </li>
                  <li>
                    <Icon name="check" />
                    {result.maskedZones.auto} inscription{result.maskedZones.auto > 1 ? "s" : ""} masquée{result.maskedZones.auto > 1 ? "s" : ""}
                    {result.maskedZones.manuelles ? `, ${result.maskedZones.manuelles} masque${result.maskedZones.manuelles > 1 ? "s" : ""} ajouté${result.maskedZones.manuelles > 1 ? "s" : ""} à la main` : ""}
                  </li>
                  <li>
                    <Icon name="check" />
                    Référence anonyme : <span className="mono">{result.ref}</span>
                  </li>
                </ul>
              </Alert>
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
                <Button variant="secondary" onClick={reset}>
                  Importer une autre radiographie
                </Button>
              </div>
              <p className="hint">
                Modèle utilisé : <span className="mono">{result.modelVersion}</span>
                {result.durationMs != null ? ` · traitée en ${(result.durationMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s` : ""}
              </p>
            </div>
          ) : null}
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
            <li>Contrôle du fichier : format réel (et non l’extension), 20 Mo au plus.</li>
            <li>Seuls les pixels sont gardés : en-têtes DICOM (nom, date de naissance, identifiant) et métadonnées (EXIF) disparaissent.</li>
            <li>Les inscriptions incrustées dans l’image sont repérées et masquées en noir ; vous pouvez en ajouter.</li>
            <li>À la confirmation seulement : enregistrement de l’image masquée sous une référence anonyme. L’original n’est jamais conservé.</li>
          </ol>
          <p className="hint" style={{ marginTop: "var(--space-4)" }}>
            L’image reste sur le serveur du cabinet : elle n’est jamais envoyée à un service externe.
          </p>
        </aside>
      </div>
    </AppShell>
  );
}
