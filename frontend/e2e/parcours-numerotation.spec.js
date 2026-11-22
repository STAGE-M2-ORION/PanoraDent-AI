import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Parcours du sprint 7, contre la stack de test (`docker-compose.e2e.yml`,
 * détections factices déterministes) : le schéma dentaire se parcourt au
 * clavier, la typologie et le résumé par quadrant filtrent la liste, une dent
 * se déclare absente (et le reste après rechargement), une dent renumérotée
 * emporte son anomalie, un doublon de numéro est signalé en orange, le schéma
 * s'exporte en PNG.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

/** Ordre du schéma, face au patient (cf. `views/analyse/model/odontogram.js`). */
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
/** Dent à droite dans le schéma, ou elle-même au bout de l'arcade. */
const aDroite = (fdi) => {
  const arcade = UPPER.includes(fdi) ? UPPER : LOWER;
  return arcade[Math.min(arcade.indexOf(fdi) + 1, arcade.length - 1)];
};

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/admin\/comptes/);
}

const schema = (page) => page.locator(".odonto");
const dent = (page, fdi) => schema(page).locator(`.tooth[data-fdi="${fdi}"]`);
const fiche = (page) => page.locator(".tooth-card");
const lignes = (page) => page.locator(".list > .row");
const fdiDe = async (loc) => Number(await loc.getAttribute("data-fdi"));

test.describe.serial("parcours du sprint 7 : numérotation et schéma dentaire", () => {
  let analyseUrl = null;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signInWithGoogle(page, ADMIN_EMAIL);
    if (analyseUrl) {
      await page.goto(analyseUrl);
      await expect(schema(page).locator(".tooth")).toHaveCount(32, { timeout: 30_000 });
    }
  });

  test("une panoramique est analysée ; le schéma montre les 32 dents et se parcourt au clavier", async ({ page }) => {
    await page.goto("/nouvelle-analyse");
    await page.setInputFiles("#file", PANO);
    await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
    await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
    await page.goto("/historique");
    await page.locator("tbody tr").first().getByRole("link", { name: /Ouvrir/ }).click();
    await page.waitForURL(/\/analyse\?id=/);
    analyseUrl = new URL(page.url()).pathname + new URL(page.url()).search;

    await expect(schema(page).locator(".tooth")).toHaveCount(32, { timeout: 60_000 });
    // Dents détectées = calque « Dents » de la visionneuse.
    const nDents = Number(await page.getByRole("button", { name: /^Dents/ }).locator(".n").textContent());
    await expect(schema(page).locator('.tooth[data-etat="present"], .tooth[data-etat="anomaly"]')).toHaveCount(nDents);

    // Une seule dent dans l'ordre de tabulation ; flèche droite : la voisine.
    const focusable = schema(page).locator('.tooth[tabindex="0"]');
    await expect(focusable).toHaveCount(1);
    const depart = await fdiDe(focusable);
    await focusable.focus();
    const voisine = aDroite(depart);
    await page.keyboard.press("ArrowRight");
    await expect(dent(page, voisine)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(fiche(page)).toHaveAttribute("data-fdi", String(voisine));
    await expect(fiche(page)).toContainText(/incisive|canine|prémolaire|molaire/);
  });

  test("typologie : chaque anomalie a sa définition et son urgence, et une marque lisible sans couleur", async ({ page }) => {
    await expect(schema(page).locator(".odonto-types li")).toHaveCount(4);
    await expect(schema(page).locator(".odonto-types li").first()).toHaveAttribute("title", /Urgence indicative/);
    await lignes(page).first().click();
    const detail = page.locator(".detail");
    await expect(detail.getByText("Définition", { exact: true })).toBeVisible();
    await expect(detail.locator(".urg")).toHaveText(/Prioritaire|À programmer|À surveiller/);
    // Marques des anomalies : des tracés (forme par type), pas des ronds de couleur seuls.
    expect(await schema(page).locator(".tooth path.mark").count()).toBeGreaterThan(0);
  });

  test("résumé par type et par quadrant : chaque case filtre la liste", async ({ page }) => {
    const resume = page.locator(".sumtab");
    await expect(resume).toBeVisible();
    const total = Number((await resume.locator("caption").textContent()).match(/:\s*(\d+)/)[1]);
    await expect(lignes(page)).toHaveCount(total);

    // Un compte non nul : la liste ne garde que ce type dans ce quadrant.
    const cellule = resume.locator("td .sumcell.n").first();
    const n = Number(await cellule.textContent());
    await cellule.click();
    await expect(cellule).toHaveAttribute("aria-pressed", "true");
    await expect(lignes(page)).toHaveCount(n);
    await expect(page.getByRole("group", { name: "Filtres actifs" })).toContainText("Quadrant");

    // Second clic : filtre retiré.
    await cellule.click();
    await expect(lignes(page)).toHaveCount(total);

    // Le sélecteur de quadrant filtre aussi ; le filtre se retire depuis sa puce.
    const q = Number((await resume.locator("thead .sumcell").first().getAttribute("aria-label")).match(/:\s*(\d+)/)[1]);
    await page.locator("#quadrant").selectOption("1");
    await expect(lignes(page)).toHaveCount(q);
    await page.getByRole("button", { name: "Retirer le filtre du quadrant 1" }).click();
    await expect(lignes(page)).toHaveCount(total);
  });

  test("une dent non détectée se déclare absente, le reste après rechargement, et se rétablit", async ({ page }) => {
    const cible = schema(page).locator('.tooth[data-etat="undetected"]').first();
    const fdi = await fdiDe(cible);
    await cible.click();
    await expect(fiche(page)).toContainText("Non détectée sur le cliché");
    await fiche(page).getByRole("button", { name: "Déclarer la dent absente" }).click();
    await expect(dent(page, fdi)).toHaveAttribute("data-etat", "absent");
    await expect(fiche(page)).toContainText("Déclarée absente par le praticien");

    await page.reload();
    await expect(dent(page, fdi)).toHaveAttribute("data-etat", "absent", { timeout: 30_000 });
    await dent(page, fdi).click();
    await fiche(page).getByRole("button", { name: "Retirer la déclaration d'absence" }).click();
    await expect(dent(page, fdi)).toHaveAttribute("data-etat", "undetected");
  });

  test("une dent renumérotée dans le schéma emporte son anomalie", async ({ page }) => {
    const porteuse = schema(page).locator('.tooth[data-etat="anomaly"]').first();
    const avant = await fdiDe(porteuse);
    const marques = await porteuse.locator("path.mark").count();
    const apres = await fdiDe(schema(page).locator('.tooth[data-etat="undetected"]').first());

    await porteuse.click();
    await fiche(page).getByRole("button", { name: "Changer le numéro" }).first().click();
    await expect(page.locator(".choose-hint")).toContainText(`dent ${avant}`);
    await dent(page, apres).click();

    await expect(page.getByRole("status").filter({ hasText: `Dent ${avant} renumérotée ${apres}` })).toBeVisible();
    await expect(dent(page, apres)).toHaveAttribute("data-etat", "anomaly");
    await expect(dent(page, apres).locator("path.mark")).toHaveCount(marques);
    await expect(dent(page, avant)).toHaveAttribute("data-etat", "undetected");
    await expect(fiche(page)).toHaveAttribute("data-fdi", String(apres));
    await expect(fiche(page)).toContainText(`Numéro proposé : ${avant}, corrigé en ${apres}.`);
  });

  test("deux dents au même numéro : signalées en orange, avec le message du serveur", async ({ page }) => {
    const [a, b] = await schema(page).locator('.tooth[data-etat="present"], .tooth[data-etat="anomaly"]').evaluateAll((els) => els.slice(0, 2).map((e) => Number(e.dataset.fdi)));
    await dent(page, a).click();
    await fiche(page).getByRole("button", { name: "Changer le numéro" }).first().click();
    await dent(page, b).click();
    await expect(dent(page, b)).toHaveAttribute("data-douteux", "oui");
    // La fiche suit la dent renumérotée : elle montre les deux détections au numéro b.
    await expect(fiche(page)).toHaveAttribute("data-fdi", String(b));
    await expect(fiche(page).getByRole("list", { name: "Numéro à vérifier" })).toContainText(`2 dents portent le numéro ${b}.`);
    await expect(fiche(page).getByRole("button", { name: "Changer le numéro" })).toHaveCount(2);
  });

  test("le schéma s'exporte en PNG, sous un nom anonyme", async ({ page }) => {
    const telechargement = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exporter le schéma dentaire en image (PNG)" }).click();
    expect((await telechargement).suggestedFilename()).toMatch(/^odontogramme-PDX-\d{4}-\d{4}\.png$/);
  });
});
