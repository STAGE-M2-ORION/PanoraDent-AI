import { useRouter } from "next/router";
import { useEffect } from "react";

import { Permission, SessionStatus, useCurrentUser } from "@/entities/session";

/**
 * `/admin` → première page d'administration que le rôle autorise : un rôle
 * qui gère les rôles sans gérer les comptes n'atterrit pas sur un écran 403.
 */
export default function AdminIndex() {
  const router = useRouter();
  const { status, can } = useCurrentUser();
  useEffect(() => {
    if (status === SessionStatus.LOADING) return;
    if (status === SessionStatus.ANONYMOUS) router.replace("/connexion");
    else if (can(Permission.USER_MANAGE)) router.replace("/admin/comptes");
    else if (can(Permission.ROLE_MANAGE)) router.replace("/admin/roles");
    else router.replace("/tableau-de-bord");
  }, [status, can, router]);
  return null;
}
