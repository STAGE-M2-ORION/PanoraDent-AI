import { Palette, ScanLine, Users } from "lucide-react";
import Link from "next/link";

import { useCurrentUser } from "@/entities/session";
import { SystemStatusLine, useSystemStatus } from "@/entities/system-status";
import { SignOutButton } from "@/features/sign-out";
import { Badge, Button } from "@/shared/ui";

export function AppHeader() {
  const status = useSystemStatus();
  const { user, canAny } = useCurrentUser();

  return (
    <header className="mb-8 border-b-2 border-primary/70 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {/* Le titre ramène à la vitrine : le poste d'analyse n'est plus la racine. */}
          <h1 className="text-3xl font-semibold tracking-tight text-primary">
            <Link
              href="/"
              className="flex items-center gap-2 transition-opacity hover:opacity-80"
            >
              <ScanLine className="size-7" aria-hidden="true" />
              PanoraDent AI
            </Link>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aide au diagnostic — prototype de recherche non certifié.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {user && (
            <span className="flex items-center gap-2 text-sm" data-testid="current-user">
              <span className="text-muted-foreground">{user.email}</span>
              <Badge variant="secondary">{user.role}</Badge>
            </span>
          )}

          {/* Visible seulement pour qui peut gérer comptes ou rôles. */}
          {canAny(["user:manage", "role:manage"]) && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin">
                <Users aria-hidden="true" />
                Administration
              </Link>
            </Button>
          )}

          <Button asChild variant="ghost" size="sm">
            <Link href="/design-system">
              <Palette aria-hidden="true" />
              Design system
            </Link>
          </Button>

          {user && <SignOutButton />}
        </div>
      </div>

      <SystemStatusLine status={status} className="mt-4" />
    </header>
  );
}
