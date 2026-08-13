// PAGE TEMPORAIRE DE VERIFICATION VISUELLE — a supprimer.
// Usage : /ds-all?panel=forms  (rendu client, un seul panneau a la fois)
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BasePanel } from "@/views/design-system/ui/BasePanel";
import { DataPanel } from "@/views/design-system/ui/DataPanel";
import { FeedbackPanel } from "@/views/design-system/ui/FeedbackPanel";
import { FormsPanel } from "@/views/design-system/ui/FormsPanel";
import { NavigationPanel } from "@/views/design-system/ui/NavigationPanel";
import { OverlaysPanel } from "@/views/design-system/ui/OverlaysPanel";

const PANELS = {
  base: BasePanel,
  forms: FormsPanel,
  data: DataPanel,
  navigation: NavigationPanel,
  overlays: OverlaysPanel,
  feedback: FeedbackPanel,
};

export default function DsAll() {
  const [name, setName] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const param = params.get("panel");
    setName(param && PANELS[param] ? param : "base");

    // Verifie le montage du Toaster dans AppProvider.
    if (params.get("toast")) {
      toast.success("Rapport PDF genere", { description: "Disponible une heure." });
      toast.error("Echec de l'analyse", { description: "Backend injoignable." });
    }
  }, []);

  if (!name) return null;
  const Panel = PANELS[name];

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h2 className="mb-6 text-2xl font-bold text-primary">### {name} ###</h2>
      <Panel />
    </main>
  );
}
