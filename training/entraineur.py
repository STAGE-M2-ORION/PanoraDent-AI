"""Branchement de nos augmentations dans ultralytics.

Les classes sont au niveau du module, et non créées dans une fonction : sous
Windows, les processus qui chargent les images reçoivent le dataset par
sérialisation (pickle), qui exige une classe importable par son nom.
"""
from ultralytics.data.dataset import YOLODataset
from ultralytics.models.yolo.detect import DetectionTrainer
from ultralytics.utils import colorstr
from ultralytics.utils.torch_utils import de_parallel

import augmentations


class DatasetPanoradent(YOLODataset):
    """YOLODataset + contraste aléatoire, inséré juste avant le formatage.

    L'amplitude est lue au moment où les transformations sont construites, dans
    le processus principal ; l'objet `ContrasteAleatoire` la transporte ensuite
    jusqu'aux processus de chargement.
    """

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
