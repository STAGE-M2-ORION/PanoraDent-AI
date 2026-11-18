import { useEffect, useMemo, useState } from "react";

import { fetchRoles } from "@/entities/role";
import { Permission, SystemRole, roleLabel, useCurrentUser } from "@/entities/session";
import { deleteUser, fetchUsers, updateUser } from "@/entities/user";
import { CreateUserModal, DeleteUserModal, EditUserModal } from "@/features/manage-users";
import { toAppError } from "@/shared/api";
import { formatDate, formatTime, initials, useAsyncResource } from "@/shared/lib";
import { Alert, Badge, Button, DateCell, Icon, IconAction } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const LAST_TIP = "Impossible : c’est le dernier compte administrateur. Créez ou désignez un autre administrateur d’abord.";
const loadAll = () => Promise.all([fetchUsers(), fetchRoles()]);

function RoleBadge({ role }) {
  const tone = role === SystemRole.ADMIN ? "primary" : role === SystemRole.PRACTITIONER ? "info" : undefined;
  return <Badge tone={tone}>{roleLabel(role)}</Badge>;
}

/** Gestion des comptes : recherche, création, modification, activation, suppression. */
export function AdminComptesPage() {
  const { user: me } = useCurrentUser();
  const { data, error, isLoading, reload } = useAsyncResource(loadAll);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [filters, setFilters] = useState({ q: "", role: "", status: "" });
  const [feedback, setFeedback] = useState(null);
  const [modal, setModal] = useState({ create: false, edit: null, del: null });
  const [tip, setTip] = useState(null);

  useEffect(() => {
    if (data) {
      setUsers(data[0]);
      setRoles(data[1]);
    }
  }, [data]);

  const activeAdmins = users.filter((u) => u.role === SystemRole.ADMIN && u.isActive);
  const isLast = (u) => u.role === SystemRole.ADMIN && u.isActive && activeAdmins.length === 1;
  const list = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!q || `${u.fullName} ${u.email}`.toLowerCase().includes(q)) &&
        (!filters.role || u.role === filters.role) &&
        (!filters.status || (filters.status === "actif" ? u.isActive : !u.isActive)),
    );
  }, [users, filters]);

  const say = (tone, title, text) => setFeedback({ tone, title, text });
  const replace = (updated) => setUsers((list0) => list0.map((u) => (u.id === updated.id ? updated : u)));
  const refused = () => say("danger", "Action refusée", LAST_TIP);

  const toggle = async (u) => {
    if (isLast(u)) return refused();
    try {
      const updated = await updateUser(u.id, { isActive: !u.isActive });
      replace(updated);
      say("success", updated.isActive ? "Compte réactivé" : "Compte désactivé", `${u.fullName || u.email} ${updated.isActive ? "peut de nouveau se connecter." : "ne peut plus se connecter."} L’action est inscrite au journal d’audit.`);
    } catch (cause) {
      say("danger", "Action refusée", toAppError(cause).message);
    }
    return undefined;
  };

  const remove = async (u) => {
    setModal((m) => ({ ...m, del: null }));
    try {
      await deleteUser(u.id);
      setUsers((list0) => list0.filter((x) => x.id !== u.id));
      say("success", "Compte supprimé", `${u.fullName || u.email} a été supprimé.`);
    } catch (cause) {
      say("danger", "Action refusée", toAppError(cause).message);
    }
  };

  const tipProps = (u) =>
    isLast(u)
      ? {
          "aria-disabled": "true",
          title: LAST_TIP,
          "aria-describedby": "last-admin-desc",
          onMouseEnter: (e) => setTip({ text: LAST_TIP, rect: e.currentTarget.getBoundingClientRect() }),
          onMouseLeave: () => setTip(null),
          onFocus: (e) => setTip({ text: LAST_TIP, rect: e.currentTarget.getBoundingClientRect() }),
          onBlur: () => setTip(null),
        }
      : {};

  const roleNames = [...new Set(roles.map((r) => r.name))];

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
          <div className="tip" role="tooltip" data-show={tip ? "true" : "false"} style={tip ? { left: Math.max(8, tip.rect.left + tip.rect.width / 2 - 150), top: Math.max(8, tip.rect.top - 64) } : undefined}>
            {tip?.text}
          </div>
          <CreateUserModal
            open={modal.create}
            roles={roles}
            onClose={() => setModal((m) => ({ ...m, create: false }))}
            onCreated={(created) => {
              setUsers((list0) => [...list0, created]);
              setModal((m) => ({ ...m, create: false }));
              say("success", "Compte créé", `${created.fullName || created.email} a été créé. Transmettez-lui son mot de passe provisoire.`);
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
              say("success", "Compte modifié", `${updated.fullName || updated.email} a été mis à jour.`);
            }}
          />
          <DeleteUserModal user={modal.del} onClose={() => setModal((m) => ({ ...m, del: null }))} onConfirm={remove} />
        </>
      }
    >
      <div className="page-head">
        <div>
          <h2>Comptes</h2>
          <p>Il n’existe pas d’inscription publique : seuls les administrateurs créent les comptes.</p>
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
        Il doit toujours rester au moins un compte administrateur actif. Le dernier compte administrateur ne peut donc être ni désactivé ni supprimé tant qu’un autre administrateur n’existe pas.
      </Alert>

      <section className="card card-pad" aria-label="Recherche et filtres" style={{ display: "grid", gap: "var(--space-4)" }}>
        <div className="filters">
          <div className="field">
            <label className="label" htmlFor="q">
              Rechercher un compte
            </label>
            <input className="input" id="q" type="search" placeholder="Nom ou e-mail" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <div className="field">
            <label className="label" htmlFor="f-role">
              Rôle
            </label>
            <select className="select" id="f-role" value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}>
              <option value="">Tous les rôles</option>
              {roleNames.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
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
              <th scope="col">Nom et e-mail</th>
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
              const name = u.fullName || u.email;
              const last = isLast(u);
              return (
                <tr key={u.id}>
                  <th scope="row">
                    <div className="person">
                      <span className="av" aria-hidden="true">
                        {initials(name)}
                      </span>
                      <div>
                        <strong>{name}</strong>
                        <span className="sub" title={u.email}>
                          {u.email}
                        </span>
                        {last ? <span className="sub">Dernier administrateur</span> : null}
                        {u.id === me?.id ? <span className="sub">Votre compte</span> : null}
                      </div>
                    </div>
                  </th>
                  <td data-label="Rôle">
                    <RoleBadge role={u.role} />
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
                      <span className="method" title="Connexion par e-mail">
                        <Icon name="mail" />
                        <span className="sr-only">E-mail</span>
                      </span>
                    </span>
                  </td>
                  <td data-label="Dernière connexion">{u.lastLoginAt ? <DateCell date={formatDate(u.lastLoginAt)} time={formatTime(u.lastLoginAt)} /> : <span className="muted">Jamais connecté</span>}</td>
                  <td className="td-actions">
                    <div className="row-actions">
                      <IconAction icon="edit" label={`Modifier ${name}`} title="Modifier le compte" onClick={() => setModal((m) => ({ ...m, edit: u }))} />
                      <IconAction
                        icon={u.isActive ? "lock" : "unlock"}
                        label={`${u.isActive ? "Désactiver" : "Réactiver"} ${name}`}
                        title={u.isActive ? "Désactiver le compte" : "Réactiver le compte"}
                        onClick={() => toggle(u)}
                        {...tipProps(u)}
                      />
                      <IconAction
                        icon="trash"
                        danger
                        label={`Supprimer ${name}`}
                        title="Supprimer le compte"
                        onClick={() => (last ? refused() : setModal((m) => ({ ...m, del: u })))}
                        {...tipProps(u)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr hidden>
              <td colSpan={6}>
                <span id="last-admin-desc" className="sr-only">
                  {LAST_TIP}
                </span>
              </td>
            </tr>
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
        Aucun mot de passe n’est affiché : l’administrateur ne voit jamais les mots de passe choisis par les utilisateurs.
      </p>
    </AppShell>
  );
}
