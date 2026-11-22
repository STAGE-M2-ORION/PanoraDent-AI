import { REVIEW_STATUS, detectionType } from "@/entities/detection";
import { Icon } from "@/shared/ui";

import { ToothState, toothKind } from "../model/odontogram";

const ARCADE = (fdi) => (fdi < 30 ? "maxillaire" : "mandibule");
const COTE = (fdi) => ([1, 4].includes(Math.floor(fdi / 10)) ? "droite du patient" : "gauche du patient");

const ETAT = {
  [ToothState.PRESENT]: "Détectée, aucune anomalie proposée.",
  [ToothState.ANOMALY]: "Détectée, porteuse d'anomalie.",
  [ToothState.ABSENT]: "Déclarée absente par le praticien.",
  [ToothState.UNDETECTED]: "Non détectée sur le cliché : absente, ou manquée par le modèle ?",
};

/**
 * Fiche d'une dent (sprint 7), dans le panneau latéral : numéro, état,
 * détections qui portent ce numéro (une par ligne en cas de doublon), rang
 * appris, numéro proposé s'il a été corrigé, incohérences signalées,
 * anomalies rattachées ; et les actions du praticien.
 */
export function ToothCard({ s, absentInfo, canEdit, onRenumber, onRejectTooth, onDeclareAbsent, onWithdrawAbsent, onSelectAnomaly, onClose }) {
  return (
    <section className="tooth-card" aria-labelledby="fiche-dent-titre" data-fdi={s.fdi}>
      <div className="tc-head">
        <h3 id="fiche-dent-titre">
          Dent {s.fdi}{" "}
          <span className="muted">
            · {toothKind(s.fdi)}, {ARCADE(s.fdi)}, {COTE(s.fdi)}
          </span>
        </h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer la fiche de la dent">
          <Icon name="x" />
        </button>
      </div>
      <p className="tc-state">{ETAT[s.state]}</p>
      {absentInfo ? (
        <p className="muted tc-meta">
          Déclarée par {absentInfo.author ?? "un praticien"}
          {absentInfo.at ? ` le ${new Date(`${String(absentInfo.at).replace(/Z?$/, "Z")}`).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}` : ""}.
        </p>
      ) : null}

      {s.issues.length ? (
        <ul className="tc-issues" aria-label="Numéro à vérifier">
          {s.issues.map((i) => (
            <li key={`${i.type}-${i.message}`}>
              <Icon name="alert" />
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      {s.detections.map((t) => (
        <div key={t.id} className="tc-det">
          <p className="tc-meta">
            {t.rank ? `Rang appris par le modèle : ${t.rank}.` : "Numéro déduit de la position."}
            {t.proposalFdi !== t.fdi ? ` Numéro proposé : ${t.proposalFdi}, corrigé en ${t.fdi}.` : ""}
          </p>
          {canEdit ? (
            <div className="tc-actions">
              <button type="button" className="vbtn outline" onClick={() => onRenumber(t)}>
                <Icon name="edit" />
                Changer le numéro
              </button>
              <button type="button" className="vbtn outline" onClick={() => onRejectTooth(t)} title="Ce cadre n'est pas une dent">
                <Icon name="x" />
                Rejeter cette détection
              </button>
            </div>
          ) : null}
        </div>
      ))}

      {canEdit && s.state === ToothState.UNDETECTED ? (
        <button type="button" className="vbtn outline" onClick={() => onDeclareAbsent(s.fdi)}>
          Déclarer la dent absente
        </button>
      ) : null}
      {canEdit && s.state === ToothState.ABSENT ? (
        <button type="button" className="vbtn outline" onClick={() => onWithdrawAbsent(s.fdi)}>
          Retirer la déclaration d&apos;absence
        </button>
      ) : null}

      {s.anomalies.length ? (
        <>
          <h4 className="tc-sub">Anomalies rattachées</h4>
          <ul className="tc-anomalies">
            {s.anomalies.map((d) => (
              <li key={d.id}>
                <button type="button" className="linkish" onClick={() => onSelectAnomaly(d.id)}>
                  <span className="dot" style={{ background: detectionType(d.label).color }} aria-hidden="true" />
                  {detectionType(d.label).label}
                  {d.confidence != null ? ` · ${d.confidence} %` : ""} · {REVIEW_STATUS[d.status]?.label ?? d.status}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
