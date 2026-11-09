import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/shared/ui";

import { SessionStatus, useCurrentUser } from "../model/session-context";

/**
 * Garde de route. Redirige vers `/login?next=…` sans session ; avec session
 * mais sans la permission demandée, affiche un refus (le backend refuse de
 * toute façon : la garde ne sert qu'à l'ergonomie).
 *
 * - `permission` : une permission exigée ;
 * - `anyOf` : au moins une permission de la liste.
 */
export function RequireAuth({ permission, anyOf, children }) {
  const { status, canAny } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (status === SessionStatus.ANONYMOUS) {
      router.replace({ pathname: "/login", query: { next: router.asPath } });
    }
  }, [status, router]);

  if (status !== SessionStatus.AUTHENTICATED) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <LoaderCircle className="animate-spin" aria-label="Chargement de la session" />
      </div>
    );
  }

  const required = anyOf ?? (permission ? [permission] : []);
  if (required.length > 0 && !canAny(required)) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Accès refusé</AlertTitle>
          <AlertDescription>Votre rôle ne permet pas d&apos;accéder à cette page.</AlertDescription>
        </Alert>
      </main>
    );
  }

  return children;
}
