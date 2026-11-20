import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";

import { ANALYSIS_STATUS, AnalysisStatus, deleteAnalysis, fetchAnalyses, formatAnalysisNumber } from "@/entities/analysis";
import { ANOMALY_LABELS, DETECTION_TYPES, TypeChip } from "@/entities/detection";
import { Permission, useCurrentUser } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { formatDate, useAsyncResource } from "@/shared/lib";
import { Alert, Badge, Button, Icon, IconAction, IdChip, Modal, NumChip, Pager, WhoChip, paginate, useToast } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const PAGE_SIZE = 10;
const PERIOD = { today: "Aujourd’hui", 7: "7 jours", 30: "30 jours", custom: "Personnalisée" };
const STATUS_FILTER = { pending: "À relire", inprogress: "Relecture en cours", closed: "Clôturée", failed: "Échec" };
const EMPTY_FILTERS = { q: "", owner: "all", period: "all", status: "all", types: [], from: "", to: "" };

/** Âge en jours d'une date ISO du backend (UTC). */
function ageInDays(iso) {
  const d = new Date(`${String(iso).replace(/Z?$/, "Z")}`);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((start - d) / 864e5));
}

function applyFilters(rows, f, meId) {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.owner === "mine" && r.depositorId !== meId) return false;
    if (q && !(r.ref.toLowerCase().includes(q) || formatAnalysisNumber(r.number).includes(q))) return false;
    const age = ageInDays(r.createdAt);
    if (f.period === "today" && age > 0) return false;
    if (f.period === "7" && age > 7) return false;
    if (f.period === "30" && age > 30) return false;
    if (f.period === "custom") {
      const iso = String(r.createdAt).slice(0, 10);
      if (f.from && iso < f.from) return false;
      if (f.to && iso > f.to) return false;
    }
    if (f.status !== "all" && r.status !== f.status) return false;
    if (f.types.length && !f.types.some((t) => r.labels.includes(t))) return false;
    return true;
  });
}

/**
 * Analyses du cabinet : recherche par référence anonyme, filtres (« Mes
 * analyses » d'emblée pour qui en dépose), pagination, suppression confirmée
 * — réservée au déposant et à l'administrateur, le serveur le revérifie.
 */
export function HistoriquePage() {
  const router = useRouter();
  const toast = useToast();
  const { can, user: me } = useCurrentUser();
  const canCreate = can(Permission.ANALYSIS_CREATE);
  const isAdmin = can(Permission.USER_MANAGE) && can(Permission.ROLE_MANAGE);
  const canDeleteRow = (r) => can(Permission.ANALYSIS_DELETE) && (isAdmin || (r.depositorId && r.depositorId === me?.id));
  const readOnly = !can(Permission.DETECTION_REVIEW);
  const { data, error, isLoading, reload } = useAsyncResource(fetchAnalyses);
  const [rows, setRows] = useState([]);
  const [f, setF] = useState(EMPTY_FILTERS);
  // « Mes analyses » d'emblée pour qui en dépose, une fois la session connue
  // (au premier rendu les permissions ne sont pas encore chargées).
  const ownerDefaulted = useRef(false);
  useEffect(() => {
    if (ownerDefaulted.current || !me) return;
    ownerDefaulted.current = true;
    if (canCreate) setF((v) => ({ ...v, owner: "mine" }));
  }, [me, canCreate]);
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => setRows(data ?? []), [data]);
  // Recherche transmise par le tableau de bord (`?q=7F3A`).
  useEffect(() => {
    if (router.isReady && typeof router.query.q === "string") setF((v) => ({ ...v, q: router.query.q }));
  }, [router.isReady, router.query.q]);
  useEffect(() => setPage(1), [f]);

  const list = useMemo(() => applyFilters(rows, f, me?.id), [rows, f, me?.id]);
  const { items, pageCount } = paginate(list, page, PAGE_SIZE);
  const hasFilters = Boolean(f.q.trim() || f.owner !== "all" || f.period !== "all" || f.status !== "all" || f.types.length);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  const chips = [];
  if (f.q.trim()) chips.push(["q", `Recherche : ${f.q.trim()}`, { q: "" }]);
  if (f.owner === "mine") chips.push(["owner", "Mes analyses", { owner: "all" }]);
  if (f.period !== "all") chips.push(["period", `Période : ${PERIOD[f.period]}`, { period: "all", from: "", to: "" }]);
  if (f.status !== "all") chips.push(["status", `Statut : ${STATUS_FILTER[f.status]}`, { status: "all" }]);
  f.types.forEach((t) => chips.push([`type:${t}`, `Anomalie : ${DETECTION_TYPES[t].label}`, { types: f.types.filter((x) => x !== t) }]));

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteAnalysis(target.id);
      setRows((r) => r.filter((x) => x.id !== target.id));
      toast(`Analyse ${target.ref} supprimée, image et compte rendu compris. L’opération est inscrite au journal d’audit.`);
    } catch (cause) {
      toast(toAppError(cause).message);
    }
  };

  let content;
  if (isLoading) {
    content = (
      <>
        <div className="table-wrap" style={{ background: "var(--color-surface)" }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="sk-row">
              {Array.from({ length: 7 }, (__, j) => (
                <span key={j} className="skeleton" />
              ))}
            </div>
          ))}
        </div>
        <p className="sr-only">Chargement de l’historique…</p>
      </>
    );
  } else if (error) {
    content = (
      <Alert tone="danger" icon="alert" role="alert" title="L’historique n’a pas pu être chargé.">
        {error.message} Vos analyses n’ont pas été modifiées.
        <div style={{ marginTop: "var(--space-3)" }}>
          <Button size="sm" variant="secondary" onClick={reload}>
            <Icon name="refresh" />
            Réessayer
          </Button>
        </div>
      </Alert>
    );
  } else if (rows.length === 0) {
    content = (
      <div className="card state-box">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="illus ill-img" src="/medias/etat-vide.webp" width="1024" height="1024" alt="" aria-hidden="true" />
        <h3>Aucune analyse pour le moment</h3>
        <p>Les analyses que vous lancerez apparaîtront ici, avec leur statut de relecture.</p>
        {canCreate ? (
          <Button href="/nouvelle-analyse">
            <Icon name="plus" />
            Nouvelle analyse
          </Button>
        ) : (
          <p>Un praticien doit déposer une première radiographie.</p>
        )}
      </div>
    );
  } else if (list.length === 0) {
    content = (
      <div className="card state-box">
        <Icon name="search" className="ill" />
        <h3>Aucune analyse ne correspond à ces critères.</h3>
        <p>{f.owner === "mine" ? "Vous n’avez pas encore déposé d’analyse correspondante : affichez celles de tout le cabinet." : "Vérifiez la référence saisie ou élargissez la période."}</p>
        <Button variant="secondary" onClick={() => setF(EMPTY_FILTERS)}>
          Effacer les filtres
        </Button>
      </div>
    );
  } else {
    content = (
      <div className="table-wrap">
        <table className="table stack">
          <caption className="sr-only">Analyses, de la plus récente à la plus ancienne</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">N°</th>
              <th scope="col">Référence</th>
              <th scope="col">Statut de revue</th>
              <th scope="col">Détections</th>
              <th scope="col">Déposée par</th>
              <th scope="col" className="r">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const S = ANALYSIS_STATUS[r.status];
              const n = formatAnalysisNumber(r.number);
              const closed = r.status === AnalysisStatus.CLOSED;
              return (
                <tr key={r.id}>
                  <td data-label="Date" className="nowrap">
                    {formatDate(r.createdAt)}
                    {r.examDate ? <span className="sub">Examen du {formatDate(r.examDate)}</span> : null}
                  </td>
                  <td data-label="N°">
                    <NumChip>{n}</NumChip>
                  </td>
                  <td data-label="Référence">
                    <IdChip>{r.ref}</IdChip>
                  </td>
                  <td data-label="Statut de revue">
                    <Badge tone={S.tone} dot>
                      {S.label}
                    </Badge>
                  </td>
                  <td data-label="Détections">
                    <span className="dets">
                      <span className="n mono">{r.detectionCount}</span>
                      <span className="sw">
                        {r.labels.map((t) => (
                          <TypeChip key={t} label={t} />
                        ))}
                      </span>
                    </span>
                  </td>
                  <td data-label="Déposée par">
                    <WhoChip name={r.depositorId && r.depositorId === me?.id ? `${r.depositorName ?? ""} (vous)`.trim() : r.depositorName} />
                  </td>
                  <td className="td-actions">
                    <div className="row-actions">
                      <Button size="sm" variant="secondary" href={`/analyse?id=${r.id}`}>
                        {readOnly ? "Consulter" : "Ouvrir"}
                        <span className="sr-only"> l’analyse n° {n}</span>
                      </Button>
                      {closed ? (
                        <IconAction icon="file" href={`/compte-rendu?id=${r.id}`} label={`Compte rendu de l’analyse n° ${n}`} title="Compte rendu" />
                      ) : (
                        <IconAction
                          icon="file"
                          disabled
                          label={`Compte rendu indisponible : l’analyse n° ${n} n’est pas clôturée`}
                          title="Le compte rendu n’est disponible qu’une fois l’analyse clôturée."
                        />
                      )}
                      {canDeleteRow(r) ? <IconAction icon="trash" danger label={`Supprimer l’analyse ${r.ref}`} title="Supprimer" onClick={() => setPendingDelete(r)} /> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const showFoot = !isLoading && !error && list.length > 0;

  return (
    <AppShell
      page="historique"
      title="Historique"
      docTitle="Historique des analyses"
      permission={Permission.ANALYSIS_READ}
      className="v-historique"
      overlay={
        <Modal open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} labelledBy="del-title">
          <h2 id="del-title">
            Supprimer l’analyse <span className="mono">{pendingDelete?.ref ?? ""}</span> ?
          </h2>
          <p>Cette action est définitive : l’image anonymisée, ses détections et son compte rendu sont effacés du serveur. L’opération est inscrite au journal d’audit.</p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Annuler
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Supprimer définitivement
            </Button>
          </div>
        </Modal>
      }
    >
      <div className="page-head">
        <div>
          <h2>Historique des analyses</h2>
          <p>Retrouvez un examen par sa référence anonyme, sa date ou son statut.</p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          {readOnly ? (
            <Badge tone="info" className="ro">
              <Icon name="eye" />
              Accès en lecture seule
            </Badge>
          ) : null}
          {canCreate ? (
            <Button href="/nouvelle-analyse">
              <Icon name="plus" />
              Nouvelle analyse
            </Button>
          ) : null}
        </div>
      </div>

      <section className="card card-pad filters" aria-label="Recherche et filtres" style={{ opacity: error || (!isLoading && rows.length === 0) ? 0.5 : undefined }}>
        <div className="filters-row">
          <div className="field search-wrap-col">
            <label className="label" htmlFor="q">
              Référence anonyme ou n° d’analyse
            </label>
            <div className="search-wrap">
              <Icon name="search" />
              <input className="input" id="q" type="search" placeholder="Par exemple : PDX-2026-0042 ou 0042" autoComplete="off" value={f.q} onChange={(e) => set({ q: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="owner">
              Déposées par
            </label>
            <select className="select" id="owner" value={f.owner} onChange={(e) => set({ owner: e.target.value })}>
              <option value="all">Tout le cabinet</option>
              <option value="mine">Moi</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="period">
              Période
            </label>
            <select className="select" id="period" value={f.period} onChange={(e) => set({ period: e.target.value })}>
              <option value="all">Toutes les dates</option>
              <option value="today">Aujourd’hui</option>
              <option value="7">7 jours</option>
              <option value="30">30 jours</option>
              <option value="custom">Personnalisée</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="status">
              Statut de revue
            </label>
            <select className="select" id="status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="all">Tous les statuts</option>
              <option value="pending">À relire</option>
              <option value="inprogress">Relecture en cours</option>
              <option value="closed">Clôturée</option>
              <option value="failed">Échec</option>
            </select>
          </div>
        </div>
        <div className="filters-row" hidden={f.period !== "custom"} style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label className="label" htmlFor="from">
              Du
            </label>
            <input className="input" id="from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="to">
              Au
            </label>
            <input className="input" id="to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          </div>
        </div>
        <fieldset className="types">
          <legend>Type d’anomalie</legend>
          {ANOMALY_LABELS.map((k) => (
            <label key={k} className="check">
              <input
                type="checkbox"
                value={k}
                checked={f.types.includes(k)}
                onChange={(e) => set({ types: e.target.checked ? [...f.types, k] : f.types.filter((t) => t !== k) })}
              />
              <span className={`det-swatch ${DETECTION_TYPES[k].cls}`} aria-hidden="true" />
              {DETECTION_TYPES[k].label}
            </label>
          ))}
        </fieldset>
        <div className="chips" aria-live="polite">
          {chips.map(([key, label, reset]) => (
            <span key={key} className="chip">
              {label}
              <button type="button" aria-label={`Retirer le filtre ${label}`} onClick={() => set(reset)}>
                <Icon name="x" />
              </button>
            </span>
          ))}
          {chips.length ? (
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setF(EMPTY_FILTERS)}>
              Effacer les filtres
            </button>
          ) : null}
        </div>
      </section>

      <section aria-label="Liste des analyses" aria-busy={isLoading}>
        {content}
      </section>

      {showFoot ? (
        <div className="foot">
          <p className="muted">
            {hasFilters
              ? `${list.length} analyse${list.length > 1 ? "s" : ""} trouvée${list.length > 1 ? "s" : ""}`
              : `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + items.length} sur ${list.length} analyse${list.length > 1 ? "s" : ""}`}
          </p>
          <Pager page={page} pageCount={pageCount} onChange={setPage} />
        </div>
      ) : null}
    </AppShell>
  );
}
