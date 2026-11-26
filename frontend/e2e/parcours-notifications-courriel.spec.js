import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Sprint 13, lot C — l'analyse qu'un praticien avait clôturée est rouverte par
 * l'administrateur : il en est prévenu dans l'application (cloche, motif) et,
 * faute de l'avoir lue pendant le délai de grâce, par e-mail, envoyé par le
 * worker et inscrit au journal. La case du profil coupe cet e-mail.
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

async function analyseCloturee(p) {
  await p.goto("/nouvelle-analyse");
  await p.setInputFiles("#file", PANO);
  await expect(p.locator(".zone-auto")).toHaveCount(2);
  await p.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
  await expect(p.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
  const liste = await (await p.request.get("/api/v1/analyses", { params: { mine: true } })).json();
  const a = await (await p.request.get(`/api/v1/analyses/${liste[0].id}`)).json();
  for (const d of a.detections.filter((x) => x.label !== "tooth")) {
    expect((await p.request.post(`/api/v1/analyses/${a.id}/detections/${d.id}/verdict`, { data: { action: "valider" } })).status()).toBe(200);
  }
  expect((await p.request.post(`/api/v1/analyses/${a.id}/cloturer`, { data: { conclusion: "Rien à signaler." } })).status()).toBe(200);
  return a;
}

const envoisAuJournal = async (page, reference) => {
  const j = await (await page.request.get("/api/v1/journal", { params: { jours: 1, categorie: "Analyses" } })).json();
  return j.sessions.flatMap((s) => s.entrees).filter((e) => e.action === "notifications_envoyees" && (e.precision || "").includes(reference));
};

test("réouverture : cloche et e-mail, selon la préférence", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, ADMIN_EMAIL, /\/admin\/comptes/);
  const roles = await (await page.request.get("/api/v1/roles")).json();
  const email = `dr.courriel.${Date.now()}@e2e.example.org`;
  expect((await page.request.post("/api/v1/utilisateurs", {
    data: { email, nom: "Courriel", prenom: "Voahangy", role_id: roles.find((r) => r.libelle === "Praticien").id, modes_connexion: ["google"] },
  })).status()).toBe(201);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  await signIn(p, email, /\/tableau-de-bord/);
  const a = await analyseCloturee(p);
  await p.goto("/tableau-de-bord");
  const cloche = p.getByRole("button", { name: /^Notifications : / });
  await expect(cloche).toHaveAttribute("data-connecte", "oui");

  // L'administrateur rouvre : le praticien est prévenu en direct, avec le motif.
  expect((await page.request.post(`/api/v1/analyses/${a.id}/rouvrir`, { data: { motif: "Vérifier la 46 sur le cliché de contrôle" } })).status()).toBe(200);
  await expect(cloche).toHaveAttribute("aria-label", "Notifications : 2 non lues");
  await cloche.click();
  await expect(p.getByRole("region", { name: "Notifications" }).getByRole("link", { name: new RegExp(`Analyse ${a.reference} rouverte`) }))
    .toContainText("Motif : Vérifier la 46 sur le cliché de contrôle");
  await p.keyboard.press("Escape");

  // Non lue après le délai de grâce : l'e-mail part (worker), inscrit au journal.
  await expect.poll(async () => (await envoisAuJournal(page, a.reference)).length, { timeout: 60_000 }).toBe(1);

  // Case décochée dans le profil : la réouverture suivante ne part plus par e-mail.
  await p.goto("/profil?onglet=preferences");
  await p.getByLabel("Une analyse que j’avais clôturée a été rouverte").uncheck();
  await p.getByRole("button", { name: "Enregistrer mes préférences" }).click();
  await expect(p.getByText("Préférences enregistrées")).toBeVisible();
  const b = await analyseCloturee(p);
  expect((await page.request.post(`/api/v1/analyses/${b.id}/rouvrir`, { data: { motif: "Deuxième contrôle demandé" } })).status()).toBe(200);
  await expect(cloche).toHaveAttribute("aria-label", /Notifications : \d+ non lues/);
  await p.waitForTimeout(15_000);                       // grâce (2 s) + passage du worker (10 s)
  expect(await envoisAuJournal(page, b.reference)).toEqual([]);
  await ctx.close();
});
