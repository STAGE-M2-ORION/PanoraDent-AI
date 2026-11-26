import { httpClient } from "@/shared/api";

import { normalizeAccessRequest } from "../model/access-request";

/** `POST /demandes-acces` — publique ; même réponse quoi qu'il arrive. */
export async function submitAccessRequest(form) {
  const { data } = await httpClient.post(
    "/demandes-acces",
    { nom: form.name, email: form.email, profil: form.profile, etablissement: form.office, ville: form.city, message: form.message },
    { skipRefresh: true },
  );
  return data.message;
}

/** `GET /administration/demandes-acces` — `user:manage`. */
export async function fetchAccessRequests(status) {
  const { data } = await httpClient.get("/administration/demandes-acces", { params: status ? { statut: status } : {} });
  return { pending: data.en_attente ?? 0, items: (data.demandes ?? []).map(normalizeAccessRequest) };
}

export async function acceptAccessRequest(id, { roleId, modes, lastName, firstName }) {
  const { data } = await httpClient.post(`/administration/demandes-acces/${encodeURIComponent(id)}/accepter`, {
    role_id: roleId,
    modes_connexion: modes,
    nom: lastName,
    prenom: firstName,
  });
  return normalizeAccessRequest(data.demande);
}

export async function refuseAccessRequest(id, reason) {
  const { data } = await httpClient.post(`/administration/demandes-acces/${encodeURIComponent(id)}/refuser`, { motif: reason ?? "" });
  return normalizeAccessRequest(data.demande);
}
