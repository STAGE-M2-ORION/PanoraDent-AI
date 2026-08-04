import { AppProvider } from "@/app";

import "@/app/styles/globals.css";

/**
 * Adaptateur Next.js — la logique vit dans la couche `app` de FSD
 * (`src/app/`). Ce fichier ne fait que la brancher au routeur.
 */
export default function NextApp({ Component, pageProps }) {
  return (
    <AppProvider>
      <Component {...pageProps} />
    </AppProvider>
  );
}
