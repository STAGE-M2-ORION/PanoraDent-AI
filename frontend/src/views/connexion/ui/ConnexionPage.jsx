import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { DetSwatch } from "@/entities/detection";
import { SessionEndReason, SessionStatus, homePathFor, startGoogleSignIn, useCurrentUser } from "@/entities/session";
import { Alert, GoogleMark, Icon } from "@/shared/ui";

/**
 * Codes d'échec renvoyés par le backend dans `?erreur=` au retour de Google.
 * `retry` : erreur passagère, on propose de recommencer (encart neutre) ;
 * sinon, le blocage relève de l'administrateur ou de Google (encart rouge).
 */
const ERRORS = {
  compte_inconnu: {
    title: "Aucun compte pour cette adresse Google",
    text: "Cette adresse n’est associée à aucun compte PanoraDent AI. Demandez à l’administrateur de votre cabinet de vous créer un compte avec cette adresse Google, puis reconnectez-vous.",
  },
  compte_desactive: {
    title: "Compte désactivé",
    text: "Votre compte a été désactivé. Contactez l’administrateur de votre cabinet pour qu’il le réactive.",
  },
  adresse_non_verifiee: {
    title: "Adresse Google non vérifiée",
    text: "Google n’a pas confirmé que cette adresse e-mail vous appartient. Vérifiez-la depuis les paramètres de votre compte Google, puis reconnectez-vous.",
  },
  etat_invalide: {
    retry: true,
    title: "La connexion n’a pas abouti",
    text: "La demande de connexion a expiré ou a été interrompue. Cela arrive si la page est restée ouverte longtemps ou si plusieurs onglets se connectent en même temps.",
  },
  echec_google: {
    retry: true,
    title: "La connexion n’a pas abouti",
    text: "Google n’a pas pu confirmer votre identité, par exemple si vous avez annulé ou si la connexion a été coupée.",
  },
};

/** Messages d'arrivée (`?etat=`), posés par la garde de route et la déconnexion. */
const ARRIVALS = {
  [SessionEndReason.EXPIRED]: { tone: "info", icon: "clock", text: "Votre session a expiré. Reconnectez-vous pour reprendre." },
  [SessionEndReason.SIGNED_OUT]: { tone: "success", icon: "check", text: "Vous êtes déconnecté." },
};

const queryValue = (value) => (typeof value === "string" ? value : "");

/**
 * Bouton « Continuer avec Google », conforme aux consignes de marque Google :
 * fond blanc, bordure #747775, texte #1F1F1F, logo « G » officiel. Il déclenche
 * une VRAIE navigation vers le backend (jamais un fetch).
 */
function GoogleButton({ pending, onClick }) {
  return (
    <button type="button" className="gsi-btn" onClick={onClick} disabled={pending} aria-describedby="hint-g">
      {pending ? <span className="gsi-spinner" aria-hidden="true" /> : <GoogleMark />}
      <span>{pending ? "Redirection vers Google…" : "Continuer avec Google"}</span>
    </button>
  );
}

/**
 * Écran de connexion : carte en deux colonnes (connexion 36 %, photo 64 %).
 * La connexion passe exclusivement par Google : aucun mot de passe.
 *
 * - `?erreur=<code>` : échec renvoyé par le backend au retour de Google ;
 * - `?etat=expiree` | `deconnecte` : bandeau d'arrivée.
 *
 * Déjà connecté : redirection vers la page d'arrivée du rôle.
 */
export function ConnexionPage() {
  const router = useRouter();
  const { status, user } = useCurrentUser();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState({ error: null, arrival: null });

  // Lu après hydratation : les messages entrent dans la région `aria-live`
  // déjà présente, ils sont donc annoncés par les lecteurs d'écran.
  useEffect(() => {
    if (!router.isReady) return;
    const code = queryValue(router.query.erreur);
    setNotice({
      error: code ? { code, ...(ERRORS[code] ?? ERRORS.echec_google) } : null,
      arrival: ARRIVALS[queryValue(router.query.etat)] ?? null,
    });
  }, [router.isReady, router.query.erreur, router.query.etat]);

  // Retour arrière depuis Google : la page peut sortir du cache du navigateur
  // avec le bouton encore « en cours ».
  useEffect(() => {
    const onPageShow = (event) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (status === SessionStatus.AUTHENTICATED) router.replace(homePathFor(user));
  }, [status, user, router]);

  const signIn = () => {
    setPending(true);
    startGoogleSignIn();
  };

  const { error, arrival } = notice;

  return (
    <div className="v-connexion">
      <Head>
        <title>Connexion · PanoraDent AI</title>
      </Head>
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-form">
            <Link className="auth-logo" href="/decouvrir" aria-label="PanoraDent AI, présentation">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/Logo_clair_transparent.svg" alt="PanoraDent AI" />
            </Link>

            <div className="panel-v">
              <h1>Connexion</h1>
              <p className="sous">Accès réservé aux praticiens et au personnel autorisé.</p>

              <div className="auth-notices" aria-live="polite" aria-atomic="true">
                {arrival && !error ? (
                  <Alert tone={arrival.tone} icon={arrival.icon}>
                    {arrival.text}
                  </Alert>
                ) : null}
                {error && !error.retry ? (
                  <Alert tone="danger" icon="alert" title={error.title} data-erreur={error.code}>
                    {error.text}
                  </Alert>
                ) : null}
                {error?.retry ? (
                  <div className="auth-neutral" data-erreur={error.code}>
                    <Icon name="info" />
                    <div>
                      <strong>{error.title}</strong>
                      <p>{error.text}</p>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={signIn} disabled={pending}>
                        Réessayer
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <GoogleButton pending={pending} onClick={signIn} />
              <p className="hint-g" id="hint-g">
                L’accès est réservé aux comptes créés par l’administrateur de votre cabinet. Utilisez l’adresse Google enregistrée sur votre compte.
              </p>
            </div>

            <p className="auth-foot">Prototype d’aide à la décision — non certifié. © 2026 PanoraDent AI.</p>
          </div>

          <aside className="auth-photo" aria-labelledby="side-t">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/medias/connexion/login-praticien.webp"
              width="1824"
              height="1344"
              alt="Praticienne de profil, assise à son poste dans un cabinet dentaire moderne, qui examine une radiographie panoramique affichée sur son écran. Image générée par IA."
            />
            <div className="photo-msg">
              <h2 id="side-t">
                Votre seconde lecture,
                <br />
                sous contrôle
              </h2>
              <p>Détection et numérotation des anomalies sur radiographies panoramiques. Le praticien garde la décision.</p>
              <Link href="/decouvrir">Découvrir la plateforme ›</Link>
            </div>
            <div className="float float-import" aria-hidden="true">
              <Icon name="upload" />
            </div>
            <div className="float float-result" aria-hidden="true">
              <p className="t">Analyse terminée</p>
              <ul>
                <li>
                  <DetSwatch label="caries" />
                  36 · carie · 94&nbsp;%
                </li>
                <li>
                  <DetSwatch label="periapical_lesion" />
                  46 · lésion apicale · 88&nbsp;%
                </li>
                <li>
                  <DetSwatch label="impacted_tooth" />
                  38 · dent incluse · 91&nbsp;%
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
