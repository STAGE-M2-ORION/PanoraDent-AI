import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

import { Processing } from "@/entities/analysis";
import { fetchCabinet } from "@/entities/cabinet";
import { Permission, useCurrentUser } from "@/entities/session";
import { DEFAULT_REPORT_OPTIONS, useReportDownload, useReportPreview } from "@/features/generate-report";
import { formatDate, formatDateTime, useAsyncResource } from "@/shared/lib";
import { Alert, Button, Icon } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";
import { useAnalysisViewModel } from "@/widgets/analysis-workspace";

import { DemoSheet } from "./DemoSheet";

/**
 * Compte rendu (sprint 8). L'aperçu EST le PDF produit par le serveur, avec
 * les options choisies : ce que l'on voit est ce que l'on télécharge. Le
 * serveur le reconstruit à chaque demande, à l'identique, et journalise
 * chaque aperçu et chaque téléchargement.
 *
 * Avant la clôture : aperçu « brouillon » (filigrane), téléchargement refusé.
 * L'en-tête vient des paramètres du cabinet (administration).
 */
export function CompteRenduPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const { can } = useCurrentUser();
  const { vm, loading, error } = useAnalysisViewModel(id, router.isReady);
  const [opts, setOpts] = useState(DEFAULT_REPORT_OPTIONS);
  const [live, setLive] = useState("");
  const cabinet = useAsyncResource(fetchCabinet);
  const canGenerate = can(Permission.REPORT_GENERATE);

  const real = Boolean(vm && !vm.demo);
  const done = real && vm.processing === Processing.DONE;
  const draft = real && !vm.closed;
  const preview = useReportPreview(real ? vm.id : null, opts, { draft, enabled: done && canGenerate });
  const { download, isPending: downloading, error: downloadError } = useReportDownload(real ? vm.id : null);
  const rejectedN = vm ? vm.dets.filter((d) => d.status === "rejected").length : 0;
  const setOpt = (key) => (event) => setOpts((o) => ({ ...o, [key]: event.target.checked }));

  const onDownload = async () => {
    setLive("");
    const fileName = await download(opts);
    if (fileName) setLive(`Compte rendu téléchargé : ${fileName}.`);
  };

  let status = null;
  if (loading) status = <Alert tone="info" icon="clock">Chargement de l’analyse…</Alert>;
  else if (error) status = <Alert tone="danger" icon="x">{error.message}</Alert>;
  else if (vm?.demo) status = <Alert tone="info" icon="info">Démonstration : aucun PDF n’est produit pour l’analyse fictive. Ouvrez une analyse réelle depuis l’historique.</Alert>;
  else if (real && !done) status = <Alert tone="warning" icon="clock">L’analyse n’est pas terminée : pas encore de compte rendu.</Alert>;
  else if (real && !canGenerate) status = <Alert tone="info" icon="lock">Votre rôle permet de consulter l’analyse, pas de produire son compte rendu.</Alert>;
  else if (draft)
    status = (
      <Alert tone="warning" icon="alert" title="Brouillon : relecture non clôturée">
        L’aperçu porte la mention « BROUILLON ». Le compte rendu se télécharge une fois l’analyse clôturée.{" "}
        <Link href={`/analyse?id=${vm.id}`}>Revenir à la relecture</Link>
      </Alert>
    );
  else if (real)
    status = (
      <Alert tone="success" icon="check">
        Analyse clôturée {vm.closedAt ? `le ${formatDateTime(vm.closedAt)}` : ""}
        {vm.closedBy ? ` par ${vm.closedBy}` : ""}. Le compte rendu se reconstruit à l’identique à chaque téléchargement.
      </Alert>
    );

  return (
    <AppShell
      page="historique"
      title={`Compte rendu · Analyse n° ${vm?.number ?? "…"}`}
      permission={Permission.ANALYSIS_READ}
      className="v-compte-rendu"
      headerContent={
        <div>
          <Link className="back-link" href={id ? `/analyse?id=${id}` : "/analyse"}>
            <span aria-hidden="true">←</span> Revenir à l’analyse
          </Link>
          <h1>Compte rendu · Analyse n° {vm?.number ?? "…"}</h1>
        </div>
      }
    >
      <div className="cr-grid">
        <section aria-label="Aperçu du compte rendu" className="sheet-zone">
          {vm?.demo ? (
            <div className="sheet-frame">
              <DemoSheet vm={vm} opts={opts} today={formatDate(new Date())} />
            </div>
          ) : (
            <div className="pdf-zone" data-state={preview.isPending ? "loading" : preview.error ? "error" : preview.url ? "ready" : "empty"}>
              {preview.url ? <iframe className="pdf-frame" src={preview.url} title="Aperçu du compte rendu PDF" data-testid="apercu-pdf" /> : null}
              {preview.isPending ? (
                <p className="pdf-msg" role="status">
                  <Icon name="clock" /> Génération de l’aperçu…
                </p>
              ) : null}
              {preview.error ? (
                <Alert tone="danger" icon="x" title="L’aperçu n’a pas pu être produit.">
                  {preview.error.message}
                </Alert>
              ) : null}
              {!preview.url && !preview.isPending && !preview.error ? <p className="pdf-msg">Aucun aperçu à afficher.</p> : null}
            </div>
          )}
        </section>

        <aside className="actions" aria-label="Actions sur le compte rendu">
          <div className="card card-pad">
            <h2>Exporter</h2>
            <div aria-live="polite">{status}</div>
            {downloadError ? (
              <Alert tone="danger" icon="x" title="Le téléchargement a échoué.">
                {downloadError.message}
              </Alert>
            ) : null}
            {canGenerate || vm?.demo ? (
              <div className="btn-row">
                <Button onClick={onDownload} disabled={!done || draft || !canGenerate || downloading}>
                  <Icon name="download" /> {downloading ? "Préparation du PDF…" : "Télécharger le PDF"}
                </Button>
              </div>
            ) : null}
            <p className="live" role="status">
              {live}
            </p>
          </div>

          {canGenerate || vm?.demo ? (
          <>
          <div className="card card-pad">
            <h2>Contenu du compte rendu</h2>
            <div>
              <label className="opt">
                <input type="checkbox" checked={opts.image} onChange={setOpt("image")} />
                <span>Inclure l’image annotée</span>
              </label>
              <label className="opt">
                <input type="checkbox" checked={opts.comments} onChange={setOpt("comments")} />
                <span>Inclure les commentaires du praticien</span>
              </label>
              <label className="opt">
                <input type="checkbox" checked={opts.rejected} onChange={setOpt("rejected")} />
                <span>
                  Inclure les propositions rejetées, dans une section séparée
                  <small>
                    {rejectedN ? `${rejectedN} proposition${rejectedN > 1 ? "s" : ""} rejetée${rejectedN > 1 ? "s" : ""} dans cette analyse.` : "Aucune proposition rejetée dans cette analyse."}
                  </small>
                </span>
              </label>
            </div>
            <Alert tone="info" icon="shield">
              Aucune donnée identifiante : le compte rendu porte la référence anonyme, et l’image anonymisée.
            </Alert>
          </div>

          <div className="card card-pad">
            <h2>En-tête du cabinet</h2>
            {cabinet.data ? (
              <p className="cab-line">
                <b>{cabinet.data.name || "Nom du cabinet non renseigné"}</b>
                {cabinet.data.address ? <span>{cabinet.data.address.split("\n")[0]}</span> : null}
                <span>{cabinet.data.hasLogo ? "Avec logo" : "Sans logo"}</span>
              </p>
            ) : null}
            {can(Permission.CABINET_MANAGE) ? (
              <Link className="btn btn-secondary btn-sm" href="/admin/cabinet">
                <Icon name="edit" /> Modifier l’en-tête
              </Link>
            ) : (
              <p className="hint">Nom, adresse et logo sont réglés par l’administrateur.</p>
            )}
          </div>
          </>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
