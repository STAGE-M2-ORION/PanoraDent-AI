import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Processing, declareToothAbsent, postVerdict, withdrawToothAbsent } from "@/entities/analysis";
import { Verdict, detectionType } from "@/entities/detection";
import { Permission, displayName, useCurrentUser } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { Alert, Badge, Button, Icon, Modal } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

import {
  buildAnnotations,
  downloadBlob,
  exportFileName,
  isVisible,
  keyBelongsToField,
  nearestTooth,
  pct,
  sortDetections,
  stepDetection,
  useAnalysisViewModel,
} from "@/widgets/analysis-workspace";
import { POSITIONS, odontogramFileName, toSvgString, toothStates } from "../model/odontogram";
import { makeReview, readResume, reviewSummary, verdictOfStatus, writeResume } from "../model/review-api";
import { AssistantPane } from "./AssistantPane";
import { ClosureModal } from "./ClosureModal";
import { ToothCard } from "./ToothCard";
import { ModelReplay } from "./ModelReplay";
import { DetectionsPane } from "./DetectionsPane";
import { Odontogram } from "./Odontogram";
import { ProcessingState } from "./ProcessingState";
import { Viewer } from "./Viewer";

const ALL_LAYERS = { tooth: true, caries: true, deep_caries: true, periapical_lesion: true, impacted_tooth: true };
const NO_LAYER = Object.fromEntries(Object.keys(ALL_LAYERS).map((k) => [k, false]));


/** Durée de traitement lisible (« 3,2 s »). */
const formatDuration = (ms) => `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;

/** Poste de lecture : visionneuse, détections, relecture, assistant. */
export function AnalysePage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const { user, can } = useCurrentUser();
  const canReview = can(Permission.DETECTION_REVIEW);
  const canReport = can(Permission.REPORT_GENERATE);
  const canReopen = can(Permission.ANALYSIS_REOPEN);
  const reviewerName = displayName(user) || "le praticien";
  const { vm, loading, error, reload } = useAnalysisViewModel(id, router.isReady);
  const viewerRef = useRef(null);

  const [dets, setDets] = useState([]);
  const [ui, setUi] = useState({
    sel: null,
    hover: null,
    threshold: 50,
    sort: "tooth",
    onlyPending: false,
    tooth: null,
    show: ALL_LAYERS,
    mode: null,
    draft: null,
    closed: false,
    busy: false,
    autoNext: true,
    hint: "",
    tab: "det",
    panelClosed: false,
  });
  const [modal, setModal] = useState(null); // "close" | "reopen"
  const [reopenWhy, setReopenWhy] = useState("");
  const [toast, setToast] = useState(null); // { text, undo }
  const [question, setQuestion] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [closure, setClosure] = useState({ closedAt: null, closedBy: null, conclusion: "" });
  // Sprint 7 : dent dont on choisit le nouveau numéro dans le schéma.
  const [choosing, setChoosing] = useState(null); // { toothId, fdi }
  const review = useMemo(() => makeReview(vm, reviewerName), [vm, reviewerName]);
  const pending = Boolean(vm && !vm.demo && vm.processing !== Processing.DONE);
  const backup = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    if (!vm) return;
    setDets(vm.dets);
    setClosure({ closedAt: vm.closedAt, closedBy: vm.closedBy, conclusion: vm.conclusion ?? "" });
    // Reprise d'une relecture interrompue : la détection où l'on s'était arrêté.
    const saved = readResume(vm.id);
    const firstPending = sortDetections(vm.dets.filter((d) => d.status === "pending"), "tooth")[0];
    const sel = vm.demo ? "d2" : vm.dets.some((d) => d.id === saved) ? saved : firstPending?.id ?? vm.dets[0]?.id ?? null;
    setUi((u) => ({ ...u, closed: vm.closed, sel }));
  }, [vm]);

  useEffect(() => writeResume(vm?.id, ui.sel), [vm?.id, ui.sel]);

  const patch = useCallback((p) => setUi((u) => ({ ...u, ...(typeof p === "function" ? p(u) : p) })), []);
  const showToast = useCallback((text, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const current = dets.find((d) => d.id === ui.sel);
  const visible = (d) => isVisible(d, ui);
  const updateDet = (detId, change) => setDets((list) => list.map((d) => (d.id === detId ? { ...d, ...change } : d)));

  const restoreBackup = () => {
    if (current && backup.current) updateDet(current.id, backup.current);
    backup.current = null;
  };

  const select = (detId, fromList) => {
    if (ui.mode === "correct") restoreBackup();
    patch({ sel: detId, tooth: null, mode: null, hint: "" });
    const d = dets.find((x) => x.id === detId);
    if (d && fromList) viewerRef.current?.centerOn(d.box);
  };

  const goNextPending = (list) => {
    if (!ui.autoNext) return;
    const order = sortDetections(list.filter((x) => x.status === "pending" && (x.confidence == null || x.confidence >= ui.threshold)), ui.sort);
    if (order.length) patch({ sel: order[0].id });
  };

  const actions = {
    select: (detId) => select(detId, true),
    hover: (detId) => patch({ hover: detId }),
    setThreshold: (threshold) => patch({ threshold }),
    setSort: (sort) => patch({ sort }),
    setOnlyPending: (onlyPending) => patch({ onlyPending }),
    setTooth: (tooth) => patch({ tooth }),
    setAutoNext: (autoNext) => patch({ autoNext }),
    validate: (comment) => decide(current, Verdict.VALIDATE, { comment }),
    reject: (comment) => decide(current, Verdict.REJECT, { comment }),
    saveNote: (comment) => decide(current, verdictOfStatus(current.status), { comment }, { quiet: true }),
    undo: () => undoLast(current),
    startCorrect: () => {
      backup.current = { box: { ...current.box }, label: current.label, fdi: current.fdi };
      patch({ mode: "correct", hint: "Correction : déplacez ou redimensionnez le cadre" });
    },
    cancelCorrect: () => {
      restoreBackup();
      patch({ mode: null, hint: "" });
    },
    saveCorrect: async ({ label, fdi }, comment) => {
      const original = backup.current;
      const ok = await decide(current, Verdict.CORRECT, { comment, label, fdi, box: current.box, originalBox: original?.box });
      if (ok) {
        backup.current = null;
        patch({ mode: null, hint: "" });
      }
    },
    askAbout: (d) => {
      patch({ tab: "chat" });
      setQuestion(`Pourquoi la dent ${d.fdi} est-elle signalée ?`);
    },
    startDraw: () => {
      if (ui.closed) return;
      patch({ mode: "draw", sel: null, draft: null, hint: "Tracez un cadre sur l'image (glisser), puis choisissez le type" });
    },
    cancelDraw: () => patch({ mode: null, draft: null }),
    saveNew: ({ label, fdi, note }) =>
      run(async () => {
        const d = await review.add({ label, fdi, box: ui.draft, note });
        setDets((list) => [...list, d]);
        patch({ mode: null, draft: null, sel: d.id });
        showToast(`Détection ajoutée sur la dent ${fdi}.`, () => undoLast(d));
      }),
  };

  /** Exécute un geste de relecture ; une erreur du serveur s'affiche sans rien perdre. */
  async function run(fn) {
    if (ui.busy) return false;
    patch({ busy: true });
    try {
      await fn();
      return true;
    } catch (cause) {
      showToast(toAppError(cause).message);
      return false;
    } finally {
      patch({ busy: false });
    }
  }

  const replaceDet = (d) => setDets((list) => list.map((x) => (x.id === d.id ? d : x)));

  /** Verdict sur une détection, puis (au choix) passage à la suivante à revoir. */
  function decide(d, verdict, opts, { quiet = false } = {}) {
    if (!d) return Promise.resolve(false);
    return run(async () => {
      const next = await review.verdict(d, verdict, opts);
      const list = dets.map((x) => (x.id === next.id ? next : x));
      setDets(list);
      const what = `dent ${next.fdi ?? "?"}, ${detectionType(next.label).label.toLowerCase()}`;
      const text = quiet ? "Commentaire enregistré." : { valider: `Détection validée : ${what}.`, corriger: `Correction enregistrée : ${what}.`, rejeter: `Détection rejetée : ${what}.` }[verdict];
      showToast(text, quiet ? undefined : () => undoLast(next));
      if (!quiet) goNextPending(list);
    });
  }

  /** Annule le dernier verdict d'une détection (un ajout annulé est retiré). */
  function undoLast(d) {
    return run(async () => {
      const next = await review.undo(d);
      if (next) {
        replaceDet(next);
        patch({ sel: next.id });
        showToast("Verdict annulé.");
      } else {
        setDets((list) => list.filter((x) => x.id !== d.id));
        patch({ sel: null });
        showToast("Détection ajoutée retirée.");
      }
    });
  }

  const onDrawEnd = () => {
    const minSize = 10 * ((vm?.width ?? 1200) / 1200);
    if (ui.draft && ui.draft.w > minSize && ui.draft.h > minSize) patch({ mode: "drawn", hint: "", nearTooth: nearestTooth(vm.teeth, ui.draft) });
    else patch({ draft: null });
  };

  // --- Numérotation (sprint 7) ------------------------------------------------
  const states = useMemo(
    () => (vm ? toothStates({ teeth: vm.teeth, dets, absentTeeth: vm.absentTeeth, incoherences: vm.incoherences }) : {}),
    [vm, dets],
  );

  /** Action sur les dents : le serveur recalcule numéros et incohérences, on relit l'analyse. */
  const runToothAction = async (call, success, after) => {
    if (ui.busy || !vm?.api) return;
    patch({ busy: true });
    try {
      await call();
      reload();
      if (after) after();
      showToast(success);
    } catch (cause) {
      showToast(toAppError(cause).message);
    } finally {
      patch({ busy: false });
    }
  };
  const toothActions = {
    renumber: (t) => setChoosing({ toothId: t.id, fdi: t.fdi }),
    choose: (fdi) => {
      const c = choosing;
      setChoosing(null);
      if (!c || fdi === c.fdi) return;
      runToothAction(() => postVerdict(vm.api, c.toothId, Verdict.CORRECT, { fdi }), `Dent ${c.fdi} renumérotée ${fdi} ; ses anomalies suivent.`, () => patch({ tooth: fdi }));
    },
    rejectTooth: (t) => runToothAction(() => postVerdict(vm.api, t.id, Verdict.REJECT), `Détection de la dent ${t.fdi} rejetée.`),
    declareAbsent: (fdi) => runToothAction(() => declareToothAbsent(vm.id, fdi), `Dent ${fdi} déclarée absente.`),
    withdrawAbsent: (fdi) => runToothAction(() => withdrawToothAbsent(vm.id, fdi), `Déclaration d'absence de la dent ${fdi} retirée.`),
  };

  const exportOdontogram = async () => {
    if (!vm) return;
    try {
      const svg = toSvgString(states, { title: `Schéma dentaire (FDI) · ${vm.ref || "démonstration"}`, typeColor: (l) => detectionType(l).color });
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = new Image();
      await new Promise((ok, ko) => {
        img.onload = ok;
        img.onerror = ko;
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const blob = await new Promise((ok) => canvas.toBlob(ok, "image/png"));
      downloadBlob(blob, odontogramFileName(vm.ref));
      showToast("Schéma dentaire exporté (PNG).");
    } catch {
      showToast("Export du schéma impossible.");
    }
  };

  const pickTooth = (fdi) => {
    const tooth = ui.tooth === fdi ? null : fdi;
    const first = sortDetections(dets.filter((d) => d.fdi === fdi), ui.sort)[0];
    patch({ tooth, sel: first ? first.id : null, mode: null, tab: "det" });
    const t = vm.teeth.find((x) => x.fdi === fdi);
    if (t) viewerRef.current?.centerOn(t.box);
  };

  const toggleAll = () => patch((u) => ({ show: Object.values(u.show).some(Boolean) ? NO_LAYER : ALL_LAYERS }));

  const exportPng = async () => {
    if (!vm || exporting) return;
    setExporting(true);
    try {
      const blob = await viewerRef.current.exportPng(buildAnnotations(vm, dets, { visible, show: ui.show }));
      downloadBlob(blob, exportFileName(vm));
      showToast("Image annotée exportée (PNG).");
    } catch (cause) {
      showToast(cause.message || "Export impossible.");
    } finally {
      setExporting(false);
    }
  };

  /** Détection suivante (+1) ou précédente (−1) parmi celles affichées, dans l'ordre de la liste. */
  const step = (dir) => {
    const next = stepDetection(dets.filter(visible), ui.sel, dir, ui.sort);
    if (next) select(next, true);
  };

  // Raccourcis clavier de la visionneuse (sauf pendant une saisie ou une fenêtre ouverte).
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (!vm || pending || modal || e.ctrlKey || e.metaKey || e.altKey || keyBelongsToField(e.target, e.key)) return;
    if (ui.mode === "draw" || ui.mode === "drawn" || ui.mode === "correct") return;
    const k = e.key;
    if (k === "j" || k === "J" || k === "ArrowDown" || k === "ArrowRight") step(1);
    else if (k === "k" || k === "K" || k === "ArrowUp" || k === "ArrowLeft") step(-1);
    else if (k === "+" || k === "=") viewerRef.current?.zoomIn();
    else if (k === "-" || k === "_") viewerRef.current?.zoomOut();
    else if (k === "0") viewerRef.current?.fit();
    else if (k === "h" || k === "H") toggleAll();
    else if (canEdit && current && (k === "v" || k === "V")) actions.validate(current.note);
    else if (canEdit && current && (k === "r" || k === "R")) actions.reject(current.note);
    else if (canEdit && current && (k === "c" || k === "C")) actions.startCorrect();
    else if (canEdit && current && current.status !== "pending" && (k === "u" || k === "U")) actions.undo();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e) => keyRef.current?.(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canEdit = canReview && !ui.closed && !ui.busy;
  const total = dets.length;
  const done = dets.filter((d) => d.status !== "pending").length;
  const left = total - done;
  const number = vm?.number ?? "…";

  const goNext = () => {
    const order = sortDetections(dets.filter((x) => x.status === "pending"), ui.sort);
    if (!order.length) return;
    if (order[0].confidence != null && order[0].confidence < ui.threshold) patch({ threshold: Math.max(0, order[0].confidence - 1) });
    select(order[0].id, true);
  };

  const trace = vm ? (
    <span className="trace">
      Modèle <span className="mono">{vm.modelVersion}</span> · seuil {pct(ui.threshold)} · analysée le {vm.date} à {vm.time}
      {vm.durationMs != null ? ` en ${formatDuration(vm.durationMs)}` : ""} · {vm.teeth.length} dents numérotées
      {vm.demo ? " · données fictives" : " · chaque verdict est enregistré avec son auteur"}
    </span>
  ) : null;

  const headerContent = (
    <div>
      <p className="crumbs">
        <Link href="/historique">Historique</Link> › Analyse
      </p>
      <h1>Analyse n° {number}</h1>
      <div className="head-meta">
        <Badge className="mono">Référence {vm?.ref ?? "…"}</Badge>
        <Badge>{vm?.date ?? ""}</Badge>
        {pending ? (
          <Badge tone={vm.processing === Processing.FAILED ? "danger" : "info"} dot>
            {vm.processing === Processing.FAILED ? "Échec de l’analyse" : "Analyse en cours"}
          </Badge>
        ) : (
          <Badge tone={ui.closed ? "success" : "info"} dot>
            {ui.closed ? "Clôturée" : "Relecture en cours"}
          </Badge>
        )}
        {!canReview ? (
          <Badge tone="warning">
            <Icon name="eye" />
            Lecture seule
          </Badge>
        ) : null}
        {vm?.demo ? <Badge tone="warning">Démonstration</Badge> : null}
      </div>
    </div>
  );

  const reportHref = vm?.id ? `/compte-rendu?id=${vm.id}` : "/compte-rendu";
  const headerActions = pending ? null : (
    <div className="head-actions">
      {canReport || vm?.demo ? (
        <Button size="sm" variant={ui.closed ? "primary" : "secondary"} href={reportHref}>
          <Icon name="file" />
          Générer le compte rendu
        </Button>
      ) : null}
      {canReview && !ui.closed ? (
        <Button size="sm" onClick={() => setModal("close")}>
          <Icon name="lock" />
          Clôturer l&apos;analyse
        </Button>
      ) : null}
    </div>
  );

  return (
    <AppShell
      page="historique"
      title={`Analyse n° ${number}`}
      permission={Permission.ANALYSIS_READ}
      className="v-analyse"
      rail
      bare
      headerContent={headerContent}
      headerActions={headerActions}
      overlay={
        <>
          <ClosureModal
            open={modal === "close"}
            number={number}
            summary={reviewSummary(dets)}
            conclusion={closure.conclusion}
            onConclusionChange={(conclusion) => setClosure((c) => ({ ...c, conclusion }))}
            onConclusionBlur={() => review.saveConclusion(closure.conclusion).catch(() => {})}
            onCancel={() => setModal(null)}
            onGoNext={() => {
              setModal(null);
              goNext();
            }}
            onConfirm={() =>
              run(async () => {
                const next = await review.close(closure.conclusion);
                setClosure((c) => ({ ...c, ...next }));
                patch({ closed: true, mode: null, draft: null });
                setModal(null);
                showToast("Analyse clôturée : elle est désormais en lecture seule.");
              })
            }
            busy={ui.busy}
          />
          <Modal open={modal === "reopen"} onClose={() => setModal(null)} labelledBy="reopenTitle">
            <h2 id="reopenTitle">Rouvrir l&apos;analyse n° {number} ?</h2>
            <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
              Les détections redeviennent modifiables ; les verdicts déjà posés sont conservés. Le compte rendu déjà généré devra être régénéré.
            </p>
            <div className="field">
              <label className="label" htmlFor="reopenWhy">
                Motif de la réouverture (obligatoire)
              </label>
              <textarea className="textarea" id="reopenWhy" placeholder="Ex. : compléter la relecture de la dent 24" value={reopenWhy} onChange={(e) => setReopenWhy(e.target.value)} />
              <span className="hint">Le motif est inscrit au journal d&apos;audit.</span>
            </div>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setModal(null)}>
                Annuler
              </Button>
              <Button
                disabled={reopenWhy.trim().length < 5 || ui.busy}
                onClick={() =>
                  run(async () => {
                    const next = await review.reopen(reopenWhy.trim());
                    setClosure((c) => ({ ...c, ...next }));
                    patch({ closed: false });
                    setModal(null);
                    setReopenWhy("");
                    showToast("Analyse rouverte. Motif inscrit au journal d'audit.");
                  })
                }
              >
                Rouvrir l&apos;analyse
              </Button>
            </div>
          </Modal>
          <div className="toast" role="status" aria-live="polite" data-show={toast ? "true" : "false"}>
            <span>{toast?.text}</span>
            {toast?.undo ? (
              <button
                type="button"
                onClick={() => {
                  toast.undo();
                  setToast(null);
                }}
              >
                Annuler
              </button>
            ) : null}
          </div>
        </>
      }
    >
      {pending ? (
        <section className="ws" aria-label="Suivi de l’analyse">
          <ProcessingState vm={vm} canLaunch={can(Permission.ANALYSIS_CREATE)} onDone={reload} />
        </section>
      ) : (
      <section className="ws" aria-label="Espace de lecture">
        <div className="strip">
          {ui.closed ? (
            <>
              <span className="locked" data-etat="lecture-seule">
                <Icon name="lock" />
                Analyse clôturée — lecture seule
              </span>
              <span style={{ color: "var(--color-viewer-muted)" }}>
                {closure.closedBy ? `par ${closure.closedBy}` : ""}
                {closure.closedAt ? ` le ${new Date(`${String(closure.closedAt).replace(/Z?$/, "Z")}`).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}
                {" · "}
                {total - reviewSummary(dets).rejected} détection{total - reviewSummary(dets).rejected > 1 ? "s" : ""} retenue{total - reviewSummary(dets).rejected > 1 ? "s" : ""}
              </span>
              {canReopen ? (
                <button type="button" className="vbtn outline" onClick={() => setModal("reopen")}>
                  <Icon name="unlock" />
                  Rouvrir l&apos;analyse
                </button>
              ) : null}
              <ModelReplay vm={vm} canCreate={can(Permission.ANALYSIS_CREATE)} />
              {trace}
            </>
          ) : (
            <>
              <strong style={{ fontWeight: 600 }}>
                <span className="mono">{done}</span> sur <span className="mono">{total}</span> détections revues
              </strong>
              <span className="progress" role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={done} aria-label="Avancement de la relecture">
                <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
              </span>
              {left ? (
                <>
                  <span style={{ color: "#FBBF24" }}>
                    {left} à revoir
                  </span>
                  <button type="button" className="vbtn outline" onClick={goNext}>
                    Suivante à revoir <Icon name="chevron" />
                  </button>
                </>
              ) : (
                <span style={{ color: "#4ADE80" }}>Tout est relu</span>
              )}
              <ModelReplay vm={vm} canCreate={can(Permission.ANALYSIS_CREATE)} />
              {trace}
            </>
          )}
        </div>
        {vm?.mockInference ? (
          <div className="strip" style={{ minHeight: 0, color: "#FBBF24" }}>
            <Icon name="alert" />
            Mode démonstration du modèle : ces détections sont factices et n&apos;ont aucune valeur diagnostique.
          </div>
        ) : null}
        <div className={`grid${ui.panelClosed ? " panel-closed" : ""}`}>
          <Viewer
            ref={viewerRef}
            vm={vm}
            dets={dets}
            visible={visible}
            show={ui.show}
            onToggleLayer={(k) => patch((u) => ({ show: { ...u.show, [k]: !u.show[k] } }))}
            onToggleAll={toggleAll}
            onExport={exportPng}
            exporting={exporting}
            sel={ui.sel}
            hover={ui.hover}
            onHover={(h) => patch({ hover: h })}
            onSelect={(detId) => select(detId, false)}
            mode={ui.mode}
            draft={ui.draft}
            onDraft={(draft) => patch({ draft })}
            onDrawEnd={onDrawEnd}
            onBoxChange={(detId, box) => updateDet(detId, { box })}
            focusTooth={ui.tooth ?? current?.fdi}
            onPickTooth={pickTooth}
            hint={ui.hint}
            panelClosed={ui.panelClosed}
            onTogglePanel={() => patch({ panelClosed: true })}
            loading={loading}
            error={error}
            onRetry={reload}
          >
            {vm ? (
              <Odontogram
                states={states}
                positions={POSITIONS}
                selectedTooth={ui.tooth ?? current?.fdi}
                onPick={pickTooth}
                choosing={choosing}
                onChoose={toothActions.choose}
                onCancelChoose={() => setChoosing(null)}
                onExport={exportOdontogram}
              />
            ) : null}
          </Viewer>

          <aside className="panel" aria-label="Détections et assistant">
            <div className="tabs" role="tablist">
              <button type="button" className="tab" role="tab" aria-selected={ui.tab === "det"} aria-controls="paneDet" onClick={() => patch({ tab: "det" })}>
                <Icon name="layers" />
                Détections <span className="count">{total}</span>
              </button>
              <button type="button" className="tab" role="tab" aria-selected={ui.tab === "chat"} aria-controls="paneChat" onClick={() => patch({ tab: "chat" })}>
                <Icon name="message" />
                Assistant
              </button>
            </div>
            <div className="tabpane" id="paneDet" role="tabpanel" data-active={ui.tab === "det" ? "true" : "false"}>
              {vm && ui.tooth != null && states[ui.tooth] ? (
                <ToothCard
                  s={states[ui.tooth]}
                  absentInfo={vm.absentTeeth.find((x) => x.fdi === ui.tooth)}
                  canEdit={canReview && !ui.closed && !ui.busy && !vm.demo}
                  onRenumber={toothActions.renumber}
                  onRejectTooth={toothActions.rejectTooth}
                  onDeclareAbsent={toothActions.declareAbsent}
                  onWithdrawAbsent={toothActions.withdrawAbsent}
                  onSelectAnomaly={(detId) => select(detId, true)}
                  onClose={() => patch({ tooth: null })}
                />
              ) : null}
              {vm ? <DetectionsPane vm={vm} state={{ ...ui, dets }} actions={actions} canReview={canReview} reviewerName={reviewerName} /> : null}
            </div>
            <div className="tabpane" id="paneChat" role="tabpanel" data-active={ui.tab === "chat" ? "true" : "false"}>
              {vm ? <AssistantPane key={vm.id ?? "demo"} vm={vm} current={current} pendingQuestion={question} onQuestionHandled={() => setQuestion(null)} /> : null}
            </div>
          </aside>
          <button type="button" className="reopen-panel" onClick={() => patch({ panelClosed: false })}>
            Détections et assistant
          </button>
        </div>
      </section>
      )}
    </AppShell>
  );
}
