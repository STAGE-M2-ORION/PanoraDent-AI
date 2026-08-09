import { useCallback, useEffect, useState } from "react";

const DARK_CLASS = "dark";

/**
 * Bascule la classe `dark` sur `<html>` le temps de la visite de cette page.
 *
 * Le reste de l'application n'est pas validé en thème sombre — les couleurs de
 * tracé du canvas sont figées en clair dans `entities/detection`. On nettoie
 * donc au démontage pour ne pas laisser fuiter le thème vers l'analyse.
 */
export function useThemePreview() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
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
