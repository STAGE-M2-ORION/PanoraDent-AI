import { useRouter } from "next/router";
import { useEffect } from "react";

/** Ancienne adresse : le parcours « mot de passe oublié » vit dans la carte de connexion. */
export default function MotDePasse() {
  const router = useRouter();
  useEffect(() => {
    router.replace({ pathname: "/connexion", query: { etat: "oubli" } });
  }, [router]);
  return null;
}
