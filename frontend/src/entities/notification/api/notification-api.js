import { httpClient } from "@/shared/api";

import { normalizePage } from "../model/notification";

/** `GET /moi/notifications` — les plus récentes et le compte des non lues. */
export async function fetchNotifications({ avant, limite = 20 } = {}) {
  const { data } = await httpClient.get("/moi/notifications", { params: { limite, ...(avant ? { avant } : {}) } });
  return normalizePage(data);
}

export async function markNotificationRead(id) {
  await httpClient.post(`/moi/notifications/${encodeURIComponent(id)}/lue`);
}

export async function markAllNotificationsRead() {
  const { data } = await httpClient.post("/moi/notifications/lues");
  return data.marquees;
}
