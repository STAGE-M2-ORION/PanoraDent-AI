"""Hachage bcrypt, vérification en temps constant et politique de mot de passe."""
import bcrypt
import pytest

from app import auth_security as sec
from app.config import Settings

BON = "cheval correct batterie agrafe"


def test_empreinte_bcrypt_jamais_le_mot_de_passe():
    empreinte = sec.hacher_mot_de_passe(BON)
    assert empreinte.startswith("$2b$") and BON not in empreinte
    assert sec.hacher_mot_de_passe(BON) != empreinte  # sel aléatoire
    assert sec.verifier_mot_de_passe(BON, empreinte)
    assert not sec.verifier_mot_de_passe(BON + "!", empreinte)


def test_cout_12_par_defaut_et_exige_en_production():
    assert Settings.model_fields["bcrypt_cout"].default == 12
    with pytest.raises(ValueError, match="BCRYPT_COUT"):
        Settings(
            app_env="production", identity_provider="google", bcrypt_cout=4,
            jwt_secret="x" * 40, google_client_id="id", google_client_secret="s",
            courriel_mode="smtp", smtp_hote="smtp.example.org", assistant_fournisseur="ollama",
        )


def test_verification_tourne_meme_sans_empreinte(monkeypatch):
    """Compte inconnu ou sans mot de passe : bcrypt tourne quand même (sur une
    empreinte factice), sinon le temps de réponse révélerait l'existence du compte."""
    appels = []
    vrai = bcrypt.checkpw
    monkeypatch.setattr(sec.bcrypt, "checkpw", lambda a, b: appels.append(b) or vrai(a, b))
    assert sec.verifier_mot_de_passe(BON, None) is False
    assert len(appels) == 1 and appels[0].startswith(b"$2b$")


def test_empreinte_corrompue_refusee():
    assert sec.verifier_mot_de_passe(BON, "pas-une-empreinte") is False


@pytest.mark.parametrize("mot_de_passe, motif", [
    ("court", "au moins 12"),
    ("é" * 40, "72 octets"),
    ("abababababababab", "répétitif"),
    ("dr.martin@cabinet.fr", "adresse"),
])
def test_politique_refuse(mot_de_passe, motif):
    with pytest.raises(sec.MotDePasseTropFaible, match=motif):
        sec.verifier_politique(mot_de_passe, "dr.martin@cabinet.fr")


def test_politique_accepte_une_phrase_sans_caractere_special():
    sec.verifier_politique(BON, "dr.martin@cabinet.fr")
