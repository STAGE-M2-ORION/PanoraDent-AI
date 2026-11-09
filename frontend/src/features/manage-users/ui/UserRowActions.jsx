import { Trash2, UserCheck, UserX } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { deleteUser, updateUser } from "@/entities/user";
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

/**
 * Activer/désactiver et supprimer un compte. Le serveur refuse de toucher au
 * dernier administrateur actif ; son message est affiché tel quel.
 * `isSelf` désactive les actions sur son propre compte (aussi refusées côté API).
 */
export function UserRowActions({ user, isSelf, onChanged }) {
  const toggle = useAsyncAction((next) => updateUser(user.id, { isActive: next }));
  const remove = useAsyncAction(() => deleteUser(user.id));

  async function handleToggle() {
    const result = await toggle.run(!user.isActive);
    if (result) onChanged?.();
  }

  async function handleDelete() {
    await remove.run();
    onChanged?.();
  }

  // `run` ne rejette pas : l'erreur est dans l'état, on la montre en toast.
  const error = toggle.error ?? remove.error;
  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  return (
    <div className="flex justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleToggle}
        disabled={isSelf || toggle.isPending}
        title={isSelf ? "Vous ne pouvez pas modifier votre propre compte" : undefined}
      >
        {user.isActive ? <UserX aria-hidden="true" /> : <UserCheck aria-hidden="true" />}
        {user.isActive ? "Désactiver" : "Activer"}
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={isSelf}
            aria-label={`Supprimer ${user.email}`}
            title={isSelf ? "Vous ne pouvez pas supprimer votre propre compte" : undefined}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce compte ?</AlertDialogTitle>
            <AlertDialogDescription>
              {user.email} perdra immédiatement tout accès. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
