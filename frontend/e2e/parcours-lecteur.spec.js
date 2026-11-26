import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Sprint 8, lot E — le rôle lecteur consulte, en lecture seule : il retrouve
 * une analyse dans l'historique, la consulte, voit sa fiche d'historique ;
 * aucune action d'écriture ne lui est proposée (ni bouton inutile), et le
 * serveur refuse de toute façon (test de couverture des routes, côté backend).
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";
const LECTEUR = `lecteur.e2e.${Date.now()}@e2e.example.org`;
const CAPTURES = process.env.CAPTURES;

async function signInWithGoogle(page, email, landing) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(landing);
}

const capture = async (page, nom) => (CAPTURES ? page.screenshot({ path: `${CAPTURES}/lecteur-${nom}.png` }) : null);

test.describe.serial("le rôle lecteur consulte, en lecture seule", () => {
  let reference = null;

  test("l'administrateur importe une analyse et crée un compte lecteur", async ({ page }) => {
    await signInWithGoogle(page, ADMIN_EMAIL, /\/admin\/comptes/);
    await page.goto("/nouvelle-analyse");
    await page.setInputFiles("#file", PANO);
    await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
    await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
    reference = (await page.locator("[data-etat=import-termine]").innerText()).match(/PDX-\d{4}-\d{4}/)[0];

    await page.goto("/admin/comptes");
    await page.getByRole("button", { name: "Créer un compte" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un compte" });
    await dialog.getByLabel("Prénom").fill("Lova");
    await dialog.getByLabel("Nom", { exact: true }).fill("Lecture");
    await dialog.getByLabel("Adresse e-mail", { exact: true }).fill(LECTEUR);
    await dialog.getByLabel("Rôle").selectOption({ label: "Lecteur" });
    await dialog.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Compte créé" })).toBeVisible();
  });

  test("navigation : consultation seulement, pas d'administration ni d'import", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signInWithGoogle(page, LECTEUR, /\/tableau-de-bord/);
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link", { name: "Historique" })).toBeVisible();
    for (const interdit of ["Nouvelle analyse", "Comptes", "Rôles et permissions", "Modèles", "Cabinet"]) {
      await expect(nav.getByRole("link", { name: interdit, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: /Nouvelle analyse/ })).toHaveCount(0);
    await capture(page, "tableau-de-bord");
  });

  test("historique et analyse : consulter, sans aucune action d'écriture", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signInWithGoogle(page, LECTEUR, /\/tableau-de-bord/);
    await page.goto("/historique");
    await expect(page.getByText("Accès en lecture seule")).toBeVisible();
    await page.getByLabel("Référence, n°, note ou conclusion").fill(reference);
    const ligne = page.locator("tbody tr");
    await expect(ligne).toHaveCount(1, { timeout: 30_000 });
    await expect(ligne.getByRole("button", { name: /Supprimer/ })).toHaveCount(0);
    await expect(ligne.getByRole("button", { name: /Relancer/ })).toHaveCount(0);
    await capture(page, "historique");

    // Fiche d'historique : consultable.
    await ligne.getByRole("button", { name: /Historique de l’analyse/ }).click();
    await expect(page.getByRole("dialog").locator("[data-action=import_analyse]")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();

    await ligne.getByRole("link", { name: /Consulter/ }).click();
    await page.waitForURL(/\/analyse\?id=/);
    await expect(page.locator(".trace")).toBeVisible({ timeout: 30_000 });
    for (const action of ["Clôturer l'analyse", "Générer le compte rendu", "Ajouter une détection", "Valider", "Rejeter", "Corriger"]) {
      await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "Générer le compte rendu" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Suivante à revoir/ })).toHaveCount(0);
    await expect(page.locator(".minimap-note")).not.toContainText("valider");
    await expect(page.getByText("Lecture seule : votre rôle ne permet pas de modifier les détections.").first()).toBeVisible();
    // La fiche d'une dent ne propose aucune action.
    await page.locator(".odonto .tooth").first().click();
    await expect(page.locator(".tooth-card")).toBeVisible();
    await expect(page.locator(".tooth-card").getByRole("button", { name: /Changer|Rejeter|Déclarer|Retirer/ })).toHaveCount(0);
    await capture(page, "analyse");

    // Compte rendu : pas de production, pas d'options inutiles.
    const id = new URL(page.url()).searchParams.get("id");
    await page.goto(`/compte-rendu?id=${id}`);
    await expect(page.getByText("Votre rôle permet de consulter l’analyse, pas de produire son compte rendu.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Télécharger le PDF" })).toHaveCount(0);
    await expect(page.getByLabel("Inclure l’image annotée")).toHaveCount(0);
    await capture(page, "compte-rendu");
  });
});
