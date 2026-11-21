import uuid
from datetime import date, datetime
from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
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
    # Verdict courant (dénormalisé depuis `verdicts` pour les comptes et les filtres).
    etat: Mapped[str] = mapped_column(String(10), default=EtatDetection.A_REVOIR, index=True)
    revu_par_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("utilisateur.id", ondelete="SET NULL"), nullable=True
    )
    revu_le: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    analysis: Mapped["Analysis"] = relationship(back_populates="detections")
    revu_par = relationship("Utilisateur", foreign_keys=[revu_par_id])
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
        """Valeurs retenues : celles du dernier verdict actif, sinon la proposition."""
        v = self.verdict_courant
        source = v if v is not None else self
        return {k: getattr(source, k) for k in ("label", "fdi", "x", "y", "w", "h")}


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
    """Traçabilité des modèles et de leurs métriques d'évaluation (PRD §5.5)."""
    __tablename__ = "model_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    version: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    dataset: Mapped[str] = mapped_column(String, default="")
    metrics_json: Mapped[str] = mapped_column(Text, default="{}")
    notes: Mapped[str] = mapped_column(Text, default="")
