"""Service d'envoi d'e-mails : gabarits, modes, boîte de test."""
import logging

from app.config import settings
from app.services import courriel

from .conftest import BASE

LIEN = "http://localhost:3000/premiere-connexion?jeton=abc"


def test_gabarit_premiere_connexion():
    c = courriel.premiere_connexion("dr.a@cabinet.fr", "Aina", LIEN, google=True)
    assert c.sujet == "Votre compte PanoraDent AI"
    assert "Bonjour Aina," in c.texte and LIEN in c.texte and "24 heures" in c.texte
    assert "Continuer avec Google" in c.texte
    assert 'href="http://localhost:3000/premiere-connexion?jeton=abc"' in c.html
    sans_google = courriel.premiere_connexion("dr.a@cabinet.fr", "", LIEN, google=False)
    assert "Google" not in sans_google.texte and sans_google.texte.startswith("Bonjour,")


def test_gabarit_echappe_le_html():
    c = courriel.premiere_connexion("x@y.fr", "<script>alert(1)</script>", LIEN, google=False)
    assert "<script>" not in c.html and "&lt;script&gt;" in c.html


def test_gabarit_reinitialisation():
    c = courriel.reinitialisation("dr.a@cabinet.fr", None, LIEN)
    assert "une heure" in c.texte and "sessions ouvertes sont fermées" in c.texte


def test_mode_memoire(boite):
    courriel.envoyer(courriel.reinitialisation("a@b.fr", None, LIEN))
    assert [c.destinataire for c in boite] == ["a@b.fr"]


def test_mode_console(monkeypatch, caplog):
    monkeypatch.setattr(settings, "courriel_mode", "console")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        courriel.envoyer(courriel.reinitialisation("a@b.fr", None, LIEN))
    assert "a@b.fr" in caplog.text and LIEN in caplog.text


def test_mode_smtp(monkeypatch):
    journal = []

    class FauxSMTP:
        def __init__(self, hote, port, timeout):
            journal.append(("connexion", hote, port))
        def __enter__(self):
            return self
        def __exit__(self, *exc):
            return False
        def starttls(self):
            journal.append(("starttls",))
        def login(self, u, p):
            journal.append(("login", u))
        def send_message(self, m):
            journal.append(("envoi", m["To"], m["Subject"], m.get_content_type()))

    monkeypatch.setattr(courriel.smtplib, "SMTP", FauxSMTP)
    for k, v in dict(courriel_mode="smtp", smtp_hote="smtp.example.org", smtp_port=587,
                     smtp_utilisateur="robot", smtp_mot_de_passe="s3cret").items():
        monkeypatch.setattr(settings, k, v)
    courriel.envoyer(courriel.reinitialisation("a@b.fr", None, LIEN))
    assert journal == [
        ("connexion", "smtp.example.org", 587), ("starttls",), ("login", "robot"),
        ("envoi", "a@b.fr", "Réinitialisation de votre mot de passe PanoraDent AI", "multipart/alternative"),
    ]


def test_echec_smtp_ne_remonte_pas(monkeypatch, caplog):
    def panne(*a, **k):
        raise OSError("serveur injoignable")
    monkeypatch.setattr(courriel.smtplib, "SMTP", panne)
    monkeypatch.setattr(settings, "courriel_mode", "smtp")
    monkeypatch.setattr(settings, "smtp_hote", "smtp.example.org")
    courriel.envoyer(courriel.reinitialisation("a@b.fr", None, LIEN))  # ne lève pas
    assert "échec de l'envoi" in caplog.text


def test_boite_de_test_lisible_et_videe(client, boite):
    courriel.envoyer(courriel.reinitialisation("a@b.fr", None, LIEN))
    courriel.envoyer(courriel.reinitialisation("c@d.fr", None, LIEN))
    r = client.get(f"{BASE}/test/courriels", params={"destinataire": "A@B.fr"})
    assert [m["destinataire"] for m in r.json()] == ["a@b.fr"]
    assert client.delete(f"{BASE}/test/courriels").status_code == 204
    assert boite == []
