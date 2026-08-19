/** En-tête de section : le bloc révélé au défilement, la grille suit à part. */
export function SectionHeading({ eyebrow, title, description }) {
  return (
    <div data-reveal="section" className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-medium tracking-wide text-primary uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-lg text-muted-foreground text-pretty">{description}</p>
    </div>
  );
}
