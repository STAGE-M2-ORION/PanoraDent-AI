import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Fusionne des classes conditionnelles en résolvant les conflits Tailwind :
 * la dernière classe d'un même groupe gagne (`px-2 px-4` → `px-4`).
 *
 * Utilitaire attendu par les composants shadcn/ui.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
