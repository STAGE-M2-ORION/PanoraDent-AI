import uuid
from datetime import date, datetime
from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, Uuid
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

    detections: Mapped[list["Detection"]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan"
    )
    deposant = relationship("Utilisateur", lazy="joined")

    def cles_stockees(self) -> list[str]:
        """Tout ce que l'analyse a laissé dans le stockage objet."""
        return [k for k in (self.image_key, self.image_affichage_key, self.report_key) if k]


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String)
    fdi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence: Mapped[float] = mapped_column(Float)
    # Boîte en FRACTIONS de la largeur et de la hauteur de l'image (0 à 1) :
    # zoom, réduction d'affichage et version réduite n'ont aucun effet sur
    # l'alignement des cadres.
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    # Version du modèle qui a produit la détection (vide pour un ajout du praticien).
    model_version: Mapped[str] = mapped_column(String, default="")
    # Révision par le praticien (PRD §5.3) : validé / corrigé / ajouté / supprimé.
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String, default="model")  # model | human

    analysis: Mapped["Analysis"] = relationship(back_populates="detections")


class ModelVersion(Base):
    """Traçabilité des modèles et de leurs métriques d'évaluation (PRD §5.5)."""
    __tablename__ = "model_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    version: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    dataset: Mapped[str] = mapped_column(String, default="")
    metrics_json: Mapped[str] = mapped_column(Text, default="{}")
    notes: Mapped[str] = mapped_column(Text, default="")
