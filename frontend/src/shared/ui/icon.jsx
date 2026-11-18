import { ICONS } from "./icons";

/**
 * Icône du jeu PanoraDent. Décorative par défaut (`aria-hidden`) : le sens est
 * toujours porté par un texte voisin ou un `aria-label` sur le contrôle.
 */
export function Icon({ name, className, ...rest }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      // Fragments SVG statiques du module `icons.js`, jamais de donnée externe.
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.info }}
      {...rest}
    />
  );
}
