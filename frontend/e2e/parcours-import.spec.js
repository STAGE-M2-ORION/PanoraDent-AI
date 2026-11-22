import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Parcours du sprint 3, contre la stack de test (`docker-compose.e2e.yml`) :
 * refus des mauvais fichiers, aperçu anonymisé sans stockage, tracé d'un
 * masque, abandon sans trace, confirmation sous une référence anonyme,
 * « Mes analyses », suppression par le déposant.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const PETITE = path.join(ICI, "fixtures", "image-trop-petite.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
}

async function firstLoginLink(request, email) {
  let lien = null;
  await expect
    .poll(async () => {
      const r = await request.get("/api/v1/test/courriels", { params: { destinataire: email } });
      const m = (await r.json()).filter((x) => x.texte.includes("/premiere-connexion?jeton="));
      lien = m.length ? m.at(-1).texte.match(/https?:\/\/\S+premiere-connexion\?jeton=\S+/)[0] : null;
      return Boolean(lien);
    })
    .toBe(true);
  const url = new URL(lien);
  return `${url.pathname}${url.search}`;
}

/** Nombre d'analyses déposées par le compte connecté (vu par l'API). */
async function mesAnalyses(page) {
  const r = await page.request.get("/api/v1/analyses", { params: { mine: "true" } });
  return (await r.json()).length;
}

test.describe.serial("parcours du sprint 3 : import anonymisé", () => {
  const email = `import.e2e.${Date.now()}@e2e.example.org`;
  const password = "mot de passe du praticien import";

  test("un praticien est créé et active son compte", async ({ page, request }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await page.getByRole("button", { name: "Créer un compte" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un compte" });
    await dialog.getByLabel("Prénom").fill("Tiana");
    await dialog.getByLabel("Nom", { exact: true }).fill("Import");
    await dialog.getByLabel("Adresse e-mail", { exact: true }).fill(email);
    await dialog.getByLabel("Rôle").selectOption({ label: "Praticien" });
    await dialog.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Compte créé" })).toBeVisible();

    await page.context().clearCookies();
    await page.goto(await firstLoginLink(request, email));
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(password);
    await page.getByLabel("Confirmez le mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Activer mon compte" }).click();
    await page.getByRole("button", { name: "Plus tard, continuer vers l’application" }).click();
    await page.waitForURL(/\/tableau-de-bord/);
  });

  test.beforeEach(async ({ page }, info) => {
    if (info.title.startsWith("un praticien est créé")) return;
    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(/\/tableau-de-bord/);
  });

  test("un PDF puis une image de 400 px sont refusés, chacun avec son message", async ({ page }) => {
    await page.goto("/nouvelle-analyse");
    await page.setInputFiles("#file", { name: "compte-rendu.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n" + "0".repeat(4000)) });
    await expect(page.locator("[data-erreur=fichier-refuse]")).toContainText("PNG, JPEG ou DICOM");
    await page.setInputFiles("#file", PETITE);
    await expect(page.locator("[data-erreur=fichier-refuse]")).toContainText("400 × 300");
    expect(await mesAnalyses(page)).toBe(0);
  });

  test("aperçu avec inscriptions masquées, masque tracé, abandon : aucune trace", async ({ page }) => {
    await page.goto("/nouvelle-analyse");
    await page.setInputFiles("#file", PANO);
    await expect(page.locator("[data-testid=mask-surface] img")).toBeVisible();
    await expect(page.locator(".zone-auto")).toHaveCount(2);
    await expect(page.getByText("2 inscriptions masquées automatiquement")).toBeVisible();

    const box = await page.locator("[data-testid=mask-surface]").boundingBox();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator(".zone-manual")).toHaveCount(1);
    await page.getByRole("button", { name: "Retirer le masque 1" }).click();
    await expect(page.locator(".zone-manual")).toHaveCount(0);

    await page.getByRole("button", { name: "Abandonner" }).click();
    await expect(page.getByText("Glissez votre radiographie ici")).toBeVisible();
    expect(await mesAnalyses(page)).toBe(0); // rien n'a été enregistré
  });

  test("confirmation : référence anonyme, puis « Mes analyses » et suppression", async ({ page }) => {
    await page.goto("/nouvelle-analyse");
    await page.setInputFiles("#file", PANO);
    await expect(page.locator(".zone-auto")).toHaveCount(2);
    const box = await page.locator("[data-testid=mask-surface]").boundingBox();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 5 });
    await page.mouse.up();
    await page.getByLabel("Date de l’examen").fill("2026-11-18");
    await page.getByLabel("Note").fill("Contrôle à 6 mois");
    await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();

    const termine = page.locator("[data-etat=import-termine]");
    await expect(termine).toBeVisible({ timeout: 60_000 });
    await expect(termine).toContainText("2 inscriptions masquées, 1 masque ajouté à la main");
    const reference = (await termine.locator(".mono").innerText()).trim();
    expect(reference).toMatch(/^PDX-\d{4}-\d{4}$/);

    await page.goto("/historique");
    await expect(page.locator("#owner")).toHaveValue("mine");
    const row = page.getByRole("row").filter({ hasText: reference });
    await expect(row).toContainText("(vous)");
    await expect(row).toContainText("Examen du 18/11/2026");

    await row.getByRole("button", { name: `Supprimer l’analyse ${reference}` }).click();
    await page.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(page.getByText(`Analyse ${reference} supprimée`)).toBeVisible();
    expect(await mesAnalyses(page)).toBe(0);
  });
});
