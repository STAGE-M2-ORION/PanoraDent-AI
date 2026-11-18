import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo, useRef, useState } from "react";

import { ANALYSIS_STATUS, fetchAnalyses, formatAnalysisNumber } from "@/entities/analysis";
import { DETECTION_TYPES, DetectionLabel } from "@/entities/detection";
import { Permission, displayName, screenProfile, useCurrentUser } from "@/entities/session";
import { useSystemStatus } from "@/entities/system-status";
import { fetchUsers } from "@/entities/user";
import { formatDate, useAsyncResource } from "@/shared/lib";
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

function buildConfig(profile, { name, analyses, users }) {
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
    const active = (users ?? []).filter((u) => u.isActive).length;
    const total = (users ?? []).length;
    return {
      hello: "Bonjour, administrateur",
      lead: "Données agrégées et anonymes : aucune image ni identifiant de patient n’est affiché ici.",
      kpis: [
        { label: "Comptes actifs", value: active, ring: total ? Math.round((active / total) * 100) : null, ringText: `${active} comptes actifs sur ${total} créés`, delta: `${total} comptes au total`, dir: "flat", href: "/admin/comptes" },
        { label: "Demandes d’accès", value: 2, ring: 25, ringText: "2 demandes en attente de traitement (démonstration)", delta: "En attente", dir: "flat", tone: "warning", href: "/admin/comptes" },
        { label: "Connexions cette semaine", value: 41, ring: 82, ringText: "41 connexions, pour un maximum de 50 en une semaine (démonstration)", delta: "+8 % vs semaine dernière", dir: "up", good: true, tone: "navy", href: "/admin/audit" },
        { label: "Échecs de connexion", value: 3, ring: 7, ringText: "3 échecs sur 44 tentatives cette semaine (démonstration)", delta: "−2 vs semaine dernière", dir: "down", good: true, href: "/admin/audit" },
      ],
      line: { title: "Analyses par mois", sub: "Toutes les analyses de la plateforme", real: true, series: lineSeries, summary: lineSummary },
      gauge: { title: "Double vérification", sub: "Comptes ayant activé la vérification en deux étapes", value: 67, caption: "4 comptes sur 6. Rappel à envoyer aux 2 autres.", icon: "shield" },
      prog: {
        title: "Relectures par praticien",
        sub: "Détections relues sur détections reçues, 30 jours",
        items: [
          { name: "Dr Rakoto", value: 82, detail: "45/55" },
          { name: "Dr Andria", value: 64, detail: "29/45" },
          { name: "Dr Hery", value: 45, detail: "18/40" },
          { name: "Dr Voahangy", value: 30, detail: "6/20" },
        ],
      },
      bars: { title: "Nouveaux comptes par mois", sub: "Comptes créés par l’administrateur", name: "Comptes créés", trendName: "Moyenne sur 3 mois", values: [0, 1, 0, 2, 0, 1, 0, 0, 1, 1, 0, 1], labels: MONTHS.labels, year: MONTHS.year, summary: "Entre 0 et 2 comptes créés par mois ; 1 ce mois-ci." },
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
  const inference = !status?.inferenceReachable ? "down" : status.inferenceMode === "mock" ? "slow" : "ok";
  const rows = [
    ["server", "API", status ? api : null],
    ["cpu", "Inférence", status ? inference : null],
    ["database", "Base de données", status ? api : null],
    ["box", "Stockage", status ? api : null],
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
  const [period, setPeriod] = useState(12);
  const [query, setQuery] = useState("");

  const C = useMemo(
    () => buildConfig(profile, { name: displayName(user), analyses: analysesRes.data, users: usersRes.data }),
    [profile, user, analysesRes.data, usersRes.data],
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
              />
            )}
          </DashCard>
          <DashCard span="span-4" title={C.gauge.title} sub={C.gauge.sub} signature exportable={false}>
            {() => <Gauge value={C.gauge.value} label={C.gauge.title} caption={C.gauge.caption} icon={C.gauge.icon} />}
          </DashCard>
          <DashCard span="span-5" title={C.prog.title} sub={C.prog.sub}>
            {(ref) => <ProgressList exportRef={ref} title={C.prog.title} items={C.prog.items} />}
          </DashCard>
          <DashCard span="span-7" title={C.bars.title} sub={C.bars.sub}>
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
                  <h3 id="l-audit">Dernières actions sensibles</h3>
                  <Link href="/admin/audit">
                    Journal d’audit complet
                  </Link>
                </div>
                <div className="table-wrap">
                  <table className="table stack">
                    <caption className="sr-only">Trois dernières actions sensibles (démonstration)</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Acteur</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Aujourd’hui", "09:12", "AD", "Administrateur", "Compte créé : lecteur@demo.panoradent.test"],
                        ["Hier", "16:40", "DR", "Dr Rakoto", "Analyse supprimée"],
                        ["Il y a 3 jours", "11:05", "AD", "Administrateur", "Rôle modifié : praticien → lecteur"],
                      ].map(([d, t, av, who, action]) => (
                        <tr key={action}>
                          <td data-label="Date">
                            <span className="dt">
                              <span className="d">{d}</span>
                              <span className="t">{t}</span>
                            </span>
                          </td>
                          <td data-label="Acteur">
                            <span className="who-chip">
                              <span className="av" aria-hidden="true">
                                {av}
                              </span>
                              {who}
                            </span>
                          </td>
                          <td data-label="Action">{action}</td>
                        </tr>
                      ))}
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
