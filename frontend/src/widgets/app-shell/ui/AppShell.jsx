import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

import { fetchModelVersions } from "@/entities/model-version";
import { SessionStatus, displayName, roleLabel, screenProfile, useCurrentUser } from "@/entities/session";
import { demoNotifications } from "@/shared/demo";
import { cx, useAppTheme } from "@/shared/lib";
import { Avatar, Button, Card, Icon, Logo, UserPhoto } from "@/shared/ui";

import { visibleNavigation } from "../model/navigation";

function Sidebar({ page, open, rail, onNavigate }) {
  const { user, can, canAny, logout } = useCurrentUser();
  const router = useRouter();
  const [modelVersion, setModelVersion] = useState(null);
  const name = displayName(user);

  useEffect(() => {
    if (!can("model:read")) return undefined;
    let cancelled = false;
    fetchModelVersions()
      .then((versions) => {
        if (!cancelled) setModelVersion(versions[0]?.version ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await logout();
    router.replace({ pathname: "/connexion", query: { etat: "deconnecte" } });
  };

  return (
    <aside className={rail ? "sidebar rail" : "sidebar"} id="sidebar" data-open={open ? "true" : "false"}>
      <div className="brand">
        <Logo href="/" variant={rail ? "icon" : "dark"} />
      </div>
      <nav aria-label="Navigation principale" style={{ display: "grid", gap: 2 }} onClick={onNavigate}>
        {visibleNavigation(can, canAny).map((item) =>
          item.group ? (
            <div key={item.group} className="nav-label">
              {item.group}
            </div>
          ) : (
            <Link key={item.href} className="nav-link" href={item.href} aria-current={page === item.page ? "page" : undefined}>
              <span className="nav-ic">
                <Icon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </Link>
          ),
        )}
      </nav>
      <div className="sidebar-foot">
        <div className="user-chip">
          <Avatar src={user?.photoUrl} name={name} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
            <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
              {roleLabel(user?.role)}
            </span>
          </span>
        </div>
        <Link className="nav-link" href="/profil" aria-current={page === "profil" ? "page" : undefined}>
          <span className="nav-ic">
            <Icon name="user" />
          </span>
          <span>Profil</span>
        </Link>
        <button type="button" className="nav-link" onClick={signOut} style={{ background: "none", border: 0, width: "100%", cursor: "pointer", textAlign: "left" }}>
          <span className="nav-ic">
            <Icon name="logout" />
          </span>
          <span>Se déconnecter</span>
        </button>
        {modelVersion ? (
          <p className="muted" style={{ fontSize: "var(--text-xs)", padding: "var(--space-2) var(--space-3) 0" }}>
            Modèle <span className="mono">{modelVersion}</span>
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function Notifications() {
  const { user } = useCurrentUser();
  const list = demoNotifications[screenProfile(user)];
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(true);
  const bellRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (!event.target.closest(".notif")) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="notif">
      <button
        ref={bellRef}
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-controls="notif-pop"
        aria-label={unread ? `Notifications : ${list.length} nouvelles` : "Notifications : aucune nouvelle non lue"}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
          setUnread(false);
        }}
      >
        <Icon name="bell" />
        <span className="dot" aria-hidden="true" hidden={!unread} />
      </button>
      <div className="notif-pop" id="notif-pop" hidden={!open}>
        {list.map((n) => (
          <Link key={n.title} href={n.href}>
            <strong>{n.title}</strong>
            <span>{n.text}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Topbar({ title, crumbs, headerContent, headerActions, onMenu }) {
  const { user } = useCurrentUser();
  const { theme, toggle } = useAppTheme();
  const dark = theme === "dark";
  const themeLabel = dark ? "Passer en mode clair" : "Passer en mode sombre";
  const name = displayName(user);
  return (
    <header className="topbar">
      <button type="button" className="btn btn-ghost btn-sm menu-btn" aria-label="Ouvrir le menu" onClick={onMenu}>
        <Icon name="menu" />
      </button>
      {headerContent ?? (
        <div>
          <p className="crumbs">{crumbs}</p>
          <h1>{title}</h1>
        </div>
      )}
      <div className="spacer" />
      {headerActions}
      <div className="top-tools">
        <button type="button" className="btn btn-ghost btn-sm theme-toggle" aria-label={themeLabel} title={themeLabel} onClick={toggle}>
          <Icon name={dark ? "sun" : "contrast"} />
        </button>
        <div className="top-actions">
          <Notifications />
          <Link className="icon-btn avatar-btn" href="/profil" aria-label={`Mon profil : ${name}`}>
            <UserPhoto src={user?.photoUrl} name={name} />
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Écran « Accès refusé (403) », dans la page. */
export function Forbidden() {
  const { user } = useCurrentUser();
  return (
    <Card pad style={{ maxWidth: 560, margin: "var(--space-12) auto", textAlign: "center", display: "grid", gap: "var(--space-4)", justifyItems: "center" }}>
      <span className="avatar" style={{ width: 52, height: 52, background: "var(--color-danger-soft)", color: "var(--color-danger)" }}>
        <Icon name="lock" />
      </span>
      <p className="mono muted" style={{ fontSize: "var(--text-sm)" }}>
        Erreur 403
      </p>
      <h2 style={{ fontSize: "var(--text-2xl)" }}>Accès refusé</h2>
      <p className="muted">
        Votre rôle ({roleLabel(user?.role)}) ne donne pas accès à cette fonction. Si vous pensez qu&apos;il s&apos;agit d&apos;une erreur, contactez
        l&apos;administrateur de votre cabinet.
      </p>
      <Button href="/tableau-de-bord">Retour au tableau de bord</Button>
    </Card>
  );
}

/**
 * Structure de l'application connectée, garde de session comprise.
 *
 * L'export statique (`output: "export"`) interdit le middleware Next : la garde
 * est donc côté client, ici. Seules les pages qui passent par `AppShell` sont
 * protégées ; `/connexion`, `/mentions`, `/decouvrir` et les fichiers statiques
 * ne l'utilisent pas.
 *
 * - Sans session : renvoie vers `/connexion` (avec `etat=expiree` si la
 *   session vient d'expirer, `etat=deconnecte` après une déconnexion). Le
 *   retour de Google ramène sur `/`, qui oriente selon le rôle.
 * - Sans la permission demandée (`permission` ou `anyOf`) : écran 403 dans la
 *   page — le backend refuse de toute façon, la garde ne sert qu'à l'ergonomie.
 *
 * `className` : classe racine de la vue (`v-<nom>`), qui confine ses styles.
 * `rail` : barre latérale réduite aux icônes (écran de lecture).
 * `bare` : le contenu remplit `.main` sans le gabarit `.page`.
 * `headerContent` / `headerActions` : en-tête personnalisé de la barre du haut.
 * `overlay` : modales de la vue, rendues hors de la zone principale.
 */
export function AppShell({ page, title, crumbs = "Application", docTitle, permission, anyOf, className, overlay, rail, bare, headerContent, headerActions, children }) {
  const { status, endReason, canAny } = useCurrentUser();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (status !== SessionStatus.ANONYMOUS) return;
    router.replace({ pathname: "/connexion", query: endReason ? { etat: endReason } : {} });
  }, [status, endReason, router]);

  const head = (
    <Head>
      <title>{`${docTitle ?? title} · PanoraDent AI`}</title>
    </Head>
  );

  if (status !== SessionStatus.AUTHENTICATED) {
    return (
      <>
        {head}
        <div className="shell-loading" role="status">
          <span className="sr-only">Chargement de la session…</span>
        </div>
      </>
    );
  }

  const required = anyOf ?? (permission ? [permission] : []);
  const allowed = required.length === 0 || canAny(required);

  return (
    <div className={cx("app-root", className)}>
      {head}
      <div className="app">
        <Sidebar page={page} open={menuOpen} rail={rail} onNavigate={() => setMenuOpen(false)} />
        <div className="main">
          <Topbar
            title={title}
            crumbs={crumbs}
            headerContent={allowed ? headerContent : undefined}
            headerActions={allowed ? headerActions : undefined}
            onMenu={() => setMenuOpen((v) => !v)}
          />
          {allowed && bare ? children : <main className="page">{allowed ? children : <Forbidden />}</main>}
          <footer className="app-foot">
            <Icon name="info" />
            <span>Prototype d’aide à la décision — non certifié. Le praticien garde la décision.</span>
          </footer>
        </div>
      </div>
      {allowed ? overlay : null}
    </div>
  );
}
