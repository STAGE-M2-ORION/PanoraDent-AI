import Head from "next/head";
import Link from "next/link";

import { Logo } from "@/shared/ui";

/** Mentions légales (les champs « à renseigner » restent signalés comme tels). */
export function MentionsPage() {
  return (
    <div className="v-mentions">
      <Head>
        <title>Mentions légales · PanoraDent AI</title>
      </Head>
      <main className="doc">
        <header>
          <Logo href="/decouvrir" />
          <Link href="/decouvrir">← Retour à l&apos;accueil</Link>
        </header>
        <h1>Mentions légales</h1>
        <section>
          <h2>Éditeur</h2>
          <p>PanoraDent AI (nom provisoire), prototype académique réalisé dans le cadre d&apos;un mémoire de fin d&apos;études, Toliara, Madagascar.</p>
          <p className="tbd">Nom de l&apos;auteur, établissement, directeur de mémoire et adresse de contact : à renseigner.</p>
        </section>
        <section>
          <h2>Hébergement</h2>
          <p className="tbd">Hébergeur et adresse du serveur : à renseigner.</p>
        </section>
        <section>
          <h2>Nature du service</h2>
          <p>
            PanoraDent AI est un outil d&apos;aide à la décision. Il n&apos;est pas certifié comme dispositif médical, ne pose aucun diagnostic et ne remplace pas le jugement clinique du praticien, seul
            responsable de l&apos;interprétation des examens.
          </p>
        </section>
        <section id="donnees">
          <h2>Données personnelles et données de santé</h2>
          <ul>
            <li>Les radiographies sont anonymisées dès l&apos;import : balises DICOM identifiantes, métadonnées et texte incrusté sont retirés.</li>
            <li>Les images et les détections restent sur le serveur de la plateforme ; aucune image n&apos;est transmise à un service externe.</li>
            <li>Les comptes sont créés par un administrateur ; l&apos;accès est limité selon le rôle et tracé dans un journal d&apos;audit.</li>
          </ul>
          <p className="tbd">Durée de conservation, responsable du traitement et cadre légal applicable à Madagascar : à renseigner.</p>
        </section>
        <section>
          <h2>Jeu de données</h2>
          <p>
            Le modèle est entraîné sur DENTEX, jeu public de radiographies panoramiques annotées. Licence et citation exacte : <span className="tbd">à renseigner</span>.
          </p>
        </section>
      </main>
    </div>
  );
}
