import { LoaderCircle, Pencil, ShieldPlus, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { createRole, updateRole } from "@/entities/role";
import { useAsyncAction } from "@/shared/lib";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from "@/shared/ui";

/** Le rôle `admin` garde toutes les permissions : le serveur refuse de les modifier. */
const LOCKED_PERMISSIONS_ROLE = "admin";

/**
 * Création (sans `role`) ou édition (avec `role`) d'un rôle.
 * `permissions` est le catalogue `[{ code, description }]` issu de
 * `GET /api/permissions`. L'enregistrement REMPLACE l'ensemble des permissions.
 */
export function RoleEditorDialog({ role, permissions, onSaved }) {
  const isEdit = Boolean(role);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState(() => new Set(role?.permissions ?? []));

  const save = useAsyncAction((payload) =>
    isEdit ? updateRole(role.id, payload) : createRole(payload),
  );

  const permissionsLocked = role?.name === LOCKED_PERMISSIONS_ROLE;
  const nameLocked = Boolean(role?.isSystem);

  function resetForm() {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setSelected(new Set(role?.permissions ?? []));
    save.reset();
  }

  function handleOpenChange(next) {
    setOpen(next);
    resetForm(); // repart toujours de l'état du serveur (ouverture comme annulation)
  }

  function toggle(code, checked) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const payload = { name: name.trim(), description: description.trim() };
    if (!permissionsLocked) payload.permissions = [...selected];
    const saved = await save.run(payload);
    if (saved) {
      setOpen(false);
      onSaved?.(saved);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="outline" size="sm">
            <Pencil aria-hidden="true" />
            Modifier
          </Button>
        ) : (
          <Button>
            <ShieldPlus aria-hidden="true" />
            Nouveau rôle
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isEdit ? `Rôle « ${role.name} »` : "Créer un rôle"}</DialogTitle>
            <DialogDescription>
              Un utilisateur a exactement un rôle ; ses droits sont l&apos;ensemble des permissions cochées.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={`role-name-${role?.id ?? "new"}`}>Nom</Label>
            <Input
              id={`role-name-${role?.id ?? "new"}`}
              required
              minLength={2}
              maxLength={50}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={nameLocked}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`role-desc-${role?.id ?? "new"}`}>Description</Label>
            <Input
              id={`role-desc-${role?.id ?? "new"}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Permissions</legend>
            {permissionsLocked && (
              <p className="text-xs text-muted-foreground">
                Le rôle admin porte toujours toutes les permissions.
              </p>
            )}
            {permissions.map((permission) => {
              const id = `perm-${role?.id ?? "new"}-${permission.code}`;
              return (
                <div key={permission.code} className="flex items-start gap-3">
                  <Checkbox
                    id={id}
                    checked={selected.has(permission.code)}
                    onCheckedChange={(checked) => toggle(permission.code, checked === true)}
                    disabled={permissionsLocked}
                    className="mt-0.5"
                  />
                  <Label htmlFor={id} className="flex-col items-start gap-0.5 font-normal">
                    <span className="font-mono text-xs">{permission.code}</span>
                    <span className="text-muted-foreground">{permission.description}</span>
                  </Label>
                </div>
              );
            })}
          </fieldset>

          {save.error && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>{save.error.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={save.isPending || name.trim().length < 2}>
              {save.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
