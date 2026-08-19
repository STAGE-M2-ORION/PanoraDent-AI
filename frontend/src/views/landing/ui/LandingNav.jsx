import { Palette, ScanLine, ScanSearch } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/ui";

export function LandingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-primary transition-opacity hover:opacity-80"
        >
          <ScanLine className="size-6" aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight">PanoraDent AI</span>
        </Link>

        <nav className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/design-system">
              <Palette aria-hidden="true" />
              Design system
            </Link>
          </Button>

          <Button asChild size="sm">
            <Link href="/analyse">
              <ScanSearch aria-hidden="true" />
              Analyser
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
