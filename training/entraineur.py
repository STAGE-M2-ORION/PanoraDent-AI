"""Branchement de nos augmentations dans ultralytics.

Les classes sont au niveau du module, et non créées dans une fonction : sous
Windows, les processus qui chargent les images reçoivent le dataset par
sérialisation (pickle), qui exige une classe importable par son nom.
"""
import json
from pathlib import Path

from ultralytics.data.dataset import YOLODataset
from ultralytics.models.yolo.detect import DetectionTrainer
from ultralytics.utils import LOGGER, colorstr
from ultralytics.utils.torch_utils import de_parallel

import augmentations
import reequilibrage


class DatasetPanoradent(YOLODataset):
    """YOLODataset + contraste aléatoire, inséré juste avant le formatage.

    L'amplitude est lue au moment où les transformations sont construites, dans
    le processus principal ; l'objet `ContrasteAleatoire` la transporte ensuite
    jusqu'aux processus de chargement.
    """

    def get_labels(self):
        """Étiquettes, et à l'entraînement seulement, clichés rares répétés
        (`reequilibrage.SEUIL` > 0). ultralytics relit la liste des images dans
        ces étiquettes : un cliché répété est simplement vu plus souvent, avec
        des augmentations différentes à chaque passage."""
        labels = super().get_labels()
        if not self.augment or reequilibrage.SEUIL <= 0:
            return labels
        classes = [{int(c) for c in lb["cls"].reshape(-1)} for lb in labels]
        copies = reequilibrage.repetitions(reequilibrage.facteurs(classes, reequilibrage.SEUIL),
                                           reequilibrage.GRAINE)
        bilan = reequilibrage.bilan(classes, copies)
        if reequilibrage.FICHIER_BILAN:
            Path(reequilibrage.FICHIER_BILAN).write_text(
                json.dumps({"seuil": reequilibrage.SEUIL, "graine": reequilibrage.GRAINE, **bilan},
                           indent=2), encoding="utf-8")
        LOGGER.info(f"{self.prefix}rééquilibrage (seuil {reequilibrage.SEUIL}) : "
                    f"{bilan['cliches_avant']} -> {bilan['cliches_apres']} clichés")
        labels = reequilibrage.repeter(labels, copies)
        self.im_files = [lb["im_file"] for lb in labels]
        return labels

    def build_transforms(self, hyp=None):
        transforms = super().build_transforms(hyp)
        if self.augment:
            transforms.insert(-1, augmentations.ContrasteAleatoire(augmentations.CONTRASTE))
        return transforms


def construire_dataset(cfg, chemin_images, batch, data, mode="train", stride=32):
    """Équivalent de `ultralytics.data.build_yolo_dataset`, avec notre classe."""
    return DatasetPanoradent(
        img_path=chemin_images,
        imgsz=cfg.imgsz,
        batch_size=batch,
        augment=mode == "train",
        hyp=cfg,
        rect=cfg.rect or mode == "val",
        cache=cfg.cache or None,
        single_cls=cfg.single_cls or False,
        stride=int(stride),
        pad=0.0 if mode == "train" else 0.5,
        prefix=colorstr(f"{mode}: "),
        task=cfg.task,
        classes=cfg.classes,
        data=data,
        fraction=cfg.fraction if mode == "train" else 1.0,
    )


class EntraineurPanoradent(DetectionTrainer):
    """Entraîneur ultralytics qui charge les images par `DatasetPanoradent`."""

    def build_dataset(self, img_path, mode="train", batch=None):
        gs = max(int(de_parallel(self.model).stride.max() if self.model else 0), 32)
        return construire_dataset(self.args, img_path, batch, self.data, mode=mode, stride=gs)
