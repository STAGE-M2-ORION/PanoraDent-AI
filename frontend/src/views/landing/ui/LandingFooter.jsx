import { ScanLine } from "lucide-react";
import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ScanLine className="size-4 text-primary" aria-hidden="true" />
          PanoraDent AI — aide au diagnostic, prototype de recherche.
        </p>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/analyse" className="transition-colors hover:text-foreground">
            Poste d&apos;analyse
          </Link>
          <Link href="/design-system" className="transition-colors hover:text-foreground">
            Design system
          </Link>
          <Link href="#pipeline" className="transition-colors hover:text-foreground">
            Pipeline
          </Link>
        </nav>
      </div>
    </footer>
  );
}
