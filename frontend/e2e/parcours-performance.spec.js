import { expect, test } from "@playwright/test";

/**
 * Sprint 10, lot D — page Performances : les mesures affichées sont celles
 * publiées au registre (rien d'inventé, rien de recalculé) ; courbe de seuil,
 * matrice de confusion ; deux versions mesurées sur le même jeu de test se
 * comparent, deux versions de jeux différents sont signalées, sans conclusion.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";
const marque = Date.now();
const A = `perf-${marque}-a`;
const B = `perf-${marque}-b`;
const C = `perf-${marque}-c`;

const mesures = (map50) => ({
  map50, precision: 0.5424, recall: 0.5166, test_images: 109, partition: "test",
  anomalies: {
    detection: {
      global: { precision: 0.5424, rappel: 0.5166, mAP50: map50, mAP50_95: 0.3426 },
      par_classe: {
        tooth: null,
        caries: { instances: 332, precision: 0.4898, rappel: 0.4157, mAP50: 0.493, mAP50_95: 0.3458 },
        impacted_tooth: { instances: 94, precision: 0.8455, rappel: 0.9318, mAP50: 0.927, mAP50_95: 0.6243 },
      },
      confusion: {
        etiquettes: ["tooth", "caries", "impacted_tooth", "fond"],
        matrice: [[0, 0, 0, 0], [0, 134, 1, 130], [0, 1, 86, 10], [0, 180, 7, 0]],
        lecture: "ligne = prédit, colonne = vrai ; fond = manqué ou inventé",
      },
    },
    niveau_image: { par_classe: { caries: { sensibilite: 0.883, specificite: 0.4667 } } },
  },
  seuils_exploitation: {
    par_classe: { caries: { seuil: 0.1, rappel: 0.597, precision: 0.37, fausses_alertes_par_cliche: 3.655, cible: 0.7, atteinte: false } },
    courbes: { caries: [[0.05, 0.71, 0.318], [0.1, 0.597, 0.37], [0.25, 0.388, 0.518], [0.5, 0.199, 0.653]] },
  },
});

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/admin\/comptes/);
}

test("la page Performances lit le registre et compare honnêtement", async ({ page, request }) => {
  for (const [version, map50, empreinte] of [[A, 0.4597, `e2e-${marque}`], [B, 0.5097, `e2e-${marque}`], [C, 0.9, `autre-${marque}`]]) {
    const r = await request.post("/api/v1/test/modeles", {
      data: { version, sha_dents: "a".repeat(64), sha_anomalies: "b".repeat(64), metrics: mesures(map50), empreinte },
    });
    expect(r.status()).toBe(201);
  }

  await page.setViewportSize({ width: 1400, height: 1000 });
  await signInWithGoogle(page, ADMIN_EMAIL);
  await page.goto("/performance");
  await expect(page.getByText("Prototype de recherche non certifié")).toBeVisible();
  await expect(page.getByText(/Valeurs d’exemple fictives|ex\. fictif/)).toHaveCount(0);

  await page.getByLabel("Version affichée").selectOption(B);

  // Mesures globales et par classe : celles du registre.
  const kpis = page.getByRole("region", { name: "Mesures globales du modèle" });
  await expect(kpis).toContainText("0,51");
  await expect(kpis).toContainText("109");
  const parClasse = page.getByRole("region", { name: "Mesures par classe" });
  const carie = parClasse.getByRole("row", { name: /^Carie / });
  await expect(carie).toContainText("0,49");
  await expect(carie).toContainText("42 %");
  await expect(carie).toContainText("88 %");
  await expect(carie).toContainText("332");
  await expect(parClasse.getByRole("row", { name: /^Dent incluse/ })).toContainText("0,93");

  // Effet du seuil : la phrase en clair, la courbe de validation.
  await expect(page.getByText("Au seuil retenu de 0,10, le modèle retrouve 60 % des caries de la validation")).toBeVisible();
  await expect(page.getByText("L’objectif de 70 % de rappel n’est pas atteint")).toBeVisible();
  const courbe = page.locator(".pr-panel").filter({ hasText: "Carie" });
  await expect(courbe.locator(".pr-pt")).toHaveCount(4);
  await expect(courbe.locator(".pr-readout")).toHaveText("Seuil 0,10 · rappel 60 % · précision 37 %");
  await courbe.locator(".pr-pt").last().hover();
  await expect(courbe.locator(".pr-readout")).toHaveText("Seuil 0,05 · rappel 71 % · précision 32 %");

  // Matrice de confusion : les effectifs, sans la ligne ni la colonne « Dent » vides.
  const matrice = page.locator("table.matrix");
  await expect(matrice.locator("td.diag").first()).toHaveText("134");
  await expect(matrice.getByRole("columnheader", { name: "Dent", exact: true })).toHaveCount(0);

  // Même jeu de test : écart affiché.
  await page.getByLabel("Version A", { exact: true }).selectOption(A);
  await page.getByLabel("Version B", { exact: true }).selectOption(B);
  const comparaison = page.getByTestId("comparaison");
  await expect(comparaison.getByRole("columnheader", { name: "Écart (B − A)" })).toBeVisible();
  await expect(comparaison.getByRole("row", { name: /Toutes classes/ })).toContainText("+0,05");

  // Jeux de test différents : signalé, pas d'écart.
  await page.getByLabel("Version B", { exact: true }).selectOption(C);
  await expect(page.getByRole("note").filter({ hasText: "Jeux de test différents : pas de conclusion" })).toBeVisible();
  await expect(comparaison.getByRole("columnheader", { name: "Écart (B − A)" })).toHaveCount(0);
  await expect(comparaison.getByRole("row", { name: /Toutes classes/ })).toContainText("0,90");

  // Une version publiée sans seuils le dit, sans courbe inventée.
  const versions = await (await page.request.get("/api/v1/model/versions")).json();
  const sansSeuils = versions.find((v) => !v.metrics?.seuils_exploitation);
  if (sansSeuils) {
    await page.getByLabel("Version affichée").selectOption(sansSeuils.version);
    await expect(page.getByText("Seuils non publiés avec cette version")).toBeVisible();
    await expect(page.locator(".pr-panel")).toHaveCount(0);
  }
});
