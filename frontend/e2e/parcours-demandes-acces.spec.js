import { expect, test } from "@playwright/test";

/**
 * Sprint 13 — demandes d'accès : il n'y a pas d'inscription libre. Un visiteur
 * demande depuis la page d'accueil ; l'administrateur est prévenu en direct
 * (cloche), ouvre la demande, l'accepte avec le rôle qu'il choisit : le compte
 * est créé et reçoit son lien d'activation. Une autre est refusée avec un
 * motif. La réponse au visiteur ne dit jamais si un compte existe déjà.
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

async function demander(browser, { nom, email, profil, cabinet, ville, message }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const v = await ctx.newPage();
  await v.goto("/decouvrir");                // la vitrine publique (« / » aiguille selon la session)
  await v.getByRole("button", { name: "Demander un accès" }).first().click();
  const dialog = v.getByRole("dialog");
  await dialog.getByLabel("Nom et prénom").fill(nom);
  await dialog.getByLabel("Profil").selectOption(profil);
  await dialog.getByLabel("Cabinet ou établissement").fill(cabinet);
  await dialog.getByLabel("Ville").fill(ville);
  await dialog.getByLabel("E-mail professionnel").fill(email);
  await dialog.getByLabel("Message (facultatif)").fill(message);
  await dialog.getByRole("button", { name: "Envoyer la demande" }).click();
  const confirmation = dialog.getByText(/L'administrateur du cabinet l'examinera/);
  await expect(confirmation).toBeVisible();
  const texte = await confirmation.textContent();
  await ctx.close();
  return texte;
}

test("demande d'accès : prévenu en direct, acceptée avec le rôle choisi, ou refusée", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const marque = Date.now();
  const hery = { nom: `Rasoanaivo Hery ${marque}`, email: `hery.${marque}@e2e.example.org`, profil: "Patient",
    cabinet: "Université de Toliara", ville: "Toliara", message: "Patient du cabinet, pour suivre mes radiographies." };
  const intrus = { nom: `Inconnu ${marque}`, email: `inconnu.${marque}@e2e.example.org`, profil: "Patient",
    cabinet: "", ville: "", message: "" };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, ADMIN_EMAIL, /\/admin\/comptes/);
  const cloche = page.getByRole("button", { name: /^Notifications : / });
  await expect(cloche).toHaveAttribute("data-connecte", "oui");
  await page.request.delete("/api/v1/test/courriels");

  // Le visiteur demande ; l'administrateur est prévenu sans recharger.
  const reponse = await demander(browser, hery);
  await cloche.click();
  const lien = page.getByRole("region", { name: "Notifications" }).getByRole("link", { name: new RegExp(`Demande d’accès : ${hery.nom}|Demande d'accès : ${hery.nom}`) });
  await expect(lien).toContainText("Université de Toliara, Toliara");
  await lien.click();
  await page.waitForURL(/\/admin\/demandes-acces\?demande=/);
  const carte = page.getByRole("article", { name: `Demande de ${hery.nom}` });
  await expect(carte).toHaveClass(/is-visee/);
  await expect(carte).toContainText("Patient du cabinet, pour suivre mes radiographies.");

  // Acceptée : rôle proposé d'après le profil (Lecteur), prénom complété.
  await carte.getByRole("button", { name: `Accepter la demande de ${hery.nom}` }).click();
  const fenetre = page.getByRole("dialog", { name: "Accepter la demande" });
  await expect(fenetre.getByLabel("Rôle").locator("option:checked")).toHaveText("Lecteur");
  await fenetre.getByLabel("Nom", { exact: true }).fill(`Rasoanaivo ${marque}`);
  await fenetre.getByLabel("Prénom", { exact: true }).fill("Hery");
  await fenetre.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Compte créé pour ${hery.email}` })).toBeVisible();
  await expect(page.getByRole("article", { name: `Demande de ${hery.nom}` })).toHaveCount(0);   // plus en attente

  const comptes = await (await page.request.get("/api/v1/utilisateurs")).json();
  const compte = comptes.find((u) => u.email === hery.email);
  expect(compte.role.libelle).toBe("Lecteur");
  expect([compte.nom, compte.prenom]).toEqual([`Rasoanaivo ${marque}`, "Hery"]);
  const recus = await (await page.request.get("/api/v1/test/courriels", { params: { destinataire: hery.email } })).json();
  expect(recus.map((m) => m.sujet)).toEqual(["Votre compte PanoraDent AI"]);
  expect(recus[0].texte).toContain("premiere-connexion?jeton=");

  // Refusée, avec un motif transmis au demandeur.
  await demander(browser, intrus);
  await page.reload();
  const autre = page.getByRole("article", { name: `Demande de ${intrus.nom}` });
  await autre.getByRole("button", { name: `Refuser la demande de ${intrus.nom}` }).click();
  const refus = page.getByRole("dialog", { name: "Refuser la demande" });
  await refus.getByLabel(/Motif/).fill("Accès réservé au cabinet.");
  await refus.getByRole("button", { name: "Refuser la demande" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Demande de ${intrus.nom} refusée` })).toBeVisible();
  const lettre = await (await page.request.get("/api/v1/test/courriels", { params: { destinataire: intrus.email } })).json();
  expect(lettre[0].texte).toContain("Motif indiqué : Accès réservé au cabinet.");
  await page.getByRole("button", { name: "Refusées" }).click();
  await expect(page.getByRole("article", { name: `Demande de ${intrus.nom}` })).toContainText("Motif du refus : Accès réservé au cabinet.");

  // Même réponse pour une adresse qui a déjà un compte : rien ne se devine de l'extérieur.
  expect(await demander(browser, { ...hery, nom: `Encore ${marque}` })).toBe(reponse);
  const visibles = await (await page.request.get("/api/v1/administration/demandes-acces", { params: { statut: "en_attente" } })).json();
  expect(visibles.demandes.some((d) => d.email === hery.email)).toBe(false);
});

test("au clavier, chaque champ garde le focus pendant la frappe", async ({ page }) => {
  // Régression : le focus revenait sur « Nom et prénom » à chaque frappe dans un
  // autre champ (effet de la fenêtre modale relancé à chaque rendu).
  await page.goto("/decouvrir");
  await page.getByRole("button", { name: "Demander un accès" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Nom et prénom")).toBeFocused();
  await page.keyboard.type("Lionel Ark");
  await page.keyboard.press("Tab");                       // Profil
  await page.keyboard.press("Tab");                       // Cabinet ou établissement
  await page.keyboard.type("Cabinet du Port");
  await dialog.getByLabel("Ville").click();
  await page.keyboard.type("Toliara");
  await dialog.getByLabel("E-mail professionnel").click();
  await page.keyboard.type("lionel@example.org");
  await expect(dialog.getByLabel("E-mail professionnel")).toBeFocused();
  await expect(dialog.getByLabel("Nom et prénom")).toHaveValue("Lionel Ark");
  await expect(dialog.getByLabel("Cabinet ou établissement")).toHaveValue("Cabinet du Port");
  await expect(dialog.getByLabel("Ville")).toHaveValue("Toliara");
  await expect(dialog.getByLabel("E-mail professionnel")).toHaveValue("lionel@example.org");
  // Échap ferme toujours la fenêtre.
  await page.keyboard.press("Escape");
  await expect(dialog.getByLabel("Nom et prénom")).toHaveCount(0);
});
