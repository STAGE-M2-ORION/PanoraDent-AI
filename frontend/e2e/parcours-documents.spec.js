import { expect, test } from "@playwright/test";

/**
 * Sprint 9, lot D — base documentaire de l'assistant : l'administrateur
 * dépose un document Markdown, le voit indexé par le worker (vectoriseur
 * factice en e2e), règle la recherche, remplace le fichier, le réindexe, puis
 * le retire de la base. Un fichier d'un format refusé l'est dès l'écran.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/\/admin\/comptes/);
}

const markdown = (texte) => ({ name: "guide-de-lecture.md", mimeType: "text/markdown", buffer: Buffer.from(texte, "utf-8") });

test("l'administrateur tient la base documentaire de l'assistant", async ({ page }) => {
  const marque = Date.now();   // contenu unique : la pile e2e peut être réutilisée
  const titre = `Guide de lecture ${marque}`;
  await signInWithGoogle(page, ADMIN_EMAIL);
  await page.getByRole("link", { name: "Base documentaire" }).click();
  await page.waitForURL(/\/admin\/documents/);

  // Format refusé avant tout envoi.
  await page.getByTestId("doc-upload-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert").filter({ hasText: "PDF ou Markdown" })).toBeVisible();

  // Dépôt, puis indexation par le worker : l'écran se met à jour seul.
  await page.getByLabel("Titre du prochain document (facultatif)").fill(titre);
  await page.getByTestId("doc-upload-input").setInputFiles(
    markdown(`# Lésions péri-apicales\n\nUne lésion péri-apicale est une zone radio-claire autour de l'apex (${marque}).\n\n# Seuil\n\nLe seuil règle les propositions affichées.\n`),
  );
  await expect(page.getByRole("status").filter({ hasText: `« ${titre} » ajouté` })).toBeVisible();
  const ligne = page.getByRole("row").filter({ hasText: titre });
  await expect(ligne.getByText("Indexé")).toBeVisible({ timeout: 30_000 });
  await expect(ligne.getByRole("cell", { name: "2", exact: true })).toBeVisible();   // deux passages

  // Le même fichier une seconde fois : refusé par le serveur.
  await page.getByTestId("doc-upload-input").setInputFiles(
    markdown(`# Lésions péri-apicales\n\nUne lésion péri-apicale est une zone radio-claire autour de l'apex (${marque}).\n\n# Seuil\n\nLe seuil règle les propositions affichées.\n`),
  );
  await expect(page.getByRole("alert").filter({ hasText: "déjà dans la base" })).toBeVisible();

  // Réglages de la recherche.
  await page.getByLabel("Passages remis au modèle").fill("4");
  await page.getByLabel("Seuil de similarité").fill("0,35");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Réglages de la recherche enregistrés." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Passages remis au modèle")).toHaveValue("4");
  await expect(page.getByLabel("Seuil de similarité")).toHaveValue("0.35");

  // Remplacement du fichier : réindexé avec la nouvelle version (un passage).
  await ligne.getByRole("button", { name: `Remplacer le fichier de « ${titre} »` }).click();
  await page.getByTestId("doc-replace-input").setInputFiles(markdown(`# Guide\n\nVersion revue ${marque}.\n`));
  await expect(page.getByRole("status").filter({ hasText: `« ${titre} » remplacé` })).toBeVisible();
  await expect(ligne.getByRole("cell", { name: "1", exact: true })).toBeVisible({ timeout: 30_000 });

  // Réindexation à la demande.
  await ligne.getByRole("button", { name: `Réindexer « ${titre} »` }).click();
  await expect(page.getByRole("status").filter({ hasText: `« ${titre} » remis en indexation.` })).toBeVisible();
  await expect(ligne.getByText("Indexé")).toBeVisible({ timeout: 30_000 });

  // Le fichier s'ouvre depuis la liste.
  const fichier = await page.request.get(await ligne.getByRole("link", { name: `Ouvrir « ${titre} »` }).getAttribute("href"));
  expect(fichier.status()).toBe(200);
  expect(await fichier.text()).toContain(`Version revue ${marque}`);

  // Retrait de la base, après confirmation.
  await ligne.getByRole("button", { name: `Supprimer « ${titre} »` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retirer le document" }).click();
  await expect(page.getByRole("status").filter({ hasText: `« ${titre} » retiré de la base.` })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: titre })).toHaveCount(0);

  // Chaque geste est au journal d'audit, dans la catégorie de l'assistant.
  const journal = await (await page.request.get("/api/v1/journal", { params: { jours: 1, categorie: "Assistant documentaire" } })).json();
  const actions = journal.sessions.flatMap((s) => s.entrees.filter((e) => (e.precision || "").includes(titre)).map((e) => e.action));
  for (const action of ["document_depose", "document_indexe", "document_remplace", "document_reindexation", "document_supprime"]) {
    expect(actions).toContain(action);
  }
});
