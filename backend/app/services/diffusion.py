"""Diffusion des notifications en temps réel (sprint 13, lot B).

Le worker est un processus séparé du backend, qui seul tient les WebSocket.
Pour aller de l'un à l'autre sans Redis ni courtier, PostgreSQL suffit :

1. `annoncer` émet `pg_notify` **dans la transaction de l'événement** :
   PostgreSQL ne le livre qu'au commit (et jamais en cas d'annulation), à
   toutes les connexions qui écoutent, quel que soit le processus émetteur ;
2. `Ecouteur`, un fil du backend, écoute ce canal et remet chaque annonce au
   `Diffuseur` ;
3. le `Diffuseur` réveille les WebSocket ouverts du destinataire (un par
   onglet).

L'annonce ne porte que deux identifiants (destinataire, notification) : le
contenu est relu en base par le flux, qui vérifie qu'il appartient bien au
destinataire. Une annonce perdue (backend redémarré, écoute coupée) n'est pas
grave : le flux renvoie le compte des non lues à intervalle régulier, et
l'écran relit la liste à chaque reconnexion.

Sans PostgreSQL (tests, SQLite) : remise locale juste après le commit.
"""
import asyncio
import logging
import select
import threading
import uuid

from sqlalchemy import event, text
from sqlalchemy.orm import Session

logger = logging.getLogger("uvicorn.error")

CANAL = "panoradent_notifications"
ONGLETS_MAX = 10          # connexions simultanées par utilisateur
_EN_ATTENTE = "notifications_a_annoncer"


class Diffuseur:
    """Abonnés par utilisateur : une file asyncio par WebSocket ouvert."""

    def __init__(self):
        self._abonnes: dict[str, set[asyncio.Queue]] = {}
        self._boucle: asyncio.AbstractEventLoop | None = None
        self._verrou = threading.Lock()

    def abonner(self, utilisateur_id) -> asyncio.Queue | None:
        """À appeler depuis la boucle du serveur ; None au-delà de ONGLETS_MAX."""
        self._boucle = asyncio.get_running_loop()
        with self._verrou:
            files = self._abonnes.setdefault(str(utilisateur_id), set())
            if len(files) >= ONGLETS_MAX:
                return None
            file = asyncio.Queue(maxsize=100)
            files.add(file)
            return file

    def desabonner(self, utilisateur_id, file: asyncio.Queue) -> None:
        with self._verrou:
            files = self._abonnes.get(str(utilisateur_id))
            if files:
                files.discard(file)
                if not files:
                    del self._abonnes[str(utilisateur_id)]

    def abonnes(self, utilisateur_id) -> int:
        with self._verrou:
            return len(self._abonnes.get(str(utilisateur_id), ()))

    def publier(self, utilisateur_id, notification_id: str) -> None:
        """Depuis n'importe quel fil : remis dans la boucle du serveur."""
        boucle = self._boucle
        if boucle is None or boucle.is_closed():
            return
        boucle.call_soon_threadsafe(self._remettre, str(utilisateur_id), notification_id)

    def _remettre(self, utilisateur_id: str, notification_id: str) -> None:
        with self._verrou:
            files = list(self._abonnes.get(utilisateur_id, ()))
        for file in files:
            try:
                file.put_nowait(notification_id)
            except asyncio.QueueFull:   # onglet figé : il relira la liste à la reconnexion
                pass


DIFFUSEUR = Diffuseur()


def annoncer(db: Session, utilisateur_id: uuid.UUID, notification_id: str) -> None:
    """Dans la transaction de l'appelant : rien n'est annoncé si elle est annulée."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_notify(:canal, :charge)"),
                   {"canal": CANAL, "charge": f"{utilisateur_id}|{notification_id}"})
    else:
        db.info.setdefault(_EN_ATTENTE, []).append((str(utilisateur_id), notification_id))


@event.listens_for(Session, "after_commit")
def _apres_commit(session: Session) -> None:
    for utilisateur_id, notification_id in session.info.pop(_EN_ATTENTE, []):
        DIFFUSEUR.publier(utilisateur_id, notification_id)


@event.listens_for(Session, "after_rollback")
def _apres_annulation(session: Session) -> None:
    session.info.pop(_EN_ATTENTE, None)


class Ecouteur(threading.Thread):
    """Écoute le canal PostgreSQL et remet chaque annonce au diffuseur.
    Reconnexion automatique, délai croissant jusqu'à 30 s."""

    def __init__(self, dsn: str, diffuseur: Diffuseur = DIFFUSEUR):
        super().__init__(name="ecouteur-notifications", daemon=True)
        self._dsn, self._diffuseur = dsn, diffuseur
        self._arret = threading.Event()

    def arreter(self) -> None:
        self._arret.set()

    def run(self) -> None:
        import psycopg2
        import psycopg2.extensions

        attente = 1
        while not self._arret.is_set():
            try:
                connexion = psycopg2.connect(self._dsn)
                connexion.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
                connexion.cursor().execute(f"LISTEN {CANAL}")
                logger.info("Notifications : écoute du canal %s.", CANAL)
                attente = 1
                try:
                    while not self._arret.is_set():
                        if select.select([connexion], [], [], 5) == ([], [], []):
                            continue
                        connexion.poll()
                        while connexion.notifies:
                            charge = connexion.notifies.pop(0).payload
                            utilisateur_id, _, notification_id = charge.partition("|")
                            if notification_id:
                                self._diffuseur.publier(utilisateur_id, notification_id)
                finally:
                    connexion.close()
            except Exception as exc:  # noqa: BLE001 — l'écoute ne doit jamais mourir
                logger.warning("Notifications : écoute interrompue (%s), reprise dans %d s.",
                               exc.__class__.__name__, attente)
                self._arret.wait(attente)
                attente = min(attente * 2, 30)
