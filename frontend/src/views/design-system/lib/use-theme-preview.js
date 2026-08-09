import { useCallback, useEffect, useLayoutEffect, useState } from "react";

const DARK_CLASS = "dark";

/**
 * `useLayoutEffect` n'existe pas au prérendu statique : on retombe sur
 * `useEffect` côté serveur pour éviter l'avertissement React.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Bascule la classe `dark` sur `<html>` le temps de la visite de cette page.
 *
 * La pose de la classe est un **effet de layout** : les effets passifs des
 * composants enfants (dont la lecture des variables CSS calculées) s'exécutent
 * après, et voient donc le thème déjà appliqué. Avec un `useEffect` classique,
 * l'ordre enfant → parent ferait lire les valeurs du thème précédent.
 *
 * Le reste de l'application n'est pas validé en thème sombre — les couleurs de
 * tracé du canvas sont figées en clair dans `entities/detection`. On nettoie
 * donc au démontage pour ne pas laisser fuiter le thème vers l'analyse.
 */
export function useThemePreview() {
  const [isDark, setIsDark] = useState(false);

  useIsomorphicLayoutEffect(() => {
    document.documentElement.classList.toggle(DARK_CLASS, isDark);
  }, [isDark]);

  useEffect(
    () => () => {
      document.documentElement.classList.remove(DARK_CLASS);
    },
    [],
  );

  const toggle = useCallback(() => setIsDark((current) => !current), []);

  return { isDark, toggle };
}
