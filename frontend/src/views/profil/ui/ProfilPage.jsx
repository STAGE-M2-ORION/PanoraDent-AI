import { useRouter } from "next/router";
import { useRef, useState } from "react";

import { Permission, displayName, removeMyPhoto, roleLabel, uploadMyPhoto, useCurrentUser } from "@/entities/session";
import { updateUser } from "@/entities/user";
import { toAppError } from "@/shared/api";
import { formatDateTime } from "@/shared/lib";
import { Alert, Avatar, Badge, Button, GoogleMark, Icon } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 5 * 1024 * 1024;

const SOURCE_LABEL = {
  importee: "Photo importée",
  google: "Photo de votre compte Google",
};

/**
 * Photo de profil : celle du compte Google par défaut, remplaçable par une
 * photo importée (prioritaire), qu'on peut retirer pour revenir à Google.
 */
function PhotoCard() {
  const { user, setUser } = useCurrentUser();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const name = displayName(user);

  const run = async (action, success) => {
    setBusy(true);
    setMsg(null);
    try {
      setUser(await action());
      setMsg({ tone: "success", text: success });
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    } finally {
      setBusy(false);
    }
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // permet de reprendre le même fichier
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setMsg({ tone: "danger", text: "Formats acceptés : JPEG, PNG ou WebP." });
      return;
    }
    if (file.size > PHOTO_MAX) {
      setMsg({ tone: "danger", text: "La photo dépasse 5 Mo." });
      return;
    }
    run(() => uploadMyPhoto(file), "Photo de profil mise à jour.");
  };

  const source = user?.photoSource;
  return (
    <section className="card card-pad" aria-labelledby="h-photo">
      <div className="card-head">
        <h3 id="h-photo">Photo de profil</h3>
      </div>
      <div className="btn-row" style={{ alignItems: "center", gap: "var(--space-4, 16px)" }}>
        <Avatar src={user?.photoUrl} name={name} style={{ width: 72, height: 72, fontSize: "var(--text-lg, 1.25rem)" }} />
        <div className="stack" style={{ gap: 8 }}>
          <p className="hint" style={{ margin: 0 }}>
            {source ? SOURCE_LABEL[source] : "Aucune photo : vos initiales sont affichées."}
            {source !== "importee" ? " Vous pouvez importer la vôtre (JPEG, PNG ou WebP, 5 Mo au plus)." : null}
          </p>
          <div className="btn-row">
            <input ref={inputRef} type="file" accept={PHOTO_TYPES.join(",")} hidden onChange={onFile} />
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Icon name="upload" /> {source === "importee" ? "Changer la photo" : "Importer une photo"}
            </Button>
            {source === "importee" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => run(removeMyPhoto, "Photo importée retirée.")}
              >
                Retirer la photo importée
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <div aria-live="polite">{msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}</div>
    </section>
  );
}

function InfoCard() {
  const { user, can } = useCurrentUser();
  const [form, setForm] = useState({ prenom: user?.prenom ?? "", nom: user?.nom ?? "" });
  const [msg, setMsg] = useState(null);
  const canSave = can(Permission.USER_MANAGE);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!canSave) {
      setMsg({ tone: "info", text: "Votre nom est modifiable par l’administrateur de votre cabinet." });
      return;
    }
    try {
      await updateUser(user.id, { prenom: form.prenom.trim(), nom: form.nom.trim() });
      setMsg({ tone: "success", text: "Informations enregistrées. Elles s’afficheront au prochain chargement de l’application." });
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    }
  };

  return (
    <section className="card card-pad" aria-labelledby="h-info">
      <div className="card-head">
        <h3 id="h-info">Mes informations</h3>
      </div>
      <div className="form">
        <div className="field">
          <label className="label" htmlFor="i-prenom">
            Prénom
          </label>
          <input className="input" id="i-prenom" autoComplete="given-name" value={form.prenom} onChange={set("prenom")} readOnly={!canSave} />
        </div>
        <div className="field">
          <label className="label" htmlFor="i-nom">
            Nom
          </label>
          <input className="input" id="i-nom" autoComplete="family-name" value={form.nom} onChange={set("nom")} readOnly={!canSave} />
        </div>
        <div className="field">
          <label className="label" htmlFor="i-mail">
            Adresse Google
          </label>
          <input className="input ro" id="i-mail" type="email" autoComplete="email" value={user?.email ?? ""} readOnly aria-describedby="i-mail-h" />
          <span className="hint" id="i-mail-h">
            Identifiant de connexion : modifiable uniquement par l’administrateur.
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="i-role">
            Rôle
          </label>
          <input className="input ro" id="i-role" value={roleLabel(user?.role)} readOnly aria-describedby="i-role-h" />
          <span className="hint" id="i-role-h">
            Modifiable uniquement par l’administrateur.
          </span>
        </div>
        {msg ? (
          <Alert tone={msg.tone} role="status">
            {msg.text}
          </Alert>
        ) : null}
        <div>
          <Button variant="secondary" onClick={save}>
            Enregistrer mes informations
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Profil, connexion Google, session et rappel de sécurité. */
export function ProfilPage() {
  const router = useRouter();
  const { user, logout } = useCurrentUser();

  return (
    <AppShell page="profil" title="Profil" crumbs="Compte" className="v-profil">
      <div className="stack">
        <PhotoCard />
        <InfoCard />

        <section className="card card-pad" aria-labelledby="h-google">
          <div className="card-head">
            <h3 id="h-google">Connexion avec Google</h3>
            <span>
              <Badge tone="success" dot>
                Associée
              </Badge>
            </span>
          </div>
          <div className="btn-row" style={{ alignItems: "center" }}>
            <span className="method" aria-hidden="true">
              <GoogleMark />
            </span>
            <p className="hint" style={{ margin: 0 }}>
              Vous vous connectez avec le compte Google <strong>{user?.email}</strong>. Aucun mot de passe n’est enregistré par PanoraDent AI.
            </p>
          </div>
        </section>

        <section className="card card-pad" aria-labelledby="h-sess">
          <div className="card-head">
            <h3 id="h-sess">Session</h3>
          </div>
          <ul className="sess">
            <li>
              <span>
                <strong>Session actuelle</strong>
                <br />
                <span className="muted">{displayName(user)} · ce navigateur</span>
              </span>
              <Badge tone="success" dot>
                Active
              </Badge>
            </li>
            <li>
              <span>
                <strong>Dernière connexion</strong>
                <br />
                <span className="muted">{user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}</span>
              </span>
            </li>
          </ul>
          <div className="btn-row">
            <Button
              variant="secondary"
              onClick={async () => {
                await logout();
                router.replace({ pathname: "/connexion", query: { etat: "deconnecte" } });
              }}
            >
              <Icon name="logout" />
              Se déconnecter
            </Button>
          </div>
        </section>

        <section className="card card-pad" aria-labelledby="h-sec">
          <div className="card-head">
            <h3 id="h-sec">Rappel de sécurité</h3>
          </div>
          <ul className="sec-list">
            <li>Seuls les comptes créés par l’administrateur peuvent se connecter, avec l’adresse Google enregistrée.</li>
            <li>La session est prolongée automatiquement pendant l’utilisation, et dure 7 jours au plus.</li>
            <li>Un compte désactivé par l’administrateur ne peut plus se connecter.</li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
