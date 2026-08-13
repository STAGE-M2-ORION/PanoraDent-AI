import { Toaster, TooltipProvider } from "@/shared/ui";

/**
 * Point d'accroche unique des providers globaux (thème, i18n, error
 * boundary…).
 *
 * - `TooltipProvider` : requis par les tooltips shadcn pour partager le délai
 *   d'ouverture entre déclencheurs.
 * - `Toaster` : point de rendu unique des notifications `sonner`. Sans lui,
 *   `toast()` n'affiche rien.
 *
 * `theme="light"` est explicite : sans lui, sonner suit `prefers-color-scheme`
 * via next-themes et afficherait des notifications sombres sur une application
 * qui, elle, n'existe qu'en clair.
 */
export function AppProvider({ children }) {
  return (
    <TooltipProvider delayDuration={200}>
      {children}
      <Toaster position="bottom-right" richColors theme="light" />
    </TooltipProvider>
  );
}
