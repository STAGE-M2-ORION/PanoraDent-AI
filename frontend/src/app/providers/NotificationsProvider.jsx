import { NotificationsContext, useNotifications } from "@/entities/notification";
import { SessionStatus, useCurrentUser } from "@/entities/session";
import { useToast } from "@/shared/ui";

/**
 * Une seule connexion aux notifications pour toute l'application, ouverte
 * dès que la session l'est et fermée à la déconnexion : changer de page ne la
 * coupe pas. Chaque arrivée s'annonce aussi par un message éphémère.
 */
export function NotificationsProvider({ children }) {
  const { status } = useCurrentUser();
  const toast = useToast();
  const enabled = status === SessionStatus.AUTHENTICATED;
  const center = useNotifications({ enabled, onArrive: (n) => toast(n.title) });
  return <NotificationsContext.Provider value={{ ...center, enabled }}>{children}</NotificationsContext.Provider>;
}
