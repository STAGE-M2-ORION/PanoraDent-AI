import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { deleteRole } from "@/entities/role";
import { useAsyncAction } from "@/shared/lib";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "@/shared/ui";

/** Les rôles système et les rôles encore attribués ne sont pas supprimables. */
export function DeleteRoleButton({ role, onDeleted }) {
  const remove = useAsyncAction(() => deleteRole(role.id));
  const blockedReason = role.isSystem
    ? "Rôle système : non supprimable"
    : role.userCount > 0
      ? `Encore attribué à ${role.userCount} utilisateur(s)`
      : undefined;

  useEffect(() => {
    if (remove.error) toast.error(remove.error.message);
  }, [remove.error]);

  async function handleDelete() {
    await remove.run();
    onDeleted?.();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={Boolean(blockedReason)}
          title={blockedReason}
          aria-label={`Supprimer le rôle ${role.name}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer le rôle « {role.name} » ?</AlertDialogTitle>
          <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>Supprimer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
