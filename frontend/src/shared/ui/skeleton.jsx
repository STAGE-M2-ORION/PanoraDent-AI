import { cn } from "@/shared/lib/utils"

function Skeleton({
  className,
  ...props
}) {
  return (
    <div
      data-slot="skeleton"
      // Modification projet : shadcn utilise `bg-accent`, teinté de la couleur
      // de marque. Un placeholder doit rester neutre, sinon il se lit comme un
      // bloc coloré volontaire — d'où `bg-muted`.
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props} />
  );
}

export { Skeleton }
