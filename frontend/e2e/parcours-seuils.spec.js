import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Seuils d'exploitation par classe, contre la stack de test (service
 * d'inférence en MODELES_FACTICES=1) : une version publiée avec ses seuils est
 * activée ; l'analyse d'un cliché en hérite ; la liste suit les seuils de
 * chaque classe, le curseur les remplace puis y revient ; une détection sous
 * le seuil de sa classe est « Facultative » ; la clôture n'exige de verdict
 * que sur les détections proposées, et l'avancement compte de même.
 *
 * Comme parcours-modeles, il laisse sa version active et retire ses poids
 * factices : la suite se lance sur une pile neuve (`down -v`), où ce fichier
 * passe en dernier (ordre alphabétique).
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const POIDS = path.join(ICI, "..", "..", "inference", "weights");
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";
const VERSION = `e2e-${Date.now()}-seuils`;
// Détections factices du cliché : confiances de 0,55 à 0,90 ; 0,75 en laisse de part et d'autre.
const SEUIL = 0.75;
const SEUILS = { caries: SEUIL, deep_caries: SEUIL, periapical_lesion: SEUIL, impacted_tooth: SEUIL };

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/admin\/comptes/);
}

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

const lignes = (page) => page.locator(".list > .row");
const sousLeSeuil = (page) => page.locator(".list details.below");

test.describe.serial("seuils d'exploitation par classe", () => {
  let analyseUrl = null;
  let analyseId = null;
  let attendues = null; // { proposees, facultatives } d'après l'API

  test.beforeAll(async ({ request }) => {
    const sha = deposerPoids(VERSION);
    const r = await request.post("/api/v1/test/modeles", {
      data: { version: VERSION, sha_dents: sha.dents, sha_anomalies: sha.anomalies, map50: 0.5, seuils: SEUILS },
    });
    expect(r.status()).toBe(201);
  });

  test.afterAll(() => rmSync(path.join(POIDS, VERSION), { recursive: true, force: true }));

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signInWithGoogle(page, ADMIN_EMAIL);
  });

  test("la version et ses seuils sont activés ; l'analyse d'un cliché en hérite", async ({ page }) => {
    await page.goto("/admin/modeles");
    await page.getByRole("button", { name: `Activer la version ${VERSION}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Motif").fill("Seuils d'exploitation choisis sur la validation");
    await dialog.getByRole("button", { name: "Activer", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: `Version ${VERSION} active` })).toBeVisible();

    await page.goto("/nouvelle-analyse");
    await page.setInputFiles("#file", PANO);
    await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
    await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
    await page.goto("/historique");
    await page.locator("tbody tr").first().getByRole("link", { name: /Ouvrir/ }).click();
    await page.waitForURL(/\/analyse\?id=/);
    analyseUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    analyseId = new URL(page.url()).searchParams.get("id");
    await expect(page.locator(".trace")).toContainText(VERSION, { timeout: 90_000 });

    const a = await (await page.request.get(`/api/v1/analyses/${analyseId}`)).json();
    expect(a.seuils).toEqual(SEUILS);
    const anomalies = a.detections.filter((d) => d.label !== "tooth");
    attendues = {
      proposees: anomalies.filter((d) => d.confidence >= SEUIL).length,
      facultatives: anomalies.filter((d) => d.confidence < SEUIL).length,
    };
    expect(attendues.proposees).toBeGreaterThan(0);
    expect(attendues.facultatives).toBeGreaterThan(0);
    expect(a.avancement).toEqual({ revues: 0, total: attendues.proposees });
  });

  test("la liste suit les seuils de chaque classe ; le curseur les remplace, puis y revient", async ({ page }) => {
    await page.goto(analyseUrl);
    await expect(page.locator(".thr output")).toHaveText("par classe", { timeout: 30_000 });
    await expect(page.getByTestId("seuils-modele")).toContainText("Carie 75 %");
    await expect(page.locator(".trace")).toContainText("seuil par classe (modèle)");
    await expect(lignes(page)).toHaveCount(attendues.proposees);
    await expect(sousLeSeuil(page).locator("summary")).toContainText(`Sous le seuil de leur classe (${attendues.facultatives})`);
    await expect(page.locator(".strip")).toContainText(`${attendues.proposees} à revoir`);

    // Sous le seuil : visible, « Facultative », verdict non exigé.
    await sousLeSeuil(page).locator("summary").click();
    const facultative = sousLeSeuil(page).locator(".row").first();
    await expect(facultative).toContainText("Facultative");
    await facultative.click();
    await expect(page.getByTestId("verdict-facultatif")).toContainText("verdict facultatif");

    // Curseur à 0 : tout s'affiche ; retour aux seuils du modèle.
    await page.locator("#thr").fill("0");
    await expect(page.locator(".thr output")).toHaveText("0 %");
    await expect(lignes(page)).toHaveCount(attendues.proposees + attendues.facultatives);
    await page.getByRole("button", { name: "Revenir aux seuils du modèle" }).click();
    await expect(page.locator(".thr output")).toHaveText("par classe");
    await expect(lignes(page)).toHaveCount(attendues.proposees);
  });

  test("la clôture n'exige de verdict que sur les détections proposées", async ({ page }) => {
    await page.goto(analyseUrl);
    await expect(lignes(page)).toHaveCount(attendues.proposees, { timeout: 30_000 });
    for (let i = 0; i < attendues.proposees; i += 1) {
      await lignes(page).nth(i).click();
      await page.locator(".detail").getByRole("button", { name: "Valider", exact: true }).click();
      await expect(lignes(page).nth(i)).toContainText("Validée");
    }
    await expect(page.locator(".strip")).toContainText(`${attendues.proposees} sur ${attendues.proposees} détections revues`);

    await page.getByRole("button", { name: "Clôturer l'analyse" }).click();
    const modale = page.getByRole("dialog");
    await expect(modale).toContainText(`${attendues.facultatives} détection`);
    await expect(modale).toContainText("sous le seuil, sans verdict");
    await modale.getByRole("button", { name: /^Clôturer/ }).click();
    await expect(page.getByText("Analyse clôturée — lecture seule")).toBeVisible();
    await expect(page.getByText(new RegExp(`${attendues.proposees} détections? retenues?`))).toBeVisible();

    const a = await (await page.request.get(`/api/v1/analyses/${analyseId}`)).json();
    expect(a.cloturee).toBe(true);
    expect(a.avancement).toEqual({ revues: attendues.proposees, total: attendues.proposees });
  });
});
