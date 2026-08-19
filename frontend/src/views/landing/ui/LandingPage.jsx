import { useRef } from "react";

import { useLandingReveal } from "../lib/use-landing-reveal";

import { ClosingSection } from "./ClosingSection";
import { FeaturesSection } from "./FeaturesSection";
import { HeroSection } from "./HeroSection";
import { LandingFooter } from "./LandingFooter";
import { LandingNav } from "./LandingNav";
import { PipelineSection } from "./PipelineSection";

/**
 * Vitrine de la plateforme. La page ne fait que composer les sections et
 * fournir le conteneur qui borne les animations : hors de ce `scope`, les
 * sélecteurs `data-reveal` du hook n'atteignent rien.
 */
export function LandingPage() {
  const container = useRef(null);

  useLandingReveal(container);

  return (
    <div ref={container}>
      <LandingNav />

      <main>
        <HeroSection />
        <FeaturesSection />
        <PipelineSection />
        <ClosingSection />
      </main>

      <LandingFooter />
    </div>
  );
}
