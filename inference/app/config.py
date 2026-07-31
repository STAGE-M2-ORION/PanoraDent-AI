import os

MODEL_WEIGHTS_PATH = os.getenv("MODEL_WEIGHTS_PATH", "/weights/model.pt")
MODEL_VERSION = os.getenv("MODEL_VERSION", "mock-0.0.0")

# Classes du périmètre PRD (§3 / §5.2).
CLASSES = ["tooth", "caries", "deep_caries", "periapical_lesion", "impacted_tooth"]
