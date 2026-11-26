import Link from "next/link";

import { Permission, useCurrentUser } from "@/entities/session";
import { serviceAlerts, useSystemStatus } from "@/entities/system-status";
import { Icon } from "@/shared/ui";

/**
 * Bandeau des services dégradés (sprint 11), sur toutes les pages : une phrase
 * par incident, qui dit ce qu'il change pour l'utilisateur. Relu toutes les
 * 30 s ; il disparaît de lui-même au retour à la normale. Les administrateurs
 * ont en plus un lien vers la supervision.
 */
export function ServiceAlerts() {
  const status = useSystemStatus();
  const { can } = useCurrentUser();
  const alerts = serviceAlerts(status);
  if (!alerts.length) return null;
  const tone = alerts.some((a) => a.tone === "danger") ? "danger" : "warning";
  return (
    <div className={`service-alerts ${tone}`} role="status" aria-live="polite" data-testid="alerte-services">
      <Icon name="alert" />
      <div>
        {alerts.map((a) => (
          <p key={a.key}>{a.text}</p>
        ))}
      </div>
      {can(Permission.USER_MANAGE) ? (
        <Link className="service-alerts-link" href="/admin/supervision">
          Voir la supervision
        </Link>
      ) : null}
    </div>
  );
}
