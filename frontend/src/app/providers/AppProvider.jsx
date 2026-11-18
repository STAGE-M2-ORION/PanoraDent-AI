import { SessionProvider } from "@/entities/session";
import { ToastProvider } from "@/shared/ui";

/**
 * Point d'accroche unique des providers globaux.
 *
 * - `SessionProvider` : session utilisateur (jetons, profil, permissions) pour
 *   la garde de route et la structure de l'application.
 * - `ToastProvider` : zone unique des notifications éphémères (`useToast`).
 */
export function AppProvider({ children }) {
  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
