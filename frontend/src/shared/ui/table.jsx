import Link from "next/link";

import { cx, initials } from "../lib/cx";
import { Icon } from "./icon";

/** Puce d'identifiant (police à chasse fixe). */
export function IdChip({ children }) {
  return <span className="id-chip">{children}</span>;
}

/** Numéro discret (n° d'analyse). */
export function NumChip({ children }) {
  return <span className="num-chip">{children}</span>;
}

/** Personne en ligne : initiales + nom. */
export function WhoChip({ name }) {
  if (!name) return <span className="muted">—</span>;
  return (
    <span className="who-chip">
      <span className="av" aria-hidden="true">
        {initials(name)}
      </span>
      {name}
    </span>
  );
}

/** Personne en bloc : initiales, nom en gras, ligne secondaire. */
export function Person({ name, sub }) {
  return (
    <div className="person">
      <span className="av" aria-hidden="true">
        {initials(name)}
      </span>
      <div>
        <strong>{name}</strong>
        {sub ? <span className="sub">{sub}</span> : null}
      </div>
    </div>
  );
}

/** Cellule date : jour, puis heure en petit. */
export function DateCell({ date, time }) {
  return (
    <span className="dt">
      <span className="d">{date}</span>
      {time ? <span className="t">{time}</span> : null}
    </span>
  );
}

/**
 * Action d'une ligne, en icône. `href` → lien ; sinon bouton. `label` est le
 * nom accessible (obligatoire : l'icône seule ne dit rien).
 */
export function IconAction({ icon, label, title, href, danger, disabled, className, ...rest }) {
  const classes = cx("icon-act", danger && "danger", className);
  if (href && !disabled) {
    return (
      <Link className={classes} href={href} aria-label={label} title={title ?? label} {...rest}>
        <Icon name={icon} />
      </Link>
    );
  }
  return (
    <button
      className={classes}
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      aria-disabled={disabled ? "true" : undefined}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Pagination numérotée. */
export function Pager({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  return (
    <nav className="pager" aria-label="Pagination">
      <button className="page-btn" type="button" disabled={page <= 1} aria-label="Page précédente" onClick={() => onChange(page - 1)}>
        <Icon name="chevronleft" />
      </button>
      {pages.map((p) => (
        <button
          key={p}
          className="page-btn"
          type="button"
          aria-current={p === page ? "page" : undefined}
          aria-label={`Page ${p}`}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
      <button className="page-btn" type="button" disabled={page >= pageCount} aria-label="Page suivante" onClick={() => onChange(page + 1)}>
        <Icon name="chevron" />
      </button>
    </nav>
  );
}

/** Découpe une liste en pages : `{ items, pageCount }`. */
export function paginate(list, page, size) {
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  return { items: list.slice((page - 1) * size, page * size), pageCount };
}
