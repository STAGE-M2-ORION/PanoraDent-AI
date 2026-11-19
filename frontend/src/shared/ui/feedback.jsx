import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { cx, initials } from "../lib/cx";
import { Icon } from "./icon";

/** Pastille. `tone` : success | warning | danger | info | primary ; `dot` ajoute la puce. */
export function Badge({ tone, dot, className, children, ...rest }) {
  return (
    <span className={cx("badge", tone && `badge-${tone}`, dot && "badge-dot", className)} {...rest}>
      {children}
    </span>
  );
}

const ALERT_ICON = { success: "check", warning: "alert", danger: "alert", info: "info" };

/** Alerte : icône + titre en gras + texte. `tone` : success | warning | danger | info. */
export function Alert({ tone = "info", icon, title, className, children, ...rest }) {
  return (
    <div className={cx("alert", `alert-${tone}`, className)} {...rest}>
      <Icon name={icon ?? ALERT_ICON[tone] ?? "info"} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

/** Carte blanche à liseré fin ; `pad` ajoute la marge intérieure standard. */
export function Card({ as: Tag = "div", pad, className, children, ...rest }) {
  return (
    <Tag className={cx("card", pad && "card-pad", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Bloc de chargement animé (coupé si « mouvement réduit »). */
export function Skeleton({ className, style }) {
  return <span className={cx("skeleton", className)} style={style} aria-hidden="true" />;
}

/** Pastille ronde d'initiales. */
export function Avatar({ className, style, children, src, name }) {
  return (
    <span className={cx("avatar", className)} style={style} aria-hidden="true">
      {src || name !== undefined ? <UserPhoto src={src} name={name} /> : children}
    </span>
  );
}

/**
 * Contenu d'une pastille d'utilisateur : sa photo (importée ou Google), sinon
 * ses initiales. Si l'image ne se charge pas (photo Google retirée, réseau),
 * on retombe sur les initiales. À placer dans un conteneur rond existant
 * (`.avatar`, `.av`, `.avatar-btn`) : l'image en prend la forme.
 *
 * `referrerPolicy="no-referrer"` : les photos Google sont parfois refusées
 * quand le navigateur envoie l'adresse de la page.
 */
export function UserPhoto({ src, name }) {
  const [failed, setFailed] = useState(null);
  if (src && failed !== src) {
    return <img className="user-photo" src={src} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(src)} />;
  }
  return initials(name);
}

/* ------------------------------------------------------------------------ */
/* Fenêtre modale                                                            */
/* ------------------------------------------------------------------------ */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Fenêtre modale. Se ferme sur Échap et clic sur le fond ; place le focus sur
 * le premier élément interactif à l'ouverture et le rend au déclencheur à la
 * fermeture.
 */
export function Modal({ open, onClose, labelledBy, className, children, wide }) {
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    boxRef.current?.querySelector(FOCUSABLE)?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);

  return (
    <div
      className="modal-backdrop"
      data-open={open ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div ref={boxRef} className={cx("modal", className)} style={wide ? { width: `min(${wide}px, 100%)` } : undefined}>
        {open ? children : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Notifications éphémères (toasts)                                          */
/* ------------------------------------------------------------------------ */

const ToastContext = createContext(() => {});

/** Zone unique des notifications : `const toast = useToast(); toast("Texte")`. */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const show = useCallback((text, { duration = 4500 } = {}) => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list, { id, text }]);
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), duration);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pd-toast-zone" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className="pd-toast">
            {item.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
