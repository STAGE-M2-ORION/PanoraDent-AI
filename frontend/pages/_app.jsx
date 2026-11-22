import Head from "next/head";

import { AppProvider } from "@/app";

import "@/app/styles/index.css";

/**
 * Adaptateur Next.js — la logique vit dans la couche `app` de FSD
 * (`src/app/`). Ce fichier ne fait que la brancher au routeur.
 */
export default function NextApp({ Component, pageProps }) {
  return (
    <AppProvider>
      <Head>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <Component {...pageProps} />
    </AppProvider>
  );
}
