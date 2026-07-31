import { useEffect, useState } from "react";
import UploadPanel from "../src/components/UploadPanel.jsx";
import DetectionViewer from "../src/components/DetectionViewer.jsx";
import { health } from "../src/api.js";

export default function Home() {
  const [status, setStatus] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    health().then(setStatus).catch(() => setStatus({ status: "backend indisponible" }));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: "#1F2937", maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <header style={{ borderBottom: "3px solid #0F766E", paddingBottom: 12, marginBottom: 20 }}>
        <h1 style={{ color: "#134E4A", margin: 0 }}>PanoraDent AI</h1>
        <p style={{ color: "#4B5563", margin: "4px 0 0" }}>
          Aide au diagnostic — prototype de recherche non certifié.
        </p>
        {status && (
          <small style={{ color: status.inference_mode === "real" ? "#0F766E" : "#B45309" }}>
            Backend : {status.status} · Inférence : {status.inference_mode || "?"}
            {status.inference_mode === "mock" && " (détections factices — aucun modèle entraîné)"}
          </small>
        )}
      </header>

      <UploadPanel onDone={setAnalysis} />
      {analysis && <DetectionViewer analysis={analysis} />}
    </div>
  );
}
