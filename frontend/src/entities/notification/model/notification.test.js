import { describe, expect, it } from "vitest";

import { mergeIncoming, normalizeNotification, normalizePage, parseStreamMessage, reconnectDelay, relativeTime, streamUrl } from "./notification";

const dto = { id: "n1", type: "analyse_echouee", titre: "Analyse PDX-1 échouée", message: "…", analyse_id: "a b", reference: "PDX-1", cree_le: "2026-11-26T10:00:00Z", lue: false };

describe("notifications", () => {
  it("réponse → modèle, lien vers l'analyse", () => {
    const p = normalizePage({ non_lues: 3, notifications: [dto], suivant: "c" });
    expect(p.unread).toBe(3);
    expect(p.next).toBe("c");
    expect(p.items[0]).toMatchObject({ id: "n1", title: "Analyse PDX-1 échouée", read: false, href: "/analyse?id=a%20b", tone: "danger" });
    expect(normalizePage({}).items).toEqual([]);
    const demande = normalizePage({ notifications: [{ ...dto, type: "demande_acces", analyse_id: null, lien: "/admin/demandes-acces?demande=x" }] }).items[0];
    expect(demande).toMatchObject({ href: "/admin/demandes-acces?demande=x", icon: "users" });
    // Jamais un lien hors de l'application.
    expect(normalizePage({ notifications: [{ ...dto, analyse_id: null, lien: "https://ailleurs.example" }] }).items[0].href).toBeNull();
  });

  it("analyse confiée au lecteur : lien vers l'analyse, ton informatif", () => {
    const n = normalizeNotification({ id: "n2", type: "analyse_confiee", titre: "Analyse PDX-2026-0042 confiée", analyse_id: "a 2", lue: false });
    expect(n).toMatchObject({ href: "/analyse?id=a%202", icon: "eye", tone: "info", read: false });
  });

  it("messages du flux", () => {
    expect(parseStreamMessage('{"type":"etat","non_lues":2}')).toEqual({ unread: 2 });
    const m = parseStreamMessage(JSON.stringify({ type: "notification", notification: dto, non_lues: 4 }));
    expect(m.unread).toBe(4);
    expect(m.notification.reference).toBe("PDX-1");
    expect(parseStreamMessage("pas du json")).toBeNull();
    expect(parseStreamMessage('{"type":"autre"}')).toBeNull();
  });

  it("adresse du flux sur la même origine", () => {
    expect(streamUrl("/api/v1", new URL("https://panoradent.cabinet.lan/historique"))).toBe("wss://panoradent.cabinet.lan/api/v1/moi/notifications/flux");
    expect(streamUrl("/api/v1/", new URL("http://localhost:3000/"))).toBe("ws://localhost:3000/api/v1/moi/notifications/flux");
    expect(streamUrl("http://localhost:8000/api/v1", new URL("http://localhost:3000/"))).toBe("ws://localhost:8000/api/v1/moi/notifications/flux");
  });

  it("reconnexion à délai croissant, plafonné", () => {
    expect([0, 1, 2, 3, 10].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 30000]);
  });

  it("arrivée en direct : en tête, sans doublon", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(mergeIncoming([a, b], { id: "b", x: 1 }).map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("temps relatif", () => {
    const t = new Date("2026-11-26T12:00:00Z");
    expect(relativeTime("2026-11-26T11:59:30Z", t)).toBe("à l’instant");
    expect(relativeTime("2026-11-26T11:55:00Z", t)).toBe("il y a 5 min");
    expect(relativeTime("2026-11-26T09:00:00Z", t)).toBe("il y a 3 h");
  });
});
