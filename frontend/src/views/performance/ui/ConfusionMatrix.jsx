/**
 * Matrice de confusion du jeu de test, telle que publiée au registre :
 * ligne = classe prédite, colonne = classe vraie ; « fond » = manqué (vrai
 * sans prédiction) ou inventé (prédiction sans vrai). Effectifs bruts ; la
 * teinte (une seule, de clair à foncé) suit l'effectif, le nombre est écrit
 * dans chaque case : la couleur ne porte jamais seule l'information.
 */
export function ConfusionMatrix({ confusion }) {
  const max = Math.max(1, ...confusion.matrix.flat());
  return (
    <div className="matrix-wrap">
      <p className="axis">Classe vraie →</p>
      <table className="matrix">
        <caption className="sr-only">
          Matrice de confusion du jeu de test : lignes, classe prédite ; colonnes, classe vraie ; effectifs.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="corner">
              Prédite ↓
            </th>
            {confusion.labels.map((n) => (
              <th key={n} scope="col">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {confusion.matrix.map((row, i) => (
            <tr key={confusion.labels[i]}>
              <th scope="row" className="rowh">
                {confusion.labels[i]}
              </th>
              {row.map((v, j) => {
                const share = v / max;
                return (
                  <td
                    // eslint-disable-next-line react/no-array-index-key
                    key={j}
                    className={i === j && !confusion.labels[i].startsWith("Fond") ? "diag" : undefined}
                    title={`Prédite « ${confusion.labels[i]} », vraie « ${confusion.labels[j]} » : ${v}`}
                    style={{
                      background: v ? `color-mix(in srgb, var(--color-primary) ${Math.round(Math.max(0.06, share) * 100)}%, var(--color-surface))` : "var(--color-subtle)",
                      color: share > 0.55 ? "var(--color-surface)" : "var(--color-ink)",
                    }}
                  >
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
