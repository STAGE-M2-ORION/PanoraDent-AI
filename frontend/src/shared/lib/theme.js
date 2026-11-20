import { useCallback, useEffect, useState } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Préférence enregistrée sur le compte (`clair` | `sombre` | `systeme`) →
 * thème effectif (`light` | `dark`). `systeme` suit le réglage de l'appareil.
 */
export function resolveTheme(preference, systemPrefersDark = false) {
  if (preference === "sombre") return "dark";
  if (preference === "clair") return "light";
  return systemPrefersDark ? "dark" : "light";
}

function systemPrefersDark() {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Thème de l'application connectée, posé sur `<html data-theme>`.
 *
 * `preference` vient des préférences du compte (lues une fois au chargement de
 * l'application, avec `/moi`) ; sans préférence, on suit l'appareil. `toggle`
 * bascule localement (bouton de la barre du haut, catalogue du design system) :
 * à l'appelant de l'enregistrer s'il le souhaite. La vitrine et la connexion
 * restent toujours en clair : le thème est retiré quand l'écran qui l'a
 * demandé est démonté.
 */
export function useAppTheme(preference = "systeme") {
  const [override, setOverride] = useState(null);
  const [systemDark, setSystemDark] = useState(false);

  // Une nouvelle préférence (enregistrée depuis le profil) reprend la main.
  useEffect(() => setOverride(null), [preference]);

  useEffect(() => {
    setSystemDark(systemPrefersDark());
    let media;
    try {
      media = window.matchMedia(DARK_QUERY);
    } catch {
      return undefined;
    }
    const onChange = (event) => setSystemDark(event.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  const theme = override ?? resolveTheme(preference, systemDark);

  useEffect(() => {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  useEffect(
    () => () => {
      delete document.documentElement.dataset.theme;
    },
    [],
  );

  const toggle = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setOverride(next);
    return next;
  }, [theme]);

  return { theme, toggle };
}
