import { useEffect, useState } from "react";

import { fetchAnalysisReaders, fetchReaders, saveAnalysisReaders } from "@/entities/analysis";
import { toAppError } from "@/shared/api";
import { Alert, Button, Icon, Modal } from "@/shared/ui";

import { ReaderChecklist } from "./ReaderChecklist";

/**
 * Bandeau de l'analyse : « Lecteurs (n) ». Pour qui voit tout le cabinet ;
 * le déposant (ou un administrateur) modifie la liste, même après la clôture ;
 * les autres la consultent. Chaque lecteur ajouté est prévenu.
 */
export function AnalysisReaders({ analysisId }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAnalysisReaders(analysisId)
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState(null));
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  if (!state) return null;
  const n = state.readers.length;
  return (
    <>
      <button
        type="button"
        className="vbtn outline"
        onClick={() => setOpen(true)}
        title={n ? `Confiée à ${state.readers.map((r) => r.name).join(", ")}` : "Confier l’analyse à un lecteur"}
      >
        <Icon name="eye" />
        {n ? `Lecteurs (${n})` : state.editable ? "Confier à un lecteur" : "Aucun lecteur"}
      </button>
      {open ? <ReadersModal analysisId={analysisId} current={state} onSaved={setState} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ReadersModal({ analysisId, current, onSaved, onClose }) {
  const [all, setAll] = useState(null);
  const [selected, setSelected] = useState(current.readers.map((r) => r.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!current.editable) return undefined;
    let cancelled = false;
    fetchReaders()
      .then((list) => {
        if (cancelled) return;
        // Un lecteur déjà confié mais désactivé depuis reste affiché, pour pouvoir le retirer.
        const ids = new Set(list.map((r) => r.id));
        setAll([...list, ...current.readers.filter((r) => !ids.has(r.id))]);
      })
      .catch((cause) => !cancelled && setError(toAppError(cause).message));
    return () => {
      cancelled = true;
    };
  }, [current]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveAnalysisReaders(analysisId, selected));
      onClose();
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} labelledBy="lecteurs-t">
      <div className="stack">
        <h2 id="lecteurs-t">Lecteurs de l’analyse</h2>
        <p className="hint" style={{ margin: 0 }}>
          Un lecteur ne voit que les analyses qui lui sont confiées, en lecture seule. Chaque lecteur ajouté est prévenu ; un retrait lui ôte
          l’accès.
        </p>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        {current.editable ? (
          all ? (
            <ReaderChecklist readers={all} selected={selected} onChange={setSelected} disabled={busy} legend="Confiée à" />
          ) : (
            <p className="hint">Chargement des lecteurs…</p>
          )
        ) : current.readers.length ? (
          <ul data-lecteurs>
            {current.readers.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
        ) : (
          <p>Cette analyse n’est confiée à aucun lecteur. Seul le praticien qui l’a déposée, ou un administrateur, peut la confier.</p>
        )}
        <div className="actions">
          {current.editable ? (
            <Button onClick={save} disabled={busy || !all}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {current.editable ? "Annuler" : "Fermer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
