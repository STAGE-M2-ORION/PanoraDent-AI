import { expect, test } from "@playwright/test";

/**
 * Parcours du sprint 2, contre la stack de test (`docker-compose.e2e.yml`) :
 * l'administrateur crée un rôle, l'attribue à un compte, et le titulaire voit
 * sa navigation changer à sa connexion suivante. Le serveur, lui, applique le
 * changement tout de suite. Puis désactivation avec motif.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
}

async function signInWithPassword(page, email, password) {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function signOut(page) {
  await page.locator("#sidebar").getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/connexion/);
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

const nav = (page) => page.getByRole("navigation", { name: "Navigation principale" });

test.describe.serial("parcours du sprint 2 : rôles, permissions et comptes", () => {
  const holder = { email: `accueil.e2e.${Date.now()}@e2e.example.org`, password: "mot de passe de l accueil" };
  const roleName = `Accueil ${Date.now() % 100000}`;

  test("un nouveau praticien active son compte et voit la navigation du rôle Praticien", async ({ browser, page, request }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await page.getByRole("button", { name: "Créer un compte" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un compte" });
    await dialog.getByLabel("Prénom").fill("Voahary");
    await dialog.getByLabel("Nom", { exact: true }).fill("Accueil");
    await dialog.getByLabel("Adresse e-mail", { exact: true }).fill(holder.email);
    await dialog.getByLabel("Rôle").selectOption({ label: "Praticien" });
    await dialog.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Compte créé" })).toBeVisible();

    const other = await browser.newPage();
    await other.goto(await firstLoginLink(request, holder.email));
    await other.getByLabel("Nouveau mot de passe", { exact: true }).fill(holder.password);
    await other.getByLabel("Confirmez le mot de passe", { exact: true }).fill(holder.password);
    await other.getByRole("button", { name: "Activer mon compte" }).click();
    await other.getByRole("button", { name: "Plus tard, continuer vers l’application" }).click();
    await other.waitForURL(/\/tableau-de-bord/);
    await expect(nav(other).getByRole("link", { name: "Nouvelle analyse" })).toBeVisible();
    await expect(nav(other).getByRole("link", { name: "Historique" })).toBeVisible();
    await other.close();
  });

  test("les rôles système sont verrouillés ; l'administrateur crée un rôle personnalisé", async ({ page }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await page.goto("/admin/roles");

    // Rôle système : signalé verrouillé, sans bouton « Modifier ».
    await expect(page.getByText("Système, verrouillé").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Modifier le rôle Praticien" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dupliquer le rôle Praticien" })).toBeVisible();

    await page.getByRole("button", { name: "Créer un rôle personnalisé" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un rôle personnalisé" });
    await dialog.getByLabel("Nom du rôle").fill(roleName);
    await dialog.getByLabel(/Description/).fill("Accueil du cabinet : consulte les analyses.");
    await dialog.getByLabel("Analyses — consulter").check();
    await expect(dialog.getByTestId("role-summary")).toContainText("Peut consulter les analyses.");
    await expect(dialog.getByTestId("role-summary")).toContainText("Ne peut pas importer et lancer des analyses");
    await dialog.getByRole("button", { name: "Créer le rôle" }).click();
    await expect(page.getByText("Rôle créé")).toBeVisible();

    // Même nom, casse différente : refus du serveur affiché dans la fenêtre.
    await page.getByRole("button", { name: "Créer un rôle personnalisé" }).click();
    await dialog.getByLabel("Nom du rôle").fill(roleName.toUpperCase());
    await dialog.getByRole("button", { name: "Créer le rôle" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Un rôle porte déjà ce libellé.");
    await dialog.getByRole("button", { name: "Annuler" }).click();
  });

  test("l'administrateur attribue le rôle, avec un motif obligatoire", async ({ page }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    // La liste est paginée (10 par page) et la suite crée d'autres comptes : on cherche celui-ci.
    await page.getByLabel("Rechercher un compte").fill(holder.email);
    const row = page.getByRole("row").filter({ hasText: holder.email });
    await row.getByRole("button", { name: /Modifier .* ou changer son rôle/ }).click();
    const dialog = page.getByRole("dialog", { name: "Modifier le compte" });
    await dialog.getByLabel("Rôle").selectOption({ label: roleName });
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(dialog.getByRole("alert")).toContainText("motif");
    await dialog.getByLabel("Motif du changement de rôle").fill("Affectée à l'accueil");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(row).toContainText(roleName);
  });

  test("à sa connexion suivante, le titulaire voit sa navigation changer", async ({ page }) => {
    await signInWithPassword(page, holder.email, holder.password);
    await page.waitForURL(/\/tableau-de-bord/);
    await expect(nav(page).getByRole("link", { name: "Historique" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Nouvelle analyse" })).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Performance du modèle" })).toHaveCount(0);
    // Une adresse tapée à la main mène à l'écran « Accès refusé », explicite.
    await page.goto("/nouvelle-analyse");
    await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
    await expect(page.getByRole("main").getByText(roleName)).toBeVisible();
    await signOut(page);
  });

  test("désactivation avec motif : le compte ne peut plus se connecter", async ({ page, browser }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    // La liste est paginée (10 par page) et la suite crée d'autres comptes : on cherche celui-ci.
    await page.getByLabel("Rechercher un compte").fill(holder.email);
    const row = page.getByRole("row").filter({ hasText: holder.email });
    await row.getByRole("button", { name: /^Désactiver/ }).click();
    const dialog = page.getByRole("dialog", { name: /Désactiver le compte/ });
    await dialog.getByRole("button", { name: "Désactiver le compte" }).click();
    await expect(dialog.getByRole("alert")).toContainText("motif");
    await dialog.getByLabel(/Motif/).fill("Fin de contrat");
    await dialog.getByRole("button", { name: "Désactiver le compte" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Compte désactivé" })).toBeVisible();
    await expect(row).toContainText("Désactivé");

    const other = await browser.newPage();
    await signInWithPassword(other, holder.email, holder.password);
    await expect(other.locator("[data-erreur=compte_desactive]")).toContainText("Compte désactivé");
    await other.close();
  });
});
