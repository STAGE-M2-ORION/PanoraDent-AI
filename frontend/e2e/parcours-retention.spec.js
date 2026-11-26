import { expect, test } from "@playwright/test";

/**
 * Sprint 11, lot D — conservation du journal : la durée se règle dans les
 * paramètres du cabinet (6 mois à 10 ans) ; l'abaisser bloque la purge dans
 * la même session, pas dans une autre ; le changement est au journal. (La
 * purge elle-même, qui exige des entrées de plus de 6 mois, est éprouvée par
 * les tests du serveur.)
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

test("abaisser la durée de conservation bloque la purge dans la même session", async ({ page, browser }) => {
  await signInWithGoogle(page, ADMIN_EMAIL);
  await page.goto("/admin/cabinet");
  const duree = page.getByLabel("Durée de conservation (jours)");
  await expect(duree).toHaveValue(/^\d+$/);
  const avant = Number(await duree.inputValue());

  // Hors bornes : refusé avant envoi.
  await duree.fill("90");
  await page.getByRole("button", { name: "Enregistrer la durée" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "180 (6 mois) à 3650 (10 ans)" })).toBeVisible();

  // Abaisser : prévenu, enregistré, journalisé.
  const nouvelle = avant > 200 ? 200 : 190;
  await duree.fill(String(nouvelle));
  await expect(page.getByText("la purge ne sera pas possible dans cette session")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer la durée" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Durée de conservation du journal enregistrée." })).toBeVisible();

  // Dans le journal, cette session ne peut pas purger.
  await page.goto("/admin/audit");
  const carte = page.getByRole("region", { name: "Conservation et purge" });
  await expect(carte).toContainText(`${nouvelle} jours`);
  await expect(carte).toContainText("la purge n’y est pas possible");
  await expect(carte.getByRole("button", { name: "Purger les entrées anciennes" })).toBeDisabled();
  const journal = await (await page.request.get("/api/v1/journal", { params: { jours: 1, action: "retention_journal" } })).json();
  expect(journal.sessions.flatMap((s) => s.entrees).some((e) => e.precision === `${avant} → ${nouvelle} jours`)).toBe(true);

  // Depuis une autre session, la purge n'est plus bloquée (rien à purger sur une pile neuve).
  const autre = await browser.newContext();
  const page2 = await autre.newPage();
  await signInWithGoogle(page2, ADMIN_EMAIL);
  await page2.goto("/admin/audit");
  const carte2 = page2.getByRole("region", { name: "Conservation et purge" });
  await expect(carte2).toContainText(`${nouvelle} jours`);
  await expect(carte2).not.toContainText("la purge n’y est pas possible");
  const r = await (await page2.request.get("/api/v1/journal/retention")).json();
  expect(r.purge_bloquee).toBe(false);
  await autre.close();

  // Remise à la valeur d'origine (l'allonger ne bloque rien).
  await page.goto("/admin/cabinet");
  await page.getByLabel("Durée de conservation (jours)").fill(String(avant));
  await page.getByRole("button", { name: "Enregistrer la durée" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Durée de conservation du journal enregistrée." })).toBeVisible();
});
