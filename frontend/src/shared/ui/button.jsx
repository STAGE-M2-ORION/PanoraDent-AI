import Link from "next/link";
import { forwardRef } from "react";

import { cx } from "../lib/cx";

/** Variantes qui reçoivent l'effet « lumière » (pilule, libellé révélé). */
const LUMIERE_VARIANTS = new Set(["primary", "secondary"]);

/**
 * Bouton du design system.
 *
 * - `variant` : `primary` | `secondary` | `ghost` | `danger` | `google`
 * - `size` : `sm` pour la taille compacte (36 px, 44 px sur téléphone)
 * - `href` : rend un lien Next (navigation interne) avec l'apparence d'un bouton
 * - `lumiere` : `false` pour couper l'effet sur un principal/secondaire
 *
 * L'effet lumière double le libellé : la copie « allumée » est masquée aux
 * technologies d'assistance, le libellé de base reste le nom accessible.
 */
export const Button = forwardRef(function Button(
  { variant = "primary", size, href, lumiere = true, className, children, type = "button", ...rest },
  ref,
) {
  const withLumiere = lumiere && LUMIERE_VARIANTS.has(variant);
  const classes = cx(
    "btn",
    `btn-${variant}`,
    size === "sm" && "btn-sm",
    withLumiere && "btn-lumiere",
    withLumiere && variant === "secondary" && "discret",
    className,
  );
  const content = withLumiere ? (
    <>
      <span className="bl-base">{children}</span>
      <span className="bl-on" aria-hidden="true">
        {children}
      </span>
    </>
  ) : (
    children
  );

  if (href) {
    return (
      <Link ref={ref} href={href} className={classes} {...rest}>
        {content}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {content}
    </button>
  );
});
