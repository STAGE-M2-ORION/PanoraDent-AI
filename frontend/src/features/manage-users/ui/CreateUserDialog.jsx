import { LoaderCircle, TriangleAlert, UserPlus } from "lucide-react";
import { useState } from "react";

import { createUser } from "@/entities/user";
import { useAsyncAction } from "@/shared/lib";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  NativeSelect,
  NativeSelectOption,
} from "@/shared/ui";

const EMPTY_FORM = { email: "", fullName: "", password: "", roleId: "" };
const PASSWORD_MIN_LENGTH = 8;

/**
 * Création d'un compte par un administrateur (il n'existe pas d'inscription
 * publique). `roles` vient du parent : cette feature ne charge rien elle-même.
 */
export function CreateUserDialog({ roles, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const { run, isPending, error, reset } = useAsyncAction(createUser);

  const roleId = form.roleId || roles[0]?.id || "";
  const isValid = form.email && form.password.length >= PASSWORD_MIN_LENGTH && roleId;

  function update(field) {
    return (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));
  }

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) {
      setForm(EMPTY_FORM);
      reset();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const user = await run({ ...form, roleId });
    if (user) {
      handleOpenChange(false);
      onCreated?.(user);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden="true" />
          Nouvel utilisateur
        </Button>
      </DialogTrigger>

      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Créer un utilisateur</DialogTitle>
            <DialogDescription>
              Le compte est créé par un administrateur : il n&apos;existe pas d&apos;inscription publique.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input id="new-user-email" type="email" required value={form.email} onChange={update("email")} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new-user-name">Nom complet</Label>
            <Input id="new-user-name" value={form.fullName} onChange={update("fullName")} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new-user-password">Mot de passe initial</Label>
            <Input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={form.password}
              onChange={update("password")}
            />
            <p className="text-xs text-muted-foreground">
              {PASSWORD_MIN_LENGTH} caractères minimum. À communiquer par un canal sûr.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new-user-role">Rôle</Label>
            <NativeSelect id="new-user-role" className="w-full" value={roleId} onChange={update("roleId")}>
              {roles.map((role) => (
                <NativeSelectOption key={role.id} value={role.id}>
                  {role.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {error && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending || !isValid}>
              {isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
