import React, { useState } from "react";
import { uploadAnalysis } from "../api.js";

export default function UploadPanel({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const result = await uploadAnalysis(file);
      onDone(result);
    } catch (err) {
      setError("Échec de l'analyse : " + (err?.message || "erreur"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <label style={{
        display: "inline-block", padding: "10px 16px", background: "#0F766E",
        color: "white", borderRadius: 6, cursor: "pointer",
      }}>
        {busy ? "Analyse en cours…" : "Importer une panoramique (DICOM / JPG / PNG)"}
        <input type="file" accept=".dcm,image/*" onChange={handleFile}
               disabled={busy} style={{ display: "none" }} />
      </label>
      {error && <p style={{ color: "#C0392B" }}>{error}</p>}
    </section>
  );
}
