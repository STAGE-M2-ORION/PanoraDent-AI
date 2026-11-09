import { LoaderCircle, LogOut } from "lucide-react";

import { useCurrentUser } from "@/entities/session";
import { useAsyncAction } from "@/shared/lib";
import { Button } from "@/shared/ui";

/** Déconnexion : révoque les sessions côté serveur, vide les jetons locaux. */
export function SignOutButton() {
  const { logout } = useCurrentUser();
  const { run, isPending } = useAsyncAction(logout);

  return (
    <Button variant="outline" size="sm" onClick={() => run()} disabled={isPending}>
      {isPending ? (
        <LoaderCircle className="animate-spin" aria-hidden="true" />
      ) : (
        <LogOut aria-hidden="true" />
      )}
      Déconnexion
    </Button>
  );
}
