import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { relativeTime, useNotificationCenter } from "@/entities/notification";
import { Icon } from "@/shared/ui";

/**
 * Cloche des notifications (sprint 13) : compte des non lues, panneau des
 * plus récentes ; une notification ouvre son analyse et passe « lue ». Les
 * arrivées en temps réel viennent du `NotificationsProvider`.
 */
export function NotificationBell() {
  const { enabled, items, unread, next, connected, markRead, markAllRead, loadMore } = useNotificationCenter();
  const [open, setOpen] = useState(false);
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

  if (!enabled) return null;
  const label = unread ? `Notifications : ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications : aucune non lue";
  return (
    <div className="notif">
      <button
        ref={bellRef}
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-controls="notif-pop"
        aria-label={label}
        title={label}
        data-connecte={connected ? "oui" : "non"}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Icon name="bell" />
        {unread ? (
          <span className="notif-count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      <section className="notif-pop" id="notif-pop" hidden={!open} aria-label="Notifications">
        <header className="notif-head">
          <strong>Notifications</strong>
          {unread ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={markAllRead}>
              Tout marquer comme lu
            </button>
          ) : null}
        </header>
        {items.length ? (
          <ul className="notif-list">
            {items.map((n) => {
              const contenu = (
                <>
                  <span className={`notif-ic tone-${n.tone}`} aria-hidden="true">
                    <Icon name={n.icon} />
                  </span>
                  <span className="notif-txt">
                    <strong>{n.title}</strong>
                    <span>{n.message}</span>
                    <time dateTime={n.createdAt}>{relativeTime(n.createdAt)}</time>
                  </span>
                  {n.read ? null : <span className="sr-only">(non lue)</span>}
                </>
              );
              return (
                <li key={n.id} className={n.read ? "" : "is-unread"}>
                  {n.href ? (
                    <Link
                      href={n.href}
                      onClick={() => {
                        markRead(n.id);
                        setOpen(false);
                      }}
                    >
                      {contenu}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => markRead(n.id)}>
                      {contenu}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="notif-empty">Aucune notification pour l’instant.</p>
        )}
        {next ? (
          <button type="button" className="btn btn-ghost btn-sm notif-more" onClick={loadMore}>
            Afficher plus
          </button>
        ) : null}
      </section>
    </div>
  );
}
