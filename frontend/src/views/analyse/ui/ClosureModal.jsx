import { Alert, Button, Modal } from "@/shared/ui";

/**
 * Écran de clôture : récapitulatif des verdicts, conclusion libre,
 * confirmation. Refusée tant qu'une détection reste à revoir (le serveur le
 * vérifie aussi, et renvoie le compte).
 */
export function ClosureModal({ open, number, summary, conclusion, onConclusionChange, onConclusionBlur, onCancel, onGoNext, onConfirm, busy }) {
  const s = summary;
  const lines = [
    ["Validées", s.validated],
    ["Corrigées", s.corrected],
    ["Ajoutées par le praticien", s.added],
    ["Rejetées (exclues du compte rendu)", s.rejected],
  ];
  return (
    <Modal open={open} onClose={onCancel} labelledBy="closeTitle">
      <h2 id="closeTitle">Clôturer l&apos;analyse n° {number} ?</h2>
      {s.pending ? (
        <Alert tone="danger" icon="alert" role="alert" title={`${s.pending} détection${s.pending > 1 ? "s" : ""} sans verdict`}>
          La clôture exige un verdict sur chaque détection : validez, corrigez ou rejetez {s.pending > 1 ? "les" : "la"} d&apos;abord.
        </Alert>
      ) : null}
      {s.optional ? (
        <Alert tone="info" icon="info" title={`${s.optional} détection${s.optional > 1 ? "s" : ""} sous le seuil, sans verdict`}>
          Sous le seuil d&apos;exploitation de leur classe, elles n&apos;exigent pas de verdict : elles restent dans l&apos;analyse,
          mais n&apos;iront pas au compte rendu.
        </Alert>
      ) : null}
      <dl className="closure-recap" aria-label="Récapitulatif de la relecture">
        {lines.map(([label, n]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mono">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="field">
        <label className="label" htmlFor="conclusion">
          Conclusion du praticien (facultative)
        </label>
        <textarea
          className="textarea"
          id="conclusion"
          rows={4}
          maxLength={4000}
          placeholder="Ex. : carie 36 à traiter, contrôle de la 46 dans 6 mois."
          value={conclusion}
          onChange={(e) => onConclusionChange(e.target.value)}
          onBlur={onConclusionBlur}
        />
        <span className="hint">Reprise dans le compte rendu. Aucun nom de patient.</span>
      </div>
      <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
        La clôture verrouille l&apos;analyse : plus aucune détection ne peut être modifiée. Seul un administrateur peut la rouvrir, avec un motif inscrit au journal d&apos;audit.
      </p>
      <div className="modal-actions">
        {s.pending ? (
          <Button variant="secondary" onClick={onGoNext}>
            Aller à la suivante à revoir
          </Button>
        ) : (
          <Button variant="secondary" onClick={onCancel}>
            Continuer la relecture
          </Button>
        )}
        <Button onClick={onConfirm} disabled={Boolean(s.pending) || busy}>
          Clôturer l&apos;analyse
        </Button>
      </div>
    </Modal>
  );
}
