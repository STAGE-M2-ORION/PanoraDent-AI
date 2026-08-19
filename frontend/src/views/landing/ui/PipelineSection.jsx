import { PIPELINE_STEPS } from "../lib/landing-content";

import { SectionHeading } from "./SectionHeading";

export function PipelineSection() {
  return (
    <section id="pipeline" className="border-y border-border/60 bg-muted/40 scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeading
          eyebrow="Pipeline"
          title="Ce qui se passe entre le dépôt et le rapport"
          description="Cinq étapes, franchies sans intervention entre l'import et l'affichage des détections."
        />

        <ol data-reveal="stagger" className="mt-14 grid gap-8 md:grid-cols-5">
          {PIPELINE_STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              {/*
                Trait de liaison, masqué sur la dernière étape et hors grille
                horizontale : en pile mobile, il pointerait dans le vide.
              */}
              {index < PIPELINE_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute top-5 left-12 hidden h-px w-[calc(100%-1rem)] bg-border md:block"
                />
              )}

              <span className="relative flex size-10 items-center justify-center rounded-full border border-primary/30 bg-background font-mono text-sm font-medium text-primary">
                {index + 1}
              </span>

              <h3 className="mt-4 font-medium">{step.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
