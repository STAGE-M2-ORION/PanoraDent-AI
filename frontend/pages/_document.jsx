import { Head, Html, Main, NextScript } from "next/document";

/** Document HTML : langue, icône et préchargement des polices de marque. */
export default function Document() {
  return (
    <Html lang="fr">
      <Head>
        <link rel="icon" type="image/svg+xml" href="/brand/Icone.svg" />
        <link rel="preload" href="/fonts/Satoshi-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/PanoraDisplay-Bold.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
