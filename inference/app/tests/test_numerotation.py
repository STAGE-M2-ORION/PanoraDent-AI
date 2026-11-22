"""Sprint 7 — numérotation hybride (rang appris, quadrant géométrique),
incohérences signalées sans correction, rattachement des anomalies."""
import pytest

from app import config, model
from app.fdi import numeroter

L, H = 2000, 1000
HAUT, BAS = 350, 650
W_DENT, H_DENT = 90, 150


def dent(cx, cy, rang=None, conf=0.9):
    d = {"label": "tooth", "confidence": conf, "bbox": [cx - W_DENT / 2, cy - H_DENT / 2, W_DENT, H_DENT]}
    if rang is not None:
        d["rang"] = rang
    return d


def arcade(cy, medianes=L / 2, rangs=range(1, 9), decalage=0):
    """Dents rangées de part et d'autre de la médiane, chacune avec son rang."""
    out = []
    for r in rangs:
        ecart = 50 + 100 * (r - 1)
        out.append(dent(medianes + decalage - ecart, cy, r))
        out.append(dent(medianes + decalage + ecart, cy, r))
    return out


def fdis(dets):
    return sorted(d["fdi"] for d in dets if d["label"] == "tooth")


def test_denture_complete():
    dets = arcade(HAUT) + arcade(BAS)
    assert numeroter(dets, L, H) == []
    assert fdis(dets) == sorted(q * 10 + r for q in (1, 2, 3, 4) for r in range(1, 9))


def test_une_dent_manquante_ne_decale_plus_les_suivantes():
    """L'ancienne règle d'ordre numérotait la 37 « 36 » quand la 36 manquait."""
    bas = [d for d in arcade(BAS) if not (d["rang"] == 6 and d["bbox"][0] > L / 2)]   # sans la 36
    dets = arcade(HAUT) + bas
    numeroter(dets, L, H)
    assert 36 not in fdis(dets) and {37, 38} <= set(fdis(dets))
    sans_rang = [dent(d["bbox"][0] + W_DENT / 2, d["bbox"][1] + H_DENT / 2) for d in dets]
    numeroter(sans_rang, L, H)
    assert 36 in fdis(sans_rang) and 38 not in fdis(sans_rang)     # l'ancienne erreur, pour mémoire


def test_mediane_placee_sur_les_incisives_patient_decentre():
    """Patient décalé de 120 px : la médiane suit les incisives, pas le milieu de l'image."""
    dets = arcade(HAUT, decalage=120) + arcade(BAS, decalage=120)
    numeroter(dets, L, H)
    assert fdis(dets) == sorted(q * 10 + r for q in (1, 2, 3, 4) for r in range(1, 9))


def test_doublon_signale_jamais_corrige():
    dets = arcade(HAUT) + arcade(BAS)
    intrus = dent(L / 2 - 50 - 100 * 4 + 30, BAS, rang=4)        # une seconde « 44 »
    dets.append(intrus)
    signales = numeroter(dets, L, H)
    doublons = [s for s in signales if s["type"] == "doublon"]
    assert doublons == [{"type": "doublon", "fdi": 44, "nombre": 2, "message": "2 dents portent le numéro 44."}]
    quarante_quatre = [d for d in dets if d.get("fdi") == 44]
    assert len(quarante_quatre) == 2 and all(d["douteux"] for d in quarante_quatre)
    # Seules les dents visées par un signalement sont marquées douteuses.
    visees = {44} | {f for s in signales if s["type"] == "ordre" for f in s["fdi"]}
    assert {d["fdi"] for d in dets if d["douteux"]} <= visees


def test_rangs_dans_le_desordre_signales():
    dets = arcade(HAUT) + arcade(BAS)
    d15 = next(d for d in dets if d["rang"] == 5 and d["bbox"][0] < L / 2 and d["bbox"][1] < 500)
    d16 = next(d for d in dets if d["rang"] == 6 and d["bbox"][0] < L / 2 and d["bbox"][1] < 500)
    d15["rang"], d16["rang"] = 6, 5                                # rangs échangés
    signales = numeroter(dets, L, H)
    assert any(s["type"] == "ordre" for s in signales)
    assert d15["fdi"] == 16 and d16["fdi"] == 15                   # rien n'est déplacé
    assert d15["douteux"] and d16["douteux"]


def test_quadrant_surcharge_signale():
    dets = arcade(HAUT) + arcade(BAS) + [dent(L / 2 - 50 - 100 * 8, HAUT, rang=8)]
    signales = numeroter(dets, L, H)
    assert any(s["type"] == "quadrant_surcharge" and s["quadrant"] == 1 and s["nombre"] == 9 for s in signales)


# --- Rattachement -------------------------------------------------------------

def anomalie(label, x, y, w, h):
    return {"label": label, "confidence": 0.7, "bbox": [x, y, w, h]}


def test_rattachement_au_seuil_de_0_20():
    dets = arcade(HAUT) + arcade(BAS)
    d36 = next(i for i, d in enumerate(dets) if d["rang"] == 6 and d["bbox"][0] > L / 2 and d["bbox"][1] > 500)
    x, y, w, h = dets[d36]["bbox"]
    # 30 % de la carie sur la 36, le reste hors de toute dent (au-dessus de la couronne)
    carie = anomalie("caries", x + 10, y - 0.7 * 60, 40, 60)
    # 10 % seulement : trop peu, non rattachée
    lointaine = anomalie("caries", x + 10, y - 0.9 * 60, 40, 60)
    dets += [carie, lointaine]
    numeroter(dets, L, H)
    assert carie["fdi"] == 36 and carie["dent"] == d36
    assert lointaine["fdi"] is None and lointaine["dent"] is None


def test_lesion_peri_apicale_sous_la_racine():
    dets = arcade(HAUT) + arcade(BAS)
    d46 = next(d for d in dets if d["rang"] == 6 and d["bbox"][0] < L / 2 and d["bbox"][1] > 500)
    x, y, w, h = d46["bbox"]
    lesion = anomalie("periapical_lesion", x + 20, y + h - 5, 50, 40)     # sous l'apex
    carie = anomalie("caries", x + 20, y + h - 5, 50, 40)                 # même place, autre classe
    dets += [lesion, carie]
    numeroter(dets, L, H)
    assert lesion["fdi"] == 46                    # boîte de la dent prolongée vers la racine
    assert carie["fdi"] is None                   # une carie ne se rattache pas sous l'apex


# --- Classes lues dans les poids ----------------------------------------------

class FauxModele:
    def __init__(self, names):
        self.names = names


def test_classes_lues_dans_les_poids():
    rangs = FauxModele({i: f"dent_{i + 1}" for i in range(8)})
    contrat = FauxModele({i: n for i, n in enumerate(config.CLASSES)})
    assert model.noms_des_classes(rangs) == config.CLASSES_RANGS
    assert model.noms_des_classes(contrat) == config.CLASSES
    assert model.noms_des_classes(object()) == config.CLASSES          # poids muets : contrat
    assert model.classe_et_rang("dent_6") == ("tooth", 6)
    assert model.classe_et_rang("caries") == ("caries", None)


@pytest.mark.parametrize("ancien", [True, False])
def test_paire_avec_modele_rangs_ou_ancien_modele_dents(ancien):
    """Le service accepte une version dont le modèle dents est un modèle « rangs »
    (sprint 7) comme une version plus ancienne (classe `tooth` seule)."""
    from app.tests.test_registre import Boite

    class Yolo:
        def __init__(self, names, boites):
            self.names, self.overrides, self._b = names, {}, boites

        def predict(self, image, imgsz, conf, verbose):
            return [type("R", (), {"boxes": self._b})()]

    # 16 et 15 à gauche de la médiane, 25 à droite ; une 15 manquante ne doit rien décaler.
    centres = [(L / 2 - 550, 6), (L / 2 + 450, 5), (L / 2 - 50, 1), (L / 2 + 50, 1)]
    if ancien:
        dents = Yolo({0: "tooth"}, [Boite(0, [cx - 45, 275, cx + 45, 425], 0.9) for cx, _ in centres])
    else:
        dents = Yolo({i: f"dent_{i + 1}" for i in range(8)},
                     [Boite(r - 1, [cx - 45, 275, cx + 45, 425], 0.9) for cx, r in centres])
    anomalies = Yolo({i: n for i, n in enumerate(config.CLASSES)}, [])
    paire = type("P", (), {"dents": dents, "anomalies": anomalies, "imgsz": {"dents": 640, "anomalies": 640}})()
    dets, _ = model.predict_paire(paire, None, L, H)
    if ancien:
        assert sorted(d["fdi"] for d in dets) == [11, 12, 21, 22]        # rang par ordre
    else:
        assert sorted(d["fdi"] for d in dets) == [11, 16, 21, 25]        # rang appris


def test_mock_relie_les_anomalies_a_leur_dent_et_donne_les_rangs():
    """Le générateur factice (tests de bout en bout) imite la numérotation :
    rang appris pour chaque dent, index de la dent hôte pour chaque anomalie."""
    from app import model

    dets = model._mock_detections(1600, 800)
    dents = [d for d in dets if d["label"] == "tooth"]
    anomalies = [d for d in dets if d["label"] != "tooth"]
    assert anomalies and all(d["rang"] == d["fdi"] % 10 for d in dents)
    for a in anomalies:
        hote = dets[a["dent"]]
        assert hote["label"] == "tooth" and hote["fdi"] == a["fdi"] and hote["bbox"] == a["bbox"]
