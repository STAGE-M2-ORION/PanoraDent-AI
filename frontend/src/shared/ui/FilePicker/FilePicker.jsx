import styles from "./FilePicker.module.css";

/**
 * Input fichier masqué derrière un label stylé en bouton.
 *
 * La valeur de l'input est réinitialisée après chaque sélection : sans cela,
 * choisir deux fois le même fichier ne déclenche pas d'événement `change`.
 */
export function FilePicker({ accept, onSelect, disabled = false, children }) {
  function handleChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onSelect(file);
  }

  const classNames = [styles.picker, disabled ? styles.disabled : ""].filter(Boolean).join(" ");

  return (
    <label className={classNames}>
      {children}
      <input
        type="file"
        className={styles.input}
        accept={accept}
        onChange={handleChange}
        disabled={disabled}
      />
    </label>
  );
}
