import { expect, test } from "@playwright/test";

/**
 * Sprint 12, lot B — historique avancé : les filtres et le tri vivent dans
 * l'adresse de la page (rechargement, lien partagé avec un confrère, qui voit
 * la même sélection s'il en a le droit) ; vues enregistrées, nommées,
 * réutilisables.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

async function signIn(page, email, arrivee) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(arrivee);
}

test("filtres partagés par l'adresse et vues enregistrées", async ({ page, browser }) => {
  await signIn(page, ADMIN_EMAIL, /\/admin\/comptes/);

  // Filtres combinés et tri sur deux colonnes : tout passe dans l'adresse.
  await page.goto("/historique");
  await page.locator("#owner").selectOption("all");
  await page.locator("#dent").selectOption("36");
  await page.locator("#cr").selectOption("non_telecharge");
  await page.locator("#sort").selectOption("reference:asc");
  await page.locator("#sort2").selectOption("date:desc");
  await page.getByLabel("Référence, n°, note ou conclusion").fill("lésion");
  await expect(page).toHaveURL(/dent=36/);
  await expect(page).toHaveURL(/[?&]q=l/);   // la recherche part après une courte pause de frappe
  const url = new URL(page.url());
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ dent: "36", cr: "non_telecharge", tri: "reference,-date", q: "lésion" });
  expect(url.searchParams.has("deposant")).toBe(false);

  // Rechargement : la sélection est intacte.
  await page.reload();
  await expect(page.locator("#dent")).toHaveValue("36");
  await expect(page.locator("#cr")).toHaveValue("non_telecharge");
  await expect(page.locator("#sort")).toHaveValue("reference:asc");
  await expect(page.locator("#sort2")).toHaveValue("date:desc");
  await expect(page.getByLabel("Référence, n°, note ou conclusion")).toHaveValue("lésion");

  // Un confrère (rôle lecteur) ouvre le même lien : même sélection.
  const roles = await (await page.request.get("/api/v1/roles")).json();
  const lecteur = `lecteur.lien.${Date.now()}@e2e.example.org`;
  const cree = await page.request.post("/api/v1/utilisateurs", {
    data: { email: lecteur, nom: "Lien", prenom: "Voahangy", role_id: roles.find((r) => r.libelle === "Lecteur").id, modes_connexion: ["google"] },
  });
  expect(cree.status()).toBe(201);
  const autre = await browser.newContext();
  const page2 = await autre.newPage();
  await signIn(page2, lecteur, /\/tableau-de-bord/);
  await page2.goto(`/historique${url.search}`);
  await expect(page2.locator("#dent")).toHaveValue("36");
  await expect(page2.locator("#cr")).toHaveValue("non_telecharge");
  await expect(page2.locator("#sort")).toHaveValue("reference:asc");
  await autre.close();

  // Vue enregistrée : nommée, réappliquée après « Effacer les filtres », puis supprimée.
  const nom = `Dent 36 sans compte rendu ${Date.now()}`;
  await page.getByLabel("Enregistrer la sélection sous le nom").fill(nom);
  await page.getByRole("button", { name: "Enregistrer la vue" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Vue « ${nom} » enregistrée.` })).toBeVisible();
  await page.getByRole("region", { name: "Recherche et filtres" }).getByRole("button", { name: "Effacer les filtres" }).click();
  await expect(page.locator("#dent")).toHaveValue("");
  await page.getByRole("list", { name: "Vos vues" }).getByRole("button", { name: nom, exact: true }).click();
  await expect(page.locator("#dent")).toHaveValue("36");
  await expect(page.locator("#sort2")).toHaveValue("date:desc");
  await page.getByRole("button", { name: `Supprimer la vue ${nom}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `Vue « ${nom} » supprimée.` })).toBeVisible();
  await expect(page.getByRole("button", { name: nom, exact: true })).toHaveCount(0);
});
