import { Permission } from "@/entities/session";

/**
 * Navigation de l'application connectée. Chaque entrée n'apparaît que si le
 * rôle porte la permission demandée : la barre latérale suit les droits réels
 * (rôles système comme rôles personnalisés), pas une liste figée par rôle.
 */
export const NAVIGATION = [
  { href: "/tableau-de-bord", page: "tableau-de-bord", label: "Tableau de bord", icon: "home" },
  { href: "/nouvelle-analyse", page: "nouvelle-analyse", label: "Nouvelle analyse", icon: "upload", permission: Permission.ANALYSIS_CREATE },
  { href: "/historique", page: "historique", label: "Historique", icon: "history", permission: Permission.ANALYSIS_READ },
  { href: "/performance", page: "performance", label: "Performance du modèle", icon: "chart", permission: Permission.MODEL_READ },
  { group: "Administration", anyOf: [Permission.USER_MANAGE, Permission.ROLE_MANAGE] },
  { href: "/admin/comptes", page: "admin-comptes", label: "Comptes", icon: "users", permission: Permission.USER_MANAGE },
  { href: "/admin/roles", page: "admin-roles", label: "Rôles et permissions", icon: "key", permission: Permission.ROLE_MANAGE },
  { href: "/admin/audit", page: "admin-audit", label: "Journal d'audit", icon: "list", permission: Permission.USER_MANAGE },
  { href: "/admin/supervision", page: "admin-supervision", label: "Supervision", icon: "activity", permission: Permission.USER_MANAGE },
];

/** Entrées visibles pour un jeu de permissions. */
export function visibleNavigation(can, canAny) {
  return NAVIGATION.filter((item) => {
    if (item.group) return canAny(item.anyOf);
    return !item.permission || can(item.permission);
  });
}
