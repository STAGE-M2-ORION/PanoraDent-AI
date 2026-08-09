import * as React from "react"

import { cn } from "@/shared/lib/utils"
import { buttonVariants } from "./button"

/**
 * Input fichier masqué derrière un label stylé comme un bouton.
 *
 * Composant maison — shadcn/ui ne fournit pas d'équivalent — mais il emprunte
 * `buttonVariants` pour rester visuellement identique à un `Button`.
 *
 * Deux détails non négociables :
 * - la valeur de l'input est réinitialisée après chaque sélection, sinon
 *   choisir deux fois le même fichier ne déclenche pas d'événement `change` ;
 * - l'input est masqué en `sr-only` et non en `display:none`, pour rester
 *   atteignable au clavier.
 */
function FilePicker({
  accept,
  onSelect,
  disabled = false,
  variant = "default",
  size = "default",
  className,
  children,
  ...props
}) {
  function handleChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) onSelect(file)
  }

  return (
    <label
      data-slot="file-picker"
      data-disabled={disabled || undefined}
      className={cn(
        buttonVariants({ variant, size }),
        "cursor-pointer has-[:focus-visible]:border-ring has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-[3px]",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      {children}
      <input
        type="file"
        className="sr-only"
        accept={accept}
        onChange={handleChange}
        disabled={disabled}
        {...props}
      />
    </label>
  );
}

export { FilePicker }
