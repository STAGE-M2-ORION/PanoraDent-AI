import { Palette, ScanLine } from "lucide-react";
import Link from "next/link";

import { SystemStatusLine, useSystemStatus } from "@/entities/system-status";
import { Button } from "@/shared/ui";

export function AppHeader() {
  const status = useSystemStatus();

  return (
    <header className="mb-8 border-b-2 border-primary/70 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight text-primary">
            <ScanLine className="size-7" aria-hidden="true" />
            PanoraDent AI
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aide au diagnostic — prototype de recherche non certifié.
          </p>
        </div>

        <Button asChild variant="ghost" size="sm">
          <Link href="/design-system">
            <Palette aria-hidden="true" />
            Design system
          </Link>
        </Button>
      </div>

      <SystemStatusLine status={status} className="mt-4" />
    </header>
  );
}
