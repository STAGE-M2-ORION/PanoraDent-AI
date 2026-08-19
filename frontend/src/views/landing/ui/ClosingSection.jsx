import { ScanSearch, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle, Button } from "@/shared/ui";

/**
 * Avertissement et dernier appel à l'action réunis : la mise en garde doit
 * précéder immédiatement le bouton, jamais être reléguée au pied de page.
 */
export function ClosingSection() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20">
      <div data-reveal="section">
        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Prototype de recherche — non certifié dispositif médical</AlertTitle>
          <AlertDescription>
            Les détections produites sont des propositions. La décision médicale relève
            exclusivement du praticien. Ne pas utiliser en contexte clinique réel, ni sur
            des données patient réelles.
          </AlertDescription>
        </Alert>

        <div className="mt-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">
            Essayez avec n&apos;importe quelle image
          </h2>
          <p className="mt-3 text-muted-foreground text-pretty">
            En mode mock, l&apos;inférence renvoie des détections factices mais plausibles :
            toute la chaîne se vérifie sans modèle entraîné ni GPU.
          </p>

          <Button asChild size="lg" className="mt-7">
            <Link href="/analyse">
              <ScanSearch aria-hidden="true" />
              Ouvrir le poste d&apos;analyse
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
