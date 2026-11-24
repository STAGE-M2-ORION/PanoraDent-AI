import { expect, test } from "@playwright/test";

/**
 * Parcours du sprint 1, joué contre une stack de test complète
 * (`docker-compose.e2e.yml`) :
 *
 * - Google est remplacé par le fournisseur d'identité du backend
 *   (`IDENTITY_PROVIDER=fake`) : `/auth/google/demarrer` mène à un formulaire
 *   minimal (`input[name=email]`) qui renvoie vers le retour Google habituel ;
 * - les e-mails restent en mémoire (`COURRIEL_MODE=memoire`) : le parcours y
 *   lit ses liens par `GET /api/v1/test/courriels`.
 *
 * L'administrateur crée un compte praticien avec les deux modes. Le praticien
 * reçoit le lien, choisit son mot de passe, arrive sur son tableau de bord,
 * remplit son profil et change son thème. Il se déconnecte, oublie son mot de
 * passe, le réinitialise, et se reconnecte — puis une seconde fois avec Google
 * sur le même compte.
 */

// Adresse amorcée par le backend (`ADMIN_EMAIL` de seed_auth).
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

/** Connexion Google : lien « Continuer avec Google » → formulaire de remplacement → retour. */
async function signInWithGoogle(page, email) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
}

async function signInWithPassword(page, email, password) {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function signOut(page) {
  await page.locator("#sidebar").getByRole("button", { name: "Se déconnecter" }).click();
  await page.waitForURL(/\/connexion/);
  await expect(page.getByText("Vous êtes déconnecté.")).toBeVisible();
}

/** Dernier lien reçu par `email` dont le chemin contient `chemin`, en chemin relatif. */
async function lastLink(request, email, chemin) {
  let messages = [];
  await expect
    .poll(async () => {
      const r = await request.get("/api/v1/test/courriels", { params: { destinataire: email } });
      messages = (await r.json()).filter((m) => m.texte.includes(chemin));
      return messages.length;
    })
    .toBeGreaterThan(0);
  const lien = messages.at(-1).texte.match(/https?:\/\/\S+/g).find((url) => url.includes(chemin));
  const url = new URL(lien);
  return `${url.pathname}${url.search}`;
}

async function choosePassword(page, password) {
  await page.getByLabel("Nouveau mot de passe", { exact: true }).fill(password);
  await page.getByLabel("Confirmez le mot de passe", { exact: true }).fill(password);
}

test.describe.serial("parcours du sprint 1 : deux modes de connexion", () => {
  const practitioner = {
    email: `praticien.e2e.${Date.now()}@e2e.example.org`,
    prenom: "Hery",
    nom: "Rasoa",
    first: "premier mot de passe du praticien",
    second: "second mot de passe apres oubli",
  };

  test("l'administrateur crée un compte praticien avec les deux modes", async ({ page }) => {
    await signInWithGoogle(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin\/comptes/);
    await expect(page.getByRole("heading", { name: "Comptes", level: 2 })).toBeVisible();

    await page.getByRole("button", { name: "Créer un compte" }).click();
    const dialog = page.getByRole("dialog", { name: "Créer un compte" });
    await dialog.getByLabel("Prénom").fill(practitioner.prenom);
    await dialog.getByLabel("Nom", { exact: true }).fill(practitioner.nom);
    await dialog.getByLabel("Adresse e-mail", { exact: true }).fill(practitioner.email);
    await dialog.getByLabel("Rôle").selectOption({ label: "Praticien" });
    await expect(dialog.getByLabel("Adresse e-mail et mot de passe")).toBeChecked();
    await expect(dialog.getByLabel("Compte Google")).toBeChecked();
    await dialog.getByRole("button", { name: "Créer le compte" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Compte créé" })).toContainText("lien de première connexion");
    const row = page.getByRole("row").filter({ hasText: practitioner.email });
    await expect(row).toContainText("Praticien");
    await signOut(page);
  });

  test("le praticien active son compte par le lien reçu et arrive sur son tableau de bord", async ({ page, request }) => {
    await page.goto(await lastLink(request, practitioner.email, "/premiere-connexion?jeton="));
    await expect(page.getByRole("heading", { name: "Première connexion" })).toBeVisible();
    await choosePassword(page, "court");
    await expect(page.getByText("Trop court")).toBeVisible();
    await choosePassword(page, practitioner.first);
    await page.getByRole("button", { name: "Activer mon compte" }).click();

    // Google est autorisé mais pas encore rattaché : on le propose, on remet à plus tard.
    await expect(page.locator("[data-etat=premiere-connexion-ok]")).toBeVisible();
    await expect(page.getByRole("link", { name: "Rattacher mon compte Google" })).toBeVisible();
    await page.getByRole("button", { name: "Plus tard, continuer vers l’application" }).click();

    await page.waitForURL(/\/tableau-de-bord/);
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link", { name: "Tableau de bord" })).toBeVisible();
    await expect(nav.locator('a[href^="/admin"]')).toHaveCount(0);
  });

  test("le lien de première connexion ne sert qu'une fois", async ({ page, request }) => {
    await page.goto(await lastLink(request, practitioner.email, "/premiere-connexion?jeton="));
    await choosePassword(page, "encore un autre mot de passe");
    await page.getByRole("button", { name: "Activer mon compte" }).click();
    await expect(page.locator("[data-erreur=lien_invalide]")).toBeVisible();
    await expect(page.getByRole("link", { name: "Demander un nouveau lien" })).toBeVisible();
  });

  test("le praticien remplit son profil, change son thème et se déconnecte", async ({ page }) => {
    await signInWithPassword(page, practitioner.email, practitioner.first);
    await page.waitForURL(/\/tableau-de-bord/);

    await page.goto("/profil");
    await page.getByLabel("Titre", { exact: true }).fill("Dr");
    await page.getByLabel("Spécialité").fill("Orthodontie");
    await page.getByLabel("Numéro d’ordre").fill("MG-2026-042");
    await expect(page.locator(".signature")).toContainText("Dr Hery Rasoa");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByText("Informations enregistrées.")).toBeVisible();

    await page.getByRole("tab", { name: "Préférences" }).click();
    await page.getByLabel("Sombre", { exact: true }).check();
    await page.getByRole("button", { name: "Enregistrer mes préférences" }).click();
    await expect(page.getByText("Préférences enregistrées.")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Lu au chargement de l'application : le thème survit au rechargement.
    await page.reload();
    await expect(page.getByRole("tab", { name: "Préférences" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await signOut(page);
  });

  test("le praticien oublie son mot de passe, le réinitialise et se reconnecte", async ({ page, request }) => {
    await page.goto("/connexion");
    await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
    // La page de connexion a aussi un champ « Adresse e-mail » : attendre la
    // nouvelle page, sinon la saisie tombe dans l'ancienne pendant la navigation.
    await page.waitForURL(/\/mot-de-passe-oublie/);
    await expect(page.getByRole("heading", { name: "Mot de passe oublié" })).toBeVisible();
    await page.getByLabel("Adresse e-mail", { exact: true }).fill(practitioner.email);
    await page.getByRole("button", { name: "Recevoir un lien" }).click();
    await expect(page.locator("[data-etat=envoye]")).toContainText("Si un compte existe pour cette adresse");

    await page.goto(await lastLink(request, practitioner.email, "/nouveau-mot-de-passe?jeton="));
    await choosePassword(page, practitioner.second);
    await page.getByRole("button", { name: "Enregistrer et me connecter" }).click();
    await page.waitForURL(/\/tableau-de-bord/);
    await signOut(page);

    // L'ancien mot de passe ne marche plus ; le nouveau, si.
    await signInWithPassword(page, practitioner.email, practitioner.first);
    await expect(page.locator("[data-erreur=identifiants_invalides]")).toContainText("Adresse e-mail ou mot de passe incorrect.");
    await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveValue("");
    await signInWithPassword(page, practitioner.email, practitioner.second);
    await page.waitForURL(/\/tableau-de-bord/);
    await signOut(page);
  });

  test("le même compte se connecte une seconde fois avec Google", async ({ page }) => {
    await signInWithGoogle(page, practitioner.email);
    await page.waitForURL(/\/tableau-de-bord/);
    await page.goto("/profil?onglet=securite");
    await expect(page.getByText(`Rattaché (${practitioner.email}).`)).toBeVisible();
    await expect(page.getByText("Mot de passe défini.")).toBeVisible();
  });
});

test.describe("états de la page de connexion", () => {
  test("adresse inconnue : message neutre, identique à un mauvais mot de passe", async ({ page }) => {
    await signInWithPassword(page, "personne@e2e.example.org", "un mot de passe quelconque");
    const notice = page.locator("[data-erreur=identifiants_invalides]");
    await expect(notice).toContainText("Adresse e-mail ou mot de passe incorrect.");
    await expect(page.locator("[aria-live]").filter({ has: notice })).toHaveCount(1);
  });

  test("compte Google inconnu : encart rouge invitant à demander un compte", async ({ page }) => {
    await page.goto("/connexion?erreur=compte_inconnu");
    const notice = page.locator('[data-erreur="compte_inconnu"]');
    await expect(notice).toHaveClass(/alert-danger/);
    await expect(notice).toContainText("administrateur");
    await expect(page.locator("[aria-live]").filter({ has: notice })).toHaveCount(1);
  });

  test("mode Google non autorisé : ce compte se connecte par mot de passe", async ({ page }) => {
    await page.goto("/connexion?erreur=google_non_autorise");
    await expect(page.locator('[data-erreur="google_non_autorise"]')).toContainText("mot de passe");
  });

  test("échec Google : encart neutre avec « Réessayer »", async ({ page }) => {
    await page.goto("/connexion?erreur=echec_google");
    const notice = page.locator('[data-erreur="echec_google"]');
    await expect(notice).not.toHaveClass(/alert-danger/);
    await expect(notice.getByRole("link", { name: "Réessayer" })).toBeVisible();
  });

  test("session expirée : bandeau d'information au-dessus du formulaire", async ({ page }) => {
    await page.goto("/connexion?etat=expiree");
    await expect(page.getByText("Votre session a expiré.")).toBeVisible();
  });

  test("mot de passe oublié : même confirmation pour une adresse inconnue", async ({ page }) => {
    await page.goto("/mot-de-passe-oublie");
    await page.getByLabel("Adresse e-mail", { exact: true }).fill("personne@e2e.example.org");
    await page.getByRole("button", { name: "Recevoir un lien" }).click();
    await expect(page.locator("[data-etat=envoye]")).toContainText("Si un compte existe pour cette adresse");
  });
});
