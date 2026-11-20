"""Contrôle du fichier, retrait des métadonnées et masquage des inscriptions
incrustées, sur des panoramiques fabriquées."""
import io

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.services import anonymize as anon
from app.services.anonymize import FichierRefuse

L, H = 2000, 1000
TEXTE = "DUPONT Jean  12/03/1961"


def police(taille=36):
    try:
        return ImageFont.load_default(size=taille)
    except TypeError:  # Pillow sans FreeType
        return ImageFont.load_default()


def panoramique(texte_haut=TEXTE, texte_bas=None, mandibule=True) -> Image.Image:
    """Bordures noires, anatomie grise au centre, dents claires, bord
    mandibulaire clair sur fond gris dans la bande du bas, et (au choix) texte
    blanc incrusté dans les coins noirs : en haut à gauche, en bas à droite."""
    img = Image.new("L", (L, H), 15)
    d = ImageDraw.Draw(img)
    d.ellipse((150, 160, L - 150, H - 120), fill=120)               # anatomie
    for i in range(16):                                              # dents claires
        d.rectangle((420 + i * 72, 420, 470 + i * 72, 600), fill=235)
    if mandibule:                                                    # bord mandibulaire clair, sur fond gris
        d.rectangle((400, 860, 1300, 990), fill=140)
        d.arc((400, 400, 1300, 975), 20, 160, fill=245, width=10)
    if texte_haut:
        d.text((40, 30), texte_haut, fill=255, font=police())
    if texte_bas:
        d.text(POS_BAS, texte_bas, fill=250, font=police(30))
    return img


POS_BAS = (L - 520, H - 60)


def octets(img: Image.Image, fmt="PNG", **kw) -> bytes:
    sortie = io.BytesIO()
    img.save(sortie, format=fmt, **kw)
    return sortie.getvalue()


def boite_texte(texte, xy, taille=36):
    img = Image.new("L", (L, H), 0)
    ImageDraw.Draw(img).text(xy, texte, fill=255, font=police(taille))
    return Image.fromarray(np.asarray(img)).getbbox()  # (x0, y0, x1, y1) des pixels du texte


# --- Contrôle du fichier -------------------------------------------------------------------

@pytest.mark.parametrize("contenu, code, status", [
    (b"%PDF-1.7\n" + b"0" * 2000, "format_non_pris_en_charge", 415),
    (b"GIF89a" + b"0" * 2000, "format_non_pris_en_charge", 415),
    (b"", "fichier_vide", 422),
    (b"\x89PNG\r\n\x1a\n" + b"0" * (20 * 1024 * 1024), "fichier_trop_volumineux", 413),
], ids=["pdf", "gif", "vide", "20-mo-et-un-octet"])
def test_fichiers_refuses_avec_leur_motif(contenu, code, status):
    with pytest.raises(FichierRefuse) as e:
        anon.lire(contenu)
    assert (e.value.code, e.value.status) == (code, status)


def test_image_de_400_pixels_refusee():
    with pytest.raises(FichierRefuse) as e:
        anon.lire(octets(Image.new("L", (400, 300), 0)))
    assert e.value.code == "image_trop_petite" and "400 × 300" in e.value.message


def test_extension_trompeuse_sans_effet():
    """Le type vient des octets : un JPEG nommé .png est lu comme JPEG, un
    texte nommé .png est refusé (le nom du fichier n'est même pas transmis)."""
    assert anon.lire(octets(panoramique(), "JPEG")).size == (L, H)
    with pytest.raises(FichierRefuse):
        anon.lire(b"ceci n'est pas une image" * 100)


def test_metadonnees_exif_retirees():
    exif = Image.Exif()
    exif[0x010E] = "Patient DUPONT"          # ImageDescription
    exif[0x013B] = "Dr Martin"               # Artist
    brut = octets(panoramique(texte_haut=None).convert("RGB"), "JPEG", exif=exif.tobytes())
    assert b"DUPONT" in brut
    r = anon.anonymiser(brut)
    assert b"DUPONT" not in r.png and b"Martin" not in r.png
    with Image.open(io.BytesIO(r.png)) as sortie:
        assert sortie.format == "PNG" and sortie.mode == "L" and not sortie.getexif()


def test_dicom_champs_patient_disparus():
    pydicom = pytest.importorskip("pydicom")
    from pydicom.dataset import FileDataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, generate_uid

    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.1.1"
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset("x.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.PatientName, ds.PatientID, ds.PatientBirthDate = "DUPONT^Jean", "PAT-778899", "19610312"
    arr = np.asarray(panoramique(texte_haut=None), dtype=np.uint16) * 16
    ds.Rows, ds.Columns = arr.shape
    ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 12, 11, 0
    ds.PixelData = arr.tobytes()
    ds.is_little_endian, ds.is_implicit_VR = True, False
    tampon = io.BytesIO()
    pydicom.dcmwrite(tampon, ds, write_like_original=False)
    brut = tampon.getvalue()
    assert b"DUPONT" in brut and anon.format_reel(brut) == "dicom"

    r = anon.anonymiser(brut)
    assert r.taille == (L, H)
    for secret in (b"DUPONT", b"PAT-778899", b"19610312"):
        assert secret not in r.png


# --- Inscriptions incrustées ----------------------------------------------------------------

def test_bandeau_de_texte_masque_et_anatomie_intacte():
    img = panoramique(texte_bas="ORTHOPHOS XG 2026")
    r = anon.anonymiser(octets(img))
    arr = np.asarray(r.image)

    assert len(r.zones_auto) == 2
    for xy, texte, taille in (((40, 30), TEXTE, 36), (POS_BAS, "ORTHOPHOS XG 2026", 30)):
        x0, y0, x1, y1 = boite_texte(texte, xy, taille)
        # Plus aucun pixel du texte : au plus le fond noir de la bordure (15).
        assert arr[y0:y1, x0:x1].max() <= 15, f"texte encore visible : {texte}"
    # Les dents (centre) et le bord mandibulaire (gris autour) ne sont pas touchés.
    assert arr[420:600, 420:1500].max() == 235
    assert (arr[860:990, 400:1300] == 245).any()


def test_sans_inscription_aucun_masque():
    r = anon.anonymiser(octets(panoramique(texte_haut=None)))
    assert r.zones_auto == []
    assert np.array_equal(np.asarray(r.image), np.asarray(panoramique(texte_haut=None)))


def test_masques_manuels_appliques_et_valides():
    r = anon.anonymiser(octets(panoramique(texte_haut=None)), [{"x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}])
    arr = np.asarray(r.image)
    assert arr[500:600, 1000:1200].max() == 0
    assert r.zones_manuelles[0].en_dict() == {"x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}
    # Débordement : ramené dans l'image.
    assert anon.zones_depuis([{"x": 0.95, "y": 0.9, "w": 0.5, "h": 0.5}])[0].w == pytest.approx(0.05)
    for invalide in ([{"x": 0.1}], [{"x": 0, "y": 0, "w": -1, "h": 1}], [{"x": 0, "y": 0, "w": 0.1, "h": 0.1}] * 51):
        with pytest.raises(FichierRefuse) as e:
            anon.zones_depuis(invalide)
        assert e.value.code == "masques_invalides"


def test_version_affichage_au_dela_de_3000_px():
    assert anon.version_affichage(Image.new("L", (2000, 1000))) is None
    reduite = anon.version_affichage(Image.new("L", (3600, 1800)))
    with Image.open(io.BytesIO(reduite)) as img:
        assert img.size == (3000, 1500)


def test_compatibilite_anonymize():
    image, png = anon.anonymize(octets(panoramique().convert("RGB"), "JPEG"), "photo.jpg")
    assert image.mode == "L" and image.size == (L, H) and png[:8] == b"\x89PNG\r\n\x1a\n"
