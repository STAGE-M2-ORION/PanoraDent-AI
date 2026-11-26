import { expect, test } from "@playwright/test";

/**
 * Sprint 11, lot B — supervision : la page lit les quatre sondes réelles et
 * les indicateurs d'exploitation, sans donnée fictive ; un service dégradé
 * fait apparaître un bandeau sur toutes les pages, en clair, qui disparaît au
 * retour à la normale (la page de santé est simulée dans le navigateur : la
 * pile de test, elle, va bien).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";
const SAINE = { statut: "ok", services: { base: "ok", stockage: "ok", file: "ok", inference: "ok" } };

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/admin\/comptes/);
}

test("la supervision lit les vraies sondes, sans donnée fictive", async ({ page }) => {
  await signInWithGoogle(page, ADMIN_EMAIL);
  await page.getByRole("link", { name: "Supervision" }).click();
  await page.waitForURL(/\/admin\/supervision/);

  for (const nom of ["base", "stockage", "file", "inference"]) {
    await expect(page.locator(`[data-service=${nom}]`)).toHaveAttribute("data-etat", "ok");
  }
  await expect(page.locator("[data-service=base]")).toContainText("La base répond.");
  await expect(page.getByText("Tous les services répondent normalement.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicateurs d’exploitation, 14 derniers jours" })).toContainText("Espace occupé");
  await expect(page.locator("main").getByText(/démonstration|données fictives/)).toHaveCount(0);

  // Mêmes états que la page de santé publique, qui ne dit rien de plus.
  const sante = await (await page.request.get("/api/v1/health")).json();
  expect(sante).toEqual(SAINE);
});

test("un service dégradé : bandeau en clair sur toutes les pages, puis retour à la normale", async ({ page }) => {
  let sante = { statut: "degrade", services: { ...SAINE.services, inference: "panne" } };
  await page.route("**/api/v1/health", (route) => route.fulfill({ json: sante }));
  await signInWithGoogle(page, ADMIN_EMAIL);

  const bandeau = page.getByTestId("alerte-services");
  await expect(bandeau).toContainText("Le service d’analyse est indisponible : les nouvelles analyses attendront dans la file.");
  await expect(bandeau.getByRole("link", { name: "Voir la supervision" })).toBeVisible();
  await page.goto("/historique");
  await expect(bandeau).toBeVisible();

  // Retour à la normale : le bandeau disparaît à la relecture suivante.
  sante = SAINE;
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(bandeau).toHaveCount(0);
});
