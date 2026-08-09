import { cn } from "@/shared/lib";

/** Bloc de démonstration : titre, intention, puis rendu réel des composants. */
export function Section({ title, description, children, className }) {
  return (
    <section className={cn("scroll-mt-24 space-y-4", className)}>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** Surface neutre sur laquelle poser les exemples, pour les isoler du fond. */
export function Canvas({ children, className }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border bg-card p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Étiquette d'un exemple : le nom de la variante montrée juste au-dessus. */
export function Specimen({ label, children, className }) {
  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      {children}
      <code className="font-mono text-[11px] text-muted-foreground">{label}</code>
    </div>
  );
}
