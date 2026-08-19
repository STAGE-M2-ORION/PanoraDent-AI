import { ArrowRight, ScanSearch } from "lucide-react";
import Link from "next/link";

import { SystemStatusLine, useSystemStatus } from "@/entities/system-status";
import { Badge, Button } from "@/shared/ui";

import { HeroVisual } from "./HeroVisual";

export function HeroSection() {
  const status = useSystemStatus();

  return (
    <section className="border-b border-border/60 bg-gradient-to-b from-secondary/60 to-background">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
        <div data-reveal="hero">
          <Badge variant="warning">Prototype de recherche — non certifié</Badge>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Les anomalies de la panoramique,{" "}
            <span className="text-primary">proposées en quelques secondes</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg text-muted-foreground text-pretty">
            PanoraDent AI analyse une radiographie panoramique dentaire, localise les
            structures et les lésions suspectes, puis produit un rapport PDF. Le praticien
            garde la main : chaque détection est une proposition à valider.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/analyse">
                <ScanSearch aria-hidden="true" />
                Analyser une panoramique
              </Link>
            </Button>

            <Button asChild variant="outline" size="lg">
              <Link href="#pipeline">
                Comment ça marche
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <SystemStatusLine status={status} className="mt-8" />
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}
