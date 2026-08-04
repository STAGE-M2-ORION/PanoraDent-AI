/**
 * API publique transverse (notation `@x` de FSD) : la seule porte d'entrée
 * autorisée pour `entities/analysis`, qui compose des détections dans son
 * propre modèle. Les autres slices passent par `entities/detection`.
 */
export { normalizeDetection } from "../model/detection";
