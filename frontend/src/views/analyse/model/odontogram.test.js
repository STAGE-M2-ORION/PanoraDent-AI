import { describe, expect, it } from "vitest";

import { LOWER, POSITIONS, ToothState, UPPER, nextTooth, odontogramFileName, toSvgString, toothKind, toothLabel, toothStates } from "./odontogram";

const tooth = (fdi, over = {}) => ({ id: `t${fdi}`, fdi, doubtful: false, status: "pending", ...over });
const anomaly = (fdi, label, status = "pending") => ({ id: `a${fdi}${label}`, fdi, label, status });

describe("table de positions", () => {
  it("place les trente-deux dents, chacune une fois, face au patient", () => {
    expect(Object.keys(POSITIONS)).toHaveLength(32);
    expect(new Set([...UPPER, ...LOWER]).size).toBe(32);
    // Droite du patient à gauche du schéma : 18 et 48 en première colonne.
    expect(POSITIONS[18].col).toBe(0);
    expect(POSITIONS[48].col).toBe(0);
    expect(POSITIONS[11].col + 1).toBe(POSITIONS[21].col);
    expect(POSITIONS[36].upper).toBe(false);
    expect(toothKind(16)).toBe("molaire");
    expect(toothKind(13)).toBe("canine");
  });
});

describe("état de chaque dent", () => {
  it("présente, porteuse, déclarée absente, non détectée", () => {
    const s = toothStates({
      teeth: [tooth(11), tooth(36)],
      dets: [anomaly(36, "caries"), anomaly(11, "caries", "rejected")],
      absentTeeth: [{ fdi: 18 }],
    });
    expect(s[11].state).toBe(ToothState.PRESENT); // l'anomalie rejetée ne marque plus la dent
    expect(s[36].state).toBe(ToothState.ANOMALY);
    expect(s[18].state).toBe(ToothState.ABSENT);
    expect(s[28].state).toBe(ToothState.UNDETECTED);
  });

  it("une dent douteuse est signalée, qu'elle vienne du serveur ou d'une incohérence", () => {
    const s = toothStates({
      teeth: [tooth(36, { doubtful: true }), tooth(37)],
      incoherences: [{ type: "ordre", fdi: [38, 37], message: "…" }],
    });
    expect(s[36].doubtful).toBe(true);
    expect(s[37].doubtful).toBe(true);
    expect(s[37].issues[0].type).toBe("ordre");
    expect(s[11].doubtful).toBe(false);
  });

  it("deux détections au même numéro restent visibles comme telles", () => {
    const s = toothStates({ teeth: [tooth(36), tooth(36, { id: "t36b" })] });
    expect(s[36].detections).toHaveLength(2);
    expect(toothLabel(s[36])).toContain("2 détections portent ce numéro");
  });
});

describe("libellé annoncé", () => {
  it("donne le numéro, l'état, les anomalies et ce qui reste à revoir", () => {
    const s = toothStates({ teeth: [tooth(36, { doubtful: true })], dets: [anomaly(36, "caries"), anomaly(36, "deep_caries", "validated")] });
    const texte = toothLabel(s[36], (l) => ({ caries: "Carie", deep_caries: "Carie profonde" })[l]);
    expect(texte).toBe("Dent 36 · présente · Carie, Carie profonde · 1 à revoir · numéro à vérifier");
    expect(toothLabel(toothStates({})[18])).toBe("Dent 18 · non détectée");
  });
});

describe("navigation au clavier", () => {
  it("se déplace le long de l'arcade, change d'arcade, s'arrête aux bords", () => {
    expect(nextTooth(11, "ArrowRight")).toBe(21);
    expect(nextTooth(11, "ArrowLeft")).toBe(12);
    expect(nextTooth(18, "ArrowLeft")).toBe(18);
    expect(nextTooth(16, "ArrowDown")).toBe(46);
    expect(nextTooth(36, "ArrowUp")).toBe(26);
    expect(nextTooth(34, "Home")).toBe(48);
    expect(nextTooth(34, "End")).toBe(38);
    expect(nextTooth(34, "Enter")).toBeNull();
  });
});

describe("export", () => {
  it("produit un SVG autonome des trente-deux dents, et un nom anonyme", () => {
    const svg = toSvgString(toothStates({ teeth: [tooth(36)], dets: [anomaly(36, "caries")], absentTeeth: [18] }), {
      title: "Analyse PDX-2026-0003 <test>",
    });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.match(/<g><rect /g)).toHaveLength(32);
    expect(svg).toContain("&lt;test&gt;"); // titre échappé
    expect(svg).toContain('stroke-dasharray="3 2"'); // la 18 déclarée absente
    expect(svg).toContain('fill="#F0E442"'); // la carie de la 36
    expect(svg).toContain("CP = Carie profonde"); // légende des marques, lisible en gris
    expect(odontogramFileName("PDX-2026-0003")).toBe("odontogramme-PDX-2026-0003.png");
    expect(odontogramFileName("../a b")).toBe("odontogramme-___a_b.png");
  });
});
