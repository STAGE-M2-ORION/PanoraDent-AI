import { ScanLine } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect } from "react";

import { SessionStatus, useCurrentUser } from "@/entities/session";
import { SignInForm } from "@/features/sign-in";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui";

const DEFAULT_DESTINATION = "/analyse";

/**
 * N'accepte qu'un chemin interne : `?next=https://evil.example` ou `//evil`
 * ne doivent jamais servir de redirection ouverte après connexion.
 */
function safeDestination(next) {
  const value = Array.isArray(next) ? next[0] : next;
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return DEFAULT_DESTINATION;
}

export function LoginPage() {
  const router = useRouter();
  const { status } = useCurrentUser();

  // Déjà connecté (ou connexion à l'instant) : on part vers la destination.
  useEffect(() => {
    if (router.isReady && status === SessionStatus.AUTHENTICATED) {
      router.replace(safeDestination(router.query.next));
    }
  }, [router, status]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-8">
      <h1 className="mb-6 flex items-center justify-center gap-2 text-3xl font-semibold tracking-tight text-primary">
        <ScanLine className="size-7" aria-hidden="true" />
        PanoraDent AI
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Connexion</CardTitle>
          <CardDescription>
            Accès réservé. Les comptes sont créés par un administrateur.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Prototype de recherche non certifié — la décision médicale relève exclusivement du praticien.
      </p>
    </main>
  );
}
