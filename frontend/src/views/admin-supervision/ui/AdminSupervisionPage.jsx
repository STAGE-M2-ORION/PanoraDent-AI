import { useCallback, useEffect, useRef, useState } from "react";

import { Permission } from "@/entities/session";
import { fetchSystemStatus } from "@/entities/system-status";
import { Alert, Badge, BarChart, Button, Gauge, Icon, KpiRing, LineChart, ProgressList } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const WORD = { ok: "Opérationnel", deg: "Dégradé", down: "Hors service", unknown: "Non surveillé" };
const BADGE = { ok: ["success", "check"], deg: ["warning", "alert"], down: ["danger", "x"], unknown: [undefined, "info"] };

/** Lecture réelle de `/api/health`, chronométrée côté navigateur. */
async function probe() {
  const t0 = performance.now();
  try {
    const status = await fetchSystemStatus();
    return { status, ms: Math.round(performance.now() - t0) };
  } catch {
    return { status: null, ms: null };
  }
}

function servicesFrom(result) {
  const { status, ms } = result;
  const api = status?.isOnline ? "ok" : "down";
  const inference = !status ? "down" : !status.inferenceReachable ? "down" : status.services?.inference === "degrade" ? "deg" : "ok";
  return [
    { k: "api", name: "API", icon: "server", st: api, ms: ms != null ? `${ms} ms` : "Aucune réponse", detail: api === "ok" ? "Requêtes traitées normalement." : "Le service ne répond pas. Les fonctions qui en dépendent sont indisponibles." },
    {
      k: "inf",
      name: "Service d’inférence",
      icon: "cpu",
      st: inference,
      ms: inference === "down" ? "Aucune réponse" : "—",
      detail: inference === "deg" ? "Mode démonstration : le modèle n’est pas chargé, les détections sont factices." : inference === "ok" ? "Modèle chargé · fonctionnement normal." : "Le service d’inférence ne répond pas.",
    },
    { k: "db", name: "Base de données", icon: "database", st: "unknown", ms: "—", detail: "État non exposé par l’API : sondé indirectement par les requêtes de l’application." },
    { k: "sto", name: "Stockage des images", icon: "box", st: "unknown", ms: "—", detail: "État non exposé par l’API (stockage objet)." },
  ];
}

const DAYS = Array.from({ length: 14 }, (_, k) => {
  const d = new Date();
  d.setDate(d.getDate() - (13 - k));
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
});
const HIST = { api: { 28: "deg" }, inf: { 29: "deg", 24: "deg", 17: "deg" }, db: { 25: "down" }, sto: {} };

function DemoCard({ span, title, sub, signature, exportable = true, children }) {
  const ref = useRef(null);
  return (
    <section className={`dcard ${span}${signature ? " signature" : ""}`} aria-label={title}>
      <div className="dcard-h">
        <div>
          <h3>{title}</h3>
          <p>
            {sub} · <span className="fict">données fictives</span>
          </p>
        </div>
        {exportable ? (
          <button ref={ref} type="button" className="icon-btn" aria-label={`Exporter les données de « ${title} » en CSV`}>
            <Icon name="download" />
          </button>
        ) : null}
      </div>
      <div>{children(ref)}</div>
    </section>
  );
}

/** Supervision : état réel de l'API et de l'inférence, tableaux de bord de démonstration. */
export function AdminSupervisionPage() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const check = useCallback(async () => {
    setBusy(true);
    setResult(await probe());
    setCheckedAt(Date.now());
    setBusy(false);
  }, []);

  useEffect(() => {
    check();
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [check]);

  const since = checkedAt ? Math.round((now - checkedAt) / 1000) : null;
  const lastTxt = since == null ? "en cours" : since < 10 ? "à l’instant" : `il y a ${since} s`;
  const services = result ? servicesFrom(result) : [];

  return (
    <AppShell page="admin-supervision" title="Supervision" crumbs="Administration" permission={Permission.USER_MANAGE} className="v-admin-supervision">
      <div className="page-head">
        <div>
          <h2>État des services</h2>
          <p>Dernière vérification : {lastTxt}</p>
        </div>
        <Button onClick={check} disabled={busy}>
          <Icon name="refresh" />
          {busy ? "Vérification…" : "Vérifier maintenant"}
        </Button>
      </div>

      <Alert tone="info" role="note" icon="shield">
        Les images ne quittent jamais le serveur : l’inférence tourne localement.
      </Alert>

      <section className="kpi-row" aria-label="Indicateurs de supervision (valeurs fictives)">
        <KpiRing label="Disponibilité sur 30 jours" icon="activity" value="99,6 %" ring={99.6} ringText="99,6 % du temps, tous services confondus (démonstration)" delta="−0,2 pt vs mois dernier" dir="down" good={false} />
        <KpiRing label="Temps de réponse médian de l’inférence" icon="clock" value="1,8 s" ring={60} ringText="1,8 s, pour un seuil d’alerte de 3 s (démonstration)" delta="+0,6 s depuis 6 h" dir="up" good={false} tone="warning" />
        <KpiRing label="Analyses traitées aujourd’hui" icon="detect" value={12} ring={57} ringText="12 analyses, pour un maximum de 21 en une journée (démonstration)" delta="+3 vs hier" dir="up" good tone="navy" />
        <KpiRing label="Incidents ouverts" icon="alert" value={1} ring={33} ringText="1 incident ouvert sur 3 en 7 jours (démonstration)" delta="Inférence ralentie" dir="flat" tone="warning" />
      </section>

      <div className="dash-grid">
        <DemoCard span="span-8" title="Temps de réponse de l’inférence" sub="Médiane par jour, en secondes, 14 derniers jours">
          {(ref) => (
            <LineChart
              exportRef={ref}
              title="Temps de réponse de l’inférence"
              labels={DAYS}
              unit="s"
              summary="Stable autour de 1,2 s, puis en hausse à 1,8 s aujourd’hui, sous le seuil d’alerte de 3 s."
              series={[
                { name: "Médiane du jour", role: "accent", values: [1.2, 1.1, 1.3, 1.2, 1.2, 1.4, 1.1, 1.2, 1.3, 1.2, 1.2, 1.3, 1.5, 1.8] },
                { name: "Même jour, semaine précédente", role: "context", values: [1.1, 1.2, 1.2, 1.1, 1.3, 1.2, 1.2, 1.2, 1.1, 1.3, 1.2, 1.1, 1.2, 1.3] },
              ]}
            />
          )}
        </DemoCard>
        <DemoCard span="span-4" title="Espace disque" sub="Images et comptes rendus stockés sur le serveur" signature exportable={false}>
          {() => <Gauge value={6} label="Espace disque utilisé" caption="1,2 Go utilisés sur 20 Go (214 images)." icon="database" />}
        </DemoCard>
        <DemoCard span="span-5" title="Charge des services" sub="Utilisation moyenne sur la dernière heure">
          {(ref) => (
            <ProgressList
              exportRef={ref}
              title="Charge des services"
              items={[
                { name: "Processeur · inférence", value: 72 },
                { name: "Mémoire · inférence", value: 58 },
                { name: "Processeur · API", value: 21 },
                { name: "Connexions · base de données", value: 14 },
              ]}
            />
          )}
        </DemoCard>
        <DemoCard span="span-7" title="Analyses traitées par jour" sub="Radiographies analysées par le modèle, 14 derniers jours">
          {(ref) => (
            <BarChart
              exportRef={ref}
              title="Analyses traitées par jour"
              labels={DAYS}
              values={[8, 11, 6, 14, 9, 3, 2, 12, 15, 21, 13, 4, 9, 12]}
              name="Analyses traitées"
              trendName="Moyenne sur 3 jours"
              summary="Entre 2 et 21 analyses par jour, 12 aujourd’hui ; moins le week-end."
            />
          )}
        </DemoCard>
      </div>

      <div className="svc-grid" aria-live="polite">
        {busy && !result
          ? [0, 1, 2, 3].map((i) => (
              <article key={i} className="card card-pad svc" aria-busy="true">
                <div className="skeleton" style={{ height: 20, width: "60%" }} />
                <div className="skeleton" style={{ height: 24, width: "40%" }} />
                <div className="skeleton" style={{ height: 44 }} />
                <div className="skeleton" style={{ height: 16, width: "80%" }} />
              </article>
            ))
          : services.map((s) => (
              <article key={s.k} className="card card-pad svc">
                <div className="svc-head">
                  <Icon name={s.icon} />
                  <h3>{s.name}</h3>
                </div>
                <Badge tone={BADGE[s.st][0]} style={{ justifySelf: "start" }}>
                  <Icon name={BADGE[s.st][1]} style={{ width: 13, height: 13 }} />
                  {WORD[s.st]}
                </Badge>
                <dl className="kv" style={{ margin: 0 }}>
                  <dt>Temps de réponse</dt>
                  <dd className="mono">{s.ms}</dd>
                  <dt>Dernière vérification</dt>
                  <dd>{lastTxt}</dd>
                </dl>
                <p style={{ fontSize: "var(--text-sm)" }}>{s.detail}</p>
              </article>
            ))}
      </div>

      <section className="card card-pad" aria-labelledby="h-inc" style={{ display: "grid", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
          <h2 id="h-inc" style={{ fontSize: "var(--text-xl)" }}>
            Incidents des 7 derniers jours
          </h2>
          <span className="fict muted" style={{ fontSize: 12 }}>
            données fictives
          </span>
        </div>
        <ul className="incidents">
          {[
            ["Il y a 6 h", "Service d’inférence", "Temps de réponse élevé lors du traitement des radiographies.", "warning", "En cours"],
            ["Il y a 2 jours", "API", "Redémarrage planifié : indisponible environ 4 minutes.", "success", "Résolu"],
            ["Il y a 5 jours", "Base de données", "Hors service environ 12 minutes, reprise automatique.", "success", "Résolu"],
          ].map(([when, name, text, tone, label]) => (
            <li key={when}>
              <span className="mono">{when}</span>
              <span>
                <strong>{name}</strong>
                <br />
                <span className="muted">{text}</span>
              </span>
              <Badge tone={tone}>{label}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card-pad" aria-labelledby="h-up" style={{ display: "grid", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
          <h2 id="h-up" style={{ fontSize: "var(--text-xl)" }}>
            Disponibilité sur 30 jours
          </h2>
          <span className="fict muted" style={{ fontSize: 12 }}>
            données fictives
          </span>
        </div>
        <div className="legend" aria-label="Légende">
          <span>
            <i />
            Disponible
          </span>
          <span>
            <i className="deg" />
            Dégradé (hachuré)
          </span>
          <span>
            <i className="down" />
            Hors service (barre épaisse en bas)
          </span>
        </div>
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          {[
            ["api", "API"],
            ["inf", "Service d’inférence"],
            ["db", "Base de données"],
            ["sto", "Stockage des images"],
          ].map(([k, name]) => (
            <div key={k}>
              <p style={{ fontWeight: 500, fontSize: "var(--text-sm)", marginBottom: "var(--space-2)" }}>{name}</p>
              <ul className="uptime" aria-label={`Disponibilité de ${name} sur 30 jours`}>
                {Array.from({ length: 30 }, (_, i) => {
                  const st = HIST[k][i] || "ok";
                  const ago = 29 - i;
                  const txt = `${ago === 0 ? "Aujourd’hui" : `Il y a ${ago} j`} : ${WORD[st].toLowerCase()}`;
                  return (
                    <li key={i} className={st === "ok" ? "" : st} title={txt}>
                      <span className="sr-only">{txt}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
          Chaque barre représente un jour ; la plus à droite est aujourd’hui.
        </p>
      </section>
    </AppShell>
  );
}
