import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

/**
 * Sprint 11, lot E — tableau de bord d'administration et comptes : les
 * indicateurs sont réels (aucune donnée fictive, plus de menu de
 * notifications de démonstration) ; la liste des comptes s'exporte en CSV,
 * export journalisé ; le lien de première connexion se renvoie d'un geste à
 * tous les comptes jamais connectés.
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

test("tableau de bord réel, export des comptes et renvoi groupé des liens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signInWithGoogle(page, ADMIN_EMAIL);

  // Un compte jamais connecté (le lien de première connexion part à la création).
  const email = `dr.relance.${Date.now()}@e2e.example.org`;
  const roles = await (await page.request.get("/api/v1/roles")).json();
  const praticien = roles.find((r) => r.libelle === "Praticien");
  const cree = await page.request.post("/api/v1/utilisateurs", {
    data: { email, nom: "Relance", prenom: "Hery", role_id: praticien.id, modes_connexion: ["mot_de_passe", "google"] },
  });
  expect(cree.status()).toBe(201);

  // Tableau de bord : indicateurs réels, plus de notifications de démonstration.
  await page.goto("/tableau-de-bord");
  const indicateurs = page.getByRole("region", { name: "Indicateurs clés" });
  await expect(indicateurs).toContainText("Jamais connectés");
  await expect(indicateurs).toContainText("Connexions cette semaine");
  await expect(page.locator("main").getByText(/démonstration|données fictives|Demandes d’accès|Double vérification/)).toHaveCount(0);
  // La cloche est celle des vraies notifications (sprint 13), plus le menu de démonstration.
  await expect(page.getByRole("button", { name: /^Notifications : / })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Espace occupé" })).toBeVisible();
  const dernieres = page.getByRole("table", { name: "Dernières actions sur les comptes et les rôles, 30 jours" });
  await expect(dernieres).toContainText("Création d’un compte");
  await expect(dernieres).toContainText("Relance");

  // Export CSV de la liste des comptes, journalisé.
  await page.goto("/admin/comptes");
  const telechargement = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter (CSV)" }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^comptes-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await fichier.path(), "utf-8");
  expect(csv.startsWith("﻿Nom;Prénom;Adresse e-mail;Rôle;État;")).toBe(true);
  expect(csv).toContain(`Relance;Hery;${email};Praticien;Actif;`);
  const journal = await (await page.request.get("/api/v1/journal", { params: { jours: 1, action: "export_comptes" } })).json();
  expect(journal.sessions.flatMap((s) => s.entrees).length).toBeGreaterThan(0);

  // Renvoi groupé : le compte jamais connecté reçoit un nouveau lien.
  const avant = (await (await page.request.get("/api/v1/test/courriels", { params: { destinataire: email } })).json()).length;
  await page.getByRole("button", { name: /^Renvoyer les liens \(\d+\)$/ }).click();
  const dialogue = page.getByRole("dialog");
  await expect(dialogue).toContainText(email);
  await dialogue.getByRole("button", { name: "Renvoyer les liens" }).click();
  await expect(page.getByText(/liens? de première connexion envoyés?/)).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get("/api/v1/test/courriels", { params: { destinataire: email } })).json()).length)
    .toBe(avant + 1);
});
