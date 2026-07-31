"""Client HTTP vers le service d'inférence isolé (PRD §7.1)."""
import httpx
from ..config import settings


async def infer(image_bytes: bytes, filename: str = "image.png") -> dict:
    async with httpx.AsyncClient(timeout=60.0) as client:
        files = {"file": (filename, image_bytes, "image/png")}
        resp = await client.post(f"{settings.inference_url}/infer", files=files)
        resp.raise_for_status()
        return resp.json()
