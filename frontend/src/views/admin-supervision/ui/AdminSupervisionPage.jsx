import { useCallback, useEffect, useState } from "react";

import { Permission } from "@/entities/session";
import { SERVICE_STATES, fetchStorage, fetchSupervision, formatDuration } from "@/entities/system-status";
import { toAppError } from "@/shared/api";
import { Alert, Badge, BarChart, Button, Gauge, Icon, KpiRing, VizEmpty } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const REFRESH_MS = 30_000;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const go = bytes / 1024 ** 3;
  if (go >= 1) return `${go.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go`;
  return `${Math.round(bytes / 1024 ** 2).toLocaleString("fr-FR")} Mo`;
}

const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

async function readAll() {
  const [supervision, storage] = await Promise.allSettled([fetchSupervision(), fetchStorage()]);
  if (supervision.status === "rejected") throw supervision.reason;
  return { supervision: supervision.value, storage: storage.status === "fulfilled" ? storage.value : null };
}

/**
 * Supervision (sprint 11) : les quatre sondes du serveur (base, stockage,
 * file, inférence), chacune bornée à 2 s et indépendante des autres, et les
 * indicateurs d'exploitation mesurés sur les analyses. Relue toutes les 30 s.
 * Aucune donnée fictive : ce qui n'est pas mesuré n'est pas affiché.
 */
export function AdminSupervisionPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const check = useCallback(async () => {
    setBusy(true);
    try {
      setData(await readAll());
      setError(null);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setCheckedAt(Date.now());
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    check();
    const refresh = setInterval(check, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [check]);

  const since = checkedAt ? Math.round((now - checkedAt) / 1000) : null;
  const lastTxt = since == null ? "en cours" : since < 10 ? "à l’instant" : `il y a ${since} s`;
  const sup = data?.supervision;
  const ind = sup?.indicators;
  const storage = data?.storage;
  const touched = sup?.services.filter((s) => s.state !== "ok") ?? [];

  return (
    <AppShell page="admin-supervision" title="Supervision" crumbs="Administration" permission={Permission.USER_MANAGE} className="v-admin-supervision">
      <div className="page-head">
        <div>
          <h2>État des services</h2>
          <p>Dernière vérification : {lastTxt} · relue toutes les 30 s</p>
        </div>
        <Button onClick={check} disabled={busy}>
          <Icon name="refresh" />
          {busy ? "Vérification…" : "Vérifier maintenant"}
        </Button>
      </div>

      {error ? (
        <Alert tone="danger" role="alert" title="La supervision ne répond pas">
          {error}
        </Alert>
      ) : touched.length ? (
        <Alert tone={touched.some((s) => s.state === "panne") ? "danger" : "warning"} role="note" title={`${touched.length} service${touched.length > 1 ? "s" : ""} à surveiller`}>
          {touched.map((s) => s.name).join(", ")} : le détail figure ci-dessous. Les utilisateurs voient un bandeau tant que l’incident dure.
        </Alert>
      ) : sup ? (
        <Alert tone="success" role="note" icon="check">
          Tous les services répondent normalement.
        </Alert>
      ) : null}

      <div className="svc-grid" aria-live="polite">
        {!sup
          ? [0, 1, 2, 3].map((i) => (
              <article key={i} className="card card-pad svc" aria-busy="true">
                <div className="skeleton" style={{ height: 20, width: "60%" }} />
                <div className="skeleton" style={{ height: 24, width: "40%" }} />
                <div className="skeleton" style={{ height: 44 }} />
              </article>
            ))
          : sup.services.map((s) => {
              const st = SERVICE_STATES[s.state];
              return (
                <article key={s.key} className="card card-pad svc" data-service={s.key} data-etat={s.state}>
                  <div className="svc-head">
                    <Icon name={s.icon} />
                    <h3>{s.name}</h3>
                  </div>
                  <Badge tone={st.tone} style={{ justifySelf: "start" }}>
                    <Icon name={st.icon} style={{ width: 13, height: 13 }} />
                    {st.label}
                  </Badge>
                  <dl className="kv" style={{ margin: 0 }}>
                    <dt>Temps de réponse</dt>
                    <dd className="mono">{formatDuration(s.latencyMs)}</dd>
                  </dl>
                  <p style={{ fontSize: "var(--text-sm)" }}>{s.detail}</p>
                </article>
              );
            })}
      </div>

      <section className="kpi-row" aria-label="Indicateurs d’exploitation, 14 derniers jours">
        <KpiRing
          label="Analyses traitées · 14 jours"
          icon="detect"
          value={ind ? ind.processed : "—"}
          ring={null}
          ringText={ind ? `${ind.processed} analyses traitées en 14 jours` : "Indicateur indisponible"}
          dir="flat"
          tone="navy"
        />
        <KpiRing
          label="Durée moyenne d’une analyse"
          icon="clock"
          value={ind ? formatDuration(ind.averageMs) : "—"}
          ring={null}
          ringText={ind?.averageMs ? `Durée moyenne : ${formatDuration(ind.averageMs)}` : "Aucune analyse terminée sur la période"}
          dir="flat"
        />
        <KpiRing
          label="Taux d’échec"
          icon="alert"
          value={ind?.failureRate == null ? "—" : `${Math.round(ind.failureRate * 100)} %`}
          ring={ind?.failureRate == null ? null : Math.round(ind.failureRate * 100)}
          ringText={ind?.failureRate == null ? "Aucune analyse traitée sur la période" : `${ind.failed} échec${ind.failed > 1 ? "s" : ""} sur ${ind.processed} analyses traitées`}
          dir="flat"
          tone={ind?.failureRate ? "warning" : undefined}
        />
        <KpiRing
          label="Espace occupé"
          icon="database"
          value={storage ? formatBytes(storage.bytes) : "—"}
          ring={storage ? Math.min(100, Math.round((storage.bytes / storage.thresholdBytes) * 100)) : null}
          ringText={storage ? `${formatBytes(storage.bytes)} occupés, alerte à ${formatBytes(storage.thresholdBytes)}` : "Stockage injoignable"}
          delta={storage ? `${storage.objects} fichiers · alerte à ${formatBytes(storage.thresholdBytes)}` : undefined}
          dir="flat"
          tone={storage?.alert ? "warning" : undefined}
        />
      </section>

      <div className="dash-grid">
        <section className="dcard span-8" aria-labelledby="h-par-jour">
          <div className="dcard-h">
            <div>
              <h3 id="h-par-jour">Analyses par jour</h3>
              <p>Analyses lancées, 14 derniers jours</p>
            </div>
          </div>
          <div>
            {ind?.days.length ? (
              <BarChart
                title="Analyses par jour"
                labels={ind.days.map((d) => shortDay(d.day))}
                values={ind.days.map((d) => d.count)}
                name="Analyses lancées"
                trendName="Moyenne sur 3 jours"
                summary={`${ind.days.reduce((s, d) => s + d.count, 0)} analyses lancées en 14 jours, ${ind.days.at(-1).count} aujourd’hui.`}
              />
            ) : (
              <VizEmpty title="Indicateurs indisponibles">La base ne répond pas : les indicateurs reviendront avec elle.</VizEmpty>
            )}
          </div>
        </section>
        <section className="dcard span-4 signature" aria-labelledby="h-espace">
          <div className="dcard-h">
            <div>
              <h3 id="h-espace">Espace disque</h3>
              <p>Images anonymisées, logos et documents de référence</p>
            </div>
          </div>
          <div>
            {storage ? (
              <Gauge
                value={Math.min(100, Math.round((storage.bytes / storage.thresholdBytes) * 100))}
                label="Part du seuil d’alerte atteinte"
                caption={`${formatBytes(storage.bytes)} sur un seuil d’alerte de ${formatBytes(storage.thresholdBytes)} (${storage.objects} fichiers).`}
                icon="database"
              />
            ) : (
              <VizEmpty title="Stockage injoignable">Le volume occupé sera affiché dès que le stockage répondra.</VizEmpty>
            )}
          </div>
        </section>
      </div>

      <Alert tone="info" role="note" icon="shield">
        Les images ne quittent jamais le serveur : l’inférence et l’assistant tournent localement. La page de santé publique (
        <code>/api/v1/health</code>) ne donne qu’un état par service, pour un outil de supervision extérieur.
      </Alert>
    </AppShell>
  );
}
