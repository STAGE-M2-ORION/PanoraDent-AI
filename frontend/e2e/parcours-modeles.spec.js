import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Parcours du sprint 6 (registre des modèles), contre la stack de test
 * (`docker-compose.e2e.yml`, service d'inférence en MODELES_FACTICES=1) :
 * trois versions sont publiées (deux avec leurs poids, une sans) ;
 * l'administrateur voit le registre, une bascule vers la version sans poids
 * est refusée et rien ne change, une bascule vers une vraie version réussit et
 * entre au journal ; un praticien importe une panoramique, traitée par la
 * version active ; après une seconde bascule, il rejoue l'analyse avec le
 * nouveau modèle et compare les deux.
 *
 * Les poids factices sont déposés dans inference/weights/ (monté dans le
 * conteneur d'inférence de test) et retirés à la fin.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const POIDS = path.join(ICI, "..", "..", "inference", "weights");
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

const suffixe = Date.now();
const V1 = `e2e-${suffixe}-a`;
const V2 = `e2e-${suffixe}-b`;
const SANS_POIDS = `e2e-${suffixe}-sans-poids`;

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

/** Dépose deux fichiers de poids factices et renvoie leurs empreintes. */
function deposerPoids(version) {
  const dossier = path.join(POIDS, version);
  mkdirSync(dossier, { recursive: true });
  const sha = {};
  for (const role of ["dents", "anomalies"]) {
    const contenu = randomBytes(256);
    writeFileSync(path.join(dossier, `${role}.pt`), contenu);
    sha[role] = createHash("sha256").update(contenu).digest("hex");
  }
  return sha;
}

async function publier(request, version, sha, map50) {
  const r = await request.post("/api/v1/test/modeles", {
    data: { version, sha_dents: sha.dents, sha_anomalies: sha.anomalies, map50 },
  });
  expect(r.status()).toBe(201);
}

async function activer(page, version, motif) {
  await page.getByRole("button", { name: `Activer la version ${version}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motif").fill(motif);
  await dialog.getByRole("button", { name: "Activer", exact: true }).click();
  return dialog;
}

const ligne = (page, version) => page.locator(`tr[data-version="${version}"]`);
// Le badge « Active », pas le bouton « Activer » (qui contient le même mot).
const badgeActive = (page, version) => ligne(page, version).getByText("Active", { exact: true });

test.describe.serial("parcours du sprint 6 : registre des modèles, bascule, rejeu", () => {
  const email = `modeles.e2e.${suffixe}@e2e.example.org`;
  const password = "mot de passe du praticien modèles";
  let analyseUrl = null;

  test.beforeAll(async ({ request }) => {
    await publier(request, V1, deposerPoids(V1), 0.42);
    await publier(request, V2, deposerPoids(V2), 0.51);
    await publier(request, SANS_POIDS, { dents: "0".repeat(64), anomalies: "1".repeat(64) }, 0.99);
  });

  test.afterAll(() => {
    for (const v of [V1, V2]) rmSync(path.join(POIDS, v), { recursive: true, force: true });
  });

  test("l'administrateur voit le registre ; une version sans poids est refusée, une vraie est activée", async ({ page }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await page.getByRole("link", { name: "Modèles" }).click();
    await page.waitForURL(/\/admin\/modeles/);

    for (const v of [V1, V2, SANS_POIDS]) await expect(ligne(page, v)).toBeVisible();
    await expect(ligne(page, V2)).toContainText("0,51");

    // Le service d'analyse n'a pas ces poids : refus affiché, la fenêtre reste ouverte.
    const refus = await activer(page, SANS_POIDS, "Essai d'une version sans poids");
    await expect(refus.getByRole("alert")).toContainText("n'est pas installé");
    await refus.getByRole("button", { name: "Annuler" }).click();
    await expect(badgeActive(page, SANS_POIDS)).toHaveCount(0);

    await activer(page, V1, "Première mise en service");
    await expect(page.getByRole("status").filter({ hasText: `Version ${V1} active` })).toBeVisible();
    await expect(badgeActive(page, V1)).toBeVisible();
    await expect(ligne(page, V1).getByRole("button", { name: /Activer/ })).toHaveCount(0);
    await expect(page.locator(".active-card")).toContainText(V1);
    const journal = page.locator("table").filter({ hasText: "Motif" });
    await expect(journal.locator("tbody tr").first()).toContainText("Première mise en service");
    await expect(journal.locator("tbody tr").first()).toContainText(V1);
  });

  test("un praticien importe une panoramique, analysée par la version active", async ({ page, request }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await page.getByRole("button", { name: "Créer un compte" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un compte" });
    await dialog.getByLabel("Prénom").fill("Hery");
    await dialog.getByLabel("Nom", { exact: true }).fill("Modèles");
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
    await expect(page.locator("[data-methode=modele_texte]")).toBeVisible();     // lot C
    await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
    await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
    await page.goto("/historique");
    await page.locator("tbody tr").first().getByRole("link", { name: /Ouvrir/ }).click();
    await page.waitForURL(/\/analyse\?id=/);
    analyseUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    await expect(page.locator(".trace")).toContainText(V1, { timeout: 90_000 });
    // Déjà faite avec le modèle actif : rien à rejouer.
    await expect(page.getByRole("button", { name: /Rejouer avec/ })).toHaveCount(0);
  });

  test("après une seconde bascule, le praticien rejoue l'analyse et compare les deux modèles", async ({ page, browser }) => {
    const admin = await browser.newPage();
    await signInWithGoogle(admin, ADMIN_EMAIL);
    await admin.waitForURL(/\/admin\/comptes/);
    await admin.goto("/admin/modeles");
    await activer(admin, V2, "Meilleure mAP sur le test interne");
    await expect(badgeActive(admin, V2)).toBeVisible();
    await expect(badgeActive(admin, V1)).toHaveCount(0);
    await admin.close();

    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(/\/tableau-de-bord/);

    await page.goto(analyseUrl);
    const rejouer = page.getByRole("button", { name: `Rejouer avec ${V2}` });
    await expect(rejouer).toBeVisible({ timeout: 30_000 });
    await rejouer.click();
    await page.waitForURL((url) => url.search !== new URL(analyseUrl, "http://x").search);
    await expect(page.locator(".trace")).toContainText(V2, { timeout: 90_000 });

    await page.getByRole("button", { name: "Comparer avec l’analyse d’origine" }).click();
    const comparaison = page.getByRole("dialog", { name: "Comparaison des deux modèles" });
    await expect(comparaison).toContainText(V1);
    await expect(comparaison).toContainText(V2);
    await expect(comparaison.locator("table[data-comparaison] tbody tr").first()).toBeVisible();

    // L'analyse d'origine est restée telle quelle, avec son modèle.
    await page.goto(analyseUrl);
    await expect(page.locator(".trace")).toContainText(V1, { timeout: 30_000 });
  });
});
