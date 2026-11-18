import { useEffect, useState } from "react";

import { ANOMALY_LABELS, DETECTION_TYPES, detectionType } from "@/entities/detection";
import { Icon } from "@/shared/ui";

import { STATUS_LABEL, isDashed, pct, sortDetections } from "@/widgets/analysis-workspace";

function Row({ d, selected, hovered, hiddenLayer, dim, onSelect, onHover, reviewerName }) {
  const t = detectionType(d.label);
  return (
    <button
      type="button"
      className={`row${hovered ? " hover" : ""}${dim ? " dim" : ""}`}
      role="listitem"
      aria-pressed={selected}
      onClick={() => onSelect(d.id)}
      onMouseEnter={() => onHover(d.id)}
    >
      <span className={`sw${isDashed(d) ? " dash" : ""}`} style={{ borderColor: t.color, background: `${t.color}33` }} />
      <span className="t">{t.label}</span>
      <span className="c">{d.confidence == null ? "—" : pct(d.confidence)}</span>
      <span className="meta">
        <span className={`st ${d.status}`}>{STATUS_LABEL[d.status]}</span>
        {hiddenLayer ? (
          <span title="Calque masqué sur l'image">
            <Icon name="eyeoff" />
          </span>
        ) : null}
        <span>{d.source === "user" ? `par ${reviewerName}` : "IA"}</span>
      </span>
    </button>
  );
}

const fdiOptions = (teeth) =>
  [...new Set([...teeth.map((t) => t.fdi), ...[11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48]])].sort((a, b) => a - b);

/** Formulaire type + dent (ajout ou correction). */
function TypeToothFields({ prefix, label, fdi, teeth, onChange }) {
  return (
    <div className="two">
      <label className="vfield">
        Type d&apos;anomalie
        <select className="vinput" id={`${prefix}Type`} value={label} onChange={(e) => onChange({ label: e.target.value })}>
          {ANOMALY_LABELS.map((k) => (
            <option key={k} value={k}>
              {DETECTION_TYPES[k].label}
            </option>
          ))}
        </select>
      </label>
      <label className="vfield">
        Dent (FDI)
        <select className="vinput" id={`${prefix}Fdi`} value={fdi ?? ""} onChange={(e) => onChange({ fdi: Number(e.target.value) })}>
          {fdiOptions(teeth).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function NewDetection({ near, teeth, onCancel, onSave }) {
  const [form, setForm] = useState({ label: "caries", fdi: near, note: "" });
  useEffect(() => setForm((f) => ({ ...f, fdi: near })), [near]);
  return (
    <>
      <h3>
        <Icon name="plus" /> Nouvelle détection
      </h3>
      <p className="note-ro">
        <Icon name="info" />
        <span>Cadre tracé. Choisissez le type et vérifiez le numéro de la dent (proposé d&apos;après la position).</span>
      </p>
      <TypeToothFields prefix="n" label={form.label} fdi={form.fdi} teeth={teeth} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
      <label className="vfield">
        Commentaire (facultatif)
        <textarea className="vinput" placeholder="Ex. : image radio-claire distale" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
      </label>
      <div className="two">
        <button type="button" className="vbtn outline" onClick={onCancel}>
          Annuler
        </button>
        <button type="button" className="vbtn accent" onClick={() => onSave(form)}>
          Enregistrer la détection
        </button>
      </div>
    </>
  );
}

/**
 * Onglet « Détections » : seuil, tri, liste (au-dessus / sous le seuil),
 * détail de la détection sélectionnée et actions de revue.
 */
export function DetectionsPane({ vm, state, actions, canReview, reviewerName }) {
  const { dets, sel, hover, threshold, sort, onlyPending, tooth, show, mode, confirmDel, closed, autoNext, draft } = state;
  const current = dets.find((d) => d.id === sel);
  const locked = closed || !canReview;
  const [note, setNote] = useState(current?.note ?? "");
  const [correction, setCorrection] = useState(null);
  useEffect(() => setNote(current?.note ?? ""), [current?.id, current?.note]);
  useEffect(() => {
    if (mode === "correct" && current) setCorrection({ label: current.label, fdi: current.fdi });
    else setCorrection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, current?.id]);

  const pool = dets.filter((d) => (!onlyPending || d.status === "pending") && (!tooth || d.fdi === tooth));
  const above = sortDetections(pool.filter((d) => d.confidence == null || d.confidence >= threshold), sort);
  const below = sortDetections(pool.filter((d) => d.confidence != null && d.confidence < threshold), sort);
  const shown = dets.filter((d) => d.confidence == null || d.confidence >= threshold).length;

  const rowProps = (d) => ({
    d,
    selected: d.id === sel,
    hovered: d.id === hover,
    hiddenLayer: !show[d.label],
    onSelect: actions.select,
    onHover: actions.hover,
    reviewerName,
  });

  let lastFdi = null;
  const rows = above.map((d) => {
    const header =
      sort === "tooth" && d.fdi !== lastFdi ? (
        <div key={`g${d.fdi}`} className="grp">
          <span>
            Dent <b>{d.fdi}</b>
          </span>
          <span>{d.fdi >= 30 ? "mandibule" : "maxillaire"}</span>
        </div>
      ) : null;
    lastFdi = d.fdi;
    return [header, <Row key={d.id} {...rowProps(d)} />];
  });

  let detail;
  if (mode === "drawn" && draft) {
    detail = <NewDetection near={state.nearTooth} teeth={vm.teeth} onCancel={actions.cancelDraw} onSave={actions.saveNew} />;
  } else if (!current) {
    detail = (
      <p className="empty-sel">
        <Icon name="info" />
        <span>Sélectionnez une détection dans la liste, sur l&apos;image ou sur le schéma dentaire.</span>
      </p>
    );
  } else {
    const t = detectionType(current.label);
    detail = (
      <>
        <h3>
          <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, border: `2px ${isDashed(current) ? "dashed" : "solid"} ${t.color}` }} />
          Dent {current.fdi} · {t.label}
        </h3>
        <dl className="kv">
          <dt>Confiance</dt>
          <dd className="mono">{current.confidence == null ? "— (ajout manuel)" : pct(current.confidence)}</dd>
          <dt>Origine</dt>
          <dd>{current.source === "user" ? `Ajoutée par ${reviewerName}` : `Détection de l'IA · modèle ${vm.modelShort ?? vm.modelVersion}`}</dd>
          <dt>Statut</dt>
          <dd>
            <span className={`st ${current.status}`}>{STATUS_LABEL[current.status]}</span>
          </dd>
          {current.was ? (
            <>
              <dt>Avant</dt>
              <dd>{detectionType(current.was).label} (proposition de l&apos;IA)</dd>
            </>
          ) : null}
        </dl>
        {mode === "correct" && correction ? (
          <>
            <p className="note-ro">
              <Icon name="move" />
              <span>Faites glisser le cadre pour le déplacer, la poignée en bas à droite pour le redimensionner.</span>
            </p>
            <TypeToothFields prefix="c" label={correction.label} fdi={correction.fdi} teeth={vm.teeth} onChange={(patch) => setCorrection((c) => ({ ...c, ...patch }))} />
            <div className="two">
              <button type="button" className="vbtn outline" onClick={actions.cancelCorrect}>
                Annuler
              </button>
              <button type="button" className="vbtn accent" onClick={() => actions.saveCorrect(correction)}>
                Enregistrer la correction
              </button>
            </div>
          </>
        ) : confirmDel ? (
          <div className="inline-confirm">
            <strong>Supprimer cette détection ?</strong>
            <span style={{ color: "var(--color-viewer-muted)" }}>Elle disparaît de l&apos;image et du compte rendu. La suppression est tracée au journal d&apos;audit.</span>
            <div className="two">
              <button type="button" className="vbtn outline" onClick={() => actions.setConfirmDel(false)}>
                Garder
              </button>
              <button type="button" className="vbtn danger outline" onClick={actions.remove}>
                <Icon name="trash" />
                Supprimer
              </button>
            </div>
          </div>
        ) : !locked ? (
          <>
            <div className="actions">
              <button type="button" className={`vbtn${current.status === "pending" ? " accent" : ""}`} onClick={actions.validate}>
                <Icon name="check" />
                {current.status === "validated" ? "Validée" : "Valider"}
              </button>
              <button type="button" className="vbtn" onClick={actions.startCorrect}>
                <Icon name="edit" />
                Corriger
              </button>
              <button type="button" className="vbtn danger" onClick={() => actions.setConfirmDel(true)}>
                <Icon name="trash" />
                Supprimer
              </button>
            </div>
            <label className="note-ro" style={{ cursor: "pointer", alignItems: "center" }}>
              <input type="checkbox" checked={autoNext} onChange={(e) => actions.setAutoNext(e.target.checked)} /> Passer ensuite à la prochaine détection non revue
            </label>
          </>
        ) : (
          <p className="note-ro">
            <Icon name="lock" />
            <span>{closed ? "Analyse clôturée : résultats verrouillés." : "Lecture seule : votre rôle ne permet pas de modifier les détections."}</span>
          </p>
        )}
        <label className="vfield">
          Commentaire du praticien
          <textarea
            className="vinput"
            readOnly={locked}
            placeholder={locked ? "Aucun commentaire" : "Ajouter une observation (reprise dans le compte rendu)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => !locked && note !== (current.note ?? "") && actions.saveNote(note)}
          />
        </label>
        <button type="button" className="vbtn outline" style={{ justifySelf: "start" }} onClick={() => actions.askAbout(current)}>
          <Icon name="message" />
          Demander à l&apos;assistant
        </button>
      </>
    );
  }

  return (
    <>
      <div className="thr">
        <div className="thr-top">
          <label htmlFor="thr">Seuil de confiance</label>
          <output htmlFor="thr">{pct(threshold)}</output>
        </div>
        <input type="range" id="thr" min="0" max="100" step="1" value={threshold} aria-describedby="thrHelp" onChange={(e) => actions.setThreshold(Number(e.target.value))} />
        <small id="thrHelp">
          {shown} affichée{shown > 1 ? "s" : ""} · {dets.length - shown} sous le seuil. Un seuil bas montre plus de propositions, et plus de fausses alertes.
        </small>
      </div>
      <div className="list-tools">
        <label htmlFor="sort">Trier</label>
        <select id="sort" value={sort} onChange={(e) => actions.setSort(e.target.value)}>
          <option value="tooth">par dent</option>
          <option value="conf">par confiance</option>
          <option value="status">par statut</option>
        </select>
        <label>
          <input type="checkbox" checked={onlyPending} onChange={(e) => actions.setOnlyPending(e.target.checked)} /> Non revues seulement
        </label>
        {tooth ? (
          <button type="button" className="vbtn" style={{ minHeight: 28, fontSize: "var(--text-xs)" }} aria-label={`Retirer le filtre de la dent ${tooth}`} onClick={() => actions.setTooth(null)}>
            Dent {tooth} <Icon name="x" />
          </button>
        ) : null}
      </div>
      <div className="list" role="list" onMouseLeave={() => actions.hover(null)}>
        {above.length ? (
          rows
        ) : (
          <p className="empty-sel" style={{ padding: "var(--space-4)" }}>
            <Icon name="info" />
            <span>
              Aucune détection {tooth ? `sur la dent ${tooth} ` : ""}au-dessus du seuil{onlyPending ? " parmi les non revues" : ""}.
            </span>
          </p>
        )}
        {below.length ? (
          <details className="below">
            <summary>
              Sous le seuil de {pct(threshold)} ({below.length}) — masquées sur l&apos;image
            </summary>
            {below.map((d) => (
              <Row key={d.id} {...rowProps(d)} dim />
            ))}
          </details>
        ) : null}
      </div>
      <div className="detail" aria-live="polite">
        {detail}
      </div>
      {canReview ? (
        <div className="add-bar">
          <button type="button" className="vbtn outline" disabled={closed} onClick={actions.startDraw}>
            <Icon name="plus" />
            Ajouter une détection
          </button>
        </div>
      ) : null}
    </>
  );
}
