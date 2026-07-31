import React, { useEffect, useRef, useState } from "react";
import { getImageUrl, buildReport } from "../api.js";

const COLORS = { tooth: "#0F766E" };
const anomalyColor = "#C0392B";

export default function DetectionViewer({ analysis }) {
  const canvasRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [reportUrl, setReportUrl] = useState(null);

  useEffect(() => {
    getImageUrl(analysis.id).then(setImgUrl).catch(() => {});
    setReportUrl(null);
  }, [analysis.id]);

  useEffect(() => {
    if (!imgUrl) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      for (const d of analysis.detections) {
        const color = COLORS[d.label] || anomalyColor;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(d.x, d.y, d.w, d.h);
        ctx.fillStyle = color;
        ctx.font = "14px sans-serif";
        ctx.fillText(`${d.label} ${d.fdi || ""} ${d.confidence}`, d.x, Math.max(12, d.y - 4));
      }
    };
    img.src = imgUrl;
  }, [imgUrl, analysis]);

  return (
    <section>
      <h2 style={{ color: "#134E4A" }}>Détections proposées</h2>
      <p style={{ color: "#4B5563" }}>
        {analysis.detections.length} détection(s) · modèle {analysis.model_version} ({analysis.inference_mode})
      </p>
      <canvas ref={canvasRef} style={{ maxWidth: "100%", border: "1px solid #D8DEDD" }} />
      <div style={{ marginTop: 12 }}>
        <button
          onClick={() => buildReport(analysis.id).then(setReportUrl)}
          style={{ padding: "8px 14px", background: "#134E4A", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          Générer le rapport PDF
        </button>
        {reportUrl && (
          <a href={reportUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 12, color: "#0F766E" }}>
            Ouvrir le rapport
          </a>
        )}
      </div>
    </section>
  );
}
