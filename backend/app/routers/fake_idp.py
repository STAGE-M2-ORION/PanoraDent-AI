"""Écran du fournisseur d'identité de remplacement (APP_ENV=test uniquement).

Monté seulement quand IDENTITY_PROVIDER=fake. Il tient le rôle de la page de
Google pour les tests dans un navigateur (Playwright) : on saisit une adresse,
il délivre un code et renvoie vers la route de retour habituelle, qui suit
exactement le même chemin qu'avec Google (state, PKCE, jeton signé, nonce).
"""
import html
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, RedirectResponse

from ..auth_deps import publique
from ..identity import fournisseur

router = APIRouter(prefix="/auth/fake", tags=["test"], include_in_schema=False)


@router.get("/autoriser", response_class=HTMLResponse, dependencies=[Depends(publique)])
def autoriser(state: str = Query(...), nonce: str = Query(...), code_challenge: str = Query(...)):
    champs = "".join(
        f'<input type="hidden" name="{n}" value="{html.escape(v, quote=True)}">'
        for n, v in (("state", state), ("nonce", nonce), ("code_challenge", code_challenge))
    )
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Fournisseur d'identité de test</title></head>
<body style="font-family:system-ui;max-width:28rem;margin:4rem auto">
<h1>Fournisseur d'identité de test</h1>
<p>Remplace Google pendant les tests automatisés. Indisponible hors APP_ENV=test.</p>
<form method="get" action="/api/v1/auth/fake/valider">{champs}
<label>Adresse Google <input type="email" name="email" required autofocus></label>
<button type="submit">Se connecter</button>
</form></body></html>"""


@router.get("/valider", dependencies=[Depends(publique)])
def valider(
    email: str = Query(...),
    state: str = Query(...),
    nonce: str = Query(...),
    code_challenge: str = Query(...),
):
    fourn = fournisseur()
    code = fourn.emettre_code(fourn.revendications(email.strip(), nonce), code_challenge)
    return RedirectResponse(
        f"/api/v1/auth/google/retour?{urlencode({'code': code, 'state': state})}", status_code=302
    )
