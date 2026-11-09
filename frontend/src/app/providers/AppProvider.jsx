import { SessionProvider } from "@/entities/session";
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
 * - `SessionProvider` : session utilisateur (jetons, profil, permissions) pour
 *   la garde de route et l'en-tête.
 *
 * `theme="light"` est explicite : sans lui, sonner suit `prefers-color-scheme`
 * via next-themes et afficherait des notifications sombres sur une application
 * qui, elle, n'existe qu'en clair.
 */
export function AppProvider({ children }) {
  return (
    <SessionProvider>
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster position="bottom-right" richColors theme="light" />
      </TooltipProvider>
    </SessionProvider>
  );
}
