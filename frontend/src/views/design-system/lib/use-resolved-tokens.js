import { useEffect, useState } from "react";

/**
 * Lit la valeur calculée des variables CSS sur `<html>`.
 *
 * La page affiche ainsi la valeur réellement appliquée — et la met à jour à la
 * bascule de thème — au lieu d'une copie figée qui dériverait du CSS.
 *
 * `tokenNames` doit avoir une identité stable (constante de module) : c'est une
 * dépendance d'effet.
 */
export function useResolvedTokens(tokenNames, revision) {
  const [values, setValues] = useState({});

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const resolved = {};

    for (const name of tokenNames) {
      resolved[name] = styles.getPropertyValue(`--${name}`).trim();
    }

    setValues(resolved);
  }, [tokenNames, revision]);

  return values;
}
