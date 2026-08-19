import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui";

import { FEATURES } from "../lib/landing-content";

import { SectionHeading } from "./SectionHeading";

export function FeaturesSection() {
  return (
    <section id="fonctionnalites" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <SectionHeading
        eyebrow="Capacités"
        title="Une chaîne complète, de l'import au compte rendu"
        description="Quatre briques indépendantes, orchestrées par un backend unique."
      />

      <div data-reveal="stagger" className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <Card key={title} className="h-full">
            <CardHeader>
              <span className="mb-3 flex size-11 items-center justify-center rounded-lg bg-secondary text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <CardTitle>{title}</CardTitle>
              <CardDescription className="text-pretty">{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}
