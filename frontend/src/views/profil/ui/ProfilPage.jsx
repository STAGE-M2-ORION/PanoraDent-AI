import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  GOOGLE_LINK_URL,
  Permission,
  changeMyPassword,
  displayName,
  fetchMySessions,
  removeMyPhoto,
  revokeMySession,
  roleLabel,
  updateMyPreferences,
  updateMyProfile,
  uploadMyPhoto,
  useCurrentUser,
} from "@/entities/session";
import { NewPasswordFields, checkNewPassword } from "@/features/set-password";
import { toAppError } from "@/shared/api";
import { formatDateTime } from "@/shared/lib";
import { Alert, Avatar, Badge, Button, Field, GoogleMark, Icon, Input, PasswordInput, Select } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const TABS = [
  { id: "informations", label: "Informations" },
  { id: "preferences", label: "Préférences" },
  { id: "securite", label: "Sécurité" },
];

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 2 * 1024 * 1024;

const SOURCE_LABEL = {
  importee: "Photo importée",
  google: "Photo de votre compte Google",
};

/** Retours du rattachement Google (`?google=rattache` ou `?erreur=<code>`). */
const LINK_RESULTS = {
  rattache: { tone: "success", text: "Votre compte Google est rattaché : vous pouvez désormais vous connecter avec « Continuer avec Google »." },
  google_non_rattache: {
    tone: "danger",
    text: "Ce compte Google n’a pas pu être rattaché : il doit porter la même adresse que votre compte PanoraDent AI, et ne pas être déjà utilisé par un autre compte.",
  },
  google_non_autorise: { tone: "danger", text: "La connexion Google n’est pas autorisée pour votre compte. Demandez-la à l’administrateur." },
  compte_desactive: { tone: "danger", text: "Votre compte est désactivé." },
  adresse_non_verifiee: { tone: "danger", text: "Google n’a pas confirmé que cette adresse vous appartient." },
  session_expiree: { tone: "info", text: "Votre session avait expiré pendant le rattachement. Recommencez." },
  etat_invalide: { tone: "info", text: "Le rattachement n’a pas abouti (demande expirée ou interrompue). Recommencez." },
  echec_google: { tone: "info", text: "Google n’a pas pu confirmer votre identité. Recommencez." },
};

const q = (value) => (typeof value === "string" ? value : "");

/** « Chrome · Windows » à partir du User-Agent enregistré avec la session. */
export function describeAgent(agent = "") {
  const ua = agent || "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  if (browser || os) return [browser, os].filter(Boolean).join(" · ");
  return ua ? ua.slice(0, 40) : "Appareil inconnu";
}

function Msg({ msg }) {
  return <div aria-live="polite">{msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}</div>;
}

// --- Informations -------------------------------------------------------------------------------

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
      setMsg({ tone: "danger", text: "La photo dépasse 2 Mo." });
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
        <div className="form" style={{ gap: 8 }}>
          <p className="hint" style={{ margin: 0 }}>
            {source ? SOURCE_LABEL[source] : "Aucune photo : vos initiales sont affichées."}
            {source !== "importee" ? " Vous pouvez importer la vôtre (JPEG, PNG ou WebP, 2 Mo au plus) : elle sera recadrée en carré." : null}
          </p>
          <div className="btn-row">
            <input ref={inputRef} type="file" accept={PHOTO_TYPES.join(",")} hidden onChange={onFile} />
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Icon name="upload" /> {source === "importee" ? "Changer la photo" : "Importer une photo"}
            </Button>
            {source === "importee" ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(removeMyPhoto, "Photo importée retirée.")}>
                Retirer la photo importée
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <Msg msg={msg} />
    </section>
  );
}

const IDENTITY_FIELDS = [
  { key: "prenom", label: "Prénom", autoComplete: "given-name", max: 120 },
  { key: "nom", label: "Nom", autoComplete: "family-name", max: 120 },
  { key: "titre", label: "Titre", placeholder: "Dr, Pr…", autoComplete: "honorific-prefix", max: 80 },
  { key: "specialite", label: "Spécialité", placeholder: "Orthodontie, omnipratique…", max: 120 },
  { key: "numero_ordre", label: "Numéro d’ordre", placeholder: "Inscription à l’Ordre", max: 60 },
  { key: "telephone", label: "Téléphone professionnel", autoComplete: "tel", type: "tel", max: 30 },
];

function fromUser(user) {
  return {
    prenom: user?.prenom ?? "",
    nom: user?.nom ?? "",
    titre: user?.titre ?? "",
    specialite: user?.specialite ?? "",
    numero_ordre: user?.numeroOrdre ?? "",
    telephone: user?.telephone ?? "",
  };
}

/** Comment ces informations apparaîtront en signature du compte rendu. */
function SignaturePreview({ form, email }) {
  const name = [form.titre, form.prenom, form.nom].map((s) => s.trim()).filter(Boolean).join(" ") || email;
  const lines = [form.specialite, form.numero_ordre && `N° d’ordre ${form.numero_ordre}`, form.telephone].map((s) => (s || "").trim()).filter(Boolean);
  return (
    <div className="field">
      <span className="label">Aperçu de la signature du compte rendu</span>
      <div className="signature" aria-live="polite">
        <span className="nom">{name}</span>
        {lines.map((line) => (
          <span key={line} className="ligne">
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

function IdentityCard() {
  const { user, setUser } = useCurrentUser();
  const [form, setForm] = useState(() => fromUser(user));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const updated = await updateMyProfile(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])));
      setUser(updated);
      setForm(fromUser(updated));
      setMsg({ tone: "success", text: "Informations enregistrées." });
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad" aria-labelledby="h-info">
      <div className="card-head">
        <h3 id="h-info">Identité et coordonnées</h3>
      </div>
      <form className="form" onSubmit={save}>
        <div className="grid-2">
          {IDENTITY_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`i-${f.key}`}>
              <Input id={`i-${f.key}`} type={f.type ?? "text"} autoComplete={f.autoComplete} placeholder={f.placeholder} maxLength={f.max} value={form[f.key]} onChange={set(f.key)} />
            </Field>
          ))}
        </div>
        <div className="grid-2">
          <Field label="Adresse e-mail" htmlFor="i-mail" hint="Identifiant de connexion : modifiable uniquement par l’administrateur.">
            <Input className="ro" id="i-mail" type="email" value={user?.email ?? ""} readOnly />
          </Field>
          <Field label="Rôle" htmlFor="i-role" hint="Modifiable uniquement par l’administrateur.">
            <Input className="ro" id="i-role" value={roleLabel(user?.role)} readOnly />
          </Field>
        </div>
        <SignaturePreview form={form} email={user?.email} />
        <Msg msg={msg} />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </section>
  );
}

// --- Préférences -------------------------------------------------------------------------------

function PreferencesCard() {
  const { user, setUser, can } = useCurrentUser();
  const gereLesComptes = can(Permission.USER_MANAGE);
  const [prefs, setPrefs] = useState(() => ({ ...user.preferences }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const preferences = await updateMyPreferences({
        theme: prefs.theme,
        langue: prefs.langue,
        seuil_confiance_defaut: Number(prefs.seuil_confiance_defaut),
        courriel_analyse_echouee: Boolean(prefs.courriel_analyse_echouee),
        courriel_analyse_rouverte: Boolean(prefs.courriel_analyse_rouverte),
        ...(gereLesComptes ? { courriel_demande_acces: Boolean(prefs.courriel_demande_acces) } : {}),
      });
      setUser({ ...user, preferences });
      setMsg({ tone: "success", text: "Préférences enregistrées. Elles s’appliquent sur tous vos postes." });
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    } finally {
      setBusy(false);
    }
  };

  const seuil = Math.round(Number(prefs.seuil_confiance_defaut ?? 0.5) * 100);
  return (
    <section className="card card-pad" aria-labelledby="h-prefs">
      <div className="card-head">
        <h3 id="h-prefs">Préférences</h3>
      </div>
      <form className="form" onSubmit={save}>
        <fieldset className="choices">
          <legend>Thème</legend>
          {[
            ["clair", "Clair"],
            ["sombre", "Sombre"],
            ["systeme", "Comme l’appareil"],
          ].map(([value, label]) => (
            <label key={value} className="choice">
              <input type="radio" name="theme" value={value} checked={prefs.theme === value} onChange={() => set("theme", value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <Field label="Langue" htmlFor="p-langue" hint="L’interface est en français ; l’anglais viendra plus tard.">
          <Select id="p-langue" value={prefs.langue} onChange={(e) => set("langue", e.target.value)}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field label="Seuil de confiance par défaut" htmlFor="p-seuil" hint="Détections affichées à l’ouverture d’une analyse ; vous pourrez toujours le déplacer.">
          <div className="range-row">
            <input
              id="p-seuil"
              type="range"
              min="5"
              max="95"
              step="5"
              value={seuil}
              onChange={(e) => set("seuil_confiance_defaut", Number(e.target.value) / 100)}
              aria-valuetext={`${seuil} %`}
            />
            <output htmlFor="p-seuil">{seuil}&nbsp;%</output>
          </div>
        </Field>
        <fieldset className="choices">
          <legend>Recevoir par e-mail</legend>
          <label className="check">
            <input type="checkbox" checked={Boolean(prefs.courriel_analyse_echouee)} onChange={(e) => set("courriel_analyse_echouee", e.target.checked)} />
            Une de mes analyses a échoué
          </label>
          <label className="check">
            <input type="checkbox" checked={Boolean(prefs.courriel_analyse_rouverte)} onChange={(e) => set("courriel_analyse_rouverte", e.target.checked)} />
            Une analyse que j’avais clôturée a été rouverte
          </label>
          {gereLesComptes ? (
            <label className="check">
              <input type="checkbox" checked={Boolean(prefs.courriel_demande_acces)} onChange={(e) => set("courriel_demande_acces", e.target.checked)} />
              Une demande d’accès attend une décision
            </label>
          ) : null}
          <p className="hint">
            Toutes les notifications arrivent aussi dans l’application (cloche). L’e-mail ne part que si vous ne les avez pas lues dans les 2 minutes, au plus un toutes les 5 minutes,
            avec la seule référence anonyme de l’analyse.
          </p>
        </fieldset>
        <Msg msg={msg} />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer mes préférences"}
          </Button>
        </div>
      </form>
    </section>
  );
}

// --- Sécurité ----------------------------------------------------------------------------------

function LoginModesCard() {
  const { user } = useCurrentUser();
  const passwordAllowed = user.loginModes.includes("mot_de_passe");
  const googleAllowed = user.loginModes.includes("google");
  return (
    <section className="card card-pad" aria-labelledby="h-modes">
      <div className="card-head">
        <h3 id="h-modes">Modes de connexion</h3>
        <p className="hint" style={{ margin: 0 }}>
          Choisis par l’administrateur de votre cabinet.
        </p>
      </div>
      <ul className="rows">
        <li>
          <span className="ico" aria-hidden="true">
            <Icon name="key" />
          </span>
          <span className="txt">
            <strong>Adresse e-mail et mot de passe</strong>
            <span className="muted">{!passwordAllowed ? "Non autorisé pour ce compte." : user.hasPassword ? "Mot de passe défini." : "Aucun mot de passe : définissez-en un ci-dessous."}</span>
          </span>
          {passwordAllowed ? (
            <Badge tone={user.hasPassword ? "success" : "warning"} dot>
              {user.hasPassword ? "Actif" : "À définir"}
            </Badge>
          ) : (
            <Badge>Non autorisé</Badge>
          )}
        </li>
        <li>
          <span className="ico" aria-hidden="true">
            <GoogleMark />
          </span>
          <span className="txt">
            <strong>Compte Google</strong>
            <span className="muted">
              {!googleAllowed ? "Non autorisé pour ce compte." : user.googleLinked ? `Rattaché (${user.email}).` : `Pas encore rattaché. Utilisez le compte Google de l’adresse ${user.email}.`}
            </span>
          </span>
          {googleAllowed && !user.googleLinked ? (
            <a className="btn btn-secondary btn-sm" href={GOOGLE_LINK_URL}>
              Rattacher mon compte Google
            </a>
          ) : (
            <Badge tone={googleAllowed ? "success" : undefined} dot={googleAllowed}>
              {googleAllowed ? "Rattaché" : "Non autorisé"}
            </Badge>
          )}
        </li>
      </ul>
    </section>
  );
}

function PasswordCard({ onChanged }) {
  const { user, reload } = useCurrentUser();
  const [current, setCurrent] = useState("");
  const [value, setValue] = useState({ password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  if (!user.loginModes.includes("mot_de_passe")) return null;

  const submit = async (event) => {
    event.preventDefault();
    const problem = checkNewPassword(value, user.email);
    if (problem) {
      setMsg({ tone: "danger", text: problem });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await changeMyPassword(user.hasPassword ? current : null, value.password);
      setCurrent("");
      setValue({ password: "", confirm: "" });
      await reload();
      onChanged();
      setMsg({ tone: "success", text: "Mot de passe enregistré. Vos autres sessions ont été fermées ; celle-ci reste ouverte." });
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad" aria-labelledby="h-mdp">
      <div className="card-head">
        <h3 id="h-mdp">{user.hasPassword ? "Changer de mot de passe" : "Définir un mot de passe"}</h3>
        {!user.hasPassword ? (
          <p className="hint" style={{ margin: 0 }}>
            Utile si la connexion à Google est indisponible au cabinet.
          </p>
        ) : null}
      </div>
      <form className="form" onSubmit={submit}>
        <fieldset disabled={busy} className="form" style={{ border: 0, padding: 0, margin: 0 }}>
          {user.hasPassword ? (
            <Field label="Mot de passe actuel" htmlFor="s-actuel">
              <PasswordInput id="s-actuel" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
          ) : null}
          <NewPasswordFields value={value} onChange={setValue} email={user.email} idPrefix="s" disabled={busy} />
          <Msg msg={msg} />
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function SessionsCard({ version }) {
  const router = useRouter();
  const { logout } = useCurrentUser();
  const [sessions, setSessions] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      setSessions(await fetchMySessions());
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const signOut = async () => {
    await logout();
    router.replace({ pathname: "/connexion", query: { etat: "deconnecte" } });
  };

  const revoke = async (session) => {
    if (session.current) return signOut();
    try {
      await revokeMySession(session.id);
      setMsg({ tone: "success", text: `Session fermée : ${describeAgent(session.agent)}.` });
      load();
    } catch (cause) {
      setMsg({ tone: "danger", text: toAppError(cause).message });
    }
    return undefined;
  };

  return (
    <section className="card card-pad" aria-labelledby="h-sess">
      <div className="card-head">
        <h3 id="h-sess">Sessions ouvertes</h3>
        <p className="hint" style={{ margin: 0 }}>
          Une session inconnue ? Fermez-la, puis changez votre mot de passe.
        </p>
      </div>
      {sessions === null ? (
        <p className="muted">Chargement…</p>
      ) : (
        <ul className="rows" aria-label="Sessions ouvertes">
          {sessions.map((s) => (
            <li key={s.id}>
              <span className="ico" aria-hidden="true">
                <Icon name="monitor" />
              </span>
              <span className="txt">
                <strong>
                  {describeAgent(s.agent)} {s.current ? <Badge tone="primary">Cette session</Badge> : null}
                </strong>
                <span className="muted">
                  {s.ip || "Adresse inconnue"} · ouverte le {formatDateTime(s.createdAt)}
                </span>
              </span>
              <Button variant={s.current ? "secondary" : "ghost"} size="sm" onClick={() => revoke(s)}>
                {s.current ? (
                  <>
                    <Icon name="logout" /> Se déconnecter
                  </>
                ) : (
                  "Fermer cette session"
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Msg msg={msg} />
    </section>
  );
}

function SecurityTab() {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const code = q(router.query.google) || q(router.query.erreur);
  const result = LINK_RESULTS[code];
  return (
    <>
      {result ? (
        <Alert tone={result.tone} role={result.tone === "danger" ? "alert" : "status"} data-erreur={code}>
          {result.text}
        </Alert>
      ) : null}
      <LoginModesCard />
      <PasswordCard onChanged={() => setVersion((v) => v + 1)} />
      <SessionsCard version={version} />
    </>
  );
}

// --- Page -----------------------------------------------------------------------------------------

/**
 * Profil en trois onglets : Informations (photo, identité, signature),
 * Préférences (thème, langue, seuil, e-mails de notification) et Sécurité (modes de
 * connexion, mot de passe, sessions ouvertes). L'onglet est dans l'URL
 * (`?onglet=`) : le retour du rattachement Google ouvre « Sécurité ».
 */
export function ProfilPage() {
  const router = useRouter();
  const tab = TABS.some((t) => t.id === q(router.query.onglet)) ? q(router.query.onglet) : "informations";
  const tabRefs = useRef({});

  const select = (id) => {
    router.replace({ pathname: "/profil", query: id === "informations" ? {} : { onglet: id } }, undefined, { shallow: true });
  };

  const onKeyDown = (event) => {
    const index = TABS.findIndex((t) => t.id === tab);
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + delta + TABS.length) % TABS.length;
    select(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  return (
    <AppShell page="profil" title="Profil" crumbs="Compte" className="v-profil">
      <div className="stack">
        <div className="tabs" role="tablist" aria-label="Sections du profil" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              className="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="tab-panel stack" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
          {tab === "informations" ? (
            <>
              <PhotoCard />
              <IdentityCard />
            </>
          ) : null}
          {tab === "preferences" ? <PreferencesCard /> : null}
          {tab === "securite" ? <SecurityTab /> : null}
        </div>
      </div>
    </AppShell>
  );
}
