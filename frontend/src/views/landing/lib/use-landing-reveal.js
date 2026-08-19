import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Import **nommé** obligatoire : au prérendu, webpack résout la build CJS de
 * gsap, dont l'export par défaut est l'espace de noms du module — `gsap.
 * registerPlugin` y est introuvable et le build échoue.
 *
 * L'enregistrement vit au niveau module : sans lui, un bundler agressif peut
 * écarter les plugins, jamais référencés autrement que par leur effet de bord.
 */
gsap.registerPlugin(useGSAP, ScrollTrigger);

const EASE = "power2.out";

/** Déclenche la révélation quand l'élément entre dans les 85 % du viewport. */
const ON_ENTER = { start: "top 85%", once: true };

/**
 * Animations de la vitrine, pilotées par attributs `data-reveal` :
 *
 * | Valeur    | Effet |
 * |-----------|-------|
 * | `hero`    | enfants directs décalés au chargement |
 * | `frame`   | visuel d'en-tête, fondu + léger zoom |
 * | `box`     | boîtes de détection, apparition rebondie |
 * | `scan`    | ligne de balayage, boucle infinie |
 * | `section` | l'élément monte en fondu au défilement |
 * | `stagger` | enfants directs décalés au défilement |
 *
 * **Toutes les animations sont des `from`** : l'état final est celui du DOM
 * rendu. Sans JavaScript — ou si GSAP échoue — la page reste entièrement
 * lisible, au prix d'un état initial non masqué avant hydratation.
 *
 * `matchMedia` court-circuite l'ensemble sous `prefers-reduced-motion`, où le
 * DOM statique fait déjà le bon rendu.
 */
export function useLandingReveal(scope) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from('[data-reveal="hero"] > *', {
          y: 24,
          autoAlpha: 0,
          duration: 0.7,
          ease: EASE,
          stagger: 0.09,
        });

        gsap.from('[data-reveal="frame"]', {
          autoAlpha: 0,
          scale: 0.96,
          duration: 0.9,
          ease: EASE,
          delay: 0.1,
        });

        gsap.from('[data-reveal="box"]', {
          autoAlpha: 0,
          scale: 0.8,
          duration: 0.5,
          ease: "back.out(1.7)",
          stagger: 0.16,
          delay: 0.7,
        });

        /*
         * La ligne fait 1 px de large : `xPercent` serait sans effet. La valeur
         * est donc fonctionnelle et relue à chaque `invalidate`, ce qui suit le
         * redimensionnement du cadre.
         */
        gsap.fromTo(
          '[data-reveal="scan"]',
          { x: 0 },
          {
            x: (_, target) => target.parentElement.clientWidth,
            duration: 2.8,
            ease: "none",
            repeat: -1,
            repeatDelay: 1.4,
            delay: 1.2,
          },
        );

        gsap.utils.toArray('[data-reveal="section"]').forEach((section) => {
          gsap.from(section, {
            y: 32,
            autoAlpha: 0,
            duration: 0.7,
            ease: EASE,
            scrollTrigger: { trigger: section, ...ON_ENTER },
          });
        });

        gsap.utils.toArray('[data-reveal="stagger"]').forEach((group) => {
          gsap.from(group.children, {
            y: 28,
            autoAlpha: 0,
            duration: 0.6,
            ease: EASE,
            stagger: 0.08,
            scrollTrigger: { trigger: group, ...ON_ENTER },
          });
        });
      });

      return () => mm.revert();
    },
    { scope },
  );
}
