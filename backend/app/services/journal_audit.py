"""Lecture du journal d'audit pour l'administration.

Le journal (table `journal`) est la source ; on y ajoute les verdicts de la
relecture, qui vivent dans leur propre table (jamais modifiée). Chaque entrée
reçoit un libellé français et une catégorie, puis est rattachée à la SESSION
dans laquelle elle a eu lieu :

- exactement, si elle cite la session (« session:<id> » : connexion depuis
  le sprint 8, déconnexion) ;
- sinon, par période : la dernière session de son auteur ouverte avant elle ;
- les refus sans session (connexions refusées) forment un groupe
  « Tentatives de connexion » par compte ; les traitements de la plateforme
  (worker), un groupe à part.

Rien n'est écrit ici : on lit.
"""
import re
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, false, or_, select
from sqlalchemy.orm import Session

from .. import journal
from ..auth_models import Journal, Role, SessionUtilisateur, Utilisateur
from ..models import Analysis, Detection, Verdict
from ..schemas import _nom

CATEGORIES = ("Connexions et sécurité", "Comptes et rôles", "Analyses", "Relecture", "Comptes rendus",
              "Assistant documentaire", "Modèles", "Paramètres et exports")

# action -> (libellé, catégorie). Un test exige qu'aucune action journalisée n'en manque.
ACTIONS = {
    "connexion": ("Connexion", "Connexions et sécurité"),
    "deconnexion": ("Déconnexion", "Connexions et sécurité"),
    "verrouillage": ("Compte verrouillé après des échecs de connexion", "Connexions et sécurité"),
    "limite_depassee": ("Trop de demandes depuis un poste : demandes refusées une minute", "Connexions et sécurité"),
    "rattachement_google": ("Compte Google rattaché", "Connexions et sécurité"),
    "demande_reinitialisation": ("Demande de réinitialisation du mot de passe", "Connexions et sécurité"),
    "changement_mot_de_passe": ("Changement de mot de passe", "Connexions et sécurité"),
    "revocation_session": ("Session fermée à distance par son titulaire", "Connexions et sécurité"),
    "creation_compte": ("Création d’un compte", "Comptes et rôles"),
    "modification_compte": ("Modification d’un compte", "Comptes et rôles"),
    "renvoi_lien": ("Nouveau lien de première connexion", "Comptes et rôles"),
    "reinitialisation_par_admin": ("Réinitialisation du mot de passe par l’administrateur", "Comptes et rôles"),
    "revocation_sessions": ("Sessions d’un compte fermées par l’administrateur", "Comptes et rôles"),
    "creation_role": ("Création d’un rôle", "Comptes et rôles"),
    "modification_role": ("Modification d’un rôle", "Comptes et rôles"),
    "duplication_role": ("Duplication d’un rôle", "Comptes et rôles"),
    "suppression_role": ("Suppression d’un rôle", "Comptes et rôles"),
    "modification_profil": ("Modification de son profil", "Comptes et rôles"),
    "photo_profil": ("Photo de profil", "Comptes et rôles"),
    "import_analyse": ("Import d’une panoramique (anonymisée)", "Analyses"),
    "analyse_traitee": ("Analyse par le modèle terminée", "Analyses"),
    "analyse_echouee": ("Analyse par le modèle échouée", "Analyses"),
    "relance_analyse": ("Analyse relancée", "Analyses"),
    "rejeu_analyse": ("Analyse rejouée avec un autre modèle", "Analyses"),
    "suppression_analyse": ("Suppression d’une analyse", "Analyses"),
    "dent_absente": ("Dent déclarée absente", "Relecture"),
    "dent_absente_retiree": ("Déclaration d’absence retirée", "Relecture"),
    "cloture_analyse": ("Clôture de la relecture", "Relecture"),
    "reouverture_analyse": ("Réouverture d’une analyse", "Relecture"),
    "verdict_valider": ("Détection validée", "Relecture"),
    "verdict_corriger": ("Détection corrigée", "Relecture"),
    "verdict_rejeter": ("Détection rejetée", "Relecture"),
    "verdict_ajouter": ("Détection ajoutée par le praticien", "Relecture"),
    "compte_rendu_genere": ("Compte rendu affiché", "Comptes rendus"),
    "compte_rendu_telecharge": ("Compte rendu téléchargé", "Comptes rendus"),
    "question_assistant": ("Question à l’assistant documentaire", "Assistant documentaire"),
    "document_depose": ("Document ajouté à la base documentaire", "Assistant documentaire"),
    "document_remplace": ("Document de la base documentaire remplacé", "Assistant documentaire"),
    "document_reindexation": ("Réindexation demandée", "Assistant documentaire"),
    "document_supprime": ("Document retiré de la base documentaire", "Assistant documentaire"),
    "document_indexe": ("Document indexé", "Assistant documentaire"),
    "document_echec": ("Indexation d’un document échouée", "Assistant documentaire"),
    "conversation_effacee": ("Conversation avec l’assistant effacée", "Assistant documentaire"),
    "assistant_parametres": ("Réglages de la recherche de l’assistant", "Assistant documentaire"),
    "bascule_modele": ("Changement de la version du modèle", "Modèles"),
    "cabinet_parametres": ("Modification de l’en-tête du cabinet", "Paramètres et exports"),
    "cabinet_logo": ("Logo du cabinet", "Paramètres et exports"),
    "export_historique": ("Export de l’historique des analyses (CSV)", "Paramètres et exports"),
    "export_journal": ("Export du journal d’audit (CSV)", "Paramètres et exports"),
    "export_comptes": ("Export de la liste des comptes (CSV)", "Paramètres et exports"),
    "retention_journal": ("Durée de conservation du journal modifiée", "Paramètres et exports"),
    "purge_journal": ("Purge du journal (rétention)", "Paramètres et exports"),
}
TYPES_FR = {"tooth": "dent", "caries": "carie", "deep_caries": "carie profonde",
            "periapical_lesion": "lésion péri-apicale", "impacted_tooth": "dent incluse"}


def naif(dt: datetime | None) -> datetime | None:
    """UTC sans fuseau (le journal est horodaté avec fuseau, les verdicts sans)."""
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def poste(agent: str | None) -> str:
    """« Chrome · Windows » à partir du User-Agent (rien de plus précis n'est gardé)."""
    a = agent or ""
    navigateur = next((nom for motif, nom in ((r"Edg/", "Edge"), (r"OPR/|Opera", "Opera"), (r"Firefox/", "Firefox"),
                                               (r"Chrome/|Chromium/|HeadlessChrome", "Chrome"), (r"Safari/", "Safari"))
                       if re.search(motif, a)), None)
    systeme = next((nom for motif, nom in ((r"Windows", "Windows"), (r"Android", "Android"), (r"iPhone|iPad", "iOS"),
                                            (r"Mac OS X|Macintosh", "macOS"), (r"Linux", "Linux"))
                    if re.search(motif, a)), None)
    return " · ".join(x for x in (navigateur, systeme) if x) or "Poste inconnu"


# Motifs de refus écrits par le serveur (codes) -> français. Seul le premier mot
# compte : certains motifs sont suivis d'un contexte technique (« adresse=… »).
MOTIFS = {
    "adresse_inconnue": "adresse inconnue",
    "mot_de_passe_faux": "mot de passe incorrect",
    "mot_de_passe_non_defini": "mot de passe pas encore choisi",
    "mode_non_autorise": "mode de connexion non autorisé pour ce compte",
    "compte_desactive": "compte désactivé",
    "compte_verrouille": "compte verrouillé",
    "domaine_refuse": "domaine de messagerie refusé",
    "sub_different": "autre identité Google que celle rattachée",
    "adresse_differente": "adresse Google différente de celle du compte",
    "autre_compte_google_deja_rattache": "un autre compte Google est déjà rattaché",
    "compte_google_deja_utilise": "ce compte Google est déjà utilisé",
    "lien_deja_utilise": "lien déjà utilisé",
    "lien_expire": "lien expiré",
    "lien_inexistant": "lien inconnu",
    "type_different": "lien d’un autre usage",
    "ancien_incorrect": "ancien mot de passe incorrect",
}


def motif_lisible(motif: str) -> str:
    code = str(motif).split()[0] if str(motif).strip() else ""
    return MOTIFS.get(code, code.replace("_", " ") or str(motif))


def _precision(action: str, d: dict) -> str | None:
    """Détail lisible, à partir des seuls champs connus (jamais un jeton ni un mot de passe)."""
    if action == "question_assistant":
        question = str(d.get("question") or "")
        question = question if len(question) <= 80 else question[:79].rstrip() + "…"
        statut = {"reponse": "réponse", "refus": "sans réponse", "echec": "échec",
                  "interrompue": "interrompue"}.get(d.get("statut"), "?")
        n = len(d.get("sources") or [])
        sources = f" · {n} source{'s' if n > 1 else ''}" if n else ""
        return f"« {question} » · {statut}{sources}"
    if action.startswith("document_") and d.get("titre"):
        if action == "document_echec":
            return f"« {d['titre']} » · {d.get('erreur') or 'échec'}"
        if action == "document_indexe":
            return f"« {d['titre']} » · {d.get('passages', 0)} passages"
        return f"« {d['titre']} »"
    if action == "document_reindexation" and "documents" in d:
        return f"{d['documents']} document{'s' if d['documents'] > 1 else ''}"
    if action == "retention_journal" and "apres" in d:
        return f"{d.get('avant')} → {d['apres']} jours"
    if action == "purge_journal" and "lignes" in d:
        return f"{d['lignes']} entrée{'s' if d['lignes'] > 1 else ''} antérieure{'s' if d['lignes'] > 1 else ''} au {d.get('date_limite', '?')[:10]} · conservation {d.get('retention_jours')} jours"
    if action == "conversation_effacee" and "messages" in d:
        return f"{d['messages']} message{'s' if d['messages'] > 1 else ''}"
    if action == "assistant_parametres":
        return f"{d.get('passages')} passages · seuil {d.get('seuil')}"
    if action == "connexion":
        mode = "Avec Google" if d.get("mode") == "google" else "Par e-mail et mot de passe"
        return f"{mode} · {motif_lisible(d['motif'])}" if d.get("motif") else mode   # refus : le motif
    if d.get("motif"):
        # Réouverture, bascule : motif saisi par une personne ; refus : code du serveur.
        motif = d["motif"]
        return f"Motif : {motif_lisible(motif) if (str(motif).split() or [''])[0] in MOTIFS else motif}"
    if action in ("dent_absente", "dent_absente_retiree") and d.get("fdi"):
        return f"Dent {d['fdi']}"
    if action == "analyse_traitee":
        return f"Modèle {d.get('modele', '?')} · {d.get('detections', 0)} détections"
    if action == "analyse_echouee":
        return d.get("erreur")
    if action == "cabinet_parametres" and d.get("champs"):
        return "Champs : " + ", ".join(d["champs"])
    if action.startswith("export_") and "lignes" in d:
        return f"{d['lignes']} ligne{'s' if d['lignes'] > 1 else ''}"
    if action == "bascule_modele" and d.get("version"):
        return f"Version {d['version']}"
    return None


def _cible(cible: str | None, details: dict, references: dict, noms: dict, roles: dict) -> str | None:
    if not cible:
        return None
    genre, _, ident = cible.partition(":")
    if genre == "analyse":
        ref = references.get(ident) or details.get("reference")
        return f"Analyse {ref}" if ref else "Analyse supprimée"
    if genre == "utilisateur":
        return f"Compte {noms.get(ident) or 'supprimé'}"
    if genre == "role":
        return f"Rôle « {roles.get(ident) or details.get('libelle') or '?'} »"
    if genre == "session":
        return None
    if genre == "document":
        return "Base documentaire"   # le titre figure dans le détail
    return cible


def curseur_de(entree: dict) -> str:
    """Curseur de pagination par clé : (date, identifiant) de la dernière entrée lue."""
    return f"{entree['date'].isoformat()}|{entree['id']}"


def lire_curseur(curseur: str | None) -> tuple[datetime, str] | None:
    if not curseur:
        return None
    date, _, ident = curseur.partition("|")
    try:
        return naif(datetime.fromisoformat(date)), ident
    except ValueError as exc:
        raise ValueError("Curseur de pagination invalide.") from exc


def _avant(x: dict, cle: tuple[datetime, str] | None) -> bool:
    """Strictement plus ancienne que le curseur, dans l'ordre (date, id) décroissant."""
    return cle is None or (x["date"], x["id"]) < cle


def lire(db: Session, *, depuis: datetime, auteur: uuid.UUID | None = None, categorie: str | None = None,
         echecs: bool | None = None, action: str | None = None, cible: str | None = None,
         avant: str | None = None, limite: int = 500) -> dict:
    """Entrées du journal et verdicts depuis `depuis` (UTC naïf), filtrées, groupées par session.

    Pagination par clé : `avant` est le curseur (date, identifiant) de la
    dernière entrée de la page précédente ; seules les entrées plus anciennes
    sont lues, au moyen de l'index sur la date, sans décalage. `suivant` vaut le
    curseur de la page d'après, ou None s'il n'y a plus rien."""
    cle = lire_curseur(avant)
    q = select(Journal).where(Journal.horodatage >= depuis.replace(tzinfo=timezone.utc))
    if cle:
        # Clé (date, identifiant) : à date égale, « j:… » précède « v:… » dans l'ordre décroissant.
        d, ident = cle[0].replace(tzinfo=timezone.utc), cle[1]
        if ident.startswith("j:"):
            q = q.where(or_(Journal.horodatage < d, and_(Journal.horodatage == d, Journal.id < uuid.UUID(ident[2:]))))
        else:
            q = q.where(Journal.horodatage <= d)
    if auteur:
        q = q.where(Journal.utilisateur_id == auteur)
    if action:
        q = q.where(Journal.action == action)
    lignes_journal = list(db.scalars(q.order_by(Journal.horodatage.desc(), Journal.id.desc()).limit(limite + 1)))
    brutes = [("journal", e) for e in lignes_journal]
    qv = select(Verdict).where(Verdict.cree_le >= depuis)
    if cle:
        if cle[1].startswith("v:"):
            qv = qv.where(or_(Verdict.cree_le < cle[0], and_(Verdict.cree_le == cle[0], Verdict.id < cle[1][2:])))
        else:
            qv = qv.where(Verdict.cree_le < cle[0])
    if action:
        qv = qv.where(Verdict.action == action.removeprefix("verdict_")) if action.startswith("verdict_") \
            else qv.where(false())
    if auteur:
        qv = qv.where(Verdict.auteur_id == auteur)
    lignes_verdicts = list(db.scalars(qv.order_by(Verdict.cree_le.desc(), Verdict.id.desc()).limit(limite + 1)))
    brutes += [("verdict", v) for v in lignes_verdicts]
    # Une source a atteint son plafond : la période est incomplète, quel que soit le filtre ensuite.
    source_pleine = len(lignes_journal) > limite or len(lignes_verdicts) > limite

    # Référentiels pour les libellés.
    ids_analyses = {e.cible.partition(":")[2] for t, e in brutes if t == "journal" and (e.cible or "").startswith("analyse:")}
    detections = {d.id: d for d in db.scalars(select(Detection).where(
        Detection.id.in_({v.detection_id for t, v in brutes if t == "verdict"})))}
    ids_analyses |= {d.analysis_id for d in detections.values()}
    references = {a.id: a.reference for a in db.scalars(select(Analysis).where(Analysis.id.in_(ids_analyses)))}
    utilisateurs = {str(u.id): u for u in db.scalars(select(Utilisateur))}
    noms = {k: _nom(u) for k, u in utilisateurs.items()}
    roles = {str(r.id): r.libelle for r in db.scalars(select(Role))}

    entrees = []
    for t, e in brutes:
        if t == "journal":
            d = e.details or {}
            libelle, cat = ACTIONS.get(e.action, (e.action.replace("_", " "), "Autres"))
            entrees.append({
                "id": f"j:{e.id}",
                "date": naif(e.horodatage), "action": e.action, "libelle": libelle, "categorie": cat,
                "resultat": e.resultat, "ok": e.resultat == journal.SUCCES,
                "utilisateur_id": str(e.utilisateur_id) if e.utilisateur_id else None,
                "cible": _cible(e.cible, d, references, noms, roles), "precision": _precision(e.action, d),
                "session": e.cible.partition(":")[2] if (e.cible or "").startswith("session:") else None,
                "ip": e.ip,
            })
        else:
            det = detections.get(e.detection_id)
            ref = references.get(det.analysis_id) if det else None
            quoi = f"{TYPES_FR.get(e.label, e.label)}{f', dent {e.fdi}' if e.fdi else ''}"
            libelle, cat = ACTIONS[f"verdict_{e.action}"]
            entrees.append({
                "id": f"v:{e.id}",
                "date": e.cree_le, "action": f"verdict_{e.action}", "libelle": libelle, "categorie": cat,
                "resultat": journal.SUCCES, "ok": True,
                "utilisateur_id": str(e.auteur_id) if e.auteur_id else None,
                "cible": f"Analyse {ref}" if ref else "Analyse supprimée",
                "precision": quoi + (f" — « {e.commentaire} »" if e.commentaire else "")
                             + (" (annulé ensuite)" if e.annule_le else ""),
                "session": None, "ip": None,
            })

    entrees = [x for x in entrees if _avant(x, cle)]
    if categorie:
        entrees = [x for x in entrees if x["categorie"] == categorie]
    if echecs is not None:
        entrees = [x for x in entrees if x["ok"] != echecs]
    if cible:
        aiguille = cible.strip().lower()
        entrees = [x for x in entrees if aiguille in f"{x['cible'] or ''} {x['precision'] or ''}".lower()]
    entrees.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
    tronque = source_pleine or len(entrees) > limite
    entrees = entrees[:limite]
    suivant = curseur_de(entrees[-1]) if tronque and entrees else None

    # Sessions des auteurs concernés, pour le rattachement par période.
    auteurs = {x["utilisateur_id"] for x in entrees if x["utilisateur_id"]}
    sessions = list(db.scalars(select(SessionUtilisateur).where(
        SessionUtilisateur.utilisateur_id.in_({uuid.UUID(a) for a in auteurs}))))
    par_id = {str(s.id): s for s in sessions}
    par_auteur = defaultdict(list)
    for s in sessions:
        par_auteur[str(s.utilisateur_id)].append(s)
    for liste in par_auteur.values():
        liste.sort(key=lambda s: naif(s.cree_le))

    def session_de(x) -> str | None:
        if x["session"] in par_id:
            return x["session"]
        if not x["utilisateur_id"]:
            return None
        avant = [s for s in par_auteur.get(x["utilisateur_id"], []) if naif(s.cree_le) <= x["date"] + timedelta(seconds=2)]
        if not avant:
            return None
        s = avant[-1]
        fin = naif(s.revoquee_le) or naif(s.expire_le)
        return str(s.id) if fin is None or x["date"] <= fin + timedelta(seconds=2) else None

    maintenant = datetime.now(timezone.utc).replace(tzinfo=None)
    groupes: dict[str, dict] = {}
    for x in entrees:
        sid = session_de(x)
        if sid:
            cle = f"session:{sid}"
        elif not x["utilisateur_id"]:
            cle = "plateforme" if x["ok"] else "tentatives:anonyme"
        elif not x["ok"]:
            cle = f"tentatives:{x['utilisateur_id']}"
        else:
            cle = f"hors-session:{x['utilisateur_id']}"
        g = groupes.get(cle)
        if g is None:
            s = par_id.get(sid) if sid else None
            uid = x["utilisateur_id"]
            if s is not None:
                etat = "closed" if s.revoquee_le else ("expired" if naif(s.expire_le) < maintenant else "active")
            else:
                etat = "none"
            g = groupes[cle] = {
                "id": cle,
                "utilisateur": {"id": uid, "nom": noms.get(uid) if uid else
                                ("Plateforme" if cle == "plateforme" else "Non authentifié")},
                "titre": {"plateforme": "Traitements de la plateforme"}.get(cle) or
                         ("Tentatives de connexion" if cle.startswith("tentatives:") else
                          "Actions hors session identifiée" if cle.startswith("hors-session:") else None),
                "poste": poste(s.agent) if s is not None else None,
                "ip": s.ip if s is not None else None,
                "methode": None,
                "etat": etat,
                "ouverte_le": naif(s.cree_le) if s is not None else None,
                "fermee_le": naif(s.revoquee_le) if s is not None else None,
                "entrees": [],
            }
        if x["action"] == "connexion" and x["ok"] and g["methode"] is None:
            g["methode"] = "google" if (x["precision"] or "").startswith("Avec Google") else "mot_de_passe"
        g["entrees"].append({k: x[k] for k in ("id", "date", "action", "libelle", "categorie", "resultat", "ok",
                                               "cible", "precision", "ip")})

    # À horodatage égal (horloge grossière, actions dans la même requête), la
    # connexion ouvre la session et la déconnexion la ferme.
    rang = {"connexion": 0, "deconnexion": 2}
    for g in groupes.values():
        g["entrees"].sort(key=lambda x: (x["date"], rang.get(x["action"], 1)))
        g["derniere"] = g["entrees"][-1]["date"]
    ordre = sorted(groupes.values(), key=lambda g: g["derniere"], reverse=True)
    presents = sorted({(x["utilisateur_id"], noms.get(x["utilisateur_id"])) for x in entrees if x["utilisateur_id"]},
                      key=lambda a: (a[1] or "").lower())
    return {
        "total": len(entrees), "tronque": tronque, "suivant": suivant, "categories": list(CATEGORIES),
        "actions": [{"code": c, "libelle": l, "categorie": cat} for c, (l, cat) in ACTIONS.items()],
        "auteurs": [{"id": i, "nom": n} for i, n in presents],
        "sessions": ordre,
    }


def detail(db: Session, ident: str) -> dict | None:
    """Une entrée avec son contexte complet : tout ce que le journal a gardé
    (jamais de jeton ni de mot de passe : ils n'y sont pas écrits), la session
    et le poste, l'auteur. Lecture seule : aucune route ne modifie une entrée."""
    genre, _, cle = ident.partition(":")
    if genre == "j":
        try:
            e = db.get(Journal, uuid.UUID(cle))
        except ValueError:
            return None
        if e is None:
            return None
        d = e.details or {}
        auteur = db.get(Utilisateur, e.utilisateur_id) if e.utilisateur_id else None
        session = None
        if (e.cible or "").startswith("session:"):
            try:
                session = db.get(SessionUtilisateur, uuid.UUID(e.cible.partition(":")[2]))
            except ValueError:
                session = None
        ids = {e.cible.partition(":")[2]} if (e.cible or "").startswith("analyse:") else set()
        references = {a.id: a.reference for a in db.scalars(select(Analysis).where(Analysis.id.in_(ids)))}
        noms = {str(u.id): _nom(u) for u in db.scalars(select(Utilisateur))}
        roles = {str(r.id): r.libelle for r in db.scalars(select(Role))}
        libelle, cat = ACTIONS.get(e.action, (e.action.replace("_", " "), "Autres"))
        return {
            "id": ident, "source": "journal", "date": naif(e.horodatage), "action": e.action, "libelle": libelle,
            "categorie": cat, "resultat": e.resultat, "ok": e.resultat == journal.SUCCES,
            "auteur": {"id": str(auteur.id), "nom": _nom(auteur), "email": auteur.email} if auteur else None,
            "cible": _cible(e.cible, d, references, noms, roles), "cible_brute": e.cible,
            "precision": _precision(e.action, d), "details": d, "ip": e.ip,
            "session": {"id": str(session.id), "poste": poste(session.agent), "ip": session.ip,
                        "ouverte_le": naif(session.cree_le), "fermee_le": naif(session.revoquee_le)}
            if session is not None else None,
        }
    if genre == "v":
        v = db.get(Verdict, cle)
        if v is None:
            return None
        det = db.get(Detection, v.detection_id)
        a = db.get(Analysis, det.analysis_id) if det else None
        auteur = db.get(Utilisateur, v.auteur_id) if v.auteur_id else None
        libelle, cat = ACTIONS[f"verdict_{v.action}"]
        return {
            "id": ident, "source": "verdict", "date": v.cree_le, "action": f"verdict_{v.action}", "libelle": libelle,
            "categorie": cat, "resultat": journal.SUCCES, "ok": True,
            "auteur": {"id": str(auteur.id), "nom": _nom(auteur), "email": auteur.email} if auteur else None,
            "cible": f"Analyse {a.reference}" if a else "Analyse supprimée", "cible_brute": f"analyse:{a.id}" if a else None,
            "precision": f"{TYPES_FR.get(v.label, v.label)}{f', dent {v.fdi}' if v.fdi else ''}",
            "details": {"type": v.label, "dent": v.fdi, "cadre": {"x": v.x, "y": v.y, "w": v.w, "h": v.h},
                        "commentaire": v.commentaire or None,
                        "annule_le": v.annule_le.isoformat() if v.annule_le else None},
            "ip": None, "session": None,
        }
    return None
