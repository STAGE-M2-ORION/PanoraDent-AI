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
REPORT_GENERATE = "report:generate"
MODEL_READ = "model:read"
USER_MANAGE = "user:manage"
ROLE_MANAGE = "role:manage"

# code -> description affichée dans l'interface d'administration.
PERMISSIONS: dict[str, str] = {
    ANALYSIS_CREATE: "Importer une panoramique et lancer une analyse",
    ANALYSIS_READ: "Consulter les analyses et leurs détections",
    ANALYSIS_DELETE: "Supprimer une analyse",
    DETECTION_REVIEW: "Valider, corriger ou ajouter des détections",
    REPORT_GENERATE: "Générer le rapport PDF d'une analyse",
    MODEL_READ: "Consulter les versions de modèle et leurs métriques",
    USER_MANAGE: "Gérer les comptes utilisateurs",
    ROLE_MANAGE: "Gérer les rôles et leurs permissions",
}

ADMIN_ROLE = "admin"
PRACTITIONER_ROLE = "practitioner"
VIEWER_ROLE = "viewer"

# Permissions qui, ensemble, permettent de continuer à administrer la
# plateforme. Un « administrateur » au sens des garde-fous (dernier admin) est
# un compte actif dont le rôle porte les deux.
ADMIN_CAPABILITIES = frozenset({USER_MANAGE, ROLE_MANAGE})

# nom -> (description, permissions)
SYSTEM_ROLES: dict[str, tuple[str, frozenset[str]]] = {
    ADMIN_ROLE: (
        "Administrateur : toutes les permissions",
        frozenset(PERMISSIONS),
    ),
    PRACTITIONER_ROLE: (
        "Praticien : analyse, revue des détections et rapports",
        frozenset({
            ANALYSIS_CREATE, ANALYSIS_READ, ANALYSIS_DELETE,
            DETECTION_REVIEW, REPORT_GENERATE, MODEL_READ,
        }),
    ),
    VIEWER_ROLE: (
        "Lecteur : consultation seule",
        frozenset({ANALYSIS_READ, MODEL_READ}),
    ),
}
