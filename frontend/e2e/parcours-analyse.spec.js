import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Parcours du sprint 4, contre la stack de test (`docker-compose.e2e.yml`) :
 * l'analyse est mise en file à la confirmation puis traitée par le worker ;
 * échec quand le modèle est injoignable, relance sans réimporter ;
 * visionneuse (seuil local, zoom, raccourcis clavier, export PNG).
 *
 * Les étapes « en file » et « échec » arrêtent un instant le worker ou le
 * service d'inférence de la stack de test (CLI `docker`). Sur un poste qui
 * fait aussi tourner la stack de développement, préciser le projet :
 *   E2E_COMPOSE_PROJECT=panoradent-e2e
 * Sans `docker` accessible, ces étapes sont sautées (le reste est testé).
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

/* ---------- Conteneurs de la stack de test ---------- */

function conteneur(service) {
  const projet = process.env.E2E_COMPOSE_PROJECT;
  const filtres = [`label=com.docker.compose.service=${service}`, ...(projet ? [`label=com.docker.compose.project=${projet}`] : [])];
  try {
    const ids = execFileSync("docker", ["ps", "-a", "-q", ...filtres.flatMap((f) => ["--filter", f])], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return ids.length === 1 ? ids[0] : null; // plusieurs stacks : préciser E2E_COMPOSE_PROJECT
  } catch {
    return null;
  }
}

const docker = (...args) => execFileSync("docker", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
const WORKER = conteneur("worker");
const INFERENCE = conteneur("inference");
const PILOTABLE = Boolean(WORKER && INFERENCE);

async function inferencePrete() {
  await expect.poll(() => docker("inspect", "-f", "{{.State.Health.Status}}", INFERENCE), { timeout: 120_000 }).toBe("healthy");
}

/* ---------- Comptes ---------- */

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

async function importer(page) {
  await page.goto("/nouvelle-analyse");
  await page.setInputFiles("#file", PANO);
  await expect(page.locator(".zone-auto")).toHaveCount(2);
  await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
}

/** Position relative d'un cadre dans le calque de l'image (indépendante du zoom si aligné). */
async function positionDansImage(page, selecteur) {
  const calque = await page.locator(".stage .layer").boundingBox();
  const cadre = await page.locator(selecteur).boundingBox();
  return { x: (cadre.x - calque.x) / calque.width, y: (cadre.y - calque.y) / calque.height, w: cadre.width / calque.width };
}

test.describe.serial("parcours du sprint 4 : file de traitement et visionneuse", () => {
  const email = `analyse.e2e.${Date.now()}@e2e.example.org`;
  const password = "mot de passe du praticien analyse";

  test.afterAll(() => {
    // Jamais de stack laissée sans worker ni modèle.
    if (!PILOTABLE) return;
    try {
      docker("start", INFERENCE);
      docker("start", WORKER);
    } catch {
      /* déjà démarrés */
    }
  });

  test("un praticien est créé et active son compte", async ({ page, request }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await page.getByRole("button", { name: "Créer un compte" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un compte" });
    await dialog.getByLabel("Prénom").fill("Hery");
    await dialog.getByLabel("Nom", { exact: true }).fill("Analyse");
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
  });

  test.beforeEach(async ({ page }, info) => {
    if (info.title.startsWith("un praticien est créé")) return;
    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(/\/tableau-de-bord/);
  });

  test("la confirmation met l'analyse en file ; le worker la traite", async ({ page }) => {
    test.skip(!PILOTABLE, "docker non accessible : impossible d'arrêter le worker de la stack de test");
    docker("stop", WORKER);
    await importer(page);
    // Réponse immédiate : image enregistrée, analyse en attente du worker.
    const attente = page.locator("[data-etat=en-file]");
    await expect(attente).toBeVisible();
    await expect(attente).toContainText(/PDX-\d{4}-\d{4}/);
    await expect(attente).toContainText("En file d’attente");

    await page.goto("/historique");
    await expect(page.locator("tbody").getByText("En file d’attente").first()).toBeVisible();

    docker("start", WORKER);
    // La liste se relit seule tant qu'une analyse est en traitement.
    await expect(page.locator("tbody").getByText("À relire").first()).toBeVisible({ timeout: 60_000 });
  });

  test("modèle injoignable : échec, puis relance sans réimporter", async ({ page }) => {
    test.skip(!PILOTABLE, "docker non accessible : impossible d'arrêter le service d'inférence de la stack de test");
    test.setTimeout(240_000);
    docker("stop", INFERENCE);
    try {
      await importer(page);
      const echec = page.locator("[data-etat=echec-analyse]");
      await expect(echec).toBeVisible({ timeout: 90_000 });
      await expect(echec).toContainText("Échec de l’analyse");
      await expect(echec).toContainText("ne répond pas");
    } finally {
      docker("start", INFERENCE);
    }
    await inferencePrete();
    await page.getByRole("button", { name: "Relancer l’analyse" }).click();
    await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Modèle utilisé : .* · traitée en/)).toBeVisible(); // version et durée
  });

  test("visionneuse : seuil sans réseau, cadres alignés au zoom, clavier, export PNG", async ({ page }) => {
    test.setTimeout(120_000);
    await importer(page);
    await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
    await page.goto("/historique");
    await page.locator("tbody tr").first().getByRole("link", { name: /Ouvrir/ }).click();
    await page.waitForURL(/\/analyse\?id=/);
    await expect(page.locator("[data-det]").first()).toBeVisible();
    await expect(page.getByText(/Modèle .* en \d/)).toBeVisible(); // version et durée de traitement

    // Seuil : filtrage local, aucune requête vers l'API.
    const requetes = [];
    const ecoute = (r) => r.url().includes("/api/") && requetes.push(r.url());
    page.on("request", ecoute);
    const n = await page.locator("[data-det]").count();
    expect(n).toBeGreaterThan(0);
    await page.locator("#thr").fill("100");
    await expect(page.locator("[data-det]")).toHaveCount(0);
    await page.locator("#thr").fill("0");
    await expect.poll(() => page.locator("[data-det]").count()).toBeGreaterThanOrEqual(n);
    page.off("request", ecoute);
    expect(requetes).toEqual([]);

    // Cadres alignés sur l'image avant et après zoom.
    const cible = "[data-det] rect:nth-of-type(1)";
    await page.locator("#thr").fill("50");
    const avant = await positionDansImage(page, `${cible} >> nth=0`);
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await expect(page.locator(".zoom-val")).toHaveText(/156/);
    const apres = await positionDansImage(page, `${cible} >> nth=0`);
    expect(apres.x).toBeCloseTo(avant.x, 2);
    expect(apres.y).toBeCloseTo(avant.y, 2);
    expect(apres.w).toBeCloseTo(avant.w, 2);
    await page.keyboard.press("0");
    await expect(page.locator(".zoom-val")).toHaveText(/100/);

    // J / K : sélection suivante puis précédente.
    const detail = page.locator("h3").filter({ hasText: /^Dent \d+ · / });
    await page.keyboard.press("j");
    const premiere = await detail.innerText();
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await expect(detail).toHaveText(premiere);

    // H : tout masquer, puis tout réafficher.
    await page.keyboard.press("h");
    await expect(page.locator("[data-det]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tout afficher" })).toBeVisible();
    await page.keyboard.press("h");
    await expect(page.locator("[data-det]").first()).toBeVisible();

    // Export PNG de l'image annotée, nommé par la seule référence anonyme.
    const telechargement = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exporter en PNG l’image annotée" }).click();
    const fichier = await telechargement;
    expect(fichier.suggestedFilename()).toMatch(/^panoradent-PDX-\d{4}-\d{4}-annotee\.png$/);
    const octets = readFileSync(await fichier.path());
    expect(octets.subarray(1, 4).toString()).toBe("PNG");
    expect(octets.length).toBeGreaterThan(10_000);
  });
});
