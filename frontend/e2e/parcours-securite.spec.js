import { expect, test } from "@playwright/test";

/**
 * Sprint 12, lot D — durcissement vu du navigateur, à travers nginx : en-têtes
 * de sécurité de l'API, refus d'un corps trop gros, refus de débit traduit à
 * l'écran de connexion (simulé : la limite de la pile e2e est haute).
 */

test("en-têtes de sécurité et bornes de l'API à travers le relais", async ({ request }) => {
  const r = await request.get("/api/v1/moi");
  expect(r.status()).toBe(401);
  const h = r.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["content-security-policy"]).toContain("default-src 'none'");
  expect(h["cache-control"]).toBe("no-store");

  // Corps JSON de plus d'1 Mo : refusé par le serveur avant lecture.
  const gros = await request.post("/api/v1/auth/connexion", {
    headers: { "content-type": "application/json" },
    data: `{"email":"x@e2e.example.org","mot_de_passe":"${"a".repeat(1100 * 1024)}"}`,
  });
  expect(gros.status()).toBe(413);
  expect((await gros.json()).code).toBe("requete_trop_volumineuse");
});

test("un refus de débit s'affiche avec son délai", async ({ page }) => {
  await page.route("**/api/v1/auth/connexion", (route) =>
    route.fulfill({
      status: 429,
      headers: { "retry-after": "42" },
      contentType: "application/json",
      body: JSON.stringify({ code: "trop_de_requetes", message: "Trop de demandes : réessayez dans 42 s." }),
    }),
  );
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail", { exact: true }).fill("dr.debit@e2e.example.org");
  await page.getByLabel("Mot de passe", { exact: true }).fill("une phrase de passe quelconque");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Trop de tentatives depuis ce poste")).toBeVisible();
  await expect(page.getByText("Trop de demandes : réessayez dans 42 s.")).toBeVisible();
});
