import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "pd-theme";

function readTheme() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Thème clair / sombre de l'application connectée. Le choix est posé sur
 * `<html data-theme>` et mémorisé dans le navigateur. La vitrine et la
 * connexion restent toujours en clair : le thème est retiré quand l'écran qui
 * l'a demandé est démonté.
 */
export function useAppTheme() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const initial = readTheme();
    setTheme(initial);
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, []);

  useEffect(() => {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* stockage indisponible : le choix vaut pour la session */
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
