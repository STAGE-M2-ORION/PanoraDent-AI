import { httpClient } from "@/shared/api";

import { normalizeDocument, normalizeLibrary, normalizeSettings } from "../model/document";

/** `GET /api/v1/documents` — documents, état de l'index, réglages (`document:manage`). */
export async function fetchLibrary() {
  const { data } = await httpClient.get("/documents");
  return normalizeLibrary(data);
}

function form(file, title) {
  const body = new FormData();
  body.append("fichier", file);
  if (title && title.trim()) body.append("titre", title.trim());
  return body;
}

/** `POST /api/v1/documents` — PDF ou Markdown, 20 Mo ; indexé ensuite par le worker. */
export async function uploadDocument(file, title) {
  const { data } = await httpClient.post("/documents", form(file, title));
  return normalizeDocument(data);
}

/** `PUT /api/v1/documents/{id}/fichier` — nouvelle version du fichier, réindexée. */
export async function replaceDocument(id, file) {
  const { data } = await httpClient.put(`/documents/${encodeURIComponent(id)}/fichier`, form(file));
  return normalizeDocument(data);
}

/** `POST /api/v1/documents/{id}/reindexation`. */
export async function reindexDocument(id) {
  const { data } = await httpClient.post(`/documents/${encodeURIComponent(id)}/reindexation`);
  return normalizeDocument(data);
}

/** `POST /api/v1/documents/reindexation` — documents périmés et en échec ; renvoie leur nombre. */
export async function reindexStaleDocuments() {
  const { data } = await httpClient.post("/documents/reindexation");
  return data.documents ?? 0;
}

/** `DELETE /api/v1/documents/{id}` (204) — le document et ses passages. */
export async function deleteDocument(id) {
  await httpClient.delete(`/documents/${encodeURIComponent(id)}`);
}

/** `PUT /api/v1/assistant/parametres` — journalisé. */
export async function saveAssistantSettings(payload) {
  const { data } = await httpClient.put("/assistant/parametres", payload);
  return normalizeSettings(data);
}
