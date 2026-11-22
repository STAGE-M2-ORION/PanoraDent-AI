/** Catégories d'erreur exposées à l'UI, indépendantes du client HTTP. */
export const ErrorCode = {
  NETWORK: "network",
  TIMEOUT: "timeout",
  VALIDATION: "validation",
  NOT_FOUND: "not_found",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  CONFLICT: "conflict",
  SERVER: "server",
  UNKNOWN: "unknown",
};

const DEFAULT_MESSAGES = {
  [ErrorCode.NETWORK]: "Backend injoignable. Vérifiez que la stack est démarrée.",
  [ErrorCode.TIMEOUT]: "Le serveur met trop de temps à répondre. Réessayez.",
  [ErrorCode.VALIDATION]: "Données invalides.",
  [ErrorCode.NOT_FOUND]: "Ressource introuvable.",
  [ErrorCode.UNAUTHORIZED]: "Votre session a expiré. Reconnectez-vous.",
  [ErrorCode.FORBIDDEN]: "Votre rôle ne permet pas cette action.",
  [ErrorCode.CONFLICT]: "Cet élément existe déjà.",
  [ErrorCode.SERVER]: "Erreur du serveur pendant le traitement.",
  [ErrorCode.UNKNOWN]: "Une erreur inattendue est survenue.",
};

/**
 * Erreur normalisée : l'UI n'a jamais à connaître la forme d'une erreur axios.
 *
 * - `code` : catégorie (`ErrorCode`), déduite du statut HTTP ;
 * - `serverCode` : code métier renvoyé par le backend (`adresse_deja_prise`,
 *   `dernier_administrateur`, `non_authentifie`…), `null` sans corps JSON ;
 * - `details` : précisions éventuelles du backend (champs invalides…).
 */
export class AppError extends Error {
  constructor(code, message, { cause, serverCode = null, status = null, details } = {}) {
    super(message ?? DEFAULT_MESSAGES[code] ?? DEFAULT_MESSAGES[ErrorCode.UNKNOWN]);
    this.name = "AppError";
    this.code = code;
    this.serverCode = serverCode;
    this.status = status;
    this.details = details;
    this.cause = cause;
  }
}

function codeFromStatus(status) {
  if (status === 400 || status === 422) return ErrorCode.VALIDATION;
  if (status === 401) return ErrorCode.UNAUTHORIZED;
  if (status === 403) return ErrorCode.FORBIDDEN;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 409) return ErrorCode.CONFLICT;
  if (status >= 500) return ErrorCode.SERVER;
  return ErrorCode.UNKNOWN;
}

/**
 * Convertit n'importe quelle exception en `AppError`.
 *
 * Le backend renvoie toute erreur sous la forme
 * `{ "code": "…", "message": "…", "details"?: … }` : `message` est en français
 * et s'affiche tel quel ; à défaut, on retombe sur le message générique de la
 * catégorie (erreur réseau, proxy, page HTML d'erreur…).
 */
export function toAppError(error) {
  if (error instanceof AppError) return error;

  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
    return new AppError(ErrorCode.TIMEOUT, undefined, { cause: error });
  }

  const response = error?.response;
  if (!response) {
    return new AppError(ErrorCode.NETWORK, undefined, { cause: error });
  }

  const body = response.data && typeof response.data === "object" ? response.data : {};
  const message = typeof body.message === "string" && body.message.trim() ? body.message : undefined;
  return new AppError(codeFromStatus(response.status), message, {
    cause: error,
    serverCode: typeof body.code === "string" ? body.code : null,
    status: response.status,
    details: body.details,
  });
}
