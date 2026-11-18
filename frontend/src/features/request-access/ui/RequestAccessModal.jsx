import { useState } from "react";

import { ErrorCode, httpClient, toAppError } from "@/shared/api";
import { Alert, Button, Modal } from "@/shared/ui";

/**
 * Demande d'accès (il n'y a pas d'inscription libre). Le backend n'expose pas
 * encore de route de demande : en cas de 404, l'écran le dit au lieu de
 * prétendre avoir transmis la demande.
 */
async function sendAccessRequest(payload) {
  await httpClient.post("/access-requests", payload, { skipAuth: true });
}

export function RequestAccessModal({ open, onClose }) {
  const [form, setForm] = useState({ name: "", profile: "Chirurgien-dentiste", office: "", city: "Toliara", email: "", message: "" });
  const [state, setState] = useState({ status: "idle", error: null });
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const close = () => {
    onClose();
    setState({ status: "idle", error: null });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setState({ status: "idle", error: "Indiquez au moins votre nom et votre e-mail professionnel." });
      return;
    }
    setState({ status: "pending", error: null });
    try {
      await sendAccessRequest(form);
      setState({ status: "sent", error: null });
    } catch (cause) {
      const error = toAppError(cause);
      setState({
        status: "idle",
        error:
          error.code === ErrorCode.NOT_FOUND
            ? "L’envoi des demandes en ligne n’est pas encore ouvert sur ce serveur. Contactez directement l’administrateur de la plateforme : c’est lui qui crée les comptes."
            : error.message,
      });
    }
  };

  return (
    <Modal open={open} onClose={close} labelledBy="accessTitle" wide={560}>
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        {state.status === "sent" ? (
          <>
            <Alert tone="success" icon="check" title="Demande transmise à l'administrateur">
              Vous recevrez un e-mail quand votre compte sera créé.
            </Alert>
            <div className="modal-actions">
              <Button onClick={close}>Fermer</Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="accessTitle">Demander un accès</h2>
            <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
              Il n&apos;y a pas d&apos;inscription libre. Votre demande est transmise à l&apos;administrateur, qui crée le compte.
            </p>
            {state.error ? (
              <Alert tone="warning" icon="info" role="alert">
                {state.error}
              </Alert>
            ) : null}
            <div className="two-col">
              <div className="field">
                <label className="label" htmlFor="aName">
                  Nom et prénom
                </label>
                <input className="input" id="aName" required autoComplete="name" value={form.name} onChange={set("name")} />
              </div>
              <div className="field">
                <label className="label" htmlFor="aRole">
                  Profil
                </label>
                <select className="select" id="aRole" value={form.profile} onChange={set("profile")}>
                  <option>Chirurgien-dentiste</option>
                  <option>Enseignant ou jury</option>
                  <option>Autre</option>
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="aCab">
                  Cabinet ou établissement
                </label>
                <input className="input" id="aCab" value={form.office} onChange={set("office")} />
              </div>
              <div className="field">
                <label className="label" htmlFor="aCity">
                  Ville
                </label>
                <input className="input" id="aCity" value={form.city} onChange={set("city")} />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="aMail">
                E-mail professionnel
              </label>
              <input className="input" type="email" id="aMail" required autoComplete="email" value={form.email} onChange={set("email")} />
            </div>
            <div className="field">
              <label className="label" htmlFor="aMsg">
                Message (facultatif)
              </label>
              <textarea className="textarea" id="aMsg" value={form.message} onChange={set("message")} />
            </div>
            <div className="modal-actions">
              <Button variant="secondary" onClick={close}>
                Annuler
              </Button>
              <Button type="submit" disabled={state.status === "pending"}>
                Envoyer la demande
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
