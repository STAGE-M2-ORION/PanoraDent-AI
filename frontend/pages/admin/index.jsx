import { useRouter } from "next/router";
import { useEffect } from "react";

/** `/admin` → première page d'administration. */
export default function AdminIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/comptes");
  }, [router]);
  return null;
}
