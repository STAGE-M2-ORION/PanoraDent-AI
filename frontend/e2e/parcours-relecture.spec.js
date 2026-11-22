import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Parcours du sprint 5, contre la stack de test (`docker-compose.e2e.yml`) :
 * le praticien valide, rejette, corrige (type et cadre) une détection,
 * annule un verdict, trace une détection oubliée, retrouve sa relecture
 * après rechargement, voit la clôture refusée tant qu'il reste une détection
 * à revoir, clôture avec une conclusion ; l'analyse passe en lecture seule ;
 * seul l'administrateur la rouvre, avec un motif.
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

const avancement = (page) => page.locator(".strip strong").first();
const detail = (page) => page.locator(".detail");
const statut = (page) => detail(page).locator(".st").first();

test.describe.serial("parcours du sprint 5 : relecture et clôture", () => {
  const email = `relecture.e2e.${Date.now()}@e2e.example.org`;
  const password = "mot de passe du praticien relecture";
  let analyseUrl = null;

  test("un praticien est créé, active son compte et importe une panoramique", async ({ page, request }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await page.getByRole("button", { name: "Créer un compte" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un compte" });
    await dialog.getByLabel("Prénom").fill("Fara");
    await dialog.getByLabel("Nom", { exact: true }).fill("Relecture");
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

    await page.goto("/nouvelle-analyse");
    await page.setInputFiles("#file", PANO);
    await expect(page.locator(".zone-auto")).toHaveCount(2);
    await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
    await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
    await page.goto("/historique");
    await page.locator("tbody tr").first().getByRole("link", { name: /Ouvrir/ }).click();
    await page.waitForURL(/\/analyse\?id=/);
    analyseUrl = new URL(page.url()).pathname + new URL(page.url()).search;
  });

  test.beforeEach(async ({ page }, info) => {
    if (info.title.startsWith("un praticien est créé") || info.title.startsWith("l'administrateur")) return;
    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(/\/tableau-de-bord/);
  });

  test("verdicts, correction du cadre, annulation, ajout, reprise après rechargement", async ({ page }) => {
    await page.goto(analyseUrl);
    await expect(avancement(page)).toHaveText("0 sur 3 détections revues");

    // V : valider la détection sélectionnée ; la suivante à revoir est sélectionnée.
    await expect(statut(page)).toHaveText("À revoir");
    await page.keyboard.press("v");
    await expect(page.getByText(/Détection validée : dent/)).toBeVisible();
    await expect(avancement(page)).toHaveText("1 sur 3 détections revues");

    // Rejeter avec un commentaire.
    await detail(page).getByLabel(/Commentaire/).fill("Artefact de superposition");
    await detail(page).getByRole("button", { name: "Rejeter" }).click();
    await expect(page.getByText(/Détection rejetée : dent/)).toBeVisible();
    await expect(avancement(page)).toHaveText("2 sur 3 détections revues");

    // Clôture refusée : une détection reste à revoir.
    await page.getByRole("button", { name: "Clôturer l'analyse" }).first().click();
    const cloture = page.getByRole("dialog", { name: /Clôturer l'analyse/ });
    await expect(cloture.getByRole("alert")).toContainText("1 détection sans verdict");
    await expect(cloture.getByRole("button", { name: "Clôturer l'analyse" })).toBeDisabled();
    await cloture.getByRole("button", { name: "Aller à la suivante à revoir" }).click();

    // Corriger : type et cadre (poignée), la proposition d'origine reste consultable.
    await expect(statut(page)).toHaveText("À revoir");
    await page.keyboard.press("c");
    await detail(page).locator("#cType").selectOption("periapical_lesion");
    const poignee = await page.locator("[data-handle=br]").boundingBox();
    await page.mouse.move(poignee.x + poignee.width / 2, poignee.y + poignee.height / 2);
    await page.mouse.down();
    await page.mouse.move(poignee.x + 30, poignee.y + 20, { steps: 5 });
    await page.mouse.up();
    await detail(page).getByRole("button", { name: "Enregistrer la correction" }).click();
    await expect(page.getByText(/Correction enregistrée/)).toBeVisible();
    await expect(avancement(page)).toHaveText("3 sur 3 détections revues");

    // Retour sur la détection corrigée : proposition d'origine, cadre fantôme, puis annulation.
    await page.locator(".row").filter({ hasText: "Lésion péri-apicale" }).click();
    await expect(statut(page)).toHaveText("Corrigée");
    await expect(detail(page).getByTestId("proposition")).toContainText("proposition d'origine du modèle");
    await expect(page.getByTestId("cadre-origine")).toBeVisible();
    await detail(page).getByRole("button", { name: "Annuler le dernier verdict" }).click();
    await expect(statut(page)).toHaveText("À revoir");
    await expect(avancement(page)).toHaveText("2 sur 3 détections revues");
    await detail(page).getByRole("button", { name: "Valider" }).click();
    await expect(avancement(page)).toHaveText("3 sur 3 détections revues");

    // Ajouter une détection que le modèle n'a pas vue, par tracé direct.
    await page.getByRole("button", { name: "Ajouter une détection" }).click();
    const scene = await page.locator(".stage .layer").boundingBox();
    await page.mouse.move(scene.x + scene.width * 0.08, scene.y + scene.height * 0.72);
    await page.mouse.down();
    await page.mouse.move(scene.x + scene.width * 0.16, scene.y + scene.height * 0.86, { steps: 6 });
    await page.mouse.up();
    await detail(page).locator("#nType").selectOption("impacted_tooth");
    await detail(page).getByRole("button", { name: "Enregistrer la détection" }).click();
    await expect(page.getByText(/Détection ajoutée sur la dent/)).toBeVisible();
    await expect(statut(page)).toHaveText("Ajoutée par le praticien");
    await expect(avancement(page)).toHaveText("4 sur 4 détections revues");
    const selection = await detail(page).locator("h3").innerText();

    // Navigateur fermé puis rouvert : la relecture est au serveur, la sélection reprise.
    await page.reload();
    await expect(avancement(page)).toHaveText("4 sur 4 détections revues");
    await expect(detail(page).locator("h3")).toHaveText(selection);
    await expect(page.locator(".row.rejected")).toHaveCount(1);
  });

  test("clôture avec conclusion : l'analyse passe en lecture seule", async ({ page }) => {
    await page.goto(analyseUrl);
    await page.getByRole("button", { name: "Clôturer l'analyse" }).first().click();
    const cloture = page.getByRole("dialog", { name: /Clôturer l'analyse/ });
    await expect(cloture.locator(".closure-recap")).toContainText("Rejetées");
    await cloture.getByLabel(/Conclusion du praticien/).fill("Lésion 46 à surveiller ; contrôle dans 6 mois.");
    await cloture.getByRole("button", { name: "Clôturer l'analyse" }).click();
    await expect(page.locator("[data-etat=lecture-seule]")).toBeVisible();
    await expect(page.getByText(/Analyse clôturée : elle est désormais en lecture seule/)).toBeVisible();
    await expect(detail(page).getByRole("button", { name: /Valider|Rejeter/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajouter une détection" })).toBeDisabled();
    // Le praticien ne peut pas rouvrir.
    await expect(page.getByRole("button", { name: "Rouvrir l'analyse" })).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-etat=lecture-seule]")).toBeVisible();
  });

  test("l'administrateur rouvre l'analyse, avec un motif", async ({ page }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await page.goto(analyseUrl);
    await page.getByRole("button", { name: "Rouvrir l'analyse" }).click();
    const dialog = page.getByRole("dialog", { name: /Rouvrir l'analyse/ });
    await expect(dialog.getByRole("button", { name: "Rouvrir l'analyse" })).toBeDisabled();
    await dialog.getByLabel(/Motif de la réouverture/).fill("Compléter la relecture de la 46");
    await dialog.getByRole("button", { name: "Rouvrir l'analyse" }).click();
    await expect(page.getByText("Analyse rouverte. Motif inscrit au journal d'audit.")).toBeVisible();
    await expect(page.locator("[data-etat=lecture-seule]")).toHaveCount(0);
    await expect(avancement(page)).toHaveText("4 sur 4 détections revues");
  });
});
