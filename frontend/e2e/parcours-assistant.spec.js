import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Sprint 9, lot E — l'assistant documentaire dans la page d'analyse, contre
 * la pile de test (vectoriseur et rédacteur factices) : une question couverte
 * par la base documentaire reçoit une réponse qui cite sa source, dépliable
 * et liée au document ; une question hors documentation est refusée, sans
 * réponse inventée ; l'avertissement « pas de diagnostic » accompagne chaque
 * réponse ; la question est inscrite au journal, rattachée à l'analyse.
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
  await page.waitForURL(/\/admin\/comptes/);
}

test("le praticien interroge l'assistant depuis une analyse", async ({ page }) => {
  test.setTimeout(180_000);
  const marque = Date.now();
  const titre = `Fiches de lecture ${marque}`;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signInWithGoogle(page, ADMIN_EMAIL);

  // Base documentaire : un document indexé par le worker, réglages à l'échelle du vectoriseur factice.
  const depot = await page.request.post("/api/v1/documents", {
    multipart: {
      titre,
      fichier: {
        name: "fiches.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          `# Lésions péri-apicales\n\nUne lésion péri-apicale est une zone radio-claire autour de l'apex de la racine. ` +
            `Elle accompagne souvent une atteinte de la pulpe (${marque}).\n`,
        ),
      },
    },
  });
  expect(depot.status()).toBe(201);
  const documentId = (await depot.json()).id;
  expect((await page.request.put("/api/v1/assistant/parametres", { data: { passages: 5, seuil: 0.2 } })).status()).toBe(200);
  await expect
    .poll(async () => (await (await page.request.get("/api/v1/documents")).json()).documents.find((d) => d.id === documentId)?.etat, { timeout: 60_000 })
    .toBe("indexe");

  // Une analyse terminée.
  await page.goto("/nouvelle-analyse");
  await page.setInputFiles("#file", PANO);
  await expect(page.locator(".zone-auto")).toHaveCount(2);
  await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
  await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
  await page.goto("/historique");
  await page.locator("tbody tr").first().getByRole("link", { name: /Ouvrir/ }).click();
  await page.waitForURL(/\/analyse\?id=/);
  const analyseId = new URL(page.url()).searchParams.get("id");

  // Question couverte par la documentation : réponse sourcée.
  await page.getByRole("tab", { name: /Assistant/ }).click();
  const panneau = page.locator("#paneChat");
  await panneau.getByLabel("Votre question").fill("Qu'est-ce qu'une lésion péri-apicale ?");
  await panneau.getByRole("button", { name: "Envoyer" }).click();
  const reponse = panneau.getByTestId("assistant-reponse").first();
  await expect(reponse).toContainText("zone radio-claire autour de l'apex", { timeout: 60_000 });
  await expect(reponse).toContainText("ne pose pas de diagnostic");
  const source = reponse.locator("details.src").first();
  await expect(source).toContainText(`[1] ${titre}`);
  await expect(source).toContainText("Lésions péri-apicales");

  // Le renvoi [1] déplie la source, qui mène au document.
  await reponse.getByRole("button", { name: "Source 1" }).click();
  await expect(source).toHaveAttribute("open", "");
  const lien = source.getByRole("link", { name: "Ouvrir le document" });
  await expect(lien).toBeVisible();
  const fichier = await page.request.get(await lien.getAttribute("href"));
  expect(fichier.status()).toBe(200);
  expect(await fichier.text()).toContain(String(marque));

  // Question hors documentation : refus, sans source ni réponse inventée.
  await panneau.getByLabel("Votre question").fill("Comment traiter une fracture du fémur ?");
  await panneau.getByRole("button", { name: "Envoyer" }).click();
  const refus = panneau.getByTestId("assistant-reponse").nth(1);
  await expect(refus).toContainText("Je ne trouve rien dans la documentation de référence", { timeout: 60_000 });
  await expect(refus.locator("details.src")).toHaveCount(0);

  // Les deux questions sont au journal, rattachées à l'analyse.
  const journal = await (await page.request.get("/api/v1/journal", { params: { jours: 1, categorie: "Assistant documentaire" } })).json();
  const questions = journal.sessions.flatMap((s) => s.entrees).filter((e) => e.action === "question_assistant");
  expect(questions.some((e) => e.precision.includes("lésion péri-apicale") && e.precision.includes("réponse · 1 source"))).toBe(true);
  expect(questions.some((e) => e.precision.includes("fracture du fémur") && e.precision.includes("sans réponse"))).toBe(true);
  expect(analyseId).toBeTruthy();
});
