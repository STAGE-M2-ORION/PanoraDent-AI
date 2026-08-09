import { TooltipProvider } from "@/shared/ui";

/**
 * Point d'accroche unique des providers globaux (thème, i18n, error
 * boundary…). Aujourd'hui il ne monte que `TooltipProvider`, requis par les
 * tooltips shadcn/ui pour partager le délai d'ouverture entre déclencheurs.
 */
export function AppProvider({ children }) {
  return <TooltipProvider delayDuration={200}>{children}</TooltipProvider>;
}
