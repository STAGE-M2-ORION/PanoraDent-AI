import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

import {
  AccessRequestStatus,
  STATUS_LABELS,
  acceptAccessRequest,
  fetchAccessRequests,
  refuseAccessRequest,
  suggestedRoleName,
} from "@/entities/access-request";
import { fetchRoles } from "@/entities/role";
import { Permission } from "@/entities/session";
import { toAppError } from "@/shared/api";
import { formatDateTime, useAsyncResource } from "@/shared/lib";
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea, useToast } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const FILTRES = [
  [AccessRequestStatus.PENDING, "En attente"],
  [AccessRequestStatus.ACCEPTED, "Acceptées"],
  [AccessRequestStatus.REFUSED, "Refusées"],
  ["", "Toutes"],
];

function AcceptModal({ demande, roles, onClose, onDone }) {
  const [values, setValues] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!demande) return;
    const propose = roles.find((r) => r.name === suggestedRoleName(demande.profile)) ?? roles[0];
    setValues({ roleId: propose?.id ?? "", password: true, google: true, lastName: demande.name, firstName: "" });
    setError(null);
  }, [demande, roles]);

  if (!demande || !values) return null;
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    const modes = [values.password && "mot_de_passe", values.google && "google"].filter(Boolean);
    if (!modes.length) {
      setError("Autorisez au moins un mode de connexion.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptAccessRequest(demande.id, { roleId: values.roleId, modes, lastName: values.lastName.trim(), firstName: values.firstName.trim() });
      onDone(`Compte créé pour ${demande.email} : le lien d’activation lui est envoyé.`);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} labelledBy="accepterTitre" wide={520}>
      <form className="form" onSubmit={submit}>
        <h2 id="accepterTitre">Accepter la demande</h2>
        <p className="muted">
          Un compte est créé pour <strong>{demande.email}</strong>, qui reçoit le lien de première connexion. Vous ne choisissez jamais son mot de passe.
        </p>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        <div className="two-col">
          <Field label="Nom" htmlFor="acc-nom">
            <Input id="acc-nom" value={values.lastName} maxLength={120} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Prénom" htmlFor="acc-prenom">
            <Input id="acc-prenom" value={values.firstName} maxLength={120} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
        </div>
        <Field label="Rôle" htmlFor="acc-role" hint={`Proposé d’après le profil déclaré : ${demande.profile}.`}>
          <Select id="acc-role" value={values.roleId} onChange={(e) => set("roleId", e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="choices">
          <legend>Modes de connexion</legend>
          <label className="check">
            <input type="checkbox" checked={values.password} onChange={(e) => set("password", e.target.checked)} />
            Adresse e-mail et mot de passe
          </label>
          <label className="check">
            <input type="checkbox" checked={values.google} onChange={(e) => set("google", e.target.checked)} />
            Compte Google
          </label>
        </fieldset>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Création…" : "Créer le compte"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RefuseModal({ demande, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason("");
    setError(null);
  }, [demande]);
  if (!demande) return null;
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await refuseAccessRequest(demande.id, reason.trim());
      onDone(`Demande de ${demande.name} refusée : un e-mail l’en informe.`);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} labelledBy="refuserTitre" wide={480}>
      <form className="form" onSubmit={submit}>
        <h2 id="refuserTitre">Refuser la demande</h2>
        <p className="muted">
          {demande.name} ({demande.email}) en est informé par e-mail. Aucun compte n’est créé.
        </p>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        <Field label="Motif (facultatif, transmis au demandeur)" htmlFor="ref-motif">
          <Textarea id="ref-motif" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            Refuser la demande
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Demandes d'accès (sprint 13) : il n'y a pas d'inscription libre. Chaque
 * demande déposée depuis la page d'accueil attend ici la décision d'un
 * administrateur : accepter (compte créé, rôle choisi) ou refuser. Les
 * demandes traitées sont supprimées 90 jours après la décision.
 */
export function AdminDemandesAccesPage() {
  const router = useRouter();
  const toast = useToast();
  const [filtre, setFiltre] = useState(AccessRequestStatus.PENDING);
  const charger = useCallback(() => fetchAccessRequests(filtre), [filtre]);
  const demandes = useAsyncResource(charger);
  const roles = useAsyncResource(fetchRoles);
  const [accepting, setAccepting] = useState(null);
  const [refusing, setRefusing] = useState(null);
  const visee = typeof router.query.demande === "string" ? router.query.demande : null;

  useEffect(() => {
    if (!visee || !demandes.data) return;
    document.getElementById(`demande-${visee}`)?.scrollIntoView({ block: "center" });
  }, [visee, demandes.data]);

  const done = (message) => {
    setAccepting(null);
    setRefusing(null);
    toast(message);
    demandes.reload();
  };
  const items = demandes.data?.items ?? [];

  return (
    <AppShell page="admin-demandes-acces" title="Demandes d’accès" crumbs="Administration" permission={Permission.USER_MANAGE} className="v-admin-demandes">
      <div className="page-head">
        <div>
          <h2>Demandes d’accès</h2>
          <p className="muted">
            Il n’y a pas d’inscription libre : chaque demande déposée depuis la page d’accueil attend votre décision. Accepter crée le compte avec le rôle que
            vous choisissez ; le demandeur reçoit son lien d’activation.
          </p>
        </div>
      </div>

      <div className="dem-filtres" role="group" aria-label="Filtrer par état">
        {FILTRES.map(([valeur, libelle]) => (
          <button key={libelle} type="button" className={`chip${filtre === valeur ? " is-on" : ""}`} aria-pressed={filtre === valeur} onClick={() => setFiltre(valeur)}>
            {libelle}
            {valeur === AccessRequestStatus.PENDING && demandes.data ? ` (${demandes.data.pending})` : ""}
          </button>
        ))}
      </div>

      {demandes.error ? (
        <Alert tone="danger" role="alert">
          {demandes.error.message}
        </Alert>
      ) : null}
      {demandes.data && !items.length ? (
        <p className="muted dem-vide">Aucune demande {filtre === AccessRequestStatus.PENDING ? "en attente" : "dans cette catégorie"}.</p>
      ) : null}

      <ul className="dem-liste" aria-label="Demandes">
        {items.map((d) => {
          const etat = STATUS_LABELS[d.status] ?? { label: d.status, tone: "info" };
          return (
            <li key={d.id}>
              <article id={`demande-${d.id}`} className={`card card-pad dem-carte${visee === d.id ? " is-visee" : ""}`} aria-label={`Demande de ${d.name}`}>
                <header>
                  <div>
                    <strong>{d.name}</strong>
                    <span className="muted">{d.email}</span>
                  </div>
                  <Badge tone={etat.tone}>{etat.label}</Badge>
                </header>
                <dl>
                  <div>
                    <dt>Profil</dt>
                    <dd>{d.profile}</dd>
                  </div>
                  {d.office || d.city ? (
                    <div>
                      <dt>Établissement</dt>
                      <dd>{[d.office, d.city].filter(Boolean).join(", ")}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Reçue le</dt>
                    <dd>{formatDateTime(d.createdAt)}</dd>
                  </div>
                  {d.decidedAt ? (
                    <div>
                      <dt>Traitée le</dt>
                      <dd>{formatDateTime(d.decidedAt)}</dd>
                    </div>
                  ) : null}
                </dl>
                {d.message ? <blockquote>{d.message}</blockquote> : null}
                {d.refusalReason ? <p className="muted">Motif du refus : {d.refusalReason}</p> : null}
                {d.status === AccessRequestStatus.PENDING ? (
                  <div className="dem-actions">
                    <Button variant="secondary" onClick={() => setRefusing(d)} aria-label={`Refuser la demande de ${d.name}`}>
                      Refuser
                    </Button>
                    <Button onClick={() => setAccepting(d)} disabled={!roles.data} aria-label={`Accepter la demande de ${d.name}`}>
                      Accepter
                    </Button>
                  </div>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>

      <AcceptModal demande={accepting} roles={roles.data ?? []} onClose={() => setAccepting(null)} onDone={done} />
      <RefuseModal demande={refusing} onClose={() => setRefusing(null)} onDone={done} />
    </AppShell>
  );
}
