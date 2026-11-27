# Licences des données et des modèles

Le code de PanoraDent AI est celui du dépôt. Les **données d'apprentissage** et
les **poids entraînés** suivent les licences ci-dessous ; aucune donnée ni aucun
poids n'est versionné dans git (`data/`, `runs/`, `inference/weights/` ignorés).

## DENTEX — CC BY-NC-SA 4.0

- Source : Hugging Face `ibrahimhamamci/DENTEX`, révision `7b27ccc`.
- Usage **académique et non commercial**, partage dans les mêmes conditions.
- Utilisé pour les modèles **dents** (`dents-v1`), **rangs** (`rangs-v1`) et
  **anomalies** (`anomalies-v1`, part DENTEX de `anomalies-combine`).
- Les poids entraînés sur DENTEX héritent de cette restriction : **pas d'usage
  commercial** des modèles dents, rangs et anomalies tant qu'ils en dépendent.
- Citation : Hamamci et al., *DENTEX: An Abnormal Tooth Detection with Dental
  Enumeration and Diagnosis Benchmark for Panoramic X-rays*, 2023.

## PanoraDent — CC BY 4.0

- 1 295 radiographies panoramiques d'adultes, deux hôpitaux de Sylhet
  (Bangladesh) ; images, annotations, données structurées et documentation
  sous **CC BY 4.0** (fichier `LICENSE` du jeu) ; scripts du jeu sous MIT.
- **Citation obligatoire** de l'article Data in Brief qui accompagne le jeu,
  avec un lien vers la licence et l'indication des modifications :
  - *Référence complète (auteurs, titre, revue, DOI) : à compléter.*
  - Modifications apportées ici : classes non cibles écartées, boîtes de carie
    et de lésion remplacées par la boîte de la dent atteinte pour le jeu
    combiné, découpage propre (voir `training/class_mapping.md`).
- Utilisé **seulement pour le modèle d'anomalies** (`anomalies-panoradent`,
  `anomalies-combine`). Sa numérotation FDI, dérivée d'un détecteur
  automatique, n'est pas utilisée.
- Un modèle entraîné sur PanoraDent **seul** n'hérite que de l'obligation
  d'attribution. Le modèle **combiné** contient aussi DENTEX : il reste
  **non commercial** (CC BY-NC-SA).

## Poids de départ

`yolo11s.pt` (Ultralytics) : licence AGPL-3.0 d'Ultralytics, applicable aux
poids et au code de la bibliothèque `ultralytics`.
