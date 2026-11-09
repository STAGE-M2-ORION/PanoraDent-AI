import { LoaderCircle, LogIn, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { useCurrentUser } from "@/entities/session";
import { ErrorCode } from "@/shared/api";
import { useAsyncAction } from "@/shared/lib";
import { Alert, AlertDescription, AlertTitle, Button, Input, Label } from "@/shared/ui";

/** Titre de l'alerte selon la cause : identifiants faux ≠ compte verrouillé. */
function errorTitle(error) {
  if (error.code === ErrorCode.LOCKED) return "Compte verrouillé";
  if (error.code === ErrorCode.UNAUTHORIZED) return "Connexion refusée";
  return "Connexion impossible";
}

export function SignInForm({ onSignedIn }) {
  const { login } = useCurrentUser();
  const { run, isPending, error } = useAsyncAction(login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const user = await run(email, password);
    if (user) onSignedIn?.(user);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isPending}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="login-password">Mot de passe</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isPending}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>{errorTitle(error)}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={isPending || !email || !password}>
        {isPending ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            Connexion…
          </>
        ) : (
          <>
            <LogIn aria-hidden="true" />
            Se connecter
          </>
        )}
      </Button>
    </form>
  );
}
