import uuid
from datetime import date, datetime
from sqlalchemy import (
    JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base
from .vecteurs import Vecteur


def _uuid() -> str:
    return str(uuid.uuid4())


class StatutAnalyse:
    """Cycle de vie d'une analyse dans la file de traitement."""
    EN_FILE = "en_file"        # image stockée, en attente du worker
    EN_COURS = "en_cours"      # prise par le worker
    TERMINEE = "terminee"      # détections enregistrées
    ECHOUEE = "echouee"        # erreur : message, relance possible
    TOUS = (EN_FILE, EN_COURS, TERMINEE, ECHOUEE)


class EtatDetection:
    """Verdict courant du praticien sur une détection."""
    A_REVOIR = "a_revoir"
    VALIDEE = "validee"
    CORRIGEE = "corrigee"
    REJETEE = "rejetee"
    TOUS = (A_REVOIR, VALIDEE, CORRIGEE, REJETEE)


class ActionVerdict:
    VALIDER = "valider"
    CORRIGER = "corriger"
    REJETER = "rejeter"
    AJOUTER = "ajouter"      # détection tracée par le praticien
    TOUTES = (VALIDER, CORRIGER, REJETER, AJOUTER)


ETAT_DE_L_ACTION = {
    ActionVerdict.VALIDER: EtatDetection.VALIDEE,
    ActionVerdict.CORRIGER: EtatDetection.CORRIGEE,
    ActionVerdict.REJETER: EtatDetection.REJETEE,
    ActionVerdict.AJOUTER: EtatDetection.VALIDEE,
}

# Classes du modèle ; « tooth » (numérotation) sert de repère et n'exige pas de verdict.
LABELS = ("tooth", "caries", "deep_caries", "periapical_lesion", "impacted_tooth")
LABEL_DENT = "tooth"


class Analysis(Base):
    """Une analyse = une panoramique anonymisée + ses détections.

    AUCUNE donnée patient identifiante n'est stockée ici (PRD §9) : la
    référence est anonyme (« PDX-2026-0042 ») ; c'est au cabinet, dans son
    propre dossier patient, que le rapprochement se fait. La date d'examen et
    la note sont facultatives ; l'écran rappelle de n'y mettre aucun nom."""
    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # Indexé : l'historique trie et pagine par (date, id) (sprint 8, migration 0014).
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    # Référence lisible et anonyme, attribuée à l'import.
    reference: Mapped[str] = mapped_column(String(20), unique=True)
    # Déposant : lui seul (et l'administrateur) peut supprimer l'analyse.
    utilisateur_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True, index=True
    )
    date_examen: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    image_key: Mapped[str] = mapped_column(String)          # pleine résolution (inférence)
    # Version réduite (3 000 px de large) pour l'affichage, si l'image est plus large.
    image_affichage_key: Mapped[str | None] = mapped_column(String, nullable=True)
    report_key: Mapped[str | None] = mapped_column(String, nullable=True)
    # Zones masquées à l'import, en fractions de l'image : {"auto": [...], "manuelles": [...]}.
    masques: Mapped[dict] = mapped_column(JSON, default=dict)
    # File de traitement (le statut en base fait foi : le worker reprend au
    # redémarrage les analyses restées « en cours »).
    statut: Mapped[str] = mapped_column(String(12), default=StatutAnalyse.EN_FILE, index=True)
    erreur: Mapped[str] = mapped_column(Text, default="")
    tentatives: Mapped[int] = mapped_column(Integer, default=0)
    lance_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    demarre_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    termine_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duree_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_version: Mapped[str] = mapped_column(String, default="")
    inference_mode: Mapped[str] = mapped_column(String, default="")  # mock | real
    # Version du registre ÉPINGLÉE à la mise en file : le worker demande
    # celle-ci, même si une bascule a eu lieu entre-temps. Vide : aucune
    # version active, le service d'inférence sert son mode historique.
    version_demandee: Mapped[str | None] = mapped_column(String, nullable=True)
    # Seuils de la version, copiés au traitement : l'analyse garde ses règles.
    seuils: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Rejeu d'une analyse avec le modèle courant : l'analyse d'origine.
    origine_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("analyses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    # Relecture (sprint 5) : conclusion libre, clôture qui verrouille l'analyse.
    conclusion: Mapped[str] = mapped_column(Text, default="")
    cloturee_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cloturee_par_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )

    detections: Mapped[list["Detection"]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan", order_by="Detection.cree_le"
    )
    # Sprint 7 : dents que le praticien déclare absentes (aucune détection ne
    # les porte, et il l'a vérifié sur le cliché).
    dents_absentes: Mapped[list["DentAbsente"]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan", order_by="DentAbsente.fdi"
    )
    deposant = relationship("Utilisateur", lazy="joined", foreign_keys=[utilisateur_id])
    cloturee_par = relationship("Utilisateur", foreign_keys=[cloturee_par_id])

    @property
    def cloturee(self) -> bool:
        return self.cloturee_le is not None

    def cles_stockees(self) -> list[str]:
        """Tout ce que l'analyse a laissé dans le stockage objet."""
        return [k for k in (self.image_key, self.image_affichage_key, self.report_key) if k]


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Valeurs PROPOSÉES (par le modèle, ou tracées par le praticien) : jamais
    # modifiées ensuite. Une correction crée un verdict qui porte les valeurs
    # retenues ; celles-ci restent consultables à côté de la proposition.
    label: Mapped[str] = mapped_column(String)
    fdi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)  # None : ajout du praticien
    # Boîte en FRACTIONS de la largeur et de la hauteur de l'image (0 à 1) :
    # zoom, réduction d'affichage et version réduite n'ont aucun effet sur
    # l'alignement des cadres.
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    # Version du modèle qui a produit la détection (vide pour un ajout du praticien).
    model_version: Mapped[str] = mapped_column(String, default="")
    # Origine : proposée par le modèle (« model ») ou ajoutée par le praticien (« human »).
    source: Mapped[str] = mapped_column(String, default="model")
    # Sprint 7 — dent : rang appris par le modèle « rangs » (1 à 8), sinon vide ;
    # anomalie : la dent qui la porte (rattachement fait par le service
    # d'inférence). Une anomalie suit le numéro de sa dent tant que le
    # praticien ne lui en a pas donné un autre.
    rang: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("detections.id", ondelete="SET NULL"), nullable=True
    )
    # Verdict courant (dénormalisé depuis `verdicts` pour les comptes et les filtres).
    etat: Mapped[str] = mapped_column(String(10), default=EtatDetection.A_REVOIR, index=True)
    revu_par_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )
    revu_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    analysis: Mapped["Analysis"] = relationship(back_populates="detections")
    revu_par = relationship("Utilisateur", foreign_keys=[revu_par_id])
    dent: Mapped["Detection | None"] = relationship(remote_side="Detection.id", foreign_keys=[dent_id])
    verdicts: Mapped[list["Verdict"]] = relationship(
        back_populates="detection", cascade="all, delete-orphan", order_by="Verdict.numero"
    )

    @property
    def reviewed(self) -> bool:
        return self.etat != EtatDetection.A_REVOIR

    @property
    def verdict_courant(self) -> "Verdict | None":
        actifs = [v for v in self.verdicts if v.annule_le is None]
        return actifs[-1] if actifs else None

    def retenu(self) -> dict:
        """Valeurs retenues : celles du dernier verdict actif, sinon la proposition.

        Numéro d'une anomalie rattachée à une dent : celui que la dent porte
        AUJOURD'HUI, tant que le praticien n'a pas fixé lui-même un autre numéro
        à l'anomalie. Corriger le numéro d'une dent renumérote ainsi ses
        anomalies, partout (liste, image, schéma, compte rendu).
        """
        v = self.verdict_courant
        source = v if v is not None else self
        valeurs = {k: getattr(source, k) for k in ("label", "fdi", "x", "y", "w", "h")}
        fixe_par_le_praticien = v is not None and v.fdi != self.fdi
        if (self.label != LABEL_DENT and self.dent is not None and not fixe_par_le_praticien
                and self.dent.etat != EtatDetection.REJETEE):
            valeurs["fdi"] = self.dent.retenu()["fdi"]
        return valeurs


class ParametresCabinet(Base):
    """Paramètres du cabinet (sprint 8) : une seule ligne (id = 1), reprise en
    en-tête de chaque compte rendu. Le logo est stocké comme les images, dans
    le stockage objet ; seule sa clé est ici."""
    __tablename__ = "parametres_cabinet"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    nom: Mapped[str] = mapped_column(String(120), default="")
    adresse: Mapped[str] = mapped_column(Text, default="")
    # Mentions propres au cabinet, ajoutées au pied du compte rendu (la mention
    # « prototype non certifié » est fixée par le code, jamais retirable).
    mentions: Mapped[str] = mapped_column(Text, default="")
    logo_cle: Mapped[str | None] = mapped_column(String, nullable=True)
    maj_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    maj_par_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )

    # Durée de conservation du journal d'audit (sprint 11). Un abaissement
    # retient la session qui l'a fait : la purge y est refusée (abaisser puis
    # purger dans la foulée est le geste par lequel on efface une trace).
    retention_jours: Mapped[int] = mapped_column(Integer, default=365)
    retention_abaissee_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retention_abaissee_session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    maj_par = relationship("Utilisateur", foreign_keys=[maj_par_id])


class DentAbsente(Base):
    """Dent déclarée absente par le praticien (sprint 7) : auteur et date."""
    __tablename__ = "dents_absentes"
    __table_args__ = (UniqueConstraint("analysis_id", "fdi", name="uq_dents_absentes_analyse_fdi"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    fdi: Mapped[int] = mapped_column(Integer)
    auteur_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    analysis: Mapped["Analysis"] = relationship(back_populates="dents_absentes")
    auteur = relationship("Utilisateur", foreign_keys=[auteur_id])


class Verdict(Base):
    """Un verdict du praticien sur une détection : jamais modifié, au plus
    annulé (date et auteur de l'annulation). Il porte les valeurs RETENUES,
    complètes, et son auteur : l'historique de la relecture se relit tel quel,
    et l'écart entre le modèle et le praticien reste mesurable."""
    __tablename__ = "verdicts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    detection_id: Mapped[str] = mapped_column(ForeignKey("detections.id", ondelete="CASCADE"), index=True)
    # Rang du verdict sur sa détection (1, 2, …) : l'ordre ne dépend pas de l'horloge.
    numero: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(10))
    label: Mapped[str] = mapped_column(String)
    fdi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    commentaire: Mapped[str] = mapped_column(Text, default="")
    auteur_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True, index=True
    )
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    annule_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    annule_par_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )

    detection: Mapped["Detection"] = relationship(back_populates="verdicts")
    auteur = relationship("Utilisateur", foreign_keys=[auteur_id])


class ModelVersion(Base):
    """Registre des modèles (PRD §5.5, sprint 6).

    Une version est une PAIRE (décision S6-1) : un modèle « dents » et un
    modèle « anomalies », déposés sous `<dossier des poids>/<version>/`. Leurs
    empreintes sha256 sont vérifiées par le service d'inférence au chargement.
    Une seule version est active à la fois (index unique partiel).
    """
    __tablename__ = "model_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    version: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    dataset: Mapped[str] = mapped_column(String, default="")
    metrics_json: Mapped[str] = mapped_column(Text, default="{}")
    notes: Mapped[str] = mapped_column(Text, default="")
    # Chemins relatifs au dossier des poids, et empreintes des fichiers publiés.
    poids_dents: Mapped[str | None] = mapped_column(String, nullable=True)
    poids_anomalies: Mapped[str | None] = mapped_column(String, nullable=True)
    sha256_dents: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sha256_anomalies: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Empreinte du découpage apprentissage / validation / test (split.json).
    empreinte_decoupage: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actif: Mapped[bool] = mapped_column(Boolean, default=False)
    active_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Seuils d'exploitation par classe d'anomalie, choisis sur la validation
    # (sprint 7) ; None : version antérieure, toute anomalie attend un verdict.
    seuils: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    @property
    def servable(self) -> bool:
        """Les deux fichiers de poids sont déclarés, avec leur empreinte."""
        return all((self.poids_dents, self.poids_anomalies, self.sha256_dents, self.sha256_anomalies))


# Une seule version active : tenu par la base, pas seulement par le code.
Index("ux_model_versions_actif", ModelVersion.actif, unique=True,
      sqlite_where=ModelVersion.actif == true(), postgresql_where=ModelVersion.actif == true())


class BasculeModele(Base):
    """Journal des bascules : qui a activé quelle version, quand et pourquoi."""
    __tablename__ = "model_bascules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    horodatage: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    utilisateur_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )
    version_precedente: Mapped[str | None] = mapped_column(String, nullable=True)
    version: Mapped[str] = mapped_column(String)
    motif: Mapped[str] = mapped_column(Text, default="")

    auteur = relationship("Utilisateur", foreign_keys=[utilisateur_id])


class EtatDocument:
    """Cycle d'un document de la base documentaire (sprint 9)."""
    EN_ATTENTE = "en_attente"  # déposé (ou à réindexer) : le worker le prendra
    EN_COURS = "en_cours"      # pris par le worker
    INDEXE = "indexe"
    ECHEC = "echec"            # extraction ou vectorisation impossible : `erreur` dit pourquoi
    TOUS = (EN_ATTENTE, EN_COURS, INDEXE, ECHEC)


class Document(Base):
    """Document de référence de l'assistant (sprint 9) : PDF ou Markdown.

    Le fichier déposé est gardé dans le stockage objet (`cle_stockage`), pour
    pouvoir le réindexer seul ; son empreinte sha256 évite les doublons.
    """
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    titre: Mapped[str] = mapped_column(String(200))
    nom_fichier: Mapped[str] = mapped_column(String(255))
    format: Mapped[str] = mapped_column(String(16))  # « pdf » ou « markdown »
    cle_stockage: Mapped[str] = mapped_column(String)
    empreinte: Mapped[str] = mapped_column(String(64), unique=True)
    taille: Mapped[int] = mapped_column(Integer, default=0)
    etat: Mapped[str] = mapped_column(String(16), default=EtatDocument.EN_ATTENTE, index=True)
    erreur: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Modèle de vectorisation de la dernière indexation, et nombre de passages.
    modele_vecteurs: Mapped[str | None] = mapped_column(String(120), nullable=True)
    nb_passages: Mapped[int] = mapped_column(Integer, default=0)
    depose_par_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )
    depose_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    indexe_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    depose_par = relationship("Utilisateur", foreign_keys=[depose_par_id])
    passages: Mapped[list["Passage"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True,
        order_by="Passage.rang",
    )


class Passage(Base):
    """Passage d'un document : un extrait d'environ 800 caractères, avec son
    titre de section et sa page pour la citation, et son vecteur sémantique.

    `modele` garde le modèle qui a calculé le vecteur : un passage vectorisé
    par un autre modèle que le modèle courant est périmé, jamais comparé.
    """
    __tablename__ = "passages"
    __table_args__ = (UniqueConstraint("document_id", "rang", name="uq_passages_document_rang"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    rang: Mapped[int] = mapped_column(Integer)
    texte: Mapped[str] = mapped_column(Text)
    section: Mapped[str | None] = mapped_column(String(300), nullable=True)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    modele: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    vecteur: Mapped[list[float] | None] = mapped_column(Vecteur(), nullable=True)

    document: Mapped["Document"] = relationship(back_populates="passages")


class ParametresAssistant(Base):
    """Réglages de la recherche de l'assistant (sprint 9) : une seule ligne
    (id = 1), modifiable dans l'administration de la base documentaire."""
    __tablename__ = "parametres_assistant"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # Passages remis au modèle de langage, et similarité minimale d'un passage.
    passages: Mapped[int] = mapped_column(Integer, default=5)
    seuil: Mapped[float] = mapped_column(Float, default=0.5)
    maj_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    maj_par_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )

    maj_par = relationship("Utilisateur", foreign_keys=[maj_par_id])


class Conversation(Base):
    """Fil de l'assistant (sprint 10) : un par couple analyse-auteur. Une
    conversation est un raisonnement en cours, pas un compte rendu : deux
    praticiens qui ouvrent la même analyse ont chacun le leur."""
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("analysis_id", "auteur_id", name="uq_conversations_analyse_auteur"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    auteur_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("utilisateur.id", ondelete="CASCADE"), index=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    maj_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", passive_deletes=True,
        order_by="Message.rang",
    )


class Message(Base):
    """Un message du fil : la question du praticien, ou la réponse vérifiée de
    l'assistant (statut, texte, sources citées). Une réponse non sourcée n'est
    jamais enregistrée : seul son message d'échec l'est."""
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("conversation_id", "rang", name="uq_messages_conversation_rang"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    rang: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(12))            # « question » ou « reponse »
    statut: Mapped[str | None] = mapped_column(String(12), nullable=True)   # reponse, refus, echec, interrompue
    texte: Mapped[str] = mapped_column(Text)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class VueHistorique(Base):
    """Vue enregistrée de l'historique (sprint 12) : un jeu de filtres nommé,
    propre à son auteur. Elle ne donne accès à rien : les droits restent
    vérifiés à chaque lecture de l'historique."""
    __tablename__ = "vues_historique"
    __table_args__ = (UniqueConstraint("utilisateur_id", "nom", name="uq_vues_historique_auteur_nom"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("utilisateur.id", ondelete="CASCADE"),
                                                      index=True)
    nom: Mapped[str] = mapped_column(String(80))
    filtres: Mapped[dict] = mapped_column(JSON, default=dict)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TypeNotification:
    """Événements notifiés (sprint 13). Une notification ne porte que la
    référence anonyme de l'analyse : jamais d'image, de note ni de conclusion."""
    ANALYSE_TERMINEE = "analyse_terminee"
    ANALYSE_ECHOUEE = "analyse_echouee"
    ANALYSE_ROUVERTE = "analyse_rouverte"
    TOUS = (ANALYSE_TERMINEE, ANALYSE_ECHOUEE, ANALYSE_ROUVERTE)


class Notification(Base):
    """Notification adressée à un utilisateur (sprint 13), conservée en base :
    celles reçues hors connexion l'attendent à l'ouverture de sa session."""
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_destinataire_date", "utilisateur_id", "cree_le"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    utilisateur_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("utilisateur.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(40))
    titre: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text, default="")
    # Analyse visée (lien depuis le panneau) ; la notification survit à sa suppression.
    analyse_id: Mapped[str | None] = mapped_column(String, ForeignKey("analyses.id", ondelete="SET NULL"),
                                                   nullable=True)
    reference: Mapped[str | None] = mapped_column(String(40), nullable=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    lue_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
