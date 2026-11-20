import { useEffect, useMemo, useState } from "react";

import { fetchRoles } from "@/entities/role";
import { Permission, SystemRole, displayName, useCurrentUser } from "@/entities/session";
import { fetchUsers, updateUser } from "@/entities/user";
import { CreateUserModal, EditUserModal } from "@/features/manage-users";
import { toAppError } from "@/shared/api";
import { formatDate, formatTime, useAsyncResource } from "@/shared/lib";
import { Alert, Badge, Button, DateCell, GoogleMark, Icon, IconAction, UserPhoto } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const loadAll = () => Promise.all([fetchUsers(), fetchRoles()]);

const isAdminRole = (u) => u.roleIsSystem && u.role === SystemRole.ADMIN;

function RoleBadge({ user }) {
  const tone = user.roleIsSystem ? (user.role === SystemRole.ADMIN ? "primary" : user.role === SystemRole.PRACTITIONER ? "info" : undefined) : undefined;
  return <Badge tone={tone}>{user.role || "—"}</Badge>;
}

/**
 * Gestion des comptes : recherche, création, modification (nom, rôle),
 * activation et désactivation. Il n'y a pas de suppression : un compte qui ne
 * doit plus entrer est désactivé. Les refus du serveur s'affichent tels quels.
 */
export function AdminComptesPage() {
  const { user: me } = useCurrentUser();
  const { data, error, isLoading, reload } = useAsyncResource(loadAll);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [filters, setFilters] = useState({ q: "", role: "", status: "" });
  const [feedback, setFeedback] = useState(null);
  const [modal, setModal] = useState({ create: false, edit: null });

  useEffect(() => {
    if (data) {
      setUsers(data[0]);
      setRoles(data[1]);
    }
  }, [data]);

  const activeAdmins = users.filter((u) => isAdminRole(u) && u.isActive);
  // Indication seulement : c'est le serveur qui refuse (`dernier_administrateur`).
  const isLast = (u) => isAdminRole(u) && u.isActive && activeAdmins.length === 1;
  const list = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!q || `${u.fullName} ${u.email}`.toLowerCase().includes(q)) &&
        (!filters.role || String(u.roleId) === filters.role) &&
        (!filters.status || (filters.status === "actif" ? u.isActive : !u.isActive)),
    );
  }, [users, filters]);

  const say = (tone, title, text) => setFeedback({ tone, title, text });
  const replace = (updated) => setUsers((list0) => list0.map((u) => (u.id === updated.id ? updated : u)));

  const toggle = async (u) => {
    try {
      const updated = await updateUser(u.id, { isActive: !u.isActive });
      replace(updated);
      say(
        "success",
        updated.isActive ? "Compte réactivé" : "Compte désactivé",
        `${displayName(updated)} ${updated.isActive ? "peut de nouveau se connecter avec Google." : "ne peut plus se connecter."} L’action est inscrite au journal d’audit.`,
      );
    } catch (cause) {
      say("danger", "Action refusée", toAppError(cause).message);
    }
  };

  return (
    <AppShell
      page="admin-comptes"
      title="Comptes"
      crumbs="Administration"
      docTitle="Comptes · Administration"
      permission={Permission.USER_MANAGE}
      className="v-admin-comptes"
      overlay={
        <>
          <CreateUserModal
            open={modal.create}
            roles={roles}
            onClose={() => setModal((m) => ({ ...m, create: false }))}
            onCreated={(created) => {
              setUsers((list0) => [...list0, created]);
              setModal((m) => ({ ...m, create: false }));
              say(
                "success",
                "Compte créé",
                created.loginModes.includes("mot_de_passe")
                  ? `${displayName(created)} a reçu par e-mail, à l’adresse ${created.email}, un lien de première connexion pour choisir son mot de passe.`
                  : `${displayName(created)} a reçu une invitation à se connecter avec « Continuer avec Google », depuis l’adresse ${created.email}.`,
              );
            }}
          />
          <EditUserModal
            user={modal.edit}
            roles={roles}
            lastAdmin={modal.edit ? isLast(modal.edit) : false}
            onClose={() => setModal((m) => ({ ...m, edit: null }))}
            onSaved={(updated) => {
              replace(updated);
              setModal((m) => ({ ...m, edit: null }));
              say("success", "Compte modifié", `${displayName(updated)} a été mis à jour.`);
            }}
          />
        </>
      }
    >
      <div className="page-head">
        <div>
          <h2>Comptes</h2>
          <p>Il n’existe pas d’inscription publique : seuls les administrateurs créent les comptes et choisissent, compte par compte, les modes de connexion autorisés.</p>
        </div>
        <Button onClick={() => setModal((m) => ({ ...m, create: true }))} disabled={!roles.length}>
          <Icon name="plus" />
          Créer un compte
        </Button>
      </div>

      <div aria-live="polite" style={{ display: "grid", gap: "var(--space-3)" }}>
        {feedback ? (
          <Alert tone={feedback.tone} title={feedback.title} role={feedback.tone === "danger" ? "alert" : "status"} icon={feedback.tone === "success" ? "check" : feedback.tone === "danger" ? "alert" : "info"}>
            {feedback.text}
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="danger" title="Les comptes n’ont pas pu être chargés." role="alert">
            {error.message}{" "}
            <button type="button" className="btn btn-sm btn-ghost" onClick={reload}>
              Réessayer
            </button>
          </Alert>
        ) : null}
      </div>

      <Alert tone="info" role="note" title="Protection du dernier administrateur">
        Il doit toujours rester au moins un compte administrateur actif : le serveur refuse de désactiver le dernier ou de lui retirer son rôle tant qu’un autre administrateur
        n’existe pas.
      </Alert>

      <section className="card card-pad" aria-label="Recherche et filtres" style={{ display: "grid", gap: "var(--space-4)" }}>
        <div className="filters">
          <div className="field">
            <label className="label" htmlFor="q">
              Rechercher un compte
            </label>
            <input className="input" id="q" type="search" placeholder="Nom ou adresse Google" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <div className="field">
            <label className="label" htmlFor="f-role">
              Rôle
            </label>
            <select className="select" id="f-role" value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}>
              <option value="">Tous les rôles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="f-status">
              Statut
            </label>
            <select className="select" id="f-status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">Tous les statuts</option>
              <option value="actif">Actif</option>
              <option value="desactive">Désactivé</option>
            </select>
          </div>
        </div>
        <p className="count" aria-live="polite">
          {isLoading ? "Chargement des comptes…" : `${list.length} compte${list.length > 1 ? "s" : ""} affiché${list.length > 1 ? "s" : ""} sur ${users.length}.`}
        </p>
      </section>

      <div className="table-wrap">
        <table className="table stack">
          <caption className="sr-only">Liste des comptes</caption>
          <thead>
            <tr>
              <th scope="col">Nom et adresse Google</th>
              <th scope="col">Rôle</th>
              <th scope="col">Statut</th>
              <th scope="col">Connexion</th>
              <th scope="col" className="w">
                Dernière connexion
              </th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => {
              const name = displayName(u);
              return (
                <tr key={u.id}>
                  <th scope="row">
                    <div className="person">
                      <span className="av" aria-hidden="true">
                        <UserPhoto src={u.photoUrl} name={name} />
                      </span>
                      <div>
                        <strong>{name}</strong>
                        <span className="sub" title={u.email}>
                          {u.email}
                        </span>
                        {isLast(u) ? <span className="sub">Dernier administrateur</span> : null}
                        {u.id === me?.id ? <span className="sub">Votre compte</span> : null}
                      </div>
                    </div>
                  </th>
                  <td data-label="Rôle">
                    <RoleBadge user={u} />
                  </td>
                  <td data-label="Statut">
                    <div className="cell-col">
                      {u.isActive ? (
                        <Badge tone="success" dot>
                          Actif
                        </Badge>
                      ) : (
                        <Badge>Désactivé</Badge>
                      )}
                    </div>
                  </td>
                  <td data-label="Connexion" className="nowrap">
                    <span className="methods">
                      {u.loginModes.includes("mot_de_passe") ? (
                        <span className="method" title={u.hasPassword ? "Mot de passe défini" : "Mot de passe pas encore choisi"}>
                          <Icon name="key" />
                          <span className="sr-only">{u.hasPassword ? "Mot de passe" : "Mot de passe (en attente)"}</span>
                        </span>
                      ) : null}
                      {u.loginModes.includes("google") ? (
                        <span className="method" title={u.googleLinked ? "Compte Google rattaché" : "Google autorisé, pas encore rattaché"}>
                          <GoogleMark />
                          <span className="sr-only">{u.googleLinked ? "Google" : "Google (en attente)"}</span>
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td data-label="Dernière connexion">{u.lastLoginAt ? <DateCell date={formatDate(u.lastLoginAt)} time={formatTime(u.lastLoginAt)} /> : <span className="muted">Jamais connecté</span>}</td>
                  <td className="td-actions">
                    <div className="row-actions">
                      <IconAction icon="edit" label={`Modifier ${name} ou changer son rôle`} title="Modifier le compte ou changer de rôle" onClick={() => setModal((m) => ({ ...m, edit: u }))} />
                      {/* Pas de désactivation de son propre compte (refusée aussi par le serveur). */}
                      {u.id === me?.id ? null : (
                        <IconAction
                          icon={u.isActive ? "lock" : "unlock"}
                          label={`${u.isActive ? "Désactiver" : "Réactiver"} ${name}`}
                          title={u.isActive ? "Désactiver le compte" : "Réactiver le compte"}
                          onClick={() => toggle(u)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!isLoading && !error && list.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: "center" }}>
          <p>
            <strong>Aucun compte ne correspond à votre recherche.</strong>
          </p>
          <p className="muted">Modifiez les filtres ou effacez la recherche.</p>
        </div>
      ) : null}
      <p className="muted" style={{ fontSize: "var(--text-xs)" }}>
        PanoraDent AI ne connaît jamais les mots de passe : chacun choisit le sien par le lien reçu, et seule une empreinte est conservée.
      </p>
    </AppShell>
  );
}
