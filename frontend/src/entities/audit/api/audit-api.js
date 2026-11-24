import { httpClient } from "@/shared/api";

import { normalizeAudit } from "../model/audit";

/** `GET /api/v1/journal` — journal d'audit groupé par session (`user:manage`). */
export async function fetchAudit(params) {
  const { data } = await httpClient.get("/journal", { params });
  return normalizeAudit(data);
}

/** `GET /api/v1/journal.csv` — export des entrées filtrées ; l'export est journalisé. */
export async function fetchAuditCsv(params) {
  const { data, headers } = await httpClient.get("/journal.csv", { params, responseType: "blob" });
  const m = /filename="?([^";]+)"?/i.exec(headers?.["content-disposition"] ?? "");
  return { blob: data, fileName: m ? m[1] : "journal-audit.csv" };
}
