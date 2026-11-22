"""Génération du rapport PDF annoté et anonymisé (PRD §5.4).
Mentions légales obligatoires : prototype non certifié, décision au praticien."""
import io
from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

DISCLAIMER = (
    "PanoraDent AI — prototype de recherche NON certifie. Aide au diagnostic : "
    "la decision medicale releve exclusivement du praticien."
)


def _conf(d: dict) -> str:
    """Confiance du modèle, ou mention d'un ajout du praticien."""
    return "ajout praticien" if d.get("confidence") is None else f'conf {d["confidence"]:.2f}'


def _annotate(image: Image.Image, detections: list[dict]) -> Image.Image:
    img = image.convert("RGB")
    draw = ImageDraw.Draw(img)
    for d in detections:
        x, y, w, h = d["x"], d["y"], d["w"], d["h"]
        color = (16, 118, 110) if d["label"] == "tooth" else (192, 57, 43)
        draw.rectangle([x, y, x + w, y + h], outline=color, width=2)
        tag = f'{d["label"]} {d.get("fdi") or ""} {_conf(d)}'
        draw.text((x, max(0, y - 10)), tag.strip(), fill=color)
    return img


def build(image: Image.Image, detections: list[dict], analysis_id: str,
          model_version: str) -> bytes:
    annotated = _annotate(image, detections)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4

    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, height - 25 * mm, "PanoraDent AI — Rapport d'analyse")
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, height - 32 * mm, f"Analyse : {analysis_id}")
    c.drawString(20 * mm, height - 37 * mm, f"Modele : {model_version}")

    # Image annotée.
    img_reader = ImageReader(annotated)
    iw, ih = annotated.size
    max_w = width - 40 * mm
    scale = max_w / iw
    disp_h = ih * scale
    c.drawImage(img_reader, 20 * mm, height - 45 * mm - disp_h,
                width=max_w, height=disp_h)

    # Tableau des détections.
    y = height - 55 * mm - disp_h
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Detections proposees")
    c.setFont("Helvetica", 8)
    y -= 6 * mm
    for d in detections:
        line = f'- {d["label"]}  FDI {d.get("fdi") or "-"}  {_conf(d)}'
        c.drawString(22 * mm, y, line)
        y -= 4.5 * mm
        if y < 25 * mm:
            c.showPage()
            y = height - 25 * mm

    c.setFont("Helvetica-Oblique", 7)
    c.drawString(20 * mm, 15 * mm, DISCLAIMER)
    c.showPage()
    c.save()
    return buf.getvalue()
