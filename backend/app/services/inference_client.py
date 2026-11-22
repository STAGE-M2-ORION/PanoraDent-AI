"""Client HTTP vers le service d'inférence isolé (PRD §7.1)."""
import httpx

from ..config import settings


class RefusInference(Exception):
    """Le service a répondu, mais refuse : poids absents, altérés, illisibles."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _refus(resp: httpx.Response) -> RefusInference | None:
    if resp.status_code < 400:
        return None
    try:
        corps = resp.json()
        return RefusInference(corps.get("code", "erreur"), corps.get("message", resp.text))
    except ValueError:
        return None


async def infer(image_bytes: bytes, filename: str = "image.png") -> dict:
    async with httpx.AsyncClient(timeout=60.0) as client:
        files = {"file": (filename, image_bytes, "image/png")}
        resp = await client.post(f"{settings.inference_url}/infer", files=files)
        resp.raise_for_status()
        return resp.json()


def infer_sync(image_bytes: bytes, filename: str = "image.png", version: str | None = None,
               sha_dents: str | None = None, sha_anomalies: str | None = None) -> dict:
    """Version synchrone, pour le worker. `version` : celle épinglée sur l'analyse."""
    donnees = {k: v for k, v in (("version", version), ("sha_dents", sha_dents),
                                 ("sha_anomalies", sha_anomalies)) if v}
    with httpx.Client(timeout=120.0) as client:
        files = {"file": (filename, image_bytes, "image/png")}
        resp = client.post(f"{settings.inference_url}/infer", files=files, data=donnees)
        if (refus := _refus(resp)) is not None:
            raise refus
        resp.raise_for_status()
        return resp.json()


def charger(version: str, sha_dents: str | None, sha_anomalies: str | None) -> dict:
    """Fait charger et vérifier une version par le service, avant une bascule."""
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(f"{settings.inference_url}/charger", json={
            "version": version, "sha_dents": sha_dents, "sha_anomalies": sha_anomalies})
        if (refus := _refus(resp)) is not None:
            raise refus
        resp.raise_for_status()
        return resp.json()
