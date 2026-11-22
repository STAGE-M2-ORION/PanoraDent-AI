import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout du parcours de connexion.
 *
 * Ils visent une stack COMPLÈTE déjà démarrée (nginx + frontend exporté +
 * backend), le backend tournant avec `APP_ENV=test` et
 * `IDENTITY_PROVIDER=fake` : le fournisseur d'identité de remplacement
 * remplace Google par un simple formulaire (`/api/v1/auth/fake/autoriser`).
 *
 *   E2E_BASE_URL=http://localhost:8080 npm run test:e2e
 *
 * Variables :
 * - `E2E_BASE_URL`    — adresse de l'application (défaut http://localhost:3000) ;
 * - `E2E_ADMIN_EMAIL` — compte administrateur amorcé par le backend de test
 *   (à défaut `ADMIN_EMAIL`, la variable lue par `seed_auth`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    locale: "fr-FR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
