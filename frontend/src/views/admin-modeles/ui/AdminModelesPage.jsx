import { useState } from "react";

import {
  activateModelVersion,
  activationBlocker,
  activeVersion,
  fetchModelSwitches,
  fetchModelVersions,
  headlineMetrics,
  shortHash,
} from "@/entities/model-version";
import { Permission, useCurrentUser } from "@/entities/session";
import { formatDateTime, useAsyncResource } from "@/shared/lib";
import { Alert, Badge, Button, ConfirmDialog, Icon, useToast } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const num = (v, digits = 2) => (typeof v === "number" ? v.toLocaleString("fr-FR", { maximumFractionDigits: digits }) : "—");

function Metrics({ version }) {
  const m = headlineMetrics(version);
  if (!m) return <span className="why">Aucune mesure publiée</span>;
  return (
    <span>
      mAP@0,50 <span className="mono">{num(m.map50)}</span>
      {m.partition === "val" ? (
        <>
          {" "}
          <Badge tone="warning">validation</Badge>
        </>
      ) : null}
    </span>
  );
}

/**
 * Administration des modèles : versions publiées (paires dents + anomalies),
 * version active, bascule avec motif, journal des bascules.
 *
 * La bascule est vérifiée par le serveur : le service d'inférence charge la
 * version et contrôle l'empreinte de ses poids AVANT qu'elle ne devienne
 * active. Les analyses déjà en file gardent la version reçue à leur mise en file.
 */
export function AdminModelesPage() {
  const { can } = useCurrentUser();
  const toast = useToast();
  const versions = useAsyncResource(fetchModelVersions);
  const switches = useAsyncResource(fetchModelSwitches);
  const [target, setTarget] = useState(null);
  const canManage = can(Permission.MODEL_MANAGE);
  const list = versions.data ?? [];
  const active = activeVersion(list);

  const confirm = async (motif) => {
    await activateModelVersion(target.version, motif);
    setTarget(null);
    toast(`Version ${target.version} active. Les analyses déjà en file gardent leur version.`);
    versions.reload();
    switches.reload();
  };

  return (
    <AppShell page="admin-modeles" title="Modèles" crumbs="Administration" permission={Permission.MODEL_READ} className="v-admin-modeles">
      <div className="page-head">
        <div>
          <h2>Modèles</h2>
          <p>Versions publiées, version en service et journal des bascules. Une version associe un modèle « dents » et un modèle « anomalies ».</p>
        </div>
      </div>

      {versions.error ? (
        <Alert tone="danger" role="alert">
          {versions.error.message}
        </Alert>
      ) : null}

      <section className="dcard active-card" aria-labelledby="h-active">
        <h3 id="h-active">
          <Icon name="cpu" />
          Version en service :{" "}
          {active ? (
            <>
              <span className="mono">{active.version}</span>
              <Badge tone="success" dot>
                Active
              </Badge>
            </>
          ) : (
            <Badge tone="warning">Aucune — le service d’analyse est en mode démonstration</Badge>
          )}
        </h3>
        {active ? (
          <dl className="kv">
            <div>
              <dt>Active depuis</dt>
              <dd>{active.activatedAt ? formatDateTime(active.activatedAt) : "—"}</dd>
            </div>
            <div>
              <dt>Mesure (modèle anomalies)</dt>
              <dd>
                <Metrics version={active} />
              </dd>
            </div>
            <div>
              <dt>Découpage</dt>
              <dd className="hash">{shortHash(active.splitHash)}</dd>
            </div>
            <div>
              <dt>Données</dt>
              <dd>{active.dataset || "—"}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="dcard" aria-labelledby="h-versions">
        <div className="dcard-h">
          <div>
            <h3 id="h-versions">Versions publiées</h3>
            <p>La plus récente d’abord. Une version publiée ne change plus ; on en publie une nouvelle.</p>
          </div>
        </div>
        {list.length === 0 && !versions.isLoading ? (
          <p className="why">Aucune version publiée. Publier une paire avec training/publish_model.py.</p>
        ) : (
          <div className="table-wrap">
            <table className="table stack">
              <caption className="sr-only">Versions de modèle publiées</caption>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Publiée le</th>
                  <th scope="col">Mesure</th>
                  <th scope="col">Poids (sha256)</th>
                  <th scope="col">Découpage</th>
                  <th scope="col">État</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => {
                  const blocker = activationBlocker(v);
                  return (
                    <tr key={v.id} data-version={v.version}>
                      <th scope="row" className="mono">
                        {v.version}
                      </th>
                      <td>{v.createdAt ? formatDateTime(v.createdAt) : "—"}</td>
                      <td>
                        <Metrics version={v} />
                      </td>
                      <td>
                        <span className="hash" title={`dents ${v.sha256.teeth ?? "—"}\nanomalies ${v.sha256.anomalies ?? "—"}`}>
                          {shortHash(v.sha256.teeth)} · {shortHash(v.sha256.anomalies)}
                        </span>
                      </td>
                      <td className="hash">{shortHash(v.splitHash)}</td>
                      <td>
                        {v.active ? (
                          <Badge tone="success" dot>
                            Active
                          </Badge>
                        ) : canManage ? (
                          <>
                            <Button size="sm" variant="secondary" disabled={Boolean(blocker)} onClick={() => setTarget(v)} aria-label={`Activer la version ${v.version}`}>
                              Activer
                            </Button>
                            {blocker ? <span className="why"> {blocker}</span> : null}
                          </>
                        ) : (
                          <span className="why">Inactive</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dcard" aria-labelledby="h-switches">
        <div className="dcard-h">
          <div>
            <h3 id="h-switches">Journal des bascules</h3>
            <p>Chaque changement de version : quand, par qui, de quelle version vers laquelle, et pourquoi.</p>
          </div>
        </div>
        {(switches.data ?? []).length === 0 ? (
          <p className="why">Aucune bascule pour l’instant.</p>
        ) : (
          <div className="table-wrap">
            <table className="table stack">
              <caption className="sr-only">Journal des bascules de modèle</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Par</th>
                  <th scope="col">De</th>
                  <th scope="col">Vers</th>
                  <th scope="col">Motif</th>
                </tr>
              </thead>
              <tbody>
                {switches.data.map((s) => (
                  <tr key={`${s.at}-${s.to}`}>
                    <td>{formatDateTime(s.at)}</td>
                    <td>{s.author ?? "—"}</td>
                    <td className="mono">{s.from ?? "—"}</td>
                    <td className="mono">{s.to}</td>
                    <td>{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(target)}
        title={target ? `Activer la version ${target.version} ?` : ""}
        confirmLabel="Activer"
        reason="required"
        reasonHint="Inscrit au journal des bascules et au journal d’audit."
        onConfirm={confirm}
        onClose={() => setTarget(null)}
      >
        <p>
          Le service d’analyse va charger cette version et vérifier l’empreinte de ses poids. Si tout est conforme, les
          prochaines analyses mises en file l’utiliseront.
        </p>
        <p>Les analyses déjà en file terminent avec la version qu’elles ont reçue : une analyse ne mélange jamais deux modèles.</p>
      </ConfirmDialog>
    </AppShell>
  );
}
