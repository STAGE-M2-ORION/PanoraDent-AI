from fastapi import APIRouter, Depends
import httpx
from ..auth_deps import publique
from ..config import settings

router = APIRouter()


@router.get("/health", dependencies=[Depends(publique)])
async def health():
    inference_ok = False
    inference_mode = "unknown"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.inference_url}/health")
            if r.status_code == 200:
                inference_ok = True
                inference_mode = r.json().get("mode", "unknown")
    except Exception:
        pass
    return {"status": "ok", "inference_reachable": inference_ok, "inference_mode": inference_mode}
