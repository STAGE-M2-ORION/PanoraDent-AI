import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Sprint 13, lot B — notifications en temps réel : le praticien importe une
 * panoramique puis navigue ailleurs ; quand le worker termine, la cloche
 * s'incrémente et un message s'affiche, SANS recharger la page. La
 * notification ouvre l'analyse et passe « lue ». Un autre site ne peut pas
 * s'abonner au flux avec les cookies du praticien.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

async function signIn(page, email, arrivee) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(arrivee);
}

test("une analyse terminée fait sonner la cloche sans recharger la page", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await signIn(page, ADMIN_EMAIL, /\/admin\/comptes/);
  const roles = await (await page.request.get("/api/v1/roles")).json();
  const email = `dr.notif.${Date.now()}@e2e.example.org`;
  const cree = await page.request.post("/api/v1/utilisateurs", {
    data: { email, nom: "Cloche", prenom: "Hery", role_id: roles.find((r) => r.libelle === "Praticien").id, modes_connexion: ["google"] },
  });
  expect(cree.status()).toBe(201);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  await signIn(p, email, /\/tableau-de-bord/);
  const cloche = p.getByRole("button", { name: /^Notifications : / });
  await expect(cloche).toHaveAttribute("aria-label", "Notifications : aucune non lue");
  await expect(cloche).toHaveAttribute("data-connecte", "oui");

  // Import, puis navigation dans l'application (sans rechargement) pendant le traitement.
  await p.goto("/nouvelle-analyse");
  await expect(cloche).toHaveAttribute("data-connecte", "oui");
  await p.setInputFiles("#file", PANO);
  await expect(p.locator(".zone-auto")).toHaveCount(2);
  await p.evaluate(() => {
    window.__sansRechargement = true;      // perdu si la page se recharge
  });
  await p.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
  await p.getByRole("link", { name: "Historique" }).click();
  await p.waitForURL(/\/historique/);

  // La cloche et le message arrivent par le flux.
  await expect(cloche).toHaveAttribute("aria-label", "Notifications : 1 non lue", { timeout: 90_000 });
  await expect(p.getByRole("status").filter({ hasText: /Analyse PDX-\d{4}-\d{4} terminée/ })).toBeVisible();
  expect(await p.evaluate(() => window.__sansRechargement)).toBe(true);

  // Le panneau : la notification, sans donnée du patient, ouvre l'analyse et passe lue.
  await cloche.click();
  const panneau = p.getByRole("region", { name: "Notifications" });
  const lien = panneau.getByRole("link", { name: /Analyse PDX-\d{4}-\d{4} terminée/ });
  await expect(lien).toContainText("Prête à relire");
  await expect(panneau).not.toContainText("inscriptions");   // ni nom de fichier ni note
  await lien.click();
  await p.waitForURL(/\/analyse\?id=/);
  await expect(cloche).toHaveAttribute("aria-label", "Notifications : aucune non lue");
  const etat = await (await p.request.get("/api/v1/moi/notifications")).json();
  expect(etat.non_lues).toBe(0);
  expect(etat.notifications[0].lue).toBe(true);

  // Un autre site ne peut pas ouvrir le flux avec les cookies du praticien.
  const refus = await p.evaluate(async () => {
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/v1/moi/notifications/flux`);
    return await new Promise((resolve) => {
      ws.onmessage = (e) => resolve(`ouvert:${e.data}`);
      ws.onclose = (e) => resolve(`ferme:${e.code}`);
    });
  });
  expect(refus).toMatch(/^ouvert:/);       // depuis la page de PanoraDent : accepté
  const intrus = await p.request.get("/api/v1/moi/notifications/flux", {
    headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", Origin: "https://site-malveillant.example" },
  });
  expect(intrus.status()).toBe(403);        // depuis un autre site : refusé à la poignée de main
  await ctx.close();
});
