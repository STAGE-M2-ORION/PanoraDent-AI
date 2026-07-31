FROM python:3.11-slim

ARG TORCH_VARIANT=cpu
WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Torch installé séparément selon la cible (CPU par défaut, GPU via override).
# En mode mock, torch n'est pas requis ; décommenter pour un vrai modèle.
# RUN if [ "$TORCH_VARIANT" = "gpu" ]; then \
#       pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu121 ; \
#     else \
#       pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu ; \
#     fi

COPY app ./app
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
