import { expect, test } from "@playwright/test";

/**
 * Parcours de connexion Google, joué contre le fournisseur d'identité de
 * remplacement du backend (`APP_ENV=test`, `IDENTITY_PROVIDER=fake`) :
 * `/auth/google/demarrer` redirige vers `/api/v1/auth/fake/autoriser`, un
 * formulaire minimal (`input[name=email]` + « Se connecter ») qui renvoie
 * ensuite vers le retour Google habituel.
 */

// Adresse amorcée par le backend (`ADMIN_EMAIL` de seed_auth).
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

/** Connexion complète : bouton Google → formulaire de remplacement → retour dans l'application. */
async function signInWith(page, email) {
  await page.goto("/connexion");
  await page.getByRole("button", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
}

async function signOut(page) {
  await page.locator("#sidebar").getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/connexion/);
  await expect(page.getByText("Vous êtes déconnecté.")).toBeVisible();
}

test.describe.serial("parcours de connexion", () => {
  const practitioner = {
    email: `praticien.e2e.${Date.now()}@e2e.example.org`,
    prenom: "Hery",
    nom: "Rasoa",
  };

  test("l'administrateur se connecte, crée un compte praticien et se déconnecte", async ({ page }) => {
    await signInWith(page, ADMIN_EMAIL);

    // `/` oriente l'administrateur (user:manage) vers l'administration.
    await page.waitForURL(/\/admin\/comptes/);
    await expect(page.getByRole("heading", { name: "Comptes", level: 2 })).toBeVisible();

    await page.getByRole("button", { name: "Créer un compte" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un compte" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Prénom").fill(practitioner.prenom);
    await dialog.getByLabel("Nom", { exact: true }).fill(practitioner.nom);
    await dialog.getByLabel("Adresse Google").fill(practitioner.email);
    await dialog.getByLabel("Rôle").selectOption({ label: "Praticien" });
    await dialog.getByRole("button", { name: "Créer le compte" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Compte créé" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: practitioner.email });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Praticien");

    await signOut(page);
  });

  test("le praticien se connecte et atteint le tableau de bord, sans administration", async ({ page }) => {
    await signInWith(page, practitioner.email);

    await page.waitForURL(/\/tableau-de-bord/);
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link", { name: "Tableau de bord" })).toBeVisible();
    await expect(nav.getByText("Administration")).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Comptes" })).toHaveCount(0);
    await expect(nav.locator('a[href^="/admin"]')).toHaveCount(0);
  });
});

test.describe("états d'erreur de la page de connexion", () => {
  test("compte inconnu : encart rouge invitant à demander un compte", async ({ page }) => {
    await page.goto("/connexion?erreur=compte_inconnu");
    const notice = page.locator('[data-erreur="compte_inconnu"]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveClass(/alert-danger/);
    await expect(notice).toContainText("Aucun compte pour cette adresse Google");
    await expect(notice).toContainText("administrateur");
    // Annoncé par les lecteurs d'écran : l'encart vit dans une région aria-live.
    await expect(page.locator("[aria-live]").filter({ has: notice })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Continuer avec Google" })).toBeEnabled();
  });

  test("échec Google : encart neutre avec « Réessayer »", async ({ page }) => {
    await page.goto("/connexion?erreur=echec_google");
    const notice = page.locator('[data-erreur="echec_google"]');
    await expect(notice).toBeVisible();
    await expect(notice).not.toHaveClass(/alert-danger/);
    await expect(notice.getByRole("button", { name: "Réessayer" })).toBeVisible();
  });

  test("session expirée : bandeau d'information au-dessus du bouton", async ({ page }) => {
    await page.goto("/connexion?etat=expiree");
    await expect(page.getByText("Votre session a expiré.")).toBeVisible();
  });
});
