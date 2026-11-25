import { useEffect, useRef, useState } from "react";

import {
  DOCUMENT_EXTENSIONS, DOCUMENT_STATES, deleteDocument, documentsToReindex, fetchLibrary, formatSize,
  hasPendingDocuments, parseSettings, reindexDocument, reindexStaleDocuments, replaceDocument,
  saveAssistantSettings, uploadDocument, validateDocumentFile,
} from "@/entities/document";
import { Permission } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { formatDate, formatDateTime, formatTime, pluralize, useAsyncResource } from "@/shared/lib";
import { Alert, Badge, Button, ConfirmDialog, DateCell, Field, Icon, IconAction, Input, useToast } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const ACCEPT = [...DOCUMENT_EXTENSIONS, "application/pdf", "text/markdown"].join(",");
const POLL_MS = 3000;

function StateBadge({ doc }) {
  const s = DOCUMENT_STATES[doc.state];
  return (
    <div className="cell-col">
      <Badge tone={s.tone} dot={doc.state === "en_cours"}>
        {s.label}
      </Badge>
      {doc.state === "echec" && doc.error ? <span className="sub doc-error">{doc.error}</span> : null}
      {doc.stale ? <span className="sub">Indexé avec un autre modèle : à réindexer</span> : null}
    </div>
  );
}

/**
 * Base documentaire de l'assistant (sprint 9) : les documents de référence
 * sur lesquels l'assistant appuie ses réponses, l'état de leur indexation et
 * les réglages de la recherche. Réservé à `document:manage` ; chaque geste est
 * journalisé. L'indexation est faite par le worker : l'écran suit l'état des
 * documents en attente et se rafraîchit seul.
 */
export function AdminDocumentsPage() {
  const toast = useToast();
  const library = useAsyncResource(fetchLibrary);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [settings, setSettings] = useState({ passages: "", threshold: "" });
  const [toDelete, setToDelete] = useState(null);
  const uploadRef = useRef(null);
  const replaceRef = useRef(null);
  const replaceTarget = useRef(null);
  const data = library.data;
  const documents = data?.documents ?? [];
  const pending = hasPendingDocuments(documents);
  const toReindex = documentsToReindex(documents);
  const { reload } = library;

  useEffect(() => {
    if (data) setSettings({ passages: String(data.settings.passages), threshold: String(data.settings.threshold) });
  }, [data?.settings.passages, data?.settings.threshold]); // eslint-disable-line react-hooks/exhaustive-deps

  // L'indexation se fait hors de la requête : on suit les documents en attente.
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(reload, POLL_MS);
    return () => clearTimeout(timer);
  }, [pending, data, reload]);

  const run = async (action, success) => {
    setBusy(true);
    setError(null);
    try {
      // L'action peut renvoyer son propre message ; sinon (objet renvoyé par l'API), le message prévu.
      const result = await action();
      toast(typeof result === "string" ? result : success);
      reload();
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const onUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = validateDocumentFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    run(async () => {
      const doc = await uploadDocument(file, title);
      setTitle("");
      return `« ${doc.title} » ajouté : indexation en cours.`;
    });
  };

  const onReplace = (event) => {
    const file = event.target.files?.[0];
    const doc = replaceTarget.current;
    event.target.value = "";
    if (!file || !doc) return;
    const invalid = validateDocumentFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    run(() => replaceDocument(doc.id, file), `« ${doc.title} » remplacé : réindexation en cours.`);
  };

  const saveSettings = (event) => {
    event.preventDefault();
    const parsed = parseSettings(settings);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    run(() => saveAssistantSettings(parsed.payload), "Réglages de la recherche enregistrés.");
  };

  const settingsDirty =
    Boolean(data) && (settings.passages !== String(data.settings.passages) || settings.threshold !== String(data.settings.threshold));

  return (
    <AppShell page="admin-documents" title="Base documentaire" crumbs="Administration" permission={Permission.DOCUMENT_MANAGE} className="v-admin-documents">
      <div className="page-head">
        <div>
          <h2>Base documentaire</h2>
          <p>Les documents de référence de l’assistant : il ne répond qu’à partir de leurs passages, en les citant.</p>
        </div>
        <div className="btn-row">
          <input ref={uploadRef} type="file" accept={ACCEPT} hidden onChange={onUpload} data-testid="doc-upload-input" />
          <Button disabled={!data || busy} onClick={() => uploadRef.current?.click()}>
            <Icon name="upload" /> Ajouter un document
          </Button>
        </div>
      </div>

      {library.error ? (
        <Alert tone="danger" role="alert">
          {library.error.message}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {toReindex > 0 ? (
        <Alert tone="warning" title={`${pluralize(toReindex, "document")} à réindexer`}>
          <span>Indexés avec un autre modèle de vectorisation, ou en échec : l’assistant ne s’en sert pas.</span>{" "}
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(async () => `${pluralize(await reindexStaleDocuments(), "document")} remis en indexation.`)}>
            <Icon name="refresh" /> Tout réindexer
          </Button>
        </Alert>
      ) : null}

      <div className="doc-grid">
        <section className="card card-pad" aria-labelledby="h-doc-index">
          <div className="card-head">
            <h3 id="h-doc-index">Index</h3>
          </div>
          <dl className="doc-stats">
            <div>
              <dt>Documents</dt>
              <dd>{data ? data.index.documents : "—"}</dd>
            </div>
            <div>
              <dt>Passages interrogeables</dt>
              <dd>{data ? data.index.passages - data.index.stalePassages : "—"}</dd>
            </div>
            <div>
              <dt>Modèle de vectorisation</dt>
              <dd>{data?.index.model ?? "—"}</dd>
            </div>
          </dl>
          <Field label="Titre du prochain document (facultatif)" htmlFor="doc-titre" hint="Sinon, le nom du fichier. PDF ou Markdown, 20 Mo au plus ; un PDF scanné, sans texte, est refusé.">
            <Input id="doc-titre" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={!data || busy} />
          </Field>
        </section>

        <form className="card card-pad form" onSubmit={saveSettings} aria-labelledby="h-doc-reglages" noValidate>
          <div className="card-head">
            <h3 id="h-doc-reglages">Réglages de la recherche</h3>
          </div>
          <Field label="Passages remis au modèle" htmlFor="doc-passages" hint="De 1 à 10 : les plus proches de la question.">
            <Input id="doc-passages" type="number" min={1} max={10} step={1} value={settings.passages} onChange={(e) => setSettings((s) => ({ ...s, passages: e.target.value }))} disabled={!data || busy} />
          </Field>
          <Field label="Seuil de similarité" htmlFor="doc-seuil" hint="De 0 à 1. Sous ce seuil, un passage n’est pas jugé pertinent ; si aucun ne le passe, l’assistant refuse de répondre.">
            <Input id="doc-seuil" inputMode="decimal" value={settings.threshold} onChange={(e) => setSettings((s) => ({ ...s, threshold: e.target.value }))} disabled={!data || busy} />
          </Field>
          <div className="btn-row">
            <Button type="submit" disabled={!settingsDirty || busy}>
              Enregistrer
            </Button>
            {data?.settings.updatedAt ? (
              <span className="hint">
                Modifié le {formatDateTime(data.settings.updatedAt)}
                {data.settings.updatedBy ? ` par ${data.settings.updatedBy}` : ""}
              </span>
            ) : null}
          </div>
        </form>
      </div>

      <input ref={replaceRef} type="file" accept={ACCEPT} hidden onChange={onReplace} data-testid="doc-replace-input" />
      <div className="table-wrap">
        <table className="table stack">
          <caption className="sr-only">Documents de la base documentaire</caption>
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">État</th>
              <th scope="col">Passages</th>
              <th scope="col">Déposé</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <th scope="row">
                  <div className="cell-col">
                    <strong>{doc.title}</strong>
                    <span className="sub" title={doc.fileName}>
                      {doc.fileName} · {doc.format === "pdf" ? "PDF" : "Markdown"} · {formatSize(doc.size)}
                    </span>
                  </div>
                </th>
                <td data-label="État">
                  <StateBadge doc={doc} />
                </td>
                <td data-label="Passages">{doc.state === "indexe" ? doc.passages : "—"}</td>
                <td data-label="Déposé">
                  <div className="cell-col">
                    <DateCell date={formatDate(doc.uploadedAt)} time={formatTime(doc.uploadedAt)} />
                    {doc.uploadedBy ? <span className="sub">par {doc.uploadedBy}</span> : null}
                  </div>
                </td>
                <td className="td-actions">
                  <div className="row-actions">
                    <IconAction icon="eye" label={`Ouvrir « ${doc.title} »`} title="Ouvrir le fichier" href={doc.fileUrl} target="_blank" rel="noopener noreferrer" />
                    <IconAction
                      icon="refresh"
                      label={`Réindexer « ${doc.title} »`}
                      title="Réindexer"
                      disabled={busy || doc.state === "en_attente" || doc.state === "en_cours"}
                      onClick={() => run(() => reindexDocument(doc.id), `« ${doc.title} » remis en indexation.`)}
                    />
                    <IconAction
                      icon="upload"
                      label={`Remplacer le fichier de « ${doc.title} »`}
                      title="Remplacer par une nouvelle version"
                      disabled={busy || doc.state === "en_cours"}
                      onClick={() => {
                        replaceTarget.current = doc;
                        replaceRef.current?.click();
                      }}
                    />
                    <IconAction icon="trash" danger label={`Supprimer « ${doc.title} »`} title="Retirer de la base" disabled={busy} onClick={() => setToDelete(doc)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && documents.length === 0 ? (
          <p className="doc-empty">Aucun document : l’assistant refusera toute question tant que la base est vide.</p>
        ) : null}
      </div>
      <p className="count" aria-live="polite">
        {library.isLoading && !data ? "Chargement…" : pending ? "Indexation en cours : la liste se met à jour seule." : ""}
      </p>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={`Retirer « ${toDelete?.title ?? ""} » de la base ?`}
        confirmLabel="Retirer le document"
        tone="danger"
        onConfirm={async () => {
          await deleteDocument(toDelete.id);
          toast(`« ${toDelete.title} » retiré de la base.`);
          setToDelete(null);
          reload();
        }}
        onClose={() => setToDelete(null)}
      >
        <p>Le fichier et ses passages sont supprimés : l’assistant ne pourra plus s’y appuyer. Les réponses déjà données restent au journal.</p>
      </ConfirmDialog>
    </AppShell>
  );
}
