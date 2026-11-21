"""Téléchargement : intégrité, reprise après interruption, garde « zip slip »."""
import hashlib
import io
import zipfile

import pytest

import telecharger_dentex as td


class FausseReponse(io.BytesIO):
    def __init__(self, contenu: bytes, status: int):
        super().__init__(contenu)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def faux_fichier(monkeypatch):
    contenu = bytes(range(256)) * 40
    monkeypatch.setitem(td.FICHIERS, "essai.zip",
                        (len(contenu), hashlib.sha256(contenu).hexdigest()))
    requetes = []

    def urlopen(requete, timeout):
        plage = requete.get_header("Range")
        requetes.append(plage)
        if plage:
            debut = int(plage.split("=")[1].rstrip("-"))
            return FausseReponse(contenu[debut:], 206)
        return FausseReponse(contenu, 200)

    monkeypatch.setattr(td.urllib.request, "urlopen", urlopen)
    return contenu, requetes


def test_url_figee_sur_la_revision():
    assert td.REVISION in td.url_de("test_data.zip")
    assert "/main/" not in td.url_de("test_data.zip")


def test_telechargement_complet_et_verifie(tmp_path, faux_fichier):
    contenu, requetes = faux_fichier
    chemin = td.telecharger("essai.zip", tmp_path)
    assert chemin.read_bytes() == contenu
    assert requetes == [None]


def test_reprise_apres_interruption(tmp_path, faux_fichier):
    contenu, requetes = faux_fichier
    (tmp_path / "essai.zip").write_bytes(contenu[:3000])   # coupure à 3000 octets
    td.telecharger("essai.zip", tmp_path)
    assert requetes == ["bytes=3000-"]
    assert (tmp_path / "essai.zip").read_bytes() == contenu


def test_fichier_deja_present_non_retelecharge(tmp_path, faux_fichier):
    contenu, requetes = faux_fichier
    (tmp_path / "essai.zip").write_bytes(contenu)
    td.telecharger("essai.zip", tmp_path)
    assert requetes == []


def test_empreinte_fausse_refusee(tmp_path, faux_fichier):
    contenu, _ = faux_fichier
    corrompu = bytearray(contenu)
    corrompu[10] ^= 0xFF
    (tmp_path / "essai.zip").write_bytes(bytes(corrompu))
    with pytest.raises(td.FichierInvalide, match="sha256"):
        td.telecharger("essai.zip", tmp_path)


def test_archive_rangee_sous_son_nom(tmp_path):
    archive = tmp_path / "test_data.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("disease/label/test_1.json", "{}")
    dossier = td.extraire(archive, tmp_path / "dest")
    assert dossier == tmp_path / "dest" / "test_data"
    assert (dossier / "disease" / "label" / "test_1.json").exists()

    archive = tmp_path / "validation_data.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("validation_data/x.png", "x")
    assert (td.extraire(archive, tmp_path / "dest") / "x.png").exists()   # pas d'imbrication


def test_zip_slip_refuse(tmp_path):
    archive = tmp_path / "piege.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("../evade.txt", "x")
    with pytest.raises(td.FichierInvalide, match="suspect"):
        td.extraire(archive, tmp_path / "dest")
    assert not (tmp_path / "evade.txt").exists()
