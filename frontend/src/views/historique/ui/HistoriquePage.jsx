import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

import {
  ANALYSIS_STATUS,
  AnalysisStatus,
  EMPTY_HISTORY_FILTERS,
  FDI_QUADRANTS,
  POLL_MS,
  deleteAnalysis,
  deleteHistoryView,
  displayStatus,
  fetchHistory,
  fetchHistoryCsv,
  fetchHistoryViews,
  filtersToQuery,
  formatAnalysisNumber,
  formatSort,
  historyParams,
  launchAnalysis,
  parseSort,
  queryToFilters,
  saveHistoryView,
} from "@/entities/analysis";
import { ANOMALY_LABELS, DETECTION_TYPES, TypeChip } from "@/entities/detection";
import { Permission, useCurrentUser } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { formatDate } from "@/shared/lib";
import { Alert, Badge, Button, Icon, IconAction, IdChip, Modal, NumChip, WhoChip, useToast } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

import { AnalysisTimeline } from "./AnalysisTimeline";

const PAGE_SIZE = 10;
const PERIOD = { today: "Aujourd’hui", 7: "7 jours", 30: "30 jours", custom: "Personnalisée" };
const REPORT_FILTER = { telecharge: "Compte rendu téléchargé", non_telecharge: "Compte rendu pas encore téléchargé" };
// Tri : colonne et sens, dans les termes de l'écran.
const SORT_OPTIONS = [
  ["date", true, "Date d’import, récentes d’abord"],
  ["date", false, "Date d’import, anciennes d’abord"],
  ["examen", true, "Date d’examen, récentes d’abord"],
  ["examen", false, "Date d’examen, anciennes d’abord"],
  ["reference", false, "Référence, A → Z"],
  ["reference", true, "Référence, Z → A"],
  ["statut", false, "État, dans l’ordre du traitement"],
  ["statut", true, "État, ordre inverse"],
];
const sortValue = (k) => (k ? `${k.field}:${k.desc ? "desc" : "asc"}` : "");
const sortKey = (v) => (v ? { field: v.split(":")[0], desc: v.endsWith(":desc") } : null);
const STATUS_FILTER = { queued: "En file d’attente", running: "Analyse en cours", pending: "À relire", inprogress: "Relecture en cours", closed: "Clôturée", failed: "Échec" };
const isProcessing = (r) => r.status === AnalysisStatus.QUEUED || r.status === AnalysisStatus.RUNNING;
const EMPTY_PAGE = { items: [], total: 0, next: null, depositors: [] };

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Analyses du cabinet (sprint 8) : recherche par référence ou n°, filtres
 * (état, déposant, période, type d'anomalie retenue), tri et pagination —
 * tout est fait par le SERVEUR (pagination par clé : rapide quel que soit le
 * nombre d'analyses). Export CSV des analyses filtrées, fiche d'historique
 * de chaque analyse. « Mes analyses » d'emblée pour qui en dépose.
 * Suppression confirmée, réservée au déposant et à l'administrateur (le
 * serveur le revérifie).
 */
export function HistoriquePage() {
  const router = useRouter();
  const toast = useToast();
  const { can, user: me } = useCurrentUser();
  const canCreate = can(Permission.ANALYSIS_CREATE);
  const isAdmin = can(Permission.USER_MANAGE) && can(Permission.ROLE_MANAGE);
  const canDeleteRow = (r) => can(Permission.ANALYSIS_DELETE) && (isAdmin || (r.depositorId && r.depositorId === me?.id));
  const readOnly = !can(Permission.DETECTION_REVIEW);
  const [f, setF] = useState(EMPTY_HISTORY_FILTERS);
  // Filtres envoyés au serveur : la saisie de la recherche est regroupée (300 ms).
  const [query, setQuery] = useState(EMPTY_HISTORY_FILTERS);
  // Début de chaque page vue (pagination par clé) : on revient en arrière en dépilant.
  const [cursors, setCursors] = useState([""]);
  const [page, setPageData] = useState(EMPTY_PAGE);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [everHadRows, setEverHadRows] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [views, setViews] = useState([]);
  const [viewName, setViewName] = useState("");
  const [savingView, setSavingView] = useState(false);
  // Filtres portés par l'adresse (sprint 12) : un lien partagé rouvre la même
  // sélection, si le destinataire en a le droit — le serveur revérifie tout.
  // Sans filtre dans l'adresse : « Mes analyses » d'emblée pour qui en dépose.
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current || !router.isReady || !me) return;
    initialised.current = true;
    const fromUrl = queryToFilters(router.query, me.id, ANOMALY_LABELS);
    const empty = !Object.keys(filtersToQuery(fromUrl, me.id)).length;
    setF(empty && canCreate ? { ...fromUrl, owner: "mine" } : fromUrl);
  }, [router.isReady, router.query, me, canCreate]);
  useEffect(() => {
    fetchHistoryViews()
      .then(setViews)
      .catch(() => setViews([]));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(f);
      setCursors([""]);
    }, f.q === query.q ? 0 : 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  // L'adresse suit les filtres appliqués, sans recharger la page.
  useEffect(() => {
    if (!initialised.current) return;
    router.replace({ pathname: router.pathname, query: filtersToQuery(query, me?.id) }, undefined, { shallow: true, scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchHistory(historyParams(query, { cursor, limit: PAGE_SIZE }))
      .then((data) => {
        if (cancelled) return;
        setPageData(data);
        if (data.items.length) setEverHadRows(true);
      })
      .catch((cause) => !cancelled && setError(toAppError(cause)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, cursor, version]);
  const reload = () => setVersion((v) => v + 1);

  const rows = page.items;
  // Tant qu'une analyse de la page est en file ou en cours, la page est relue en silence.
  const processingCount = rows.filter(isProcessing).length;
  useEffect(() => {
    if (!processingCount) return undefined;
    const timer = setTimeout(reload, POLL_MS * 2);
    return () => clearTimeout(timer);
  }, [page, processingCount]);

  const hasFilters = Boolean(f.q.trim() || f.owner !== "all" || f.period !== "all" || f.status !== "all" || f.types.length || f.tooth || f.report);
  const sortKeys = parseSort(f.sort);
  const setSort = (primary, secondary) => set({ sort: formatSort([primary, secondary].filter(Boolean)) });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Lien copié : il rouvre cette sélection pour qui a le droit de la voir.");
    } catch {
      toast("Copie impossible : copiez l’adresse de la page.");
    }
  };
  const saveView = async (event) => {
    event.preventDefault();
    const name = viewName.trim();
    if (!name) return;
    setSavingView(true);
    try {
      const saved = await saveHistoryView(name, f);
      setViews((list) => [...list.filter((v) => v.id !== saved.id && v.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setViewName("");
      toast(`Vue « ${saved.name} » enregistrée.`);
    } catch (cause) {
      toast(toAppError(cause).message);
    } finally {
      setSavingView(false);
    }
  };
  const removeView = async (view) => {
    try {
      await deleteHistoryView(view.id);
      setViews((list) => list.filter((v) => v.id !== view.id));
      toast(`Vue « ${view.name} » supprimée.`);
    } catch (cause) {
      toast(toAppError(cause).message);
    }
  };
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const ownerLabel = (o) => (o === "mine" ? "Mes analyses" : `Déposées par ${page.depositors.find((d) => d.id === o)?.name ?? "un praticien"}`);

  const chips = [];
  if (f.q.trim()) chips.push(["q", `Recherche : ${f.q.trim()}`, { q: "" }]);
  if (f.owner !== "all") chips.push(["owner", ownerLabel(f.owner), { owner: "all" }]);
  if (f.period !== "all") chips.push(["period", `Période : ${PERIOD[f.period]}`, { period: "all", from: "", to: "" }]);
  if (f.status !== "all") chips.push(["status", `Statut : ${STATUS_FILTER[f.status]}`, { status: "all" }]);
  f.types.forEach((t) => chips.push([`type:${t}`, `Anomalie : ${DETECTION_TYPES[t].label}`, { types: f.types.filter((x) => x !== t) }]));
  if (f.tooth) chips.push(["tooth", `Dent ${f.tooth}`, { tooth: "" }]);
  if (f.report) chips.push(["report", REPORT_FILTER[f.report], { report: "" }]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { blob, fileName } = await fetchHistoryCsv(historyParams(query));
      saveBlob(blob, fileName);
      toast(`Export CSV : ${page.total} analyse${page.total > 1 ? "s" : ""}. L’export est inscrit au journal d’audit.`);
    } catch (cause) {
      toast(toAppError(cause).message);
    } finally {
      setExporting(false);
    }
  };

  const relaunch = async (r) => {
    try {
      const next = await launchAnalysis(r.id);
      setPageData((pg) => ({ ...pg, items: pg.items.map((x) => (x.id === r.id ? { ...x, processing: next.processing, status: displayStatus(next.processing, x.closed, x.reviewed) } : x)) }));
      toast(`Analyse ${r.ref} remise en file d’attente.`);
    } catch (cause) {
      toast(toAppError(cause).message);
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteAnalysis(target.id);
      reload();
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
  } else if (rows.length === 0 && !hasFilters && !everHadRows) {
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
  } else if (rows.length === 0) {
    content = (
      <div className="card state-box">
        <Icon name="search" className="ill" />
        <h3>Aucune analyse ne correspond à ces critères.</h3>
        <p>{f.owner === "mine" ? "Vous n’avez pas encore déposé d’analyse correspondante : affichez celles de tout le cabinet." : "Vérifiez la référence saisie ou élargissez la période."}</p>
        <Button variant="secondary" onClick={() => setF(EMPTY_HISTORY_FILTERS)}>
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
              <th scope="col">Anomalies retenues</th>
              <th scope="col">Déposée par</th>
              <th scope="col" className="r">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const S = ANALYSIS_STATUS[r.status];
              const n = formatAnalysisNumber(r.number);
              const closed = r.status === AnalysisStatus.CLOSED;
              const failed = r.status === AnalysisStatus.FAILED;
              const notReady = failed || isProcessing(r);
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
                  <td data-label="Anomalies retenues">
                    <span className="dets">
                      <span className="n mono" title={notReady ? undefined : `${r.detectionCount} détection${r.detectionCount > 1 ? "s" : ""} du modèle`}>
                        {notReady ? "—" : r.retainedCount}
                      </span>
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
                      {failed && canCreate ? (
                        <IconAction icon="refresh" label={`Relancer l’analyse n° ${n}`} title="Relancer l’analyse" onClick={() => relaunch(r)} />
                      ) : null}
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
                      <IconAction icon="history" label={`Historique de l’analyse n° ${n}`} title="Historique de l’analyse" onClick={() => setTimeline(r)} />
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

  const showFoot = !isLoading && !error && rows.length > 0;
  const first = (cursors.length - 1) * PAGE_SIZE + 1;

  return (
    <AppShell
      page="historique"
      title="Historique"
      docTitle="Historique des analyses"
      permission={Permission.ANALYSIS_READ}
      className="v-historique"
      overlay={
        <>
        <AnalysisTimeline analysis={timeline} onClose={() => setTimeline(null)} />
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
        </>
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
          <Button variant="secondary" onClick={exportCsv} disabled={exporting || isLoading || Boolean(error) || page.total === 0}>
            <Icon name="download" />
            {exporting ? "Export…" : "Exporter (CSV)"}
          </Button>
          {canCreate ? (
            <Button href="/nouvelle-analyse">
              <Icon name="plus" />
              Nouvelle analyse
            </Button>
          ) : null}
        </div>
      </div>

      <section className="card card-pad views-bar" aria-label="Vues enregistrées">
        <div className="field">
          <label className="label" htmlFor="vue">
            Vues enregistrées
          </label>
          <select
            className="select"
            id="vue"
            value=""
            onChange={(e) => {
              const v = views.find((x) => x.id === e.target.value);
              if (v) setF({ ...v.filters, types: [...v.filters.types] });
            }}
          >
            <option value="">{views.length ? "Appliquer une vue…" : "Aucune vue enregistrée"}</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <form className="views-save" onSubmit={saveView}>
          <div className="field">
            <label className="label" htmlFor="vue-nom">
              Enregistrer la sélection sous le nom
            </label>
            <input className="input" id="vue-nom" maxLength={80} placeholder="Par exemple : mes caries à relire" value={viewName} onChange={(e) => setViewName(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" disabled={!viewName.trim() || savingView}>
            <Icon name="plus" />
            Enregistrer la vue
          </Button>
        </form>
        <Button variant="ghost" onClick={copyLink}>
          <Icon name="copy" />
          Copier le lien
        </Button>
        {views.length ? (
          <ul className="views-list" aria-label="Vos vues">
            {views.map((v) => (
              <li key={v.id}>
                <button type="button" className="link-btn" onClick={() => setF({ ...v.filters, types: [...v.filters.types] })}>
                  {v.name}
                </button>
                <IconAction icon="trash" danger label={`Supprimer la vue ${v.name}`} title="Supprimer la vue" onClick={() => removeView(v)} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card card-pad filters" aria-label="Recherche et filtres" style={{ opacity: error || (!isLoading && rows.length === 0 && !hasFilters && !everHadRows) ? 0.5 : undefined }}>
        <div className="filters-row">
          <div className="field search-wrap-col">
            <label className="label" htmlFor="q">
              Référence, n°, note ou conclusion
            </label>
            <div className="search-wrap">
              <Icon name="search" />
              <input className="input" id="q" type="search" placeholder="Par exemple : PDX-2026-0042, 0042 ou lésion" autoComplete="off" value={f.q} onChange={(e) => set({ q: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="owner">
              Déposées par
            </label>
            <select className="select" id="owner" value={f.owner} onChange={(e) => set({ owner: e.target.value })}>
              <option value="all">Tout le cabinet</option>
              <option value="mine">Moi</option>
              {page.depositors
                .filter((d) => d.id !== me?.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
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
              <option value="queued">En file d’attente</option>
              <option value="running">Analyse en cours</option>
              <option value="pending">À relire</option>
              <option value="inprogress">Relecture en cours</option>
              <option value="closed">Clôturée</option>
              <option value="failed">Échec</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="dent">
              Dent
            </label>
            <select className="select" id="dent" value={f.tooth} onChange={(e) => set({ tooth: e.target.value })}>
              <option value="">Toutes les dents</option>
              {FDI_QUADRANTS.map(({ quadrant, teeth }) => (
                <optgroup key={quadrant} label={`Quadrant ${quadrant}`}>
                  {teeth.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="cr">
              Compte rendu
            </label>
            <select className="select" id="cr" value={f.report} onChange={(e) => set({ report: e.target.value })}>
              <option value="">Avec ou sans</option>
              <option value="telecharge">Téléchargé</option>
              <option value="non_telecharge">Pas encore téléchargé</option>
            </select>
          </div>
        </div>
        <div className="filters-row sort-row">
          <div className="field">
            <label className="label" htmlFor="sort">
              Trier par
            </label>
            <select className="select" id="sort" value={sortValue(sortKeys[0])} onChange={(e) => setSort(sortKey(e.target.value), sortKeys[1])}>
              {SORT_OPTIONS.map(([field, desc, label]) => (
                <option key={`${field}:${desc}`} value={sortValue({ field, desc })}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="sort2">
              Puis par
            </label>
            <select
              className="select"
              id="sort2"
              value={sortValue(sortKeys[1])}
              onChange={(e) => setSort(sortKeys[0], e.target.value ? sortKey(e.target.value) : null)}
            >
              <option value="">—</option>
              {SORT_OPTIONS.filter(([field]) => field !== sortKeys[0]?.field).map(([field, desc, label]) => (
                <option key={`${field}:${desc}`} value={sortValue({ field, desc })}>
                  {label}
                </option>
              ))}
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
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setF({ ...EMPTY_HISTORY_FILTERS, sort: f.sort })}>
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
          <p className="muted" data-testid="pagination">
            {first}–{first + rows.length - 1} sur {page.total} analyse{page.total > 1 ? "s" : ""}
            {hasFilters ? ` trouvée${page.total > 1 ? "s" : ""}` : ""}
          </p>
          <div className="btn-row" role="group" aria-label="Pagination">
            <Button size="sm" variant="secondary" disabled={cursors.length === 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
              <Icon name="chevronleft" /> Précédentes
            </Button>
            <Button size="sm" variant="secondary" disabled={!page.next} onClick={() => setCursors((c) => [...c, page.next])}>
              Suivantes <Icon name="chevron" />
            </Button>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
