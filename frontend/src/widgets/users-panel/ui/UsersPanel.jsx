import { TriangleAlert } from "lucide-react";

import { useCurrentUser } from "@/entities/session";
import { fetchUsers } from "@/entities/user";
import { CreateUserDialog, UserRowActions } from "@/features/manage-users";
import { useAsyncResource } from "@/shared/lib";
import {
  Alert,
  AlertDescription,
  Badge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";

function formatLastLogin(date) {
  return date ? date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "Jamais";
}

/** Liste des comptes + création. `roles` alimente le sélecteur de rôle. */
export function UsersPanel({ roles }) {
  const { user: me, can } = useCurrentUser();
  const { data: users, error, isLoading, reload } = useAsyncResource(fetchUsers);

  return (
    <section aria-labelledby="users-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="users-heading" className="text-lg font-semibold">
          Utilisateurs
        </h2>
        {can("user:manage") && <CreateUserDialog roles={roles} onCreated={reload} />}
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {isLoading && !users ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        users && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Dernière connexion</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.email}</div>
                      {row.fullName && (
                        <div className="text-xs text-muted-foreground">{row.fullName}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.isActive ? "success" : "outline"}>
                        {row.isActive ? "Actif" : "Désactivé"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatLastLogin(row.lastLoginAt)}
                    </TableCell>
                    <TableCell>
                      {can("user:manage") && (
                        <UserRowActions user={row} isSelf={row.id === me?.id} onChanged={reload} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}
    </section>
  );
}
