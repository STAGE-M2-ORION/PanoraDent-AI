import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect } from "react";

import { SessionStatus, homePathFor, useCurrentUser } from "@/entities/session";

/**
 * `/` : simple aiguillage, sans écran propre. C'est aussi l'adresse où le
 * backend renvoie après une connexion Google réussie.
 *
 * - connecté → page d'arrivée du rôle (`/admin` avec `user:manage`, sinon
 *   `/tableau-de-bord`) ;
 * - sans session → `/connexion`.
 *
 * La vitrine publique vit sur `/decouvrir`.
 */
export function RacinePage() {
  const router = useRouter();
  const { status, user, endReason } = useCurrentUser();

  useEffect(() => {
    if (status === SessionStatus.AUTHENTICATED) router.replace(homePathFor(user));
    else if (status === SessionStatus.ANONYMOUS) router.replace({ pathname: "/connexion", query: endReason ? { etat: endReason } : {} });
  }, [status, user, endReason, router]);

  return (
    <>
      <Head>
        <title>PanoraDent AI</title>
      </Head>
      <div className="shell-loading" role="status">
        <span className="sr-only">Chargement de la session…</span>
      </div>
    </>
  );
}
