import { expect, test } from "@playwright/test";

/**
 * Sprint 8, lot A — paramètres du cabinet (en-tête des comptes rendus) :
 * l'administrateur saisit nom, adresse et mentions, voit l'aperçu de
 * l'en-tête, importe puis retire un logo ; tout est conservé au rechargement.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";
// PNG 4 × 2 px, généré une fois (aucun fichier externe).
const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAE0lEQVR4nGMUqVjwnwEJMDGgAQBDPAIvPiqQ5AAAAABJRU5ErkJggg==",
  "base64",
);

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/admin\/comptes/);
}

test("l'administrateur règle l'en-tête du cabinet, logo compris", async ({ page }) => {
  const nom = `Cabinet du Lac ${Date.now()}`;
  await signInWithGoogle(page, ADMIN_EMAIL);
  await page.getByRole("link", { name: "Cabinet" }).click();
  await page.waitForURL(/\/admin\/cabinet/);

  await page.getByLabel("Nom du cabinet").fill(nom);
  await page.getByLabel("Adresse").fill("Rue de l'Indépendance\n301 Fianarantsoa");
  await page.getByLabel("Mentions du cabinet (facultatives)").fill("Document destiné au dossier du patient.");
  const apercu = page.getByLabel("Aperçu de l’en-tête du compte rendu");
  await expect(apercu).toContainText(nom);
  await expect(apercu).toContainText("301 Fianarantsoa");
  await expect(apercu).toContainText("prototype de recherche non certifié");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Paramètres du cabinet enregistrés." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

  await page.getByTestId("cab-logo-input").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO_PNG });
  await expect(page.getByRole("status").filter({ hasText: "Logo importé." })).toBeVisible();
  const logo = page.getByRole("img", { name: "Logo du cabinet" });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img) => img.naturalWidth)).toBe(4);   // servi par l'API, lisible

  await page.reload();
  await expect(page.getByLabel("Nom du cabinet")).toHaveValue(nom);
  await expect(page.getByRole("img", { name: "Logo du cabinet" })).toBeVisible();
  await expect(page.getByText(/Modifié le .* par /)).toBeVisible();

  await page.getByRole("button", { name: "Retirer le logo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logo retiré." })).toBeVisible();
  await expect(page.getByRole("img", { name: "Logo du cabinet" })).toHaveCount(0);
});
