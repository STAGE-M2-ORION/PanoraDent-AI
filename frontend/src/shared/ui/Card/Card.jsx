import styles from "./Card.module.css";

export function Card({ title, description, className = "", children }) {
  const classNames = [styles.card, className].filter(Boolean).join(" ");

  return (
    <section className={classNames}>
      {title && <h2 className={styles.title}>{title}</h2>}
      {description && <p className={styles.description}>{description}</p>}
      {children}
    </section>
  );
}
