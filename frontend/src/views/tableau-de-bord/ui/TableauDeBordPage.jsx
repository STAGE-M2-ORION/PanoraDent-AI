import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo, useRef, useState } from "react";

import { fetchActivity, formatDuration, periodDelta, weekLabels } from "@/entities/activity";
import { fetchAdminIndicators, weekDelta } from "@/entities/administration";
import { ANALYSIS_STATUS, fetchAnalyses, formatAnalysisNumber } from "@/entities/analysis";
import { fetchAudit } from "@/entities/audit";
import { DETECTION_TYPES } from "@/entities/detection";
import { Permission, displayName, screenProfile, useCurrentUser } from "@/entities/session";
import { fetchStorage, useSystemStatus } from "@/entities/system-status";
import { fetchUsers } from "@/entities/user";
import { formatDate, formatTime, initials, useAsyncResource } from "@/shared/lib";
import { Badge, BarChart, Button, Gauge, Icon, KpiRing, LineChart, ProgressList, lastMonths } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const MONTHS = lastMonths(12);
const noData = () => Promise.resolve(null);

/** Nombre d'analyses par mois sur 24 mois glissants : [année précédente, 12 derniers mois]. */
function monthlyCounts(analyses) {
  const now = new Date();
  const counts = new Array(24).fill(0);
  analyses.forEach((a) => {
    const d = new Date(`${String(a.createdAt).replace(/Z?$/, "Z")}`);
    const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (diff >= 0 && diff < 24) counts[23 - diff] += 1;
  });
  return { previous: counts.slice(0, 12), current: counts.slice(12) };
}

/** Dernières actions sur les comptes et les rôles (journal d'audit, 30 jours). */
const fetchSensitive = () =>
  fetchAudit({ jours: 30, categorie: "Comptes et rôles" }).then((a) =>
    a.groups
      .flatMap((g) => g.entries.map((e) => ({ ...e, who: g.user.name })))
      .sort((x, y) => (x.at < y.at ? 1 : -1))
      .slice(0, 5),
  );

function formatBytes(bytes) {
  const go = bytes / 1024 ** 3;
  return go >= 1 ? `${go.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go` : `${Math.round(bytes / 1024 ** 2).toLocaleString("fr-FR")} Mo`;
}

function buildConfig(profile, { name, analyses, users, indicators, storage, activity }) {
  const monthly = monthlyCounts(analyses ?? []);
  const thisMonth = monthly.current[11];
  const lineSeries = [
    { name: "12 derniers mois", role: "accent", values: monthly.current },
    { name: "Année précédente", role: "context", values: monthly.previous },
  ];
  const lineSummary = `${thisMonth} analyse${thisMonth > 1 ? "s" : ""} ce mois-ci, ${monthly.previous[11]} il y a un an.`;

  if (profile === "admin") {
    const ind = indicators;
    const acc = ind?.accounts;
    const lg = ind?.logins;
    const months = ind?.newAccounts ?? [];
    const created = months.at(-1)?.count ?? 0;
    const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : null);
    return {
      hello: "Bonjour, administrateur",
      lead: "Données agrégées et anonymes : aucune image ni identifiant de patient n’est affiché ici.",
      kpis: [
        { label: "Comptes actifs", value: acc ? acc.active : "—", ring: acc ? pctOf(acc.active, acc.total) : null, ringText: acc ? `${acc.active} comptes actifs sur ${acc.total} créés` : "Indicateur en cours de lecture", delta: acc ? `${acc.disabled} désactivé${acc.disabled > 1 ? "s" : ""}` : undefined, dir: "flat", href: "/admin/comptes" },
        { label: "Jamais connectés", value: acc ? acc.neverLoggedIn : "—", ring: acc ? pctOf(acc.neverLoggedIn, acc.active) : null, ringText: acc ? `${acc.neverLoggedIn} comptes actifs ne se sont jamais connectés` : "Indicateur en cours de lecture", delta: acc?.neverLoggedIn ? "Liens de première connexion à renvoyer ?" : "Tous se sont déjà connectés", dir: "flat", tone: acc?.neverLoggedIn ? "warning" : undefined, href: "/admin/comptes" },
        { label: "Connexions cette semaine", value: lg ? lg.week : "—", ring: null, ringText: lg ? `${lg.week} connexions réussies en 7 jours` : "Indicateur en cours de lecture", delta: lg ? weekDelta(lg.week, lg.lastWeek) : undefined, dir: !lg || lg.week === lg.lastWeek ? "flat" : lg.week > lg.lastWeek ? "up" : "down", tone: "navy", href: "/admin/audit" },
        { label: "Échecs de connexion", value: lg ? lg.failures : "—", ring: lg ? pctOf(lg.failures, lg.week + lg.failures) : null, ringText: lg ? `${lg.failures} échecs sur ${lg.week + lg.failures} tentatives en 7 jours` : "Indicateur en cours de lecture", delta: lg ? weekDelta(lg.failures, lg.lastWeekFailures) : undefined, dir: !lg || lg.failures === lg.lastWeekFailures ? "flat" : lg.failures > lg.lastWeekFailures ? "up" : "down", good: lg ? lg.failures <= lg.lastWeekFailures : undefined, href: "/admin/audit" },
      ],
      line: { title: "Analyses par mois", sub: `Toutes les analyses de la plateforme · ${ind ? `${ind.analyses.thisMonth} ce mois-ci` : ""}`, real: true, series: lineSeries, summary: lineSummary },
      gauge: storage
        ? { title: "Espace occupé", sub: "Images, logos et documents, par rapport au seuil d’alerte", real: true, value: Math.min(100, pctOf(storage.bytes, storage.thresholdBytes) ?? 0), caption: `${formatBytes(storage.bytes)} sur un seuil d’alerte de ${formatBytes(storage.thresholdBytes)} (${storage.objects} fichiers).`, icon: "database" }
        : { title: "Espace occupé", sub: "Le stockage ne répond pas", real: true, value: 0, caption: "Le volume occupé s’affichera dès que le stockage répondra.", icon: "database" },
      prog: {
        title: "Comptes par rôle",
        sub: "Part des comptes, actifs sur total",
        real: true,
        items: (acc?.byRole ?? []).map((r) => ({ name: r.role, value: pctOf(r.total, acc.total) ?? 0, detail: `${r.active}/${r.total}` })),
      },
      bars: {
        title: "Nouveaux comptes par mois",
        sub: "Comptes créés par l’administrateur",
        real: true,
        name: "Comptes créés",
        trendName: "Moyenne sur 3 mois",
        values: months.length ? months.map((m) => m.count) : new Array(12).fill(0),
        labels: MONTHS.labels,
        year: MONTHS.year,
        summary: `${months.reduce((t, m) => t + m.count, 0)} comptes créés en 12 mois, ${created} ce mois-ci.`,
      },
    };
  }
  // Praticien et lecteur : activité comptée par le serveur (portée « moi » ou « cabinet »).
  const act = activity;
  const an = act?.analyses;
  const det = act?.detections;
  const reading = "Indicateur en cours de lecture";
  const kpiMonth = {
    label: "Analyses ce mois-ci",
    value: an ? an.thisMonth : "—",
    ring: an ? Math.round((an.thisMonth / Math.max(1, an.thisMonth, an.lastMonth)) * 100) : null,
    ringText: an ? `${an.thisMonth} analyses ce mois-ci, ${an.lastMonth} le mois dernier` : reading,
    delta: an ? (an.lastMonth ? `${an.thisMonth >= an.lastMonth ? "+" : "−"}${Math.abs(an.thisMonth - an.lastMonth)} vs mois dernier` : "Premier mois d’activité") : undefined,
    dir: !an || an.thisMonth === an.lastMonth ? "flat" : an.thisMonth > an.lastMonth ? "up" : "down",
    good: true,
    href: "/historique",
  };
  const kpiReviewed = {
    label: "Détections relues",
    value: det?.pct != null ? `${det.pct} %` : "—",
    ring: det?.pct ?? null,
    ringText: det ? (det.proposed ? `${det.reviewed} détections relues sur ${det.proposed} proposées en 12 mois` : "Aucune détection proposée en 12 mois") : reading,
    delta: det ? (det.pending ? `${det.pending} en attente d’un verdict` : "Aucune en attente") : undefined,
    dir: "flat",
    tone: "navy",
  };
  const types = act?.types ?? [];
  const totalTypes = types.reduce((t, x) => t + x.count, 0);
  const prog = {
    title: "Anomalies retenues par type",
    sub: totalTypes ? `Répartition sur 12 mois (${totalTypes} anomalie${totalTypes > 1 ? "s" : ""})` : "Aucune anomalie retenue sur 12 mois",
    real: true,
    items: types.map((t) => {
      const type = DETECTION_TYPES[t.label];
      return { name: type?.label ?? t.label, abbr: type?.abbr, cls: type?.cls, value: Math.round((t.count / totalTypes) * 100), detail: String(t.count) };
    }),
  };
  const gauge = {
    title: "Détections relues",
    real: true,
    value: det?.pct ?? 0,
    icon: "check",
    caption: !det
      ? reading
      : det.proposed
        ? `${det.reviewed} détections relues sur ${det.proposed} ; ${det.pending ? `les ${det.pending} autres attendent un verdict` : "aucune n’attend de verdict"}.`
        : "Aucune détection proposée sur 12 mois.",
  };
  const weeks = act?.weeks ?? [];
  const weekBars = (key, name, unit, units) => {
    const values = weeks.length ? weeks.map((w) => w[key]) : new Array(12).fill(0);
    const total = values.reduce((t, v) => t + v, 0);
    return {
      name,
      real: true,
      trendName: "Moyenne sur 3 semaines",
      values,
      labels: weeks.length ? weekLabels(weeks) : new Array(12).fill(""),
      summary: `${total} ${total > 1 ? units : unit} en 12 semaines, ${values.at(-1)} cette semaine.`,
    };
  };

  if (profile === "viewer") {
    const rep = act?.reports;
    return {
      hello: "Bonjour",
      lead: "Vous consultez les analyses clôturées et leurs comptes rendus, en lecture seule.",
      readonly: true,
      kpis: [
        kpiMonth,
        { label: "Comptes rendus disponibles", value: an ? an.closed : "—", ring: null, ringText: an ? `${an.closed} analyses clôturées, chacune avec son compte rendu` : reading, delta: an ? `${an.toReview} en relecture` : undefined, dir: "flat", tone: "navy", href: "/historique" },
        { label: "Comptes rendus téléchargés", value: rep ? rep.last30 : "—", ring: null, ringText: rep ? `${rep.last30} comptes rendus téléchargés en 30 jours` : reading, delta: rep ? periodDelta(rep.last30, rep.previous30) : undefined, dir: !rep || rep.last30 === rep.previous30 ? "flat" : rep.last30 > rep.previous30 ? "up" : "down" },
        { ...kpiReviewed, tone: undefined },
      ],
      line: { title: "Analyses par mois", sub: "Analyses déposées par les praticiens", real: true, series: lineSeries, summary: lineSummary },
      gauge: { ...gauge, sub: "Part des détections relues par un praticien, cabinet, 12 mois" },
      prog,
      bars: { title: "Comptes rendus par semaine", sub: "Comptes rendus téléchargés, 12 dernières semaines", ...weekBars("reports", "Comptes rendus", "compte rendu", "comptes rendus") },
    };
  }
  return {
    hello: `Bonjour, ${name}`,
    lead: "Voici votre activité de relecture. Le modèle propose, vous décidez.",
    cta: true,
    kpis: [
      kpiMonth,
      { label: "À relire", value: an ? an.toReview : "—", ring: an ? Math.round((an.toReview / Math.max(1, an.toReview + an.closed)) * 100) : null, ringText: an ? `${an.toReview} analyses terminées à relire, ${an.closed} clôturées` : reading, delta: an ? (an.inProgress ? `${an.inProgress} en cours de traitement` : "Aucune en traitement") : undefined, dir: "flat", tone: "warning", href: "/historique" },
      kpiReviewed,
      { label: "Délai moyen avant clôture", value: act ? formatDuration(act.meanCloseSeconds) : "—", ring: null, ringText: act ? (act.meanCloseSeconds == null ? "Aucune analyse clôturée sur 30 jours" : `${formatDuration(act.meanCloseSeconds)} en moyenne entre la fin du traitement et la clôture, sur 30 jours`) : reading, delta: "Fin du traitement → clôture, 30 jours", dir: "flat" },
    ],
    line: { title: "Analyses par mois", sub: "Analyses que vous avez lancées", real: true, series: lineSeries, summary: lineSummary },
    gauge: { ...gauge, sub: "Part des détections sur lesquelles vous avez décidé, 12 mois" },
    prog,
    bars: { title: "Analyses clôturées par semaine", sub: "Vos clôtures, 12 dernières semaines", ...weekBars("closed", "Analyses clôturées", "analyse clôturée", "analyses clôturées") },
  };
}

function DashCard({ span, title, sub, signature, exportable = true, real, children }) {
  const exportRef = useRef(null);
  const id = `c-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section className={`dcard ${span}${signature ? " signature" : ""}`} aria-labelledby={id}>
      <div className="dcard-h">
        <div>
          <h3 id={id}>{title}</h3>
          <p>
            {sub}
            {real ? null : (
              <>
                {" · "}
                <span className="fict">données fictives</span>
              </>
            )}
          </p>
        </div>
        {exportable ? (
          <button ref={exportRef} type="button" className="icon-btn" aria-label={`Exporter les données de « ${title} » en CSV`}>
            <Icon name="download" />
          </button>
        ) : null}
      </div>
      <div>{children(exportRef)}</div>
    </section>
  );
}

function AnalysisRow({ analysis, action }) {
  const status = ANALYSIS_STATUS[analysis.status];
  return (
    <li>
      <div className="who">
        <strong>
          Analyse n° <span className="mono">{formatAnalysisNumber(analysis.number)}</span> · ID <span className="mono">{analysis.ref}</span>
        </strong>
        <span>
          {formatDate(analysis.createdAt)} · {analysis.detectionCount} détection{analysis.detectionCount > 1 ? "s" : ""}
        </span>
      </div>
      <div className="rowl">
        <Badge tone={status.tone}>{status.label}</Badge>
        <Button size="sm" variant="secondary" href={`/analyse?id=${analysis.id}`}>
          {action}
          <span className="sr-only"> l’analyse n° {formatAnalysisNumber(analysis.number)}</span>
        </Button>
      </div>
    </li>
  );
}

const SERVICE_BADGE = { ok: ["success", "Opérationnel"], slow: ["warning", "Mode démonstration"], down: ["danger", "Indisponible"] };

function ServiceStatus() {
  const status = useSystemStatus();
  const api = status?.isOnline ? "ok" : "down";
  // État de chaque sonde du serveur (sprint 11) ; serveur injoignable : tout est en panne.
  const probe = (key) => (!status?.isOnline ? "down" : { ok: "ok", degrade: "slow", panne: "down" }[status.services?.[key]] ?? "down");
  const rows = [
    ["server", "API", status ? api : null],
    ["cpu", "Inférence", status ? probe("inference") : null],
    ["database", "Base de données", status ? probe("base") : null],
    ["box", "Stockage", status ? probe("stockage") : null],
  ];
  return (
    <ul className="svc">
      {rows.map(([icon, label, state]) => (
        <li key={label}>
          <Icon name={icon} />
          {label}
          {state ? (
            <Badge tone={SERVICE_BADGE[state][0]} dot>
              {SERVICE_BADGE[state][1]}
            </Badge>
          ) : (
            <Badge>Vérification…</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Tableau de bord : indicateurs, graphiques et listes utiles, selon le profil. */
export function TableauDeBordPage() {
  const router = useRouter();
  const { user, can } = useCurrentUser();
  const profile = screenProfile(user);
  const analysesRes = useAsyncResource(can(Permission.ANALYSIS_READ) ? fetchAnalyses : noData);
  const usersRes = useAsyncResource(can(Permission.USER_MANAGE) ? fetchUsers : noData);
  const indicatorsRes = useAsyncResource(can(Permission.USER_MANAGE) ? fetchAdminIndicators : noData);
  const storageRes = useAsyncResource(can(Permission.USER_MANAGE) ? fetchStorage : noData);
  const sensitiveRes = useAsyncResource(can(Permission.USER_MANAGE) ? fetchSensitive : noData);
  const activityRes = useAsyncResource(profile !== "admin" && can(Permission.ANALYSIS_READ) ? fetchActivity : noData);
  const [period, setPeriod] = useState(12);
  const [query, setQuery] = useState("");

  const C = useMemo(
    () =>
      buildConfig(profile, {
        name: displayName(user),
        analyses: analysesRes.data,
        users: usersRes.data,
        indicators: indicatorsRes.data,
        storage: storageRes.data,
        activity: activityRes.data,
      }),
    [profile, user, analysesRes.data, usersRes.data, indicatorsRes.data, storageRes.data, activityRes.data],
  );
  const recent = analysesRes.data ?? [];
  const sl = (a) => a.slice(a.length - period);
  const nb = period === 12 ? 12 : period === 6 ? 8 : 4;

  return (
    <AppShell page="tableau-de-bord" title="Tableau de bord" className="v-tableau-de-bord">
      <div className="dash">
        <div className="dash-head">
          <div className="dash-hello">
            <h2>{C.hello}</h2>
            <p>{C.lead}</p>
            {C.readonly ? (
              <p>
                <Badge tone="info" className="ro">
                  <Icon name="eye" />
                  Accès en lecture seule
                </Badge>
              </p>
            ) : null}
          </div>
          <div className="dash-tools">
            <label className="sr-only" htmlFor="periode">
              Période des graphiques
            </label>
            <select className="tool" id="periode" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              <option value="12">12 derniers mois</option>
              <option value="6">6 derniers mois</option>
              <option value="3">3 derniers mois</option>
            </select>
            <form
              className="dash-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                router.push({ pathname: "/historique", query: query.trim() ? { q: query.trim() } : {} });
              }}
            >
              <label className="sr-only" htmlFor="q">
                Rechercher une analyse
              </label>
              <Icon name="search" />
              <input className="tool" id="q" name="q" type="search" placeholder="Rechercher un ID (ex. 7F3A)" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
            </form>
          </div>
        </div>

        <div className="dash-sec-h">
          <h3>Vue d’ensemble</h3>
          {C.cta ? (
            <Button href="/nouvelle-analyse">
              <Icon name="plus" />
              Nouvelle analyse
            </Button>
          ) : null}
        </div>
        <section className="kpi-row" aria-label="Indicateurs clés">
          {C.kpis.map((k) => (
            <KpiRing key={k.label} {...k} />
          ))}
        </section>

        <div className="dash-grid" key={period}>
          <DashCard span="span-8" title={C.line.title} sub={C.line.sub} real={C.line.real}>
            {(ref) => (
              <LineChart
                exportRef={ref}
                title={C.line.title}
                labels={sl(MONTHS.labels)}
                year={sl(MONTHS.year)}
                summary={C.line.summary}
                series={C.line.series.map((s) => ({ ...s, values: sl(s.values) }))}
                fictive={!C.line.real}
              />
            )}
          </DashCard>
          <DashCard span="span-4" title={C.gauge.title} sub={C.gauge.sub} signature exportable={false} real={C.gauge.real}>
            {() => <Gauge value={C.gauge.value} label={C.gauge.title} caption={C.gauge.caption} icon={C.gauge.icon} />}
          </DashCard>
          <DashCard span="span-5" title={C.prog.title} sub={C.prog.sub} real={C.prog.real}>
            {(ref) => <ProgressList exportRef={ref} title={C.prog.title} items={C.prog.items} fictive={!C.prog.real} />}
          </DashCard>
          <DashCard span="span-7" title={C.bars.title} sub={C.bars.sub} real={C.bars.real}>
            {(ref) => (
              <BarChart
                exportRef={ref}
                title={C.bars.title}
                labels={C.bars.labels.slice(-nb)}
                year={C.bars.year ? C.bars.year.slice(-nb) : null}
                values={C.bars.values.slice(-nb)}
                name={C.bars.name}
                trendName={C.bars.trendName}
                summary={C.bars.summary}
                fictive={!C.bars.real}
              />
            )}
          </DashCard>
        </div>

        <div className="dash-grid">
          {profile === "practitioner" ? (
            <>
              <section className="dcard span-5" aria-labelledby="l-relire">
                <div className="dcard-h">
                  <h3 id="l-relire">À relire</h3>
                  <Badge tone="warning">
                    {recent.length} analyse{recent.length > 1 ? "s" : ""}
                  </Badge>
                </div>
                <ul className="list">
                  {recent.slice(0, 2).map((a, i) => (
                    <li key={a.id}>
                      <div className="who">
                        <strong>
                          Analyse n° <span className="mono">{formatAnalysisNumber(a.number)}</span> · ID <span className="mono">{a.ref}</span>
                        </strong>
                        <span>
                          À relire · {a.detectionCount} détection{a.detectionCount > 1 ? "s" : ""}
                        </span>
                      </div>
                      <Button size="sm" variant={i === 0 ? "primary" : "secondary"} href={`/analyse?id=${a.id}`}>
                        {i === 0 ? "Reprendre" : "Commencer"}
                        <span className="sr-only"> la relecture de l’analyse n° {formatAnalysisNumber(a.number)}</span>
                      </Button>
                    </li>
                  ))}
                  {recent.length === 0 && !analysesRes.isLoading ? <li className="muted">Aucune analyse à relire.</li> : null}
                </ul>
              </section>
              <section className="dcard span-7" aria-labelledby="l-dernieres">
                <div className="dcard-h">
                  <h3 id="l-dernieres">Dernières analyses</h3>
                  <Link href="/historique">
                    Voir tout l’historique
                  </Link>
                </div>
                <ul className="list">
                  {recent.slice(0, 4).map((a) => (
                    <AnalysisRow key={a.id} analysis={a} action="Ouvrir" />
                  ))}
                  {recent.length === 0 && !analysesRes.isLoading ? <li className="muted">Aucune analyse pour le moment.</li> : null}
                </ul>
              </section>
            </>
          ) : null}

          {profile === "viewer" ? (
            <section className="dcard span-12" aria-labelledby="l-closes">
              <div className="dcard-h">
                <h3 id="l-closes">Dernières analyses</h3>
                <Link href="/historique">
                  Voir tout l’historique
                </Link>
              </div>
              <ul className="list">
                {recent.slice(0, 5).map((a) => (
                  <AnalysisRow key={a.id} analysis={a} action="Consulter" />
                ))}
                {recent.length === 0 && !analysesRes.isLoading ? <li className="muted">Aucune analyse pour le moment.</li> : null}
              </ul>
            </section>
          ) : null}

          {profile === "admin" ? (
            <>
              <section className="dcard span-5" aria-labelledby="l-svc">
                <div className="dcard-h">
                  <h3 id="l-svc">État des services</h3>
                  <Link href="/admin/supervision">
                    Ouvrir la supervision
                  </Link>
                </div>
                <ServiceStatus />
              </section>
              <section className="dcard span-7" aria-labelledby="l-audit">
                <div className="dcard-h">
                  <h3 id="l-audit">Dernières actions sur les comptes</h3>
                  <Link href="/admin/audit">
                    Journal d’audit complet
                  </Link>
                </div>
                <div className="table-wrap">
                  <table className="table stack">
                    <caption className="sr-only">Dernières actions sur les comptes et les rôles, 30 jours</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Acteur</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sensitiveRes.data ?? []).map((e) => (
                        <tr key={e.id}>
                          <td data-label="Date">
                            <span className="dt">
                              <span className="d">{formatDate(e.at)}</span>
                              <span className="t">{formatTime(e.at)}</span>
                            </span>
                          </td>
                          <td data-label="Acteur">
                            <span className="who-chip">
                              <span className="av" aria-hidden="true">
                                {initials(e.who)}
                              </span>
                              {e.who}
                            </span>
                          </td>
                          <td data-label="Action">{[e.label, e.target].filter(Boolean).join(" · ")}</td>
                        </tr>
                      ))}
                      {sensitiveRes.data && !sensitiveRes.data.length ? (
                        <tr>
                          <td colSpan={3} className="muted">
                            Aucune action sur les comptes ou les rôles depuis 30 jours.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
