import { useRouter } from "next/router";
import { useEffect } from "react";

/** Ancienne adresse de connexion, conservée pour les liens existants. */
export default function Login() {
  const router = useRouter();
  useEffect(() => {
    if (router.isReady) router.replace({ pathname: "/connexion", query: router.query });
  }, [router]);
  return null;
}
