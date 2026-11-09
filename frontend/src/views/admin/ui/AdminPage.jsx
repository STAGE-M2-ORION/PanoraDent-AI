import { TriangleAlert } from "lucide-react";

import { fetchRoles } from "@/entities/role";
import { RequireAuth, useCurrentUser } from "@/entities/session";
import { useAsyncResource } from "@/shared/lib";
import {
  Alert,
  AlertDescription,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui";
import { AppHeader } from "@/widgets/app-header";
import { RolesPanel } from "@/widgets/roles-panel";
import { UsersPanel } from "@/widgets/users-panel";

function AdminContent() {
  const { can } = useCurrentUser();
  const canUsers = can("user:manage");
  const canRoles = can("role:manage");
  const { data: roles, error, reload } = useAsyncResource(fetchRoles);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <AppHeader />
      <h2 className="sr-only">Administration</h2>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {!roles && !error && <Skeleton className="h-40 w-full" />}

      {roles && (
        <Tabs defaultValue={canUsers ? "users" : "roles"}>
          <TabsList>
            {canUsers && <TabsTrigger value="users">Utilisateurs</TabsTrigger>}
            {canRoles && <TabsTrigger value="roles">Rôles</TabsTrigger>}
          </TabsList>
          {canUsers && (
            <TabsContent value="users" className="mt-4">
              <UsersPanel roles={roles} />
            </TabsContent>
          )}
          {canRoles && (
            <TabsContent value="roles" className="mt-4">
              <RolesPanel roles={roles} onChanged={reload} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </main>
  );
}

/** Administration : visible pour qui peut gérer les comptes ou les rôles. */
export function AdminPage() {
  return (
    <RequireAuth anyOf={["user:manage", "role:manage"]}>
      <AdminContent />
    </RequireAuth>
  );
}
