import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo, useRef, useState } from "react";

import { fetchAdminIndicators, weekDelta } from "@/entities/administration";
import { ANALYSIS_STATUS, fetchAnalyses, formatAnalysisNumber } from "@/entities/analysis";
import { fetchAudit } from "@/entities/audit";
import { DETECTION_TYPES, DetectionLabel } from "@/entities/detection";
import { Permission, displayName, screenProfile, useCurrentUser } from "@/entities/session";
import { fetchStorage, useSystemStatus } from "@/entities/system-status";
import { fetchUsers } from "@/entities/user";
import { formatDate, formatTime, initials, useAsyncResource } from "@/shared/lib";
import { Badge, BarChart, Button, Gauge, Icon, KpiRing, LineChart, ProgressList, lastMonths } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const MONTHS = lastMonths(12);
const noData = () => Promise.resolve(null);

/** Semaines ISO des 12 dernières semaines : « S46 ». */
function lastWeeks(n) {
  const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y) / 864e5 + 1) / 7);
  };
  return Array.from({ length: n }, (_, k) => {
    const d = new Date();
    d.setDate(d.getDate() - 7 * (n - 1 - k));
    return `S${isoWeek(d)}`;
  });
}
const WEEKS = lastWeeks(12);

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

/** Répartition des détections par type (démonstration : le résumé d'analyse n'a pas le détail). */
const TYPES_ITEMS = [
  { label: DetectionLabel.CARIES, value: 38, detail: "28" },
  { label: DetectionLabel.DEEP_CARIES, value: 27, detail: "20" },
  { label: DetectionLabel.PERIAPICAL_LESION, value: 21, detail: "15" },
  { label: DetectionLabel.IMPACTED_TOOTH, value: 14, detail: "10" },
].map((t) => ({ name: DETECTION_TYPES[t.label].label, abbr: DETECTION_TYPES[t.label].abbr, cls: DETECTION_TYPES[t.label].cls, value: t.value, detail: t.detail }));

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

function buildConfig(profile, { name, analyses, users, indicators, storage }) {
  const monthly = monthlyCounts(analyses ?? []);
  const thisMonth = monthly.current[11];
  const lastMonth = monthly.current[10];
  const maxMonth = Math.max(1, ...monthly.current);
  const delta = lastMonth ? `${thisMonth >= lastMonth ? "+" : "−"}${Math.abs(Math.round(((thisMonth - lastMonth) / lastMonth) * 100))} % vs mois dernier` : "Premier mois d’activité";
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
  if (profile === "viewer") {
    return {
      hello: "Bonjour",
      lead: "Vous consultez les analyses clôturées et leurs comptes rendus, en lecture seule.",
      readonly: true,
      kpis: [
        { label: "Analyses ce mois-ci", value: thisMonth, ring: Math.round((thisMonth / maxMonth) * 100), ringText: `${thisMonth} analyses, pour un maximum de ${maxMonth} en un mois sur l’année`, delta, dir: thisMonth >= lastMonth ? "up" : "down", good: true, href: "/historique" },
        { label: "Comptes rendus disponibles", value: 12, ring: 100, ringText: "Tous les comptes rendus des analyses clôturées sont disponibles (démonstration)", delta: "Tous à jour", dir: "flat", tone: "navy", href: "/historique" },
        { label: "Consultées sur 30 jours", value: 21, ring: 58, ringText: "21 consultations sur 36 analyses clôturées (démonstration)", delta: "+5 vs 30 jours précédents", dir: "up" },
        { label: "Détections relues", value: "74 %", ring: 74, ringText: "74 % des détections ont été relues par un praticien (démonstration)", delta: "Moyenne du cabinet", dir: "flat" },
      ],
      line: { title: "Analyses par mois", sub: "Analyses déposées par les praticiens", real: true, series: lineSeries, summary: lineSummary },
      gauge: { title: "Détections relues", sub: "Part des détections relues par un praticien", value: 74, caption: "Moyenne du cabinet sur 12 mois.", icon: "check" },
      prog: { title: "Détections par type", sub: "Répartition sur 12 mois (73 détections)", items: TYPES_ITEMS },
      bars: { title: "Comptes rendus par semaine", sub: "Comptes rendus générés, 12 dernières semaines", name: "Comptes rendus", trendName: "Moyenne sur 3 semaines", values: [2, 3, 1, 4, 3, 4, 2, 3, 3, 5, 3, 2], labels: WEEKS, summary: "Entre 1 et 5 comptes rendus par semaine, 2 cette semaine." },
    };
  }
  const pending = (analyses ?? []).length;
  return {
    hello: `Bonjour, ${name}`,
    lead: "Voici votre activité de relecture. Le modèle propose, vous décidez.",
    cta: true,
    kpis: [
      { label: "Analyses ce mois-ci", value: thisMonth, ring: Math.round((thisMonth / maxMonth) * 100), ringText: `${thisMonth} analyses, pour un maximum de ${maxMonth} en un mois sur l’année`, delta, dir: thisMonth >= lastMonth ? "up" : "down", good: true, href: "/historique" },
      { label: "À relire", value: pending, ring: pending ? Math.min(100, Math.round((pending / Math.max(1, (analyses ?? []).length)) * 100)) : 0, ringText: `${pending} analyses à relire`, delta: "Analyses déposées", dir: "flat", tone: "warning", href: "/historique" },
      { label: "Détections relues", value: 54, ring: 74, ringText: "54 détections relues sur 73 (démonstration)", delta: "+9 cette semaine", dir: "up", good: true, tone: "navy" },
      { label: "Durée moyenne de relecture", value: "6 min 40", ring: 67, ringText: "6 min 40 par analyse sur 30 jours (démonstration)", delta: "−1 min vs mois dernier", dir: "down", good: true },
    ],
    line: { title: "Analyses par mois", sub: "Analyses que vous avez lancées", real: true, series: lineSeries, summary: lineSummary },
    gauge: { title: "Détections relues", sub: "Part des détections sur lesquelles vous avez décidé", value: 74, caption: "54 détections relues sur 73 ; les 19 autres attendent votre décision.", icon: "check" },
    prog: { title: "Détections par type", sub: "Répartition sur 12 mois (73 détections)", items: TYPES_ITEMS },
    bars: { title: "Analyses relues par semaine", sub: "Relectures terminées, 12 dernières semaines", name: "Analyses relues", trendName: "Moyenne sur 3 semaines", values: [3, 4, 2, 5, 4, 6, 3, 5, 4, 7, 5, 4], labels: WEEKS, summary: "Entre 2 et 7 relectures par semaine, 4 cette semaine." },
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
      }),
    [profile, user, analysesRes.data, usersRes.data, indicatorsRes.data, storageRes.data],
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
