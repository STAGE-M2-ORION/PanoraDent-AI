/** Catégories d'erreur exposées à l'UI, indépendantes du client HTTP. */
export const ErrorCode = {
  NETWORK: "network",
  TIMEOUT: "timeout",
  VALIDATION: "validation",
  NOT_FOUND: "not_found",
  SERVER: "server",
  UNKNOWN: "unknown",
};

const DEFAULT_MESSAGES = {
  [ErrorCode.NETWORK]: "Backend injoignable. Vérifiez que la stack est démarrée.",
  [ErrorCode.TIMEOUT]: "Le serveur met trop de temps à répondre. Réessayez.",
  [ErrorCode.VALIDATION]: "Fichier invalide ou illisible.",
  [ErrorCode.NOT_FOUND]: "Ressource introuvable.",
  [ErrorCode.SERVER]: "Erreur du serveur pendant le traitement.",
  [ErrorCode.UNKNOWN]: "Une erreur inattendue est survenue.",
};

/** Erreur normalisée : l'UI n'a jamais à connaître la forme d'une erreur axios. */
export class AppError extends Error {
  constructor(code, message, cause) {
    super(message ?? DEFAULT_MESSAGES[code] ?? DEFAULT_MESSAGES[ErrorCode.UNKNOWN]);
    this.name = "AppError";
    this.code = code;
    this.cause = cause;
  }
}

function codeFromStatus(status) {
  if (status === 400 || status === 422) return ErrorCode.VALIDATION;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status >= 500) return ErrorCode.SERVER;
  return ErrorCode.UNKNOWN;
}

/**
 * Convertit n'importe quelle exception en `AppError`. Le `detail` renvoyé par
 * FastAPI est repris tel quel quand il est présent, sinon on retombe sur le
 * message générique de la catégorie.
 */
export function toAppError(error) {
  if (error instanceof AppError) return error;

  if (error?.code === "ECONNABORTED") {
    return new AppError(ErrorCode.TIMEOUT, undefined, error);
  }

  const response = error?.response;
  if (!response) {
    return new AppError(ErrorCode.NETWORK, undefined, error);
  }

  const detail = response.data?.detail;
  const message = typeof detail === "string" ? detail : undefined;
  return new AppError(codeFromStatus(response.status), message, error);
}
