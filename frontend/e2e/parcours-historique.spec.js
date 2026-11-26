import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Sprint 8, lot D — historique servi par le serveur : recherche par
 * référence, filtres, pagination par clé, fiche d'historique d'une analyse
 * (lue dans le journal), export CSV.
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

test("historique : recherche, fiche, filtres, pagination et export CSV", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInWithGoogle(page, ADMIN_EMAIL);
  await page.goto("/nouvelle-analyse");
  await page.setInputFiles("#file", PANO);
  await page.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
  await expect(page.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
  const reference = (await page.locator("[data-etat=import-termine]").innerText()).match(/PDX-\d{4}-\d{4}/)[0];

  await page.goto("/historique");
  const lignes = page.locator("tbody tr");
  await expect(lignes.first()).toBeVisible({ timeout: 30_000 });

  // Recherche par référence : une seule ligne, servie par le serveur.
  await page.getByLabel("Référence, n°, note ou conclusion").fill(reference);
  await expect(lignes).toHaveCount(1);
  await expect(lignes.first()).toContainText(reference);
  await expect(page.getByTestId("pagination")).toContainText("1–1 sur 1 analyse");

  // Fiche d'historique : import puis traitement, lus dans le journal.
  await lignes.first().getByRole("button", { name: /Historique de l’analyse/ }).click();
  const fiche = page.getByRole("dialog");
  await expect(fiche).toContainText(`Historique de l’analyse ${reference}`);
  await expect(fiche.locator("[data-action=import_analyse]")).toContainText("Panoramique importée et anonymisée");
  await expect(fiche.locator("[data-action=analyse_traitee]")).toContainText("Analyse par le modèle terminée");
  await fiche.getByRole("button", { name: "Fermer" }).click();

  // Filtre par état : l'analyse vient d'être traitée, elle est « à relire ».
  await page.locator("#status").selectOption("pending");
  await expect(lignes).toHaveCount(1);
  await page.locator("#status").selectOption("closed");
  await expect(page.getByText("Aucune analyse ne correspond à ces critères.")).toBeVisible();
  await page.getByRole("button", { name: "Effacer les filtres" }).first().click();
  await page.locator("#owner").selectOption("all");

  // Pagination par clé, quand le cabinet compte plus d'une page.
  const texte = await page.getByTestId("pagination").innerText();
  const total = Number(texte.match(/sur (\d+)/)[1]);
  if (total > 10) {
    await page.getByRole("button", { name: /Suivantes/ }).click();
    await expect(page.getByTestId("pagination")).toContainText(`11–${Math.min(20, total)} sur ${total}`);
    await page.getByRole("button", { name: /Précédentes/ }).click();
    await expect(page.getByTestId("pagination")).toContainText(`1–10 sur ${total}`);
  }

  // Export CSV des analyses filtrées.
  await page.getByLabel("Référence, n°, note ou conclusion").fill(reference);
  await expect(lignes).toHaveCount(1);
  const telechargement = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter (CSV)" }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^historique-analyses-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await fichier.path(), "utf-8");
  expect(csv.startsWith("﻿N°;Référence;")).toBe(true);
  expect(csv.trim().split("\r\n")).toHaveLength(2);
  expect(csv).toContain(reference);
});
