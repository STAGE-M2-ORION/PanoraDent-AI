import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Sprint 12, lot C — tableau de bord du praticien et du lecteur : plus aucune
 * donnée fictive. Le praticien voit SES analyses (portée « moi »), le lecteur
 * celles du cabinet ; l'écran affiche ce que le serveur a compté.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PANO = path.join(ICI, "fixtures", "panoramique-inscriptions.png");
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@e2e.example.org";

async function signIn(page, email, arrivee) {
  await page.goto("/connexion");
  await page.getByRole("link", { name: "Continuer avec Google" }).click();
  await page.waitForURL(/\/api\/v1\/auth\/fake\/autoriser/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(arrivee);
}

const kpi = (page, libelle) => page.getByRole("region", { name: "Indicateurs clés" }).locator(".kpi-ring").filter({ hasText: libelle });

test("indicateurs réels du praticien puis du lecteur", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, ADMIN_EMAIL, /\/admin\/comptes/);
  const roles = await (await page.request.get("/api/v1/roles")).json();
  const marque = Date.now();
  const comptes = {};
  for (const [cle, libelle] of [["praticien", "Praticien"], ["lecteur", "Lecteur"]]) {
    comptes[cle] = `${cle}.tdb.${marque}@e2e.example.org`;
    const r = await page.request.post("/api/v1/utilisateurs", {
      data: { email: comptes[cle], nom: "Tableau", prenom: libelle, role_id: roles.find((x) => x.libelle === libelle).id, modes_connexion: ["google"] },
    });
    expect(r.status()).toBe(201);
  }

  // Praticien neuf : des zéros, pas de valeurs d'exemple.
  const ctxP = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctxP.newPage();
  await signIn(p, comptes.praticien, /\/tableau-de-bord/);
  await expect(p.locator("main").getByText(/démonstration|données fictives/)).toHaveCount(0);
  await expect(kpi(p, "Analyses ce mois-ci").locator(".kr-v")).toHaveText("0");
  await expect(kpi(p, "À relire").locator(".kr-v")).toHaveText("0");
  await expect(kpi(p, "Détections relues").locator(".kr-v")).toHaveText("—");
  await expect(kpi(p, "Délai moyen avant clôture").locator(".kr-v")).toHaveText("—");
  await expect(p.getByRole("heading", { name: "Anomalies retenues par type" })).toBeVisible();
  await expect(p.getByText("Aucune anomalie retenue sur 12 mois")).toBeVisible();

  // Une analyse déposée et traitée : elle apparaît, à relire.
  await p.goto("/nouvelle-analyse");
  await p.setInputFiles("#file", PANO);
  await expect(p.locator(".zone-auto")).toHaveCount(2);
  await p.getByRole("button", { name: "Confirmer et lancer l’analyse" }).click();
  await expect(p.locator("[data-etat=import-termine]")).toBeVisible({ timeout: 90_000 });
  await p.goto("/tableau-de-bord");
  const moi = await (await p.request.get("/api/v1/tableau-de-bord/activite")).json();
  expect(moi.portee).toBe("moi");
  expect(moi.analyses.ce_mois).toBe(1);
  await expect(kpi(p, "Analyses ce mois-ci").locator(".kr-v")).toHaveText("1");
  await expect(kpi(p, "À relire").locator(".kr-v")).toHaveText(String(moi.analyses.a_relire));
  if (moi.detections.proposees) {
    const pct = Math.round((moi.detections.relues / moi.detections.proposees) * 100);
    await expect(kpi(p, "Détections relues").locator(".kr-v")).toHaveText(`${pct} %`);
  }
  await ctxP.close();

  // Lecteur : portée cabinet, comptes rendus au lieu des relectures.
  const ctxL = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const l = await ctxL.newPage();
  await signIn(l, comptes.lecteur, /\/tableau-de-bord/);
  const cabinet = await (await l.request.get("/api/v1/tableau-de-bord/activite")).json();
  expect(cabinet.portee).toBe("cabinet");
  expect(cabinet.analyses.ce_mois).toBeGreaterThanOrEqual(1);
  await expect(l.locator("main").getByText(/démonstration|données fictives/)).toHaveCount(0);
  await expect(kpi(l, "Analyses ce mois-ci").locator(".kr-v")).toHaveText(String(cabinet.analyses.ce_mois));
  await expect(kpi(l, "Comptes rendus disponibles").locator(".kr-v")).toHaveText(String(cabinet.analyses.cloturees));
  await expect(kpi(l, "Comptes rendus téléchargés").locator(".kr-v")).toHaveText(String(cabinet.comptes_rendus.trente_jours));
  await expect(l.getByRole("heading", { name: "Comptes rendus par semaine" })).toBeVisible();
  await ctxL.close();
});
