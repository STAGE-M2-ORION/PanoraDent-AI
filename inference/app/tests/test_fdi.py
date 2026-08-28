"""Vérifie la numérotation FDI sur des dentures synthétiques.

Aucune image ni modèle n'est nécessaire : la numérotation est purement
géométrique, elle se teste sur des boîtes construites à la main.
"""
from app.fdi import assign_fdi, occlusal_plane

WIDTH, HEIGHT = 2000, 1000
TOOTH_W, TOOTH_H = 100, 150
UPPER_Y, LOWER_Y = 350, 650


def tooth(cx: float, cy: float, w: int = TOOTH_W, h: int = TOOTH_H) -> dict:
    return {"label": "tooth", "confidence": 0.9,
            "bbox": [round(cx - w / 2), round(cy - h / 2), w, h]}


def arch(cy: float, per_side: int = 8) -> list[dict]:
    """Une arcade symétrique : `per_side` dents de part et d'autre de la médiane."""
    x_mid = WIDTH / 2
    teeth = []
    for k in range(per_side):
        offset = 50 + 100 * k          # écart croissant depuis la médiane
        teeth.append(tooth(x_mid - offset, cy))
        teeth.append(tooth(x_mid + offset, cy))
    return teeth


def fdis(detections: list[dict]) -> list[int | None]:
    return sorted(d["fdi"] for d in detections if d["fdi"] is not None)


def test_denture_complete_couvre_les_quatre_quadrants():
    dets = arch(UPPER_Y) + arch(LOWER_Y)
    assign_fdi(dets, WIDTH, HEIGHT)

    attendu = ([11, 12, 13, 14, 15, 16, 17, 18] + [21, 22, 23, 24, 25, 26, 27, 28]
               + [31, 32, 33, 34, 35, 36, 37, 38] + [41, 42, 43, 44, 45, 46, 47, 48])
    assert fdis(dets) == sorted(attendu)


def test_la_droite_du_patient_est_a_gauche_de_l_image():
    """Convention radiologique : quadrants 1 et 4 dans la moitié gauche."""
    dets = arch(UPPER_Y) + arch(LOWER_Y)
    assign_fdi(dets, WIDTH, HEIGHT)
    for d in dets:
        x_centre = d["bbox"][0] + d["bbox"][2] / 2
        quadrant = d["fdi"] // 10
        if x_centre < WIDTH / 2:
            assert quadrant in (1, 4)
        else:
            assert quadrant in (2, 3)


def test_incisive_centrale_est_la_plus_proche_de_la_mediane():
    dets = arch(UPPER_Y) + arch(LOWER_Y)
    assign_fdi(dets, WIDTH, HEIGHT)
    positions = {d["fdi"]: abs(d["bbox"][0] + d["bbox"][2] / 2 - WIDTH / 2) for d in dets}
    for quadrant in (1, 2, 3, 4):
        ecarts = [positions[quadrant * 10 + p] for p in range(1, 9)]
        assert ecarts == sorted(ecarts)   # strictement croissant vers l'arrière


def test_anomalie_herite_du_fdi_de_la_dent_qu_elle_recouvre():
    dets = arch(UPPER_Y) + arch(LOWER_Y)
    # Dent 36 : quadrant 3 (bas, gauche patient = droite image), position 6.
    cible_x = WIDTH / 2 + (50 + 100 * 5)
    carie = {"label": "caries", "confidence": 0.7,
             "bbox": [round(cible_x - 20), LOWER_Y - 20, 40, 40]}
    dets.append(carie)

    assign_fdi(dets, WIDTH, HEIGHT)
    assert carie["fdi"] == 36


def test_anomalie_hors_de_toute_dent_reste_sans_fdi():
    """Mieux vaut `None` qu'un numéro inventé : le rapport affichera « FDI - »."""
    dets = arch(UPPER_Y) + arch(LOWER_Y)
    orpheline = {"label": "periapical_lesion", "confidence": 0.6,
                 "bbox": [10, 10, 30, 30]}
    dets.append(orpheline)

    assign_fdi(dets, WIDTH, HEIGHT)
    assert orpheline["fdi"] is None


def test_plan_d_occlusion_deduit_des_boites_et_non_du_cadrage():
    """Les deux arcades tiennent dans le tiers supérieur : mi-hauteur échouerait."""
    haute, basse = 200, 400
    dets = arch(haute) + arch(basse)
    assign_fdi(dets, WIDTH, 2000)          # mi-hauteur = 1000, hors des arcades

    quadrants_hauts = {d["fdi"] // 10 for d in dets
                       if d["bbox"][1] + d["bbox"][3] / 2 == haute}
    quadrants_bas = {d["fdi"] // 10 for d in dets
                     if d["bbox"][1] + d["bbox"][3] / 2 == basse}
    assert quadrants_hauts == {1, 2}
    assert quadrants_bas == {3, 4}


def test_arcade_unique_ne_produit_pas_de_fausse_mandibule():
    """Un 2-moyennes scinderait une arcade isolée en deux : le garde-fou l'évite."""
    dets = [tooth(WIDTH / 2 - (50 + 100 * k), UPPER_Y + (k % 3) * 10) for k in range(8)]
    assign_fdi(dets, WIDTH, HEIGHT)
    assert {d["fdi"] // 10 for d in dets} == {1}


def test_position_ecretee_a_la_huitieme():
    dets = [tooth(WIDTH / 2 - (50 + 100 * k), UPPER_Y) for k in range(10)]
    assign_fdi(dets, WIDTH, HEIGHT)
    assert fdis(dets) == [11, 12, 13, 14, 15, 16, 17, 18, 18, 18]


def test_plan_d_occlusion_sans_detection_retombe_sur_le_cadrage():
    assert occlusal_plane([], [], fallback=500.0) == 500.0
    assert occlusal_plane([350.0], [150], fallback=500.0) == 500.0
