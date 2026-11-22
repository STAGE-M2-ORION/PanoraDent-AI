import { useCallback, useEffect, useState } from "react";

import { summarizeRole } from "@/entities/role";
import { displayName, roleLabel } from "@/entities/session";
import { fetchUserSessions, resendFirstLogin, resetUserPassword, revokeUserSessions, updateUser } from "@/entities/user";
import { toAppError } from "@/shared/api";
import { formatDateTime } from "@/shared/lib";
import { Alert, Badge, Button, GoogleMark, Icon, Modal, UserPhoto } from "@/shared/ui";

const MODES = [
  { id: "mot_de_passe", label: "Adresse e-mail et mot de passe", icon: "key" },
  { id: "google", label: "Compte Google", google: true },
];

/** État d'un mode de connexion pour ce compte, en clair. */
function modeState(user, mode) {
  if (!user.loginModes.includes(mode)) return { tone: undefined, text: "Non autorisé" };
  if (mode === "mot_de_passe") return user.hasPassword ? { tone: "success", text: "Mot de passe choisi" } : { tone: "warning", text: "En attente de la première connexion" };
  return user.googleLinked ? { tone: "success", text: "Compte Google rattaché" } : { tone: "warning", text: "Pas encore rattaché" };
}

/** Courte description d'un appareil à partir du User-Agent. */
function device(agent) {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : null;
  const os = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS X/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : null;
  return [browser, os].filter(Boolean).join(" · ") || (agent ? agent.slice(0, 40) : "Appareil inconnu");
}

/**
 * Fiche d'un compte, pour l'administrateur : rôle (et ce qu'il autorise),
 * modes de connexion modifiables, dernière connexion, sessions ouvertes, et
 * les gestes d'accès — renvoyer le lien de première connexion, réinitialiser
 * le mot de passe, fermer les sessions. Chaque geste est confirmé dans la
 * fiche, puis inscrit au journal par le serveur.
 */
export function AccountSheet({ user, roles, me, onClose, onChanged }) {
  const [modes, setModes] = useState([]);
  const [sessions, setSessions] = useState(null);
  const [confirm, setConfirm] = useState(null); // "reset" | "sessions" | null
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const self = user && me && user.id === me.id;

  const loadSessions = useCallback(async () => {
    if (!user) return;
    try {
      setSessions(await fetchUserSessions(user.id));
    } catch (cause) {
      setSessions([]);
      setMsg({ tone: "danger", text: toAppError(cause).message });
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setModes([...user.loginModes]);
    setConfirm(null);
    setMsg(null);
    setSessions(null);
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) return <Modal open={false} onClose={onClose} labelledBy="m-sheet-t" />;

  const role = roles.find((r) => r.id === user.roleId);
  const summary = role ? summarizeRole(role.permissions) : null;
  const removed = user.loginModes.filter((m) => !modes.includes(m));
  const modesDirty = modes.length !== user.loginModes.length || removed.length > 0;
  const canResend = user.isActive && ((user.loginModes.includes("mot_de_passe") && !user.hasPassword) || (!user.loginModes.includes("mot_de_passe") && !user.googleLinked));
  const canReset = user.isActive && !self && user.loginModes.includes("mot_de_passe") && user.hasPassword;

  const run = async (action, success) => {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ tone: "success", text: success });
      setConfirm(null);
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    } finally {
      setBusy(false);
    }
  };

  const saveModes = () =>
    run(async () => {
      onChanged(await updateUser(user.id, { loginModes: modes }));
      loadSessions();
    }, removed.length ? "Modes enregistrés. Les sessions ouvertes du compte ont été fermées." : "Modes de connexion enregistrés.");

  const toggleMode = (id) => setModes((list) => (list.includes(id) ? list.filter((m) => m !== id) : [...list, id]));
  const name = displayName(user);

  return (
    <Modal open onClose={onClose} labelledBy="m-sheet-t" wide={640}>
      <div style={{ display: "grid", gap: "var(--space-5)" }} data-testid="fiche-compte">
        <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
          <span className="avatar" style={{ width: 56, height: 56, flex: "none" }} aria-hidden="true">
            <UserPhoto src={user.photoUrl} name={name} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 id="m-sheet-t" style={{ margin: 0 }}>
              {name}
            </h2>
            <p className="muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
              {user.email}
            </p>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <Badge tone={user.isActive ? "success" : undefined} dot={user.isActive}>
                {user.isActive ? "Actif" : "Désactivé"}
              </Badge>
              <Badge tone="primary">{roleLabel(user.role)}</Badge>
              {self ? <Badge>Votre compte</Badge> : null}
            </div>
          </div>
        </div>

        <div aria-live="polite">{msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}</div>

        <section aria-labelledby="f-role" style={{ display: "grid", gap: 4 }}>
          <h3 id="f-role" className="label" style={{ margin: 0 }}>
            Rôle : {roleLabel(user.role)}
          </h3>
          {summary ? (
            <>
              <p style={{ margin: 0 }}>{summary.can}</p>
              {summary.cannot ? (
                <p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
                  {summary.cannot}
                </p>
              ) : null}
            </>
          ) : null}
          <p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
            Créé le {user.createdAt ? formatDateTime(user.createdAt) : "—"} · Dernière connexion : {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "jamais"}
          </p>
        </section>

        <section aria-labelledby="f-modes" style={{ display: "grid", gap: "var(--space-2)" }}>
          <h3 id="f-modes" className="label" style={{ margin: 0 }}>
            Modes de connexion autorisés
          </h3>
          {MODES.map((m) => {
            const state = modeState(user, m.id);
            return (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 40, cursor: "pointer" }}>
                <input type="checkbox" checked={modes.includes(m.id)} onChange={() => toggleMode(m.id)} disabled={busy} style={{ width: 18, height: 18, margin: 0, accentColor: "var(--color-primary)" }} />
                <span aria-hidden="true" className="mode-ico">
                  {m.google ? <GoogleMark /> : <Icon name={m.icon} style={{ width: 18, height: 18 }} />}
                </span>
                <span style={{ flex: "1 1 auto" }}>{m.label}</span>
                <Badge tone={state.tone}>{state.text}</Badge>
              </label>
            );
          })}
          {modes.length === 0 ? <p className="error-text">Autorisez au moins un mode de connexion.</p> : null}
          {removed.length ? (
            <Alert tone="warning" icon="alert">
              Retirer un mode efface ce qui en dépend ({removed.includes("mot_de_passe") ? "le mot de passe choisi" : "le rattachement Google"}) et ferme les sessions ouvertes du compte.
            </Alert>
          ) : null}
          {modesDirty ? (
            <div>
              <Button size="sm" onClick={saveModes} disabled={busy || modes.length === 0}>
                Enregistrer les modes
              </Button>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="f-sess" style={{ display: "grid", gap: "var(--space-2)" }}>
          <h3 id="f-sess" className="label" style={{ margin: 0 }}>
            Sessions ouvertes
          </h3>
          {sessions === null ? (
            <p className="muted">Chargement…</p>
          ) : sessions.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Aucune session ouverte.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1em", display: "grid", gap: 4 }} aria-label="Sessions ouvertes du compte">
              {sessions.map((s) => (
                <li key={s.id}>
                  <strong>{device(s.agent)}</strong> <span className="muted">· {s.ip || "adresse inconnue"} · ouverte le {formatDateTime(s.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {confirm ? (
          <Alert tone="warning" icon="alert" title={confirm === "reset" ? "Réinitialiser le mot de passe ?" : "Fermer toutes les sessions ?"}>
            <p style={{ margin: "0 0 8px" }}>
              {confirm === "reset"
                ? `Les sessions de ${name} seront fermées et un lien d’une heure lui sera envoyé pour choisir un nouveau mot de passe. Vous ne verrez jamais son mot de passe.`
                : `${name} devra se reconnecter sur tous ses appareils.`}
            </p>
            <div className="btn-row">
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  confirm === "reset"
                    ? run(async () => {
                        await resetUserPassword(user.id);
                        loadSessions();
                      }, `Mot de passe réinitialisé : ${name} a reçu un lien par e-mail. L’action est inscrite au journal.`)
                    : run(async () => {
                        await revokeUserSessions(user.id);
                        loadSessions();
                      }, "Toutes les sessions du compte ont été fermées.")
                }
              >
                Confirmer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                Annuler
              </Button>
            </div>
          </Alert>
        ) : (
          <div className="btn-row">
            {canResend ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => resendFirstLogin(user.id), `Un nouveau lien a été envoyé à ${user.email} ; le précédent ne fonctionne plus.`)}>
                <Icon name="mail" /> Renvoyer le lien de première connexion
              </Button>
            ) : null}
            {canReset ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirm("reset")}>
                <Icon name="key" /> Réinitialiser le mot de passe
              </Button>
            ) : null}
            {!self && sessions?.length ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("sessions")}>
                <Icon name="logout" /> Fermer toutes les sessions
              </Button>
            ) : null}
          </div>
        )}

        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
