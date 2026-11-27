import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Analyses confiées à un lecteur : le praticien (ici l'administrateur, qui
 * dépose aussi) confie l'analyse dès l'import ; le lecteur la voit, et elle
 * seule ; un autre lecteur ne voit rien. La liste se modifie ensuite depuis
 * la page de l'analyse, et l'historique dit à qui chaque analyse est confiée.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";
const MARQUE = Date.now();
const L1 = { email: `lecteur1.attrib.${MARQUE}@e2e.example.org`, prenom: "Lova", nom: `Confiance${MARQUE}` };
const L2 = { email: `lecteur2.attrib.${MARQUE}@e2e.example.org`, prenom: "Tiana", nom: `Relais${MARQUE}` };
const nomDe = (l) => `${l.prenom} ${l.nom}`;

async function signIn(page, email, arrivee) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(arrivee);
}

async function enLecteur(browser, lecteur, action) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await signIn(page, lecteur.email, /\/tableau-de-bord/);
  try {
    await action(page);
  } finally {
    await ctx.close();
  }
}

test("confier une analyse à un lecteur, puis changer de lecteur", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, ADMIN_EMAIL, /\/admin\/comptes/);
  const roles = await (await page.request.get("/api/v1/roles")).json();
  const lecteurRole = roles.find((r) => r.libelle === "Lecteur").id;
  for (const l of [L1, L2]) {
    const r = await page.request.post("/api/v1/utilisateurs", {
      data: { email: l.email, nom: l.nom, prenom: l.prenom, role_id: lecteurRole, modes_connexion: ["google"] },
    });
    expect(r.status()).toBe(201);
  }

  // Import : confiée à L1 dès la confirmation.
  await page.goto("/nouvelle-analyse");
  await page.setInputFiles("#file", PANO);
  const choix = page.locator("[data-lecteurs]");
  await expect(choix).toBeVisible({ timeout: 30_000 });
  await choix.getByLabel(new RegExp(nomDe(L1))).check();
  await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
  await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
  const reference = (await page.locator("[data-etat=import-termine]").innerText()).match(/PDX-\d{4}-\d{4}/)[0];
  const [analyse] = (await (await page.request.get(`/api/v1/historique?q=${reference}`)).json()).elements;

  // L1 est prévenu, retrouve l'analyse, et elle seule.
  await enLecteur(browser, L1, async (p) => {
    const notifs = (await (await p.request.get("/api/v1/moi/notifications")).json()).notifications;
    expect(notifs.find((n) => n.type === "analyse_confiee")?.reference).toBe(reference);
    const h = await (await p.request.get("/api/v1/historique")).json();
    expect(h.elements.map((e) => e.reference)).toEqual([reference]);
    await p.goto("/historique");
    await expect(p.locator("tbody tr")).toHaveCount(1, { timeout: 30_000 });
    await expect(p.locator("tbody tr")).toContainText(reference);
    await expect(p.locator("th", { hasText: "Confiée à" })).toHaveCount(0);   // il ne voit pas ses pairs
    await p.goto(`/analyse?id=${analyse.id}`);
    await expect(p.locator(".trace")).toBeVisible({ timeout: 30_000 });
    await expect(p.getByRole("button", { name: /Lecteurs|Confier/ })).toHaveCount(0);
  });

  // L2 : rien ne lui est confié.
  await enLecteur(browser, L2, async (p) => {
    expect((await p.request.get(`/api/v1/analyses/${analyse.id}`)).status()).toBe(404);
    await p.goto("/historique");
    await expect(p.getByText("aucune ne l’est encore")).toBeVisible({ timeout: 30_000 });
  });

  // Page de l'analyse : L1 retiré, L2 ajouté.
  await page.goto(`/analyse?id=${analyse.id}`);
  await page.getByRole("button", { name: "Lecteurs (1)" }).click();
  const dialog = page.getByRole("dialog", { name: "Lecteurs de l’analyse" });
  await dialog.getByLabel(new RegExp(nomDe(L1))).uncheck();
  await dialog.getByLabel(new RegExp(nomDe(L2))).check();
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("button", { name: "Lecteurs (1)" })).toHaveAttribute("title", new RegExp(nomDe(L2)));

  // Historique : colonne « Confiée à » et filtre par lecteur.
  await page.goto("/historique");
  await page.locator("#owner").selectOption("all");
  await page.locator("#lecteur").selectOption({ label: nomDe(L2) });
  await expect(page).toHaveURL(/lecteur=/);
  const ligne = page.locator("tbody tr", { hasText: reference });
  await expect(ligne).toHaveCount(1, { timeout: 30_000 });
  await expect(ligne.locator("[data-lecteurs]")).toHaveText(nomDe(L2));

  await enLecteur(browser, L1, async (p) => {
    expect((await p.request.get(`/api/v1/analyses/${analyse.id}`)).status()).toBe(404);
  });
});
