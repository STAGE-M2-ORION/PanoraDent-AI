"""Catalogue des permissions et rôles système (RBAC).

Une permission est une capacité atomique `ressource:action`. Un rôle est un
ensemble de permissions ; un utilisateur porte exactement un rôle.

Les permissions sont fixées par le code : une route ne peut exiger qu'un code
de ce catalogue. Les rôles, eux, sont paramétrables par un administrateur
(sauf les rôles système, protégés contre la suppression et le renommage).
"""

ANALYSIS_CREATE = "analysis:create"
ANALYSIS_READ = "analysis:read"
ANALYSIS_DELETE = "analysis:delete"
DETECTION_REVIEW = "detection:review"
ANALYSIS_REOPEN = "analysis:reopen"
REPORT_GENERATE = "report:generate"
MODEL_READ = "model:read"
MODEL_MANAGE = "model:manage"
USER_MANAGE = "user:manage"
ROLE_MANAGE = "role:manage"
CABINET_MANAGE = "cabinet:manage"

# code -> libellé affiché dans l'interface d'administration.
PERMISSIONS: dict[str, str] = {
    ANALYSIS_CREATE: "Importer une panoramique et lancer une analyse",
    ANALYSIS_READ: "Consulter les analyses et leurs détections",
    ANALYSIS_DELETE: "Supprimer une analyse",
    DETECTION_REVIEW: "Valider, corriger ou ajouter des détections",
    ANALYSIS_REOPEN: "Rouvrir une analyse clôturée",
    REPORT_GENERATE: "Générer le rapport PDF d'une analyse",
    MODEL_READ: "Consulter les versions de modèle et leurs métriques",
    MODEL_MANAGE: "Activer une version de modèle (bascule)",
    USER_MANAGE: "Gérer les comptes utilisateurs",
    ROLE_MANAGE: "Gérer les rôles et leurs permissions",
    CABINET_MANAGE: "Modifier les paramètres du cabinet (en-tête des comptes rendus)",
}

# Libellés des trois rôles système (colonne `role.libelle`).
ADMIN_ROLE = "Administrateur"
PRACTITIONER_ROLE = "Praticien"
VIEWER_ROLE = "Lecteur"

# Permissions qui, ensemble, permettent de continuer à administrer la
# plateforme. Un « administrateur » au sens des garde-fous (dernier admin) est
# un compte actif dont le rôle porte les deux.
ADMIN_CAPABILITIES = frozenset({USER_MANAGE, ROLE_MANAGE})

# libellé -> permissions
SYSTEM_ROLE_DESCRIPTIONS: dict[str, str] = {
    ADMIN_ROLE: "Gère les comptes, les rôles et la supervision de la plateforme.",
    PRACTITIONER_ROLE: "Dépose, relit et clôture ses analyses, génère les comptes rendus.",
    VIEWER_ROLE: "Consulte les analyses et la performance du modèle, en lecture seule.",
}

SYSTEM_ROLES: dict[str, frozenset[str]] = {
    ADMIN_ROLE: frozenset(PERMISSIONS),
    PRACTITIONER_ROLE: frozenset({
        ANALYSIS_CREATE, ANALYSIS_READ, ANALYSIS_DELETE,
        DETECTION_REVIEW, REPORT_GENERATE, MODEL_READ,
    }),
    VIEWER_ROLE: frozenset({ANALYSIS_READ, MODEL_READ}),
}
