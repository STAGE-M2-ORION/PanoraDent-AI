import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { homePathFor, resetPassword, useCurrentUser } from "@/entities/session";
import { LinkPasswordForm } from "@/features/set-password";
import { AuthCard } from "@/widgets/auth-card";

/**
 * Nouveau mot de passe, depuis le lien reçu par e-mail (`?jeton=`). La
 * réussite ouvre directement la session (les autres sessions du compte sont
 * fermées par le serveur) et mène à l'application.
 */
export function NouveauMotDePassePage() {
  const router = useRouter();
  const { reload } = useCurrentUser();
  const token = typeof router.query.jeton === "string" ? router.query.jeton : "";
  // Export statique : à la compilation, `isReady` est faux ; dans le navigateur,
  // sans `?jeton=`, il est vrai dès le premier rendu. Les deux premiers rendus
  // différaient (erreur d'hydratation React #418) : on attend d'être monté.
  const [monte, setMonte] = useState(false);
  useEffect(() => setMonte(true), []);

  return (
    <AuthCard docTitle="Nouveau mot de passe">
      <Head>
        {/* Le jeton est dans l'URL : il ne doit partir dans aucun en-tête Referer. */}
        <meta name="referrer" content="no-referrer" />
      </Head>
      <div className="panel-v">
        <h1>Nouveau mot de passe</h1>
        <p className="sous">Choisissez le mot de passe que vous utiliserez désormais. Vos autres sessions ouvertes seront fermées.</p>
        {monte && router.isReady ? (
          <LinkPasswordForm
            key={token}
            token={token}
            submitLabel="Enregistrer et me connecter"
            renewHint="Demandez un nouveau lien : il vous parviendra par e-mail."
            submit={(password) => resetPassword(token, password)}
            onDone={async () => {
              const user = await reload();
              router.replace(homePathFor(user));
            }}
          />
        ) : null}
      </div>
    </AuthCard>
  );
}
