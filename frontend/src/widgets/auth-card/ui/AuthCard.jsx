import Head from "next/head";
import Link from "next/link";

/**
 * Gabarit des écrans d'authentification (connexion, mot de passe oublié,
 * nouveau mot de passe, première connexion) : la carte centrée de la
 * maquette, formulaire à gauche, photo à droite. Styles : `.v-connexion`.
 *
 * `aside` : fragments d'interface posés sur la photo (écran de connexion).
 */
export function AuthCard({ docTitle, aside, children }) {
  return (
    <div className="v-connexion">
      <Head>
        <title>{`${docTitle} · PanoraDent AI`}</title>
      </Head>
      <main className="auth-page">
        <div className="auth-card">
          <div className="auth-form">
            <Link className="auth-logo" href="/decouvrir" aria-label="PanoraDent AI, présentation">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/Logo_clair_transparent.svg" alt="PanoraDent AI" />
            </Link>
            {children}
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
            {aside}
          </aside>
        </div>
      </main>
    </div>
  );
}
