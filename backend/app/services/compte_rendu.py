"""Compte rendu PDF d'une analyse (sprint 8, PRD §5.4).

**Reconstruit à la demande**, jamais conservé comme un fichier figé : tout
vient de l'analyse, verrouillée après la clôture. Deux générations donnent
donc le même document, date de génération mise à part (PDF « invariant » :
identifiant et date internes fixes ; un test compare deux rendus).

Contenu : en-tête du cabinet, référence ANONYME (jamais une donnée
identifiante : l'image est l'image anonymisée, celle qui a été traitée),
date de l'examen, praticien et date de clôture, version du modèle et seuils ;
image annotée composée ici (le PDF ne dépend pas de l'affichage du
navigateur), schéma dentaire, tableau des anomalies RETENUES (validées,
corrigées, ajoutées), conclusion telle que saisie ; les propositions
rejetées seulement sur demande, dans une section séparée. Sur chaque page :
la mention « prototype non certifié », les mentions du cabinet, la
référence et la pagination.

Deux temps : `donnees()` assemble tout (logique pure, testée), `rendre()`
dessine le PDF.
"""
import io
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont
from reportlab.graphics.shapes import Circle, Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Image as RLImage
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..config import settings
from ..models import LABEL_DENT, EtatDetection
from . import revue
from .numerotation import dents_presentes

MENTION = ("PanoraDent AI — prototype de recherche non certifié. Aide à la décision : "
           "le diagnostic et la conduite à tenir relèvent exclusivement du praticien.")

# Typologie (identique à l'écran) : nom, abréviation, couleur, forme de la marque.
TYPES = {
    "caries": ("Carie", "C", "#F0E442", "rond"),
    "deep_caries": ("Carie profonde", "CP", "#D55E00", "carre"),
    "periapical_lesion": ("Lésion péri-apicale", "LPA", "#CC79A7", "losange"),
    "impacted_tooth": ("Dent incluse", "DI", "#009E73", "triangle"),
}
STATUTS = {EtatDetection.VALIDEE: "Validée", EtatDetection.CORRIGEE: "Corrigée",
           EtatDetection.REJETEE: "Rejetée", EtatDetection.A_REVOIR: "À revoir"}
HAUT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
BAS = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]


@dataclass(frozen=True)
class Options:
    image: bool = True
    rejetees: bool = False
    commentaires: bool = True
    brouillon: bool = False


# --- Données -------------------------------------------------------------------------------------

def locale(dt: datetime | None) -> datetime | None:
    """Heure du cabinet (la base est en UTC naïf)."""
    if dt is None:
        return None
    try:
        from zoneinfo import ZoneInfo
        fuseau = ZoneInfo(settings.fuseau_horaire)
    except Exception:  # noqa: BLE001 — base des fuseaux absente : Madagascar, UTC+3
        fuseau = timezone(timedelta(hours=3))
    return dt.replace(tzinfo=timezone.utc).astimezone(fuseau)


def _date(dt) -> str:
    return dt.strftime("%d/%m/%Y") if dt else "non renseignée"


def _heure(dt) -> str:
    d = locale(dt)
    return f"{d:%d/%m/%Y} à {d:%H:%M}" if d else "—"


def praticien(u) -> dict | None:
    """Identité professionnelle du praticien qui a clôturé (profil), jamais celle d'un patient."""
    if u is None:
        return None
    nom = " ".join(x for x in (u.titre, u.prenom, u.nom) if x and x.strip()) or u.email
    details = [x for x in (u.specialite, f"N° d’ordre {u.numero_ordre}" if u.numero_ordre else None) if x]
    return {"nom": nom, "details": details}


def _ligne(d) -> dict:
    r = d.retenu()
    nom, abbr, couleur, forme = TYPES.get(r["label"], (r["label"], "?", "#94A3B8", "rond"))
    courant = d.verdict_courant
    return {
        "fdi": r["fdi"], "label": r["label"], "type": nom, "abbr": abbr, "couleur": couleur, "forme": forme,
        "confiance": None if d.source == "human" else d.confidence,
        "statut": "Ajoutée" if d.source == "human" else STATUTS.get(d.etat, d.etat),
        "commentaire": (courant.commentaire or "").strip() if courant else "",
        "cadre": (r["x"], r["y"], r["w"], r["h"]),
    }


def _tri(lignes: list[dict]) -> list[dict]:
    return sorted(lignes, key=lambda l: (l["fdi"] or 99, l["type"], -(l["confiance"] or 0)))


def donnees(a, cabinet, options: Options) -> dict:
    """Tout le contenu du compte rendu, sans rien dessiner."""
    anomalies = [d for d in a.detections if d.label != LABEL_DENT]
    retenues = _tri([_ligne(d) for d in anomalies if revue.au_compte_rendu(a, d)])
    rejetees = _tri([_ligne(d) for d in anomalies if d.etat == EtatDetection.REJETEE]) if options.rejetees else []
    if not options.commentaires:
        for l in retenues + rejetees:
            l["commentaire"] = ""
    presentes = {v["fdi"] for _, v in dents_presentes(a) if v["fdi"] in revue.FDI_VALIDES}
    seuils = a.seuils or None
    return {
        "reference": a.reference,
        "cabinet": {"nom": cabinet.nom or "Cabinet dentaire", "adresse": [l for l in cabinet.adresse.splitlines() if l.strip()],
                    "mentions": cabinet.mentions.strip()},
        "examen": _date(a.date_examen),
        "importee": _heure(a.created_at),
        "cloture": ({"le": _heure(a.cloturee_le), "par": praticien(a.cloturee_par)} if a.cloturee else None),
        "modele": a.model_version or "—",
        "seuils": ({TYPES[k][0]: v for k, v in seuils.items() if k in TYPES} if seuils else None),
        "retenues": retenues,
        "rejetees": rejetees,
        "conclusion": (a.conclusion or "").strip(),
        "schema": {"presentes": presentes, "absentes": {x.fdi for x in a.dents_absentes},
                   "anomalies": {l["fdi"]: [x for x in retenues if x["fdi"] == l["fdi"]] for l in retenues if l["fdi"]}},
        "options": options,
    }


# --- Image annotée -------------------------------------------------------------------------------

LARGEUR_IMAGE = 1600   # pixels : assez pour l'impression, PDF léger


def image_annotee(image: Image.Image, lignes: list[dict]) -> bytes:
    """Image anonymisée, réduite, avec le cadre et l'étiquette (dent, type) de
    chaque anomalie retenue. PNG, identique d'un appel à l'autre."""
    img = image.convert("RGB")
    if img.width > LARGEUR_IMAGE:
        img = img.resize((LARGEUR_IMAGE, round(img.height * LARGEUR_IMAGE / img.width)), Image.LANCZOS)
    w, h = img.size
    trace = ImageDraw.Draw(img)
    police = ImageFont.load_default(size=max(14, w // 70))
    epaisseur = max(2, w // 500)
    for l in lignes:
        x, y, bw, bh = l["cadre"]
        boite = [x * w, y * h, (x + bw) * w, (y + bh) * h]
        trace.rectangle(boite, outline=l["couleur"], width=epaisseur)
        texte = f"{l['fdi'] or '?'} {l['abbr']}"
        gauche, haut, droite, bas = trace.textbbox((0, 0), texte, font=police)
        tx, ty = boite[0], max(0, boite[1] - (bas - haut) - 6)
        trace.rectangle([tx, ty, tx + (droite - gauche) + 8, ty + (bas - haut) + 6], fill=l["couleur"])
        trace.text((tx + 4, ty + 3 - haut), texte, fill="#0B1220", font=police)
    sortie = io.BytesIO()
    img.save(sortie, format="PNG")
    return sortie.getvalue()


# --- Rendu PDF -----------------------------------------------------------------------------------

def _p(texte: str) -> str:
    """Texte sûr pour un paragraphe : balises échappées, caractères hors de la
    police standard remplacés (rien ne s'affiche en carré noir)."""
    return escape(str(texte).encode("cp1252", "replace").decode("cp1252"))


STYLES = {
    "titre": ParagraphStyle("titre", fontName="Helvetica-Bold", fontSize=15, leading=19, spaceAfter=2),
    "cabinet": ParagraphStyle("cabinet", fontName="Helvetica-Bold", fontSize=11, leading=14),
    "petit": ParagraphStyle("petit", fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.HexColor("#334155")),
    "section": ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=11, leading=14, spaceBefore=10, spaceAfter=4),
    "texte": ParagraphStyle("texte", fontName="Helvetica", fontSize=9.5, leading=13),
    "cellule": ParagraphStyle("cellule", fontName="Helvetica", fontSize=8.5, leading=11),
    "note": ParagraphStyle("note", fontName="Helvetica-Oblique", fontSize=8, leading=10, textColor=colors.HexColor("#475569")),
}


def _marque(forme: str, cx: float, cy: float, r: float, couleur: str):
    remplissage, trait = colors.HexColor(couleur), colors.HexColor("#0B1220")
    if forme == "carre":
        return Rect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8, fillColor=remplissage, strokeColor=trait, strokeWidth=0.5)
    if forme == "losange":
        s = r * 1.2
        return Polygon([cx, cy + s, cx + s, cy, cx, cy - s, cx - s, cy], fillColor=remplissage, strokeColor=trait, strokeWidth=0.5)
    if forme == "triangle":
        s = r * 1.15
        return Polygon([cx, cy + s, cx + s, cy - s * 0.8, cx - s, cy - s * 0.8], fillColor=remplissage, strokeColor=trait, strokeWidth=0.5)
    return Circle(cx, cy, r, fillColor=remplissage, strokeColor=trait, strokeWidth=0.5)


def schema_dentaire(schema: dict, largeur: float) -> Drawing:
    """Odontogramme FDI : présente (trait plein), porteuse d'anomalie (marques
    par forme), déclarée absente (pointillés barrés), non détectée (gris clair)."""
    pas = largeur / 16
    hauteur = 92
    d = Drawing(largeur, hauteur)
    d.add(Line(largeur / 2, 4, largeur / 2, hauteur - 4, strokeColor=colors.HexColor("#94A3B8"), strokeDashArray=[2, 2]))
    d.add(Line(0, hauteur / 2, largeur, hauteur / 2, strokeColor=colors.HexColor("#CBD5E1")))
    for rangee, y0, y_num in ((HAUT, hauteur / 2 + 6, hauteur - 9), (BAS, 10, 2)):
        for i, fdi in enumerate(rangee):
            cx = pas * i + pas / 2
            absente, presente = fdi in schema["absentes"], fdi in schema["presentes"]
            couleur = colors.HexColor("#0F172A") if presente else colors.HexColor("#CBD5E1")
            cadre = Rect(cx - pas * 0.32, y0, pas * 0.64, 22, rx=3, ry=3, fillColor=None, strokeColor=couleur,
                         strokeWidth=1.2 if presente else 0.8)
            if absente:
                cadre.strokeDashArray = [2, 1.5]
                cadre.strokeColor = colors.HexColor("#64748B")
            d.add(cadre)
            if absente:
                d.add(Line(cx - pas * 0.32, y0, cx + pas * 0.32, y0 + 22, strokeColor=colors.HexColor("#64748B"), strokeWidth=0.8))
            d.add(String(cx, y_num, str(fdi), fontName="Helvetica-Bold" if presente else "Helvetica", fontSize=7,
                         textAnchor="middle", fillColor=colors.HexColor("#0F172A") if presente else colors.HexColor("#94A3B8")))
            for k, l in enumerate(schema["anomalies"].get(fdi, [])[:3]):
                d.add(_marque(l["forme"], cx - 6 + k * 6, y0 + 11, 2.6, l["couleur"]))   # au centre de la case
    return d


def _tableau(lignes: list[dict], avec_commentaire: bool, largeur: float) -> Table:
    entete = ["Dent", "Type", "Confiance", "Statut"] + (["Commentaire du praticien"] if avec_commentaire else [])
    corps = [[Paragraph(_p(h), STYLES["cellule"]) for h in entete]]
    for l in lignes:
        ligne = [
            str(l["fdi"] or "—"),
            Paragraph(f'<font color="{l["couleur"]}">■</font> {_p(l["type"])} ({_p(l["abbr"])})', STYLES["cellule"]),
            "ajout du praticien" if l["confiance"] is None else f"{round(l['confiance'] * 100)} %",
            l["statut"],
        ]
        if avec_commentaire:
            ligne.append(Paragraph(_p(l["commentaire"]) or "—", STYLES["cellule"]))
        corps.append(ligne)
    fixes = [14 * mm, 46 * mm, 26 * mm, 22 * mm]
    largeurs = fixes + ([largeur - sum(fixes)] if avec_commentaire else [])
    t = Table(corps, colWidths=largeurs, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8.5),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
    ]))
    return t


class _CanevasNumerote(rl_canvas.Canvas):
    """Canevas qui connaît le nombre total de pages (« page 2 / 3 ») et pose,
    sur CHAQUE page, la mention, les mentions du cabinet et la référence."""

    pied = None  # (fonction de dessin) fixée par rendre()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pages = []

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._pages)
        for etat in self._pages:
            self.__dict__.update(etat)
            self.pied(self, total)
            super().showPage()
        super().save()


def rendre(contenu: dict, image: Image.Image | None, logo: bytes | None, genere_le: datetime) -> bytes:
    """PDF A4 du compte rendu. `genere_le` est la SEULE valeur qui change d'une
    génération à l'autre."""
    options: Options = contenu["options"]
    sortie = io.BytesIO()
    marge = 18 * mm
    doc = SimpleDocTemplate(sortie, pagesize=A4, leftMargin=marge, rightMargin=marge, topMargin=16 * mm,
                            bottomMargin=30 * mm, title=f"Compte rendu {contenu['reference']}", author="PanoraDent AI",
                            subject="Compte rendu d'analyse panoramique", creator="PanoraDent AI", invariant=1,
                            pageCompression=0)
    largeur = A4[0] - 2 * marge
    story = []

    # En-tête : logo et identité du cabinet, titre et référence anonyme.
    cab = contenu["cabinet"]
    bloc_cabinet = [Paragraph(_p(cab["nom"]), STYLES["cabinet"])] + [Paragraph(_p(l), STYLES["petit"]) for l in cab["adresse"]]
    cellule_logo = ""
    if logo:
        lecteur = Image.open(io.BytesIO(logo))
        lw, lh = lecteur.size
        echelle = min(45 * mm / lw, 18 * mm / lh)
        cellule_logo = RLImage(io.BytesIO(logo), width=lw * echelle, height=lh * echelle)
    entete = Table([[cellule_logo, bloc_cabinet]], colWidths=[50 * mm, largeur - 50 * mm])
    entete.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, 0), 1.2, colors.HexColor("#0F172A")),
                                ("BOTTOMPADDING", (0, 0), (-1, 0), 8)]))
    story += [entete, Spacer(1, 8), Paragraph("Compte rendu d’analyse panoramique", STYLES["titre"])]

    cloture = contenu["cloture"]
    infos = [
        ["Référence anonyme", contenu["reference"]],
        ["Date de l’examen", contenu["examen"]],
        ["Analyse importée le", contenu["importee"]],
        ["Relecture clôturée", f"le {cloture['le']} par {cloture['par']['nom']}" if cloture and cloture["par"] else
         (f"le {cloture['le']}" if cloture else "non clôturée — BROUILLON")],
        ["Modèle d’aide à la décision", contenu["modele"]],
        ["Seuils de proposition", ", ".join(f"{k} {round(v * 100)} %" for k, v in contenu["seuils"].items())
         if contenu["seuils"] else "toutes les propositions du modèle ont été soumises au praticien"],
    ]
    t = Table([[Paragraph(_p(k), STYLES["petit"]), Paragraph(_p(v), STYLES["cellule"])] for k, v in infos],
              colWidths=[48 * mm, largeur - 48 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 2)]))
    story += [Spacer(1, 4), t]

    if options.image and image is not None:
        png = image_annotee(image, contenu["retenues"])
        iw, ih = Image.open(io.BytesIO(png)).size
        story += [Paragraph("Image annotée (anonymisée)", STYLES["section"]),
                  RLImage(io.BytesIO(png), width=largeur, height=largeur * ih / iw),
                  Paragraph("Cadres : anomalies retenues par le praticien, avec le numéro FDI de la dent et le type "
                            "(C carie, CP carie profonde, LPA lésion péri-apicale, DI dent incluse).", STYLES["note"])]

    story.append(KeepTogether([
        Paragraph("Schéma dentaire (notation FDI)", STYLES["section"]),
        schema_dentaire(contenu["schema"], largeur),
        Paragraph("Trait plein : dent détectée · gris clair : non détectée · pointillés barrés : déclarée absente "
                  "par le praticien · marques : anomalies retenues (rond carie, carré carie profonde, losange "
                  "lésion péri-apicale, triangle dent incluse).", STYLES["note"]),
    ]))

    retenues = contenu["retenues"]
    story.append(Paragraph(f"Anomalies retenues ({len(retenues)})", STYLES["section"]))
    if retenues:
        story.append(_tableau(retenues, options.commentaires, largeur))
    else:
        story.append(Paragraph("Aucune anomalie retenue par le praticien.", STYLES["texte"]))

    conclusion = contenu["conclusion"]
    story += [Paragraph("Conclusion du praticien", STYLES["section"]),
              Paragraph(_p(conclusion).replace("\n", "<br/>") if conclusion else "Aucune conclusion saisie.", STYLES["texte"])]

    if cloture and cloture["par"]:
        lignes = [cloture["par"]["nom"], *cloture["par"]["details"], f"Relecture clôturée le {cloture['le']}"]
        story += [Spacer(1, 10), Paragraph("<br/>".join(_p(l) for l in lignes), STYLES["petit"])]

    if options.rejetees:
        rejetees = contenu["rejetees"]
        story += [Paragraph(f"Propositions rejetées par le praticien ({len(rejetees)})", STYLES["section"]),
                  Paragraph("Section demandée explicitement : ces propositions du modèle ont été écartées lors de la "
                            "relecture et ne font PAS partie du compte rendu clinique.", STYLES["note"]), Spacer(1, 4)]
        story.append(_tableau(rejetees, options.commentaires, largeur) if rejetees else
                     Paragraph("Aucune proposition rejetée.", STYLES["texte"]))

    genere = _heure(genere_le.replace(tzinfo=None) if genere_le.tzinfo is None else
                    genere_le.astimezone(timezone.utc).replace(tzinfo=None))

    def pied(c, total):
        c.saveState()
        if options.brouillon:
            c.setFont("Helvetica-Bold", 46)
            c.setFillColor(colors.Color(0.85, 0.2, 0.2, alpha=0.18))
            c.translate(A4[0] / 2, A4[1] / 2)
            c.rotate(35)
            c.drawCentredString(0, 0, "BROUILLON — non clôturée")
            c.rotate(-35)
            c.translate(-A4[0] / 2, -A4[1] / 2)
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.line(marge, 24 * mm, A4[0] - marge, 24 * mm)
        c.setFillColor(colors.HexColor("#334155"))
        style = ParagraphStyle("pied", fontName="Helvetica", fontSize=7, leading=8.6, textColor=colors.HexColor("#334155"))
        texte = _p(MENTION) + (f"<br/>{_p(cab['mentions'])}" if cab["mentions"] else "")
        p = Paragraph(texte, style)
        _, h = p.wrap(largeur, 20 * mm)
        p.drawOn(c, marge, 23 * mm - h)
        c.setFont("Helvetica", 7)
        c.drawString(marge, 8 * mm, f"Réf. {contenu['reference']} · Généré le {genere}".encode("cp1252", "replace").decode("cp1252"))
        c.drawRightString(A4[0] - marge, 8 * mm, f"page {c.getPageNumber()} / {total}")
        c.restoreState()

    canevas = type("Canevas", (_CanevasNumerote,), {"pied": staticmethod(pied)})
    doc.build(story, canvasmaker=canevas)
    return sortie.getvalue()
