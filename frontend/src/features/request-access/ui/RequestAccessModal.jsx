import { useState } from "react";

import { PROFILES, submitAccessRequest, validateAccessRequest } from "@/entities/access-request";
import { toAppError } from "@/shared/api";
import { Alert, Button, Modal } from "@/shared/ui";

const VIDE = { name: "", profile: "Chirurgien-dentiste", office: "", city: "", email: "", message: "" };

/**
 * Demande d'accès (sprint 13) : il n'y a pas d'inscription libre. La demande
 * part à l'administrateur, prévenu par la cloche et par e-mail ; s'il
 * l'accepte, le demandeur reçoit le lien d'activation de son compte. La
 * réponse est la même quoi qu'il arrive (le serveur ne dit pas si un compte
 * existe déjà pour l'adresse).
 */
export function RequestAccessModal({ open, onClose }) {
  const [form, setForm] = useState(VIDE);
  const [state, setState] = useState({ status: "idle", error: null, message: null });
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const close = () => {
    onClose();
    if (state.status === "sent") setForm(VIDE);
    setState({ status: "idle", error: null, message: null });
  };

  const submit = async (event) => {
    event.preventDefault();
    const invalide = validateAccessRequest(form);
    if (invalide) {
      setState({ status: "idle", error: invalide, message: null });
      return;
    }
    setState({ status: "pending", error: null, message: null });
    try {
      const message = await submitAccessRequest({ ...form, name: form.name.trim(), email: form.email.trim() });
      setState({ status: "sent", error: null, message });
    } catch (cause) {
      // Trop de demandes depuis ce poste (429), champ refusé (422), réseau : le message du serveur.
      setState({ status: "idle", error: toAppError(cause).message, message: null });
    }
  };

  return (
    <Modal open={open} onClose={close} labelledBy="accessTitle" wide={560}>
      <form onSubmit={submit} noValidate style={{ display: "grid", gap: "var(--space-4)" }}>
        {state.status === "sent" ? (
          <>
            <Alert tone="success" icon="check" title="Demande transmise à l'administrateur">
              {state.message}
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
                  {PROFILES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="aCab">
                  Cabinet ou établissement
                </label>
                <input className="input" id="aCab" maxLength={160} value={form.office} onChange={set("office")} />
              </div>
              <div className="field">
                <label className="label" htmlFor="aCity">
                  Ville
                </label>
                <input className="input" id="aCity" maxLength={80} value={form.city} onChange={set("city")} />
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
              <textarea className="textarea" id="aMsg" maxLength={1000} value={form.message} onChange={set("message")} />
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
