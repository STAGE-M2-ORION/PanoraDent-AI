import { useMemo, useState } from "react";

import { Permission } from "@/entities/session";
import { AUDIT_AUTHORS, AUDIT_ENTRIES, AUDIT_SESSIONS, AUDIT_TYPES, daysAgo } from "@/shared/demo";
import { formatDate, initials } from "@/shared/lib";
import { Alert, Badge, Button, GoogleMark, Icon, exportCsv } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const minutes = (hm) => {
  const [h, m] = hm.split(":");
  return Number(h) * 60 + Number(m);
};
const duration = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
const dayLabel = (n) => `${n === 0 ? "Aujourd’hui" : n === 1 ? "Hier" : `Il y a ${n} jours`} · ${formatDate(daysAgo(n))}`;
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
  none: (
    <Badge tone="danger">
      <Icon name="lock" style={small} />
      Aucune session ouverte
    </Badge>
  ),
};

function Method({ method }) {
  return method === "google" ? (
    <span className="method" title="Connexion avec Google">
      <GoogleMark />
      <span className="sr-only">Google</span>
    </span>
  ) : (
    <span className="method" title="Connexion par e-mail">
      <Icon name="mail" />
      <span className="sr-only">E-mail</span>
    </span>
  );
}

function SessionCard({ id, items, total, open, onToggle }) {
  const S = AUDIT_SESSIONS[id];
  const list = [...items].sort((a, b) => minutes(a.time) - minutes(b.time));
  const first = list[0];
  const last = list[list.length - 1];
  const ko = list.filter((r) => r.result !== "ok").length;
  const span = minutes(last.time) - minutes(first.time);
  return (
    <details className="sess" open={open} onToggle={(e) => onToggle(id, e.currentTarget.open)}>
      <summary>
        <span className="sess-chev" aria-hidden="true">
          <Icon name="chevrondown" />
        </span>
        <span className="sess-who">
          <span className="av" aria-hidden="true">
            {initials(S.who)}
          </span>
          <span>
            <strong>{S.who}</strong>
            <span className="sub">{S.title ?? `Session n° ${S.n}`}</span>
          </span>
        </span>
        <span className="sess-when">
          <span className="dt">
            <span className="d">{formatDate(daysAgo(first.days))}</span>
            <span className="t">
              {first.time}
              {span ? ` → ${last.time}` : ""}
            </span>
          </span>
          {S.state !== "none" && span ? <span className="sess-dur mono">{duration(span)}</span> : null}
        </span>
        <span className="sess-chips">
          <span className="id-chip">{S.poste}</span>
          <Method method={S.method} />
        </span>
        <span className="sess-end">
          <Badge>
            {list.length}
            {list.length < total ? ` sur ${total}` : ""} action{total > 1 ? "s" : ""}
          </Badge>
          {ko ? (
            <Badge tone="danger">
              {ko} échec{ko > 1 ? "s" : ""}
            </Badge>
          ) : null}{" "}
          {STATE_BADGE[S.state]}
        </span>
      </summary>
      <ol className="tl" aria-label="Actions de la session, de la première à la dernière">
        {list.map((r) => (
          <li key={`${r.time}${r.action}${r.target}`} className={r.result === "ok" ? "" : "ko"}>
            <span className="tl-t mono">{r.time}</span>
            <span className="tl-dot" aria-hidden="true" />
            <span className="tl-body">
              <strong>{r.action}</strong>
              <span className="sub">
                {r.target}
                {r.detail ? ` · ${r.detail}` : ""}
              </span>
            </span>
            <span className="tl-res">
              {r.result === "ok" ? (
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

/** Journal d'audit groupé par session (données de démonstration). */
export function AdminAuditPage() {
  const [f, setF] = useState({ period: "7", author: "", type: "", result: "" });
  const [openIds, setOpenIds] = useState({ s1: true });
  const [exported, setExported] = useState(false);

  const list = useMemo(
    () => AUDIT_ENTRIES.filter((e) => e.days < Number(f.period) && (!f.author || e.author === f.author) && (!f.type || e.type === f.type) && (!f.result || e.result === f.result)),
    [f],
  );
  const groups = useMemo(() => {
    const by = {};
    const order = [];
    list.forEach((e) => {
      if (!by[e.session]) {
        by[e.session] = [];
        order.push(e.session);
      }
      by[e.session].push(e);
    });
    const key = (id) => Math.min(...by[id].map((e) => e.days * 1440 - minutes(e.time)));
    order.sort((a, b) => key(a) - key(b));
    return { by, order };
  }, [list]);
  const nSessions = groups.order.filter((id) => AUDIT_SESSIONS[id].state !== "none").length;
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));

  let day = null;
  const blocks = [];
  groups.order.forEach((id) => {
    const items = groups.by[id];
    const d0 = Math.min(...items.map((e) => e.days));
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
        key={id}
        id={id}
        items={items}
        total={AUDIT_ENTRIES.filter((e) => e.session === id).length}
        open={Boolean(openIds[id])}
        onToggle={(sid, open) => setOpenIds((o) => ({ ...o, [sid]: open }))}
      />,
    );
  });

  const exportList = () => {
    exportCsv(
      "journal-audit",
      ["Date", "Heure", "Auteur", "Action", "Cible", "Détail", "Poste", "Type", "Résultat", "Session"],
      list.map((e) => [formatDate(daysAgo(e.days)), e.time, e.author, e.action, e.target, e.detail, e.poste, e.type, e.result === "ok" ? "Succès" : "Échec", AUDIT_SESSIONS[e.session].n ?? "—"]),
    );
    setExported(true);
  };

  return (
    <AppShell page="admin-audit" title="Journal d’audit" crumbs="Administration" permission={Permission.USER_MANAGE} className="v-admin-audit">
      <Alert tone="warning" role="note" title="Données de démonstration">
        Le serveur n’enregistre pas encore de journal d’audit : les sessions ci-dessous sont fictives et illustrent l’écran prévu.
      </Alert>

      <div className="page-head">
        <div>
          <h2>Journal d’audit</h2>
          <p>Les actions sont regroupées par session d’utilisateur. Le journal est en ajout seul : aucune entrée ne peut être modifiée ni supprimée.</p>
        </div>
        <Button variant="secondary" onClick={exportList}>
          <Icon name="download" />
          Exporter (CSV)
        </Button>
      </div>

      <div aria-live="polite">
        {exported ? (
          <Alert tone="success" icon="check" title="Export prêt" role="status">
            Le fichier CSV contient une ligne par entrée correspondant aux filtres, avec le numéro de session.
          </Alert>
        ) : null}
      </div>

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
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-aut">
              Auteur
            </label>
            <select className="select" id="f-aut" value={f.author} onChange={set("author")}>
              <option value="">Tous les auteurs</option>
              {AUDIT_AUTHORS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-typ">
              Type d’action
            </label>
            <select className="select" id="f-typ" value={f.type} onChange={set("type")}>
              <option value="">Tous les types</option>
              {AUDIT_TYPES.map((t) => (
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
          <p className="muted" style={{ fontSize: "var(--text-sm)" }} aria-live="polite">
            {list.length} entrée{list.length > 1 ? "s" : ""} dans {groups.order.length} groupe{groups.order.length > 1 ? "s" : ""} ({nSessions} session{nSessions > 1 ? "s" : ""}) correspondant aux filtres.
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setOpenIds(Object.fromEntries(groups.order.map((id) => [id, true])))}>
              Tout déplier
            </button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setOpenIds({})}>
              Tout replier
            </button>
          </div>
        </div>
      </section>

      <div>
        {list.length ? (
          blocks
        ) : (
          <div className="card card-pad" style={{ textAlign: "center" }}>
            <p>
              <strong>Aucune entrée ne correspond à ces filtres.</strong>
            </p>
            <p className="muted">Élargissez la période ou retirez un filtre.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
