import { useEffect, useMemo, useState } from "react";

import { deleteRole, duplicateRole, fetchPermissions, fetchRoles, updateRole } from "@/entities/role";
import { Permission, SYSTEM_ROLE_ORDER, SystemRole, roleLabel } from "@/entities/session";
import { fetchUsers } from "@/entities/user";
import { RoleFormModal, SENSITIVE_PERMISSIONS, orderedPermissions, permissionLabel, summarizeRole } from "@/features/manage-roles";
import { toAppError } from "@/shared/api";
import { useAsyncResource } from "@/shared/lib";
import { Alert, Badge, Button, ConfirmDialog, Icon, IconAction, KpiRing, UserPhoto } from "@/shared/ui";
import { AppShell } from "@/widgets/app-shell";

const ROLE_ICONS = {
  [SystemRole.ADMIN]: "shield",
  [SystemRole.PRACTITIONER]: "tooth",
  [SystemRole.VIEWER]: "eye",
};

const loadAll = () => Promise.all([fetchRoles(), fetchPermissions(), fetchUsers().catch(() => [])]);

/**
 * Rôles et permissions : indicateurs, cartes des rôles (description, résumé en
 * clair, modifier / dupliquer / supprimer), matrice. Les rôles système sont
 * verrouillés — le serveur le garantit, l'écran le signale.
 */
export function AdminRolesPage() {
  const { data, error, reload } = useAsyncResource(loadAll);
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState({}); // id de rôle personnalisé → permissions modifiées
  const [feedback, setFeedback] = useState(null);
  const [form, setForm] = useState({ open: false, role: null }); // création (role null) ou modification
  const [toDelete, setToDelete] = useState(null);

  useEffect(() => {
    if (!data) return;
    setRoles(data[0]);
    setCatalog(data[1]);
    setUsers(data[2]);
    setDraft({});
  }, [data]);

  const ordered = useMemo(
    () => [...roles].sort((a, b) => (a.isSystem === b.isSystem ? SYSTEM_ROLE_ORDER.indexOf(a.name) - SYSTEM_ROLE_ORDER.indexOf(b.name) || a.name.localeCompare(b.name) : a.isSystem ? -1 : 1)),
    [roles],
  );
  const perms = orderedPermissions(catalog);
  const total = perms.length;
  const custom = ordered.filter((r) => !r.isSystem);
  const permsOf = (r) => draft[r.id] ?? r.permissions;
  const dirty = Object.keys(draft).length > 0;
  const sensitiveCount = perms.filter((p) => SENSITIVE_PERMISSIONS.has(p)).length;
  const accountCount = roles.reduce((n, r) => n + r.userCount, 0);

  const togglePerm = (role, code) => {
    const current = permsOf(role);
    const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
    setDraft((d) => ({ ...d, [role.id]: next }));
  };

  const saveCustom = async () => {
    try {
      const saved = await Promise.all(Object.entries(draft).map(([id, permissions]) => updateRole(id, { permissions })));
      setRoles((list) => list.map((r) => saved.find((s) => s.id === r.id) ?? r));
      setDraft({});
      setFeedback({ tone: "success", title: "Rôle enregistré", text: `Les permissions de ${saved.map((r) => `« ${r.name} »`).join(", ")} ont été mises à jour. L’action est inscrite au journal d’audit.` });
    } catch (cause) {
      setFeedback({ tone: "danger", title: "Enregistrement refusé", text: toAppError(cause).message });
    }
  };

  const remove = async (role) => {
    try {
      await deleteRole(role.id);
    } catch (cause) {
      throw toAppError(cause);
    }
    setRoles((list) => list.filter((r) => r.id !== role.id));
    setToDelete(null);
    setFeedback({ tone: "success", title: "Rôle supprimé", text: `Le rôle « ${role.name} » a été supprimé. L’action est inscrite au journal d’audit.` });
  };

  const duplicate = async (role) => {
    try {
      const copy = await duplicateRole(role.id);
      setRoles((list) => [...list, copy]);
      setForm({ open: true, role: copy });
      setFeedback({ tone: "success", title: "Rôle dupliqué", text: `« ${copy.name} » reprend les permissions de « ${roleLabel(role.name)} ». Renommez-le et ajustez-le.` });
    } catch (cause) {
      setFeedback({ tone: "danger", title: "Duplication refusée", text: toAppError(cause).message });
    }
  };

  return (
    <AppShell
      page="admin-roles"
      title="Rôles et permissions"
      crumbs="Administration"
      permission={Permission.ROLE_MANAGE}
      className="v-admin-roles"
      overlay={
        <>
          <RoleFormModal
            open={form.open}
            role={form.role}
            catalog={catalog}
            onClose={() => setForm({ open: false, role: null })}
            onSaved={(role) => {
              const existed = roles.some((r) => r.id === role.id);
              setRoles((list) => (existed ? list.map((r) => (r.id === role.id ? role : r)) : [...list, role]));
              setDraft((d) => {
                const next = { ...d };
                delete next[role.id];
                return next;
              });
              setForm({ open: false, role: null });
              setFeedback(
                existed
                  ? { tone: "success", title: "Rôle enregistré", text: `« ${role.name} » a été mis à jour. Les comptes qui le portent ont leurs nouveaux droits immédiatement.` }
                  : { tone: "success", title: "Rôle créé", text: `Le rôle « ${role.name} » est disponible lors de la création d’un compte.` },
              );
            }}
          />
          <ConfirmDialog
            open={Boolean(toDelete)}
            title={`Supprimer le rôle « ${toDelete?.name ?? ""} » ?`}
            confirmLabel="Supprimer le rôle"
            tone="danger"
            onConfirm={() => remove(toDelete)}
            onClose={() => setToDelete(null)}
          >
            <p style={{ margin: 0 }}>La suppression est définitive. Elle n’est possible que si aucun compte ne porte ce rôle.</p>
          </ConfirmDialog>
        </>
      }
    >
      <div className="dash-head">
        <div className="dash-hello">
          <h2>Rôles et permissions</h2>
          <p>Un rôle regroupe des permissions. Les trois rôles système sont verrouillés : dupliquez-en un pour créer une variante.</p>
        </div>
        <div className="dash-tools">
          <Button onClick={() => setForm({ open: true, role: null })} disabled={!catalog.length}>
            <Icon name="plus" />
            Créer un rôle personnalisé
          </Button>
        </div>
      </div>

      <div aria-live="polite">
        {feedback ? (
          <Alert tone={feedback.tone} title={feedback.title} role={feedback.tone === "danger" ? "alert" : "status"} icon={feedback.tone === "success" ? "check" : "alert"}>
            {feedback.text}
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="danger" title="Les rôles n’ont pas pu être chargés." role="alert">
            {error.message}{" "}
            <button type="button" className="btn btn-sm btn-ghost" onClick={reload}>
              Réessayer
            </button>
          </Alert>
        ) : null}
      </div>

      <section className="kpi-row" aria-label="Indicateurs des rôles">
        <KpiRing
          label="Rôles"
          icon="key"
          value={roles.length}
          ring={roles.length ? Math.round(((roles.length - custom.length) / roles.length) * 100) : null}
          ringText={`${roles.length} rôles : ${roles.length - custom.length} système et ${custom.length} personnalisé${custom.length > 1 ? "s" : ""}`}
          delta={`${roles.length - custom.length} système · ${custom.length} personnalisé${custom.length > 1 ? "s" : ""}`}
          dir="flat"
        />
        <KpiRing label="Comptes" icon="users" value={accountCount} ring={100} ringText={`Les ${accountCount} comptes ont un rôle`} delta="Tous ont un rôle" dir="flat" tone="navy" good href="/admin/comptes" />
        <KpiRing label="Permissions gérées" icon="list" value={total} ring={total ? 100 : null} ringText={`${total} permissions dans la matrice`} delta="Voir la matrice" dir="flat" />
        <KpiRing
          label="Permissions sensibles"
          icon="shield"
          value={sensitiveCount}
          ring={total ? Math.round((sensitiveCount / total) * 100) : null}
          ringText={`${sensitiveCount} permissions sensibles sur ${total}, réservées à l’administrateur`}
          delta="Réservées à l’administrateur"
          dir="flat"
          tone="warning"
        />
      </section>

      <section aria-labelledby="h-roles" className="dash" style={{ gap: "var(--space-4)" }}>
        <div className="dash-sec-h">
          <h3 id="h-roles">Rôles existants</h3>
        </div>
        <div className="role-grid">
          {ordered.map((r, k) => {
            const n = permsOf(r).filter((p) => perms.includes(p)).length;
            const icon = (r.isSystem && ROLE_ICONS[r.name]) || "sparkle";
            const summary = summarizeRole(r.permissions);
            const members = users.filter((u) => u.roleId === r.id).slice(0, 4);
            return (
              <article key={r.id} className={`dcard role-tile${r.isSystem ? "" : " custom"}`} aria-labelledby={`rt-${k}`}>
                <div className="role-tile-h">
                  <span className="role-ic" aria-hidden="true">
                    <Icon name={icon} />
                  </span>
                  <div className="role-tile-t">
                    <h3 id={`rt-${k}`}>{roleLabel(r.name)}</h3>
                    {r.isSystem ? (
                      <Badge title="Rôle système : ni modifiable ni supprimable">
                        <Icon name="lock" />
                        Système, verrouillé
                      </Badge>
                    ) : (
                      <Badge tone="primary">Personnalisé</Badge>
                    )}
                  </div>
                </div>
                <p className="role-desc">{r.description || (r.isSystem ? "" : "Rôle personnalisé.")}</p>
                <p className="role-summary">{summary.can}</p>
                <div className="role-perms">
                  <div className="prog-top">
                    <span className="prog-name">Permissions accordées</span>
                    <span className="prog-v mono">
                      {n} sur {total}
                    </span>
                  </div>
                  <div className="prog-trk" role="img" aria-label={`${n} permissions sur ${total}`}>
                    <span className="prog-fill" style={{ "--w": `${total ? Math.round((n / total) * 100) : 0}%` }} />
                  </div>
                </div>
                <div className="role-foot">
                  <span className="role-who">
                    {members.length ? (
                      <span className="av-stack" aria-hidden="true">
                        {members.map((u) => (
                          <span key={u.id} className="av">
                            <UserPhoto src={u.photoUrl} name={u.fullName || u.email} />
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span>{r.userCount ? `${r.userCount} compte${r.userCount > 1 ? "s" : ""}` : "Aucun compte"}</span>
                  </span>
                  <span className="row-actions">
                    {r.isSystem ? null : (
                      <IconAction icon="edit" label={`Modifier le rôle ${r.name}`} title="Modifier le nom, la description et les permissions" onClick={() => setForm({ open: true, role: r })} />
                    )}
                    <IconAction icon="copy" label={`Dupliquer le rôle ${roleLabel(r.name)}`} title="Dupliquer : un rôle personnalisé avec les mêmes permissions" onClick={() => duplicate(r)} />
                    {r.isSystem ? null : (
                      <IconAction
                        icon="trash"
                        danger
                        label={`Supprimer le rôle ${r.name}`}
                        title={r.userCount ? "Un rôle porté par des comptes ne peut pas être supprimé" : "Supprimer le rôle"}
                        disabled={r.userCount > 0}
                        onClick={() => setToDelete(r)}
                      />
                    )}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="dcard matrix-card" aria-labelledby="h-matrix">
        <div className="dcard-h">
          <div>
            <h3 id="h-matrix">Matrice des permissions</h3>
            <p>Les colonnes des rôles système sont en lecture seule. Seuls les rôles personnalisés peuvent être ajustés.</p>
          </div>
          {custom.length ? (
            <Button variant="secondary" size="sm" onClick={saveCustom} disabled={!dirty}>
              {custom.length === 1 ? `Enregistrer « ${custom[0].name} »` : "Enregistrer les rôles personnalisés"}
            </Button>
          ) : null}
        </div>
        <div className="table-wrap">
          <table className="table matrix stack">
            <caption className="sr-only">Permissions par rôle</caption>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                {ordered.map((r) => (
                  <th key={r.id} scope="col">
                    {roleLabel(r.name)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perms.map((code) => (
                <tr key={code}>
                  <th scope="row">
                    <span>{permissionLabel(code, catalog)}</span>
                    {SENSITIVE_PERMISSIONS.has(code) ? (
                      <>
                        {" "}
                        <Badge tone="warning">Sensible</Badge>
                      </>
                    ) : null}
                  </th>
                  {ordered.map((r) => {
                    const name = roleLabel(r.name);
                    const yes = permsOf(r).includes(code);
                    if (!r.isSystem) {
                      return (
                        <td key={r.id} data-label={name}>
                          <label className="check-row">
                            <input type="checkbox" checked={yes} onChange={() => togglePerm(r, code)} />
                            <span className="sr-only">
                              {permissionLabel(code, catalog)} : {name}
                            </span>
                          </label>
                        </td>
                      );
                    }
                    return (
                      <td key={r.id} data-label={name}>
                        {yes ? (
                          <span className="cell-yes">
                            <Icon name="check" />
                            <span className="sr-only">Autorisé : {name}</span>
                            <span aria-hidden="true">Oui</span>
                          </span>
                        ) : (
                          <span className="cell-no">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">Non autorisé : {name}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
