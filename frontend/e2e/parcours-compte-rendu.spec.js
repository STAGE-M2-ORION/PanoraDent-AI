import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Sprint 8, lots B et C — compte rendu produit par le serveur : avant la
 * clôture, un aperçu « BROUILLON » et aucun téléchargement ; après la
 * clôture, le PDF définitif s'affiche, suit les options choisies et se
 * télécharge sous la référence anonyme.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/admin\/comptes/);
}

/** Texte brut du PDF affiché dans l'aperçu (le PDF n'est pas compressé). */
async function pdfAffiche(page) {
  const apercu = page.getByTestId("apercu-pdf");
  await expect(apercu).toBeVisible({ timeout: 30_000 });
  const src = await apercu.getAttribute("src");
  return page.evaluate(async (url) => new TextDecoder("latin1").decode(await (await fetch(url)).arrayBuffer()), src);
}

test.describe.serial("compte rendu produit par le serveur", () => {
  let analyseUrl = null;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signInWithGoogle(page, ADMIN_EMAIL);
  });

  test("avant la clôture : aperçu « brouillon », téléchargement impossible", async ({ page }) => {
    await page.goto("/nouvelle-analyse");
    await page.setInputFiles("#file", PANO);
    await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
    await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
    await page.goto("/historique");
    await page.locator("tbody tr").first().getByRole("link", { name: /Ouvrir/ }).click();
    await page.waitForURL(/\/analyse\?id=/);
    analyseUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    // Le lien ne porte l'identifiant qu'une fois l'analyse chargée.
    await expect(page.getByRole("link", { name: "Générer le compte rendu" })).toHaveAttribute("href", /\/compte-rendu\?id=/, { timeout: 30_000 });

    await page.getByRole("link", { name: "Générer le compte rendu" }).click();
    await page.waitForURL(/\/compte-rendu\?id=/);
    await expect(page.getByText("Brouillon : relecture non clôturée")).toBeVisible({ timeout: 30_000 });
    expect(await pdfAffiche(page)).toContain("BROUILLON");
    await expect(page.getByRole("button", { name: "Télécharger le PDF" })).toBeDisabled();
  });

  test("après la clôture : PDF définitif, options suivies, téléchargement", async ({ page }) => {
    await page.goto(analyseUrl);
    const lignes = page.locator(".list > .row");
    await expect(lignes.first()).toBeVisible({ timeout: 30_000 });
    const n = await lignes.count();
    for (let i = 0; i < n; i += 1) {
      await lignes.nth(i).click();
      if (i === 0) {
        await page.locator(".detail").getByRole("button", { name: "Rejeter", exact: true }).click();
        await expect(lignes.nth(i)).toContainText("Rejetée");
      } else {
        await page.locator(".detail").getByRole("button", { name: "Valider", exact: true }).click();
        await expect(lignes.nth(i)).toContainText("Validée");
      }
    }
    await page.getByRole("button", { name: "Clôturer l'analyse" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Clôturer/ }).click();
    await expect(page.getByText("Analyse clôturée — lecture seule")).toBeVisible();

    await page.getByRole("link", { name: "Générer le compte rendu" }).click();
    await expect(page.getByText(/Analyse clôturée le .* Le compte rendu se reconstruit à l’identique/)).toBeVisible({ timeout: 30_000 });
    let pdf = await pdfAffiche(page);
    expect(pdf).not.toContain("BROUILLON");
    expect(pdf).toContain("prototype de recherche non certifi");
    expect(pdf).not.toContain("Propositions rejet");

    // Option « rejetées » : l'aperçu est régénéré, avec la section séparée.
    await page.getByLabel(/Inclure les propositions rejetées/).check();
    await expect.poll(async () => (await pdfAffiche(page)).includes("Propositions rejet"), { timeout: 15_000 }).toBe(true);

    const telechargement = page.waitForEvent("download");
    await page.getByRole("button", { name: "Télécharger le PDF" }).click();
    const fichier = await telechargement;
    expect(fichier.suggestedFilename()).toMatch(/^compte-rendu-PDX-\d{4}-\d{4}\.pdf$/);
    await expect(page.getByRole("status").filter({ hasText: "Compte rendu téléchargé" })).toBeVisible();
    pdf = await fichier.path().then((p) => import("node:fs").then((fs) => fs.readFileSync(p)));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
