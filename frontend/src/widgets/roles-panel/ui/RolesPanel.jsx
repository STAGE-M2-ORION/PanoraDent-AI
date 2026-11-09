import { TriangleAlert } from "lucide-react";

import { useCurrentUser } from "@/entities/session";
import { fetchPermissions } from "@/entities/role";
import { DeleteRoleButton, RoleEditorDialog } from "@/features/manage-roles";
import { pluralize, useAsyncResource } from "@/shared/lib";
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/shared/ui";

/** Rôles et leurs permissions. `roles` et `onChanged` viennent de la vue. */
export function RolesPanel({ roles, onChanged }) {
  const { can } = useCurrentUser();
  const { data: permissions, error, isLoading } = useAsyncResource(fetchPermissions);
  const canManage = can("role:manage");

  return (
    <section aria-labelledby="roles-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="roles-heading" className="text-lg font-semibold">
          Rôles
        </h2>
        {canManage && permissions && (
          <RoleEditorDialog permissions={permissions} onSaved={onChanged} />
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {isLoading && <Skeleton className="h-40 w-full" />}

      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {role.name}
                {role.isSystem && <Badge variant="outline">système</Badge>}
              </CardTitle>
              <CardDescription>
                {role.description || "Aucune description."} —{" "}
                {pluralize(role.userCount, "utilisateur")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ul className="flex flex-wrap gap-1.5" aria-label={`Permissions de ${role.name}`}>
                {role.permissions.length === 0 && (
                  <li className="text-sm text-muted-foreground">Aucune permission.</li>
                )}
                {role.permissions.map((code) => (
                  <li key={code}>
                    <Badge variant="secondary" className="font-mono">
                      {code}
                    </Badge>
                  </li>
                ))}
              </ul>

              {canManage && permissions && (
                <div className="flex justify-end gap-2">
                  <RoleEditorDialog role={role} permissions={permissions} onSaved={onChanged} />
                  <DeleteRoleButton role={role} onDeleted={onChanged} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
