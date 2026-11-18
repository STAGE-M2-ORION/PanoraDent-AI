import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import { detectionType } from "@/entities/detection";
import { Permission, displayName, useCurrentUser } from "@/entities/session";
import { Alert, Badge, Button, Icon, Modal } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

import { nearestTooth, pct, sortDetections, useAnalysisViewModel } from "@/widgets/analysis-workspace";
import { AssistantPane } from "./AssistantPane";
import { DetectionsPane } from "./DetectionsPane";
import { Odontogram } from "./Odontogram";
import { Viewer } from "./Viewer";

const ALL_LAYERS = { tooth: true, caries: true, deep_caries: true, periapical_lesion: true, impacted_tooth: true };

/** Poste de lecture : visionneuse, détections, relecture, assistant. */
export function AnalysePage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const { user, can } = useCurrentUser();
  const canReview = can(Permission.DETECTION_REVIEW);
  const canReport = can(Permission.REPORT_GENERATE);
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
    confirmDel: false,
    closed: false,
    autoNext: true,
    hint: "",
    tab: "det",
    panelClosed: false,
  });
  const [modal, setModal] = useState(null); // "close" | "reopen"
  const [reopenWhy, setReopenWhy] = useState("");
  const [toast, setToast] = useState(null); // { text, undo }
  const [question, setQuestion] = useState(null);
  const backup = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    if (!vm) return;
    setDets(vm.dets);
    const firstPending = sortDetections(vm.dets.filter((d) => d.status === "pending"), "tooth")[0];
    setUi((u) => ({ ...u, closed: vm.closed, sel: vm.demo ? "d2" : firstPending?.id ?? vm.dets[0]?.id ?? null }));
  }, [vm]);

  const patch = useCallback((p) => setUi((u) => ({ ...u, ...(typeof p === "function" ? p(u) : p) })), []);
  const showToast = useCallback((text, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const current = dets.find((d) => d.id === ui.sel);
  const visible = (d) => ui.show[d.label] && (d.confidence == null || d.confidence >= ui.threshold);
  const updateDet = (detId, change) => setDets((list) => list.map((d) => (d.id === detId ? { ...d, ...change } : d)));

  const restoreBackup = () => {
    if (current && backup.current) updateDet(current.id, backup.current);
    backup.current = null;
  };

  const select = (detId, fromList) => {
    if (ui.mode === "correct") restoreBackup();
    patch({ sel: detId, tooth: null, mode: null, confirmDel: false, hint: "" });
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
    setConfirmDel: (confirmDel) => patch({ confirmDel }),
    validate: () => {
      const d = current;
      const status = d.status === "validated" ? "pending" : d.status === "pending" ? "validated" : d.status;
      const next = dets.map((x) => (x.id === d.id ? { ...x, status } : x));
      setDets(next);
      if (status === "validated") {
        showToast(`Détection validée : dent ${d.fdi}, ${detectionType(d.label).label.toLowerCase()}.`);
        goNextPending(next);
      }
    },
    startCorrect: () => {
      backup.current = { box: { ...current.box }, label: current.label, fdi: current.fdi };
      patch({ mode: "correct", hint: "Correction : déplacez ou redimensionnez le cadre" });
    },
    cancelCorrect: () => {
      restoreBackup();
      patch({ mode: null, hint: "" });
    },
    saveCorrect: ({ label, fdi }) => {
      const d = current;
      const change = { label, fdi };
      if (label !== d.label && !d.was && d.source === "ai") change.was = d.label;
      if (d.source === "ai") change.status = "corrected";
      updateDet(d.id, change);
      backup.current = null;
      patch({ mode: null, hint: "" });
      showToast("Correction enregistrée : le cadre passe en pointillé.");
    },
    remove: () => {
      const d = current;
      const index = dets.indexOf(d);
      setDets((list) => list.filter((x) => x.id !== d.id));
      patch({ confirmDel: false, sel: null });
      showToast(`Détection supprimée (dent ${d.fdi}).`, () => {
        setDets((list) => [...list.slice(0, index), d, ...list.slice(index)]);
        patch({ sel: d.id });
      });
    },
    saveNote: (note) => {
      updateDet(current.id, { note });
      showToast("Commentaire enregistré.");
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
    saveNew: ({ label, fdi, note }) => {
      const newId = `u${Date.now()}`;
      setDets((list) => [...list, { id: newId, fdi, label, confidence: null, status: "added", source: "user", note: note.trim(), box: { ...ui.draft } }]);
      patch({ mode: null, draft: null, sel: newId });
      showToast(`Détection ajoutée sur la dent ${fdi}.`);
    },
  };

  const onDrawEnd = () => {
    const minSize = 10 * ((vm?.width ?? 1200) / 1200);
    if (ui.draft && ui.draft.w > minSize && ui.draft.h > minSize) patch({ mode: "drawn", hint: "", nearTooth: nearestTooth(vm.teeth, ui.draft) });
    else patch({ draft: null });
  };

  const pickTooth = (fdi) => {
    const tooth = ui.tooth === fdi ? null : fdi;
    const first = sortDetections(dets.filter((d) => d.fdi === fdi), ui.sort)[0];
    patch({ tooth, sel: first ? first.id : null, mode: null, tab: "det" });
    const t = vm.teeth.find((x) => x.fdi === fdi);
    if (t) viewerRef.current?.centerOn(t.box);
  };

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
      Modèle <span className="mono">{vm.modelVersion}</span> · seuil {pct(ui.threshold)} · analysée le {vm.date} à {vm.time} · {vm.teeth.length} dents numérotées
      {vm.demo ? " · données fictives" : " · relecture conservée pour cette session"}
    </span>
  ) : null;

  const headerContent = (
    <div>
      <p className="crumbs">
        <Link href="/historique">Historique</Link> › Analyse
      </p>
      <h1>Analyse n° {number}</h1>
      <div className="head-meta">
        <Badge className="mono">ID anonyme {vm?.ref ?? "…"}</Badge>
        <Badge>{vm?.date ?? ""}</Badge>
        <Badge tone={ui.closed ? "success" : "info"} dot>
          {ui.closed ? "Clôturée" : "Relecture en cours"}
        </Badge>
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
  const headerActions = (
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
          <Modal open={modal === "close"} onClose={() => setModal(null)} labelledBy="closeTitle">
            <h2 id="closeTitle">Clôturer l&apos;analyse n° {number} ?</h2>
            {left ? (
              <Alert tone="warning" icon="alert" title={`${left} détection${left > 1 ? "s ne sont" : " n'est"} pas revue${left > 1 ? "s" : ""}.`}>
                Elles seront exclues du compte rendu. Vous pouvez aussi les relire d&apos;abord.
              </Alert>
            ) : null}
            <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
              La clôture verrouille les résultats : plus aucune détection ne peut être modifiée. Une réouverture reste possible, avec un motif inscrit au journal d&apos;audit.
            </p>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setModal(null)}>
                Continuer la relecture
              </Button>
              <Button
                onClick={() => {
                  patch({ closed: true, mode: null });
                  setModal(null);
                  showToast("Analyse clôturée. Le compte rendu peut être généré.");
                }}
              >
                Clôturer l&apos;analyse
              </Button>
            </div>
          </Modal>
          <Modal open={modal === "reopen"} onClose={() => setModal(null)} labelledBy="reopenTitle">
            <h2 id="reopenTitle">Rouvrir l&apos;analyse n° {number} ?</h2>
            <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
              Les détections redeviennent modifiables. Le compte rendu déjà généré devra être régénéré.
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
                disabled={reopenWhy.trim().length < 5}
                onClick={() => {
                  patch({ closed: false });
                  setModal(null);
                  setReopenWhy("");
                  showToast("Analyse rouverte. Motif inscrit au journal d'audit.");
                }}
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
      <section className="ws" aria-label="Espace de lecture">
        <div className="strip">
          {ui.closed ? (
            <>
              <span className="locked">
                <Icon name="lock" />
                Analyse clôturée — résultats verrouillés
              </span>
              <span style={{ color: "var(--color-viewer-muted)" }}>
                {done} détection{done > 1 ? "s" : ""} retenue{done > 1 ? "s" : ""} · {left} non revue{left > 1 ? "s" : ""} exclue{left > 1 ? "s" : ""}
              </span>
              {canReview ? (
                <button type="button" className="vbtn outline" onClick={() => setModal("reopen")}>
                  <Icon name="unlock" />
                  Rouvrir l&apos;analyse
                </button>
              ) : null}
              {trace}
            </>
          ) : (
            <>
              <strong style={{ fontWeight: 600 }}>
                <span className="mono">{done}</span> sur <span className="mono">{total}</span> détections relues
              </strong>
              <span className="progress" role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={done} aria-label="Avancement de la relecture">
                <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
              </span>
              {left ? (
                <>
                  <span style={{ color: "#FBBF24" }}>
                    {left} non revue{left > 1 ? "s" : ""}
                  </span>
                  <button type="button" className="vbtn outline" onClick={goNext}>
                    Aller à la suivante <Icon name="chevron" />
                  </button>
                </>
              ) : (
                <span style={{ color: "#4ADE80" }}>Tout est relu</span>
              )}
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
            hint={ui.hint}
            panelClosed={ui.panelClosed}
            onTogglePanel={() => patch({ panelClosed: true })}
            loading={loading}
            error={error}
            onRetry={reload}
          >
            {vm ? <Odontogram present={new Set(vm.teeth.map((t) => t.fdi))} dets={dets} selectedTooth={ui.tooth ?? current?.fdi} onPick={pickTooth} /> : null}
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
    </AppShell>
  );
}
