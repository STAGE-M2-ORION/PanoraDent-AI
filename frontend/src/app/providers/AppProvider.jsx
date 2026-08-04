/**
 * Point d'accroche unique des providers globaux (client de requêtes, thème,
 * i18n, error boundary…). Aujourd'hui transparent : l'application n'a pas
 * encore d'état partagé, mais les couches inférieures n'auront pas à changer
 * quand il en faudra un.
 */
export function AppProvider({ children }) {
  return <>{children}</>;
}
