import { SessionProvider } from "@/entities/session";
import { ToastProvider } from "@/shared/ui";

import { NotificationsProvider } from "./NotificationsProvider";

/**
 * Point d'accroche unique des providers globaux.
 *
 * - `SessionProvider` : session utilisateur (jetons, profil, permissions) pour
 *   la garde de route et la structure de l'application.
 * - `ToastProvider` : zone unique des notifications éphémères (`useToast`).
 * - `NotificationsProvider` : notifications de l'utilisateur et leur flux en
 *   temps réel, une seule connexion pour toute l'application (sprint 13).
 */
export function AppProvider({ children }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <NotificationsProvider>{children}</NotificationsProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
