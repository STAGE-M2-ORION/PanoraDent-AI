"""PanoraDent : classes gardées, conversion A1 (lésion → dent atteinte),
jeu combiné sur les 3 classes communes (B1), garde de publication."""
from pathlib import Path

import pytest

import panoradent as pd_
from config import CLASSES, CLASSES_COMBINE, CLASSES_PANORADENT, LISTES_ESSAI
from train import check_class_order

L, H = 2000, 1000


def cliche(boites):
    return pd_.Cliche("OPG_0001.jpg", Path("x.jpg"), L, H, "A", boites)


def boite(classe, x, y, w, h):
    """Boîte en pixels → normalisée."""
    return pd_.Boite(classe, x / L, y / H, w / L, h / H)


def test_classes_cibles_gardees_non_cibles_ecartees():
    texte = "\n".join([
        "2 0.5 0.5 0.02 0.05",    # Dental Caries
        "6 0.5 0.5 0.05 0.10",    # Periapical Abnormality : définition absente → écartée
        "8 0.5 0.5 0.03 0.15",    # Periodontal Pocket : trop rare → écartée
        "4 0.9 0.6 0.05 0.10",    # Impacted Third Molar
        "5 0.3 0.4 0.0 0.10",     # boîte d'aire nulle → écartée
    ])
    boites, ecartees = pd_.lire_etiquettes(texte, L, H)
    assert [b.classe for b in boites] == ["caries", "impacted_tooth"]
    assert ecartees == {"Periapical Abnormality": 1, "Periodontal Pocket": 1, "Missing Tooth": 1}
    assert boites[0].x == pytest.approx(0.49) and boites[0].w == pytest.approx(0.02)


def test_carie_devient_la_dent_atteinte_une_seule_fois():
    dents = [[900, 200, 90, 250], [1000, 200, 90, 250]]
    c = cliche([boite("caries", 910, 250, 30, 30), boite("caries", 940, 300, 25, 25),   # deux caries, même dent
                boite("caries", 1010, 260, 30, 30)])
    conv = pd_.convertir(c, dents)
    assert [b.classe for b in conv.boites] == ["caries", "caries"]
    assert (conv.boites[0].x * L, conv.boites[0].w * L) == pytest.approx((900, 90))
    assert conv.fusionnees == {"caries": 1} and conv.non_rattachees == {}


def test_lesion_sous_l_apex_rattachee_a_sa_dent():
    """Mandibule (sous le plan d'occlusion) : la boîte de la dent est prolongée vers le bas."""
    dents = [[900, 200, 90, 250], [900, 550, 90, 250]]
    lesion = boite("periapical_lesion", 910, 795, 60, 50)       # sous l'apex de la dent du bas
    conv = pd_.convertir(cliche([lesion]), dents)
    assert len(conv.boites) == 1 and conv.boites[0].y * H == pytest.approx(550)


def test_anomalie_sans_dent_signalee_et_inclusion_gardee():
    dents = [[900, 200, 90, 250]]
    incluse = boite("impacted_tooth", 1700, 600, 120, 110)
    c = cliche([boite("caries", 100, 100, 30, 30), incluse, boite("missing_tooth", 500, 500, 60, 250)])
    conv = pd_.convertir(c, dents)
    assert conv.non_rattachees == {"caries": 1}
    assert conv.boites == [incluse]                       # dent absente : hors jeu combiné (B1)
    assert all(b.classe in CLASSES_COMBINE for b in conv.boites)


def test_correspondance_dentex_carie_profonde_fusionnee():
    assert pd_.DENTEX_VERS_COMBINE["deep_caries"] == "caries"
    assert "tooth" not in pd_.DENTEX_VERS_COMBINE
    assert set(pd_.DENTEX_VERS_COMBINE.values()) == set(CLASSES_COMBINE)


def test_jeux_d_essai_entrainables_mais_hors_contrat(tmp_path):
    for noms in LISTES_ESSAI:
        assert noms != CLASSES
        yaml = tmp_path / "data.yaml"
        yaml.write_text(f'names: {__import__("json").dumps(noms)}\n', encoding="utf-8")
        check_class_order(yaml)                         # pas de refus à l'entraînement
    assert CLASSES_COMBINE == CLASSES_PANORADENT[:3]    # classes communes en tête, même index
