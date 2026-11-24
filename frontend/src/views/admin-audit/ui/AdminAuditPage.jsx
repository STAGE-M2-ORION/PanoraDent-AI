import { useEffect, useState } from "react";

import { EMPTY_AUDIT_FILTERS, auditParams, fetchAudit, fetchAuditCsv, localDay, spanLabel } from "@/entities/audit";
import { Permission } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { formatDate, formatTime, initials } from "@/shared/lib";
import { Alert, Badge, Button, GoogleMark, Icon, useToast } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const small = { width: 13, height: 13 };

const STATE_BADGE = {
  active: (
    <Badge tone="info" dot>
      En cours
    </Badge>
  ),
  closed: (
    <Badge tone="success">
      <Icon name="check" style={small} />
      Déconnexion
    </Badge>
  ),
  expired: (
    <Badge tone="warning">
      <Icon name="clock" style={small} />
      Expirée
    </Badge>
  ),
  none: null,
};

function Method({ method }) {
  if (!method) return null;
  return method === "google" ? (
    <span className="method" title="Connexion avec Google">
      <GoogleMark />
      <span className="sr-only">Google</span>
    </span>
  ) : (
    <span className="method" title="Connexion par e-mail et mot de passe">
      <Icon name="mail" />
      <span className="sr-only">E-mail et mot de passe</span>
    </span>
  );
}

/** « Aujourd'hui · 24/11/2026 », « Hier · … », sinon la date. */
function dayLabel(day) {
  const today = localDay(new Date().toISOString());
  const yesterday = localDay(new Date(Date.now() - 864e5).toISOString());
  const [y, m, d] = day.split("-");
  const date = `${d}/${m}/${y}`;
  return day === today ? `Aujourd’hui · ${date}` : day === yesterday ? `Hier · ${date}` : date;
}

function SessionCard({ g, open, onToggle }) {
  const first = g.entries[0];
  const last = g.entries[g.entries.length - 1];
  const ko = g.entries.filter((e) => !e.ok).length;
  const span = spanLabel(first.at, last.at);
  return (
    <details className="sess" open={open} onToggle={(e) => onToggle(g.id, e.currentTarget.open)} data-groupe={g.id.split(":")[0]}>
      <summary>
        <span className="sess-chev" aria-hidden="true">
          <Icon name="chevrondown" />
        </span>
        <span className="sess-who">
          <span className="av" aria-hidden="true">
            {initials(g.user.name)}
          </span>
          <span>
            <strong>{g.user.name}</strong>
            <span className="sub">{g.title ?? (g.openedAt ? `Session ouverte le ${formatDate(g.openedAt)} à ${formatTime(g.openedAt)}` : "Session")}</span>
          </span>
        </span>
        <span className="sess-when">
          <span className="dt">
            <span className="d">{formatDate(first.at)}</span>
            <span className="t">
              {formatTime(first.at)}
              {span ? ` → ${formatTime(last.at)}` : ""}
            </span>
          </span>
          {g.state !== "none" && span ? <span className="sess-dur mono">{span}</span> : null}
        </span>
        <span className="sess-chips">
          {g.device ? (
            <span className="id-chip" title={g.ip ? `Adresse IP ${g.ip}` : undefined}>
              {g.device}
            </span>
          ) : null}
          <Method method={g.method} />
        </span>
        <span className="sess-end">
          <Badge>
            {g.entries.length} action{g.entries.length > 1 ? "s" : ""}
          </Badge>
          {ko ? (
            <Badge tone="danger">
              {ko} échec{ko > 1 ? "s" : ""}
            </Badge>
          ) : null}{" "}
          {STATE_BADGE[g.state]}
        </span>
      </summary>
      <ol className="tl" aria-label="Actions de la session, de la première à la dernière">
        {g.entries.map((r, i) => (
          <li key={`${r.at}-${r.action}-${i}`} className={r.ok ? "" : "ko"} data-action={r.action}>
            <span className="tl-t mono">{formatTime(r.at)}</span>
            <span className="tl-dot" aria-hidden="true" />
            <span className="tl-body">
              <strong>{r.label}</strong>
              <span className="sub">
                {[r.target, r.detail, r.category].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="tl-res">
              {r.ok ? (
                <Badge tone="success">
                  <Icon name="check" style={small} />
                  Succès
                </Badge>
              ) : (
                <Badge tone="danger">
                  <Icon name="x" style={small} />
                  Échec
                </Badge>
              )}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Journal d'audit, lu sur le serveur : entrées du journal et verdicts de la
 * relecture, groupés par session d'utilisateur (poste, méthode de connexion,
 * état). Le journal est en ajout seul : rien ne s'y modifie ni ne s'y efface.
 * L'export CSV est produit par le serveur, et lui-même journalisé.
 */
export function AdminAuditPage() {
  const toast = useToast();
  const [f, setF] = useState(EMPTY_AUDIT_FILTERS);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authors, setAuthors] = useState([]);
  const [openIds, setOpenIds] = useState({});
  // « Tout déplier » vaut aussi pour les groupes chargés ensuite (changement de filtre),
  // jusqu'à « Tout replier ».
  const [expandAll, setExpandAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAudit(auditParams(f))
      .then((d) => {
        if (cancelled) return;
        setData(d);
        // Liste des auteurs : on garde ceux déjà vus, pour pouvoir changer d'auteur filtré.
        setAuthors((prev) => [...new Map([...prev, ...d.authors].map((a) => [a.id, a])).values()].sort((a, b) => a.name.localeCompare(b.name)));
        // La session la plus récente est dépliée d'emblée.
        if (d.groups[0]) setOpenIds((o) => (Object.keys(o).length ? o : { [d.groups[0].id]: true }));
      })
      .catch((cause) => !cancelled && setError(toAppError(cause)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [f]);

  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const groups = data?.groups ?? [];
  const nSessions = groups.filter((g) => g.state !== "none").length;

  const exportList = async () => {
    setExporting(true);
    try {
      const { blob, fileName } = await fetchAuditCsv(auditParams(f));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Export CSV prêt. L’export est lui-même inscrit au journal.");
    } catch (cause) {
      toast(toAppError(cause).message);
    } finally {
      setExporting(false);
    }
  };

  const blocks = [];
  let day = null;
  groups.forEach((g) => {
    const d0 = localDay(g.lastAt);
    if (d0 !== day) {
      day = d0;
      blocks.push(
        <h3 key={`d${d0}`} className="sess-day">
          {dayLabel(d0)}
        </h3>,
      );
    }
    blocks.push(
      <SessionCard
        key={g.id}
        g={g}
        open={openIds[g.id] ?? expandAll}
        onToggle={(id, open) => setOpenIds((o) => (o[id] === open || (o[id] === undefined && open === expandAll) ? o : { ...o, [id]: open }))}
      />,
    );
  });

  return (
    <AppShell page="admin-audit" title="Journal d’audit" crumbs="Administration" permission={Permission.USER_MANAGE} className="v-admin-audit">
      <div className="page-head">
        <div>
          <h2>Journal d’audit</h2>
          <p>Les actions sont regroupées par session d’utilisateur, verdicts de la relecture compris. Le journal est en ajout seul : aucune entrée ne peut être modifiée ni supprimée.</p>
        </div>
        <Button variant="secondary" onClick={exportList} disabled={exporting || loading || !data?.total}>
          <Icon name="download" />
          {exporting ? "Export…" : "Exporter (CSV)"}
        </Button>
      </div>

      {error ? (
        <Alert tone="danger" role="alert" title="Le journal n’a pas pu être lu.">
          {error.message}
        </Alert>
      ) : null}
      {data?.truncated ? (
        <Alert tone="warning" role="note" title="Liste tronquée">
          La période compte plus d’entrées que l’écran n’en affiche : réduisez-la ou filtrez ; l’export CSV, lui, contient tout.
        </Alert>
      ) : null}

      <section className="card card-pad" aria-label="Filtres" style={{ display: "grid", gap: "var(--space-3)" }}>
        <div className="filters">
          <div className="field">
            <label className="label" htmlFor="f-per">
              Période
            </label>
            <select className="select" id="f-per" value={f.period} onChange={set("period")}>
              <option value="1">Dernières 24 heures</option>
              <option value="3">3 derniers jours</option>
              <option value="7">7 derniers jours</option>
              <option value="30">30 derniers jours</option>
              <option value="90">90 derniers jours</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-aut">
              Auteur
            </label>
            <select className="select" id="f-aut" value={f.author} onChange={set("author")}>
              <option value="">Tous les auteurs</option>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-typ">
              Type d’action
            </label>
            <select className="select" id="f-typ" value={f.category} onChange={set("category")}>
              <option value="">Tous les types</option>
              {(data?.categories ?? []).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-res">
              Résultat
            </label>
            <select className="select" id="f-res" value={f.result} onChange={set("result")}>
              <option value="">Tous les résultats</option>
              <option value="ok">Succès</option>
              <option value="ko">Échec</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <p className="muted" style={{ fontSize: "var(--text-sm)" }} aria-live="polite" data-testid="journal-total">
            {loading
              ? "Lecture du journal…"
              : `${data?.total ?? 0} entrée${(data?.total ?? 0) > 1 ? "s" : ""} dans ${groups.length} groupe${groups.length > 1 ? "s" : ""} (${nSessions} session${nSessions > 1 ? "s" : ""}) correspondant aux filtres.`}
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                setExpandAll(true);
                setOpenIds({});
              }}
            >
              Tout déplier
            </button>
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                setExpandAll(false);
                setOpenIds({});
              }}
            >
              Tout replier
            </button>
          </div>
        </div>
      </section>

      <div>
        {groups.length ? (
          blocks
        ) : !loading && !error ? (
          <div className="card card-pad" style={{ textAlign: "center" }}>
            <p>
              <strong>Aucune entrée ne correspond à ces filtres.</strong>
            </p>
            <p className="muted">Élargissez la période ou retirez un filtre.</p>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
