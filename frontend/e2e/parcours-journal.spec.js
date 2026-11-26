import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

/**
 * Journal d'audit branché sur le serveur : l'administrateur voit sa session
 * (connexion Google), une connexion refusée parmi les tentatives, filtre par
 * résultat et par type, exporte en CSV — et l'export apparaît au journal.
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

test("journal d'audit : sessions, tentatives, filtres et export", async ({ page, request }) => {
  // Une connexion refusée (adresse inconnue), avant d'ouvrir le journal.
  const refus = await request.post("/api/v1/auth/connexion", { data: { email: `inconnu.${Date.now()}@e2e.example.org`, mot_de_passe: "pas le bon mot de passe" } });
  expect(refus.status()).toBe(401);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInWithGoogle(page, ADMIN_EMAIL);
  await page.getByRole("link", { name: "Journal d'audit" }).click();
  await page.waitForURL(/\/admin\/audit/);
  await expect(page.getByText("Données de démonstration")).toHaveCount(0);
  await expect(page.getByTestId("journal-total")).toContainText(/\d+ entrées?/, { timeout: 30_000 });

  // Sa propre session : la connexion Google, la plus récente, dépliée d'emblée.
  const session = page.locator("details.sess[data-groupe=session]").first();
  await expect(session).toBeVisible();
  await expect(session.locator("summary .method")).toHaveAttribute("title", "Connexion avec Google");
  await expect(session.locator("[data-action=connexion]").first()).toContainText("Connexion");

  // Filtre « Échec » : la connexion refusée, dans les tentatives.
  await page.locator("#f-res").selectOption("ko");
  const tentatives = page.locator("details.sess[data-groupe=tentatives]").first();
  await expect(tentatives).toContainText("Tentatives de connexion");
  await expect(page.locator("details.sess .tl li:not(.ko)")).toHaveCount(0);
  await expect(tentatives.locator(".tl li").last()).toContainText("adresse inconnue");   // motif traduit (le refus de ce parcours, le plus récent)
  await page.locator("#f-res").selectOption("");

  // Filtre par type d'action.
  await page.locator("#f-typ").selectOption("Connexions et sécurité");
  // « Tout déplier » vaut aussi pour la liste rechargée après le filtre.
  await page.getByRole("button", { name: "Tout déplier" }).click();
  await expect(page.locator(".tl li").first()).toBeVisible();
  await expect
    .poll(async () => {
      const textes = await page.locator(".tl li .sub").allInnerTexts();
      return textes.length > 0 && textes.every((t) => t.includes("Connexions et sécurité"));
    })
    .toBe(true);
  await page.locator("#f-typ").selectOption("");

  // Sprint 11 : filtre par action, puis détail d'une entrée, avec sa session.
  await page.getByLabel("Action", { exact: true }).selectOption("connexion");
  await page.getByRole("button", { name: "Tout déplier" }).click();
  await expect.poll(async () => new Set(await page.locator(".tl li").evaluateAll((li) => li.map((x) => x.dataset.action)))).toEqual(new Set(["connexion"]));
  await page.locator("[data-action=connexion] .tl-open").first().click();
  const detail = page.getByTestId("journal-detail");
  await expect(detail.getByRole("heading", { name: "Connexion" })).toBeVisible();
  await expect(detail).toContainText(ADMIN_EMAIL);
  await expect(detail).toContainText("Session");
  await expect(detail).toContainText("cette entrée ne peut être ni modifiée ni supprimée");
  await detail.getByRole("button", { name: "Fermer" }).click();
  await page.getByLabel("Action", { exact: true }).selectOption("");

  // Recherche par cible : une cible inconnue ne ramène rien.
  await page.getByLabel("Cible").fill("cible-introuvable-xyz");
  await expect(page.getByText("Aucune entrée ne correspond à ces filtres.")).toBeVisible();
  await page.getByLabel("Cible").fill("");
  await expect(page.getByTestId("journal-total")).toContainText(/[1-9]\d* entrées?/);

  // Export CSV, puis l'export lui-même au journal.
  const telechargement = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter (CSV)" }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^journal-audit-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(readFileSync(await fichier.path(), "utf-8").startsWith("﻿Date (UTC);Auteur;Action;Catégorie;")).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Tout déplier" }).click();
  await expect(page.locator("[data-action=export_journal]").first()).toContainText("Export du journal d’audit (CSV)");
});
