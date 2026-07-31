"""Anonymisation des panoramiques à l'import (PRD §5.1 / §9).

- DICOM : écrase les champs identifiants avant tout stockage.
- Image : rien à anonymiser dans les pixels, mais on retire les métadonnées EXIF.
Retourne toujours une image PIL en niveaux de gris + les octets normalisés (PNG).
"""
import io
from PIL import Image

# Champs DICOM identifiants à neutraliser (liste de base, à compléter selon besoin).
DICOM_IDENTIFYING_TAGS = [
    "PatientName", "PatientID", "PatientBirthDate", "PatientAddress",
    "PatientTelephoneNumbers", "OtherPatientIDs", "OtherPatientNames",
    "ReferringPhysicianName", "InstitutionName", "InstitutionAddress",
    "StudyDate", "AccessionNumber", "StudyID",
]


def _dicom_to_image(raw: bytes):
    import pydicom
    import numpy as np
    ds = pydicom.dcmread(io.BytesIO(raw))
    # Neutralise les identifiants.
    for tag in DICOM_IDENTIFYING_TAGS:
        if tag in ds:
            try:
                ds.data_element(tag).value = ""
            except Exception:
                pass
    arr = ds.pixel_array.astype("float32")
    arr = (arr - arr.min()) / (arr.ptp() + 1e-6) * 255.0
    return Image.fromarray(arr.astype("uint8")).convert("L")


def anonymize(raw: bytes, filename: str) -> tuple[Image.Image, bytes]:
    name = (filename or "").lower()
    if name.endswith(".dcm") or raw[128:132] == b"DICM":
        image = _dicom_to_image(raw)
    else:
        image = Image.open(io.BytesIO(raw)).convert("L")  # perd l'EXIF
    buf = io.BytesIO()
    image.save(buf, format="PNG")  # ré-encodage propre, sans métadonnées
    return image, buf.getvalue()
