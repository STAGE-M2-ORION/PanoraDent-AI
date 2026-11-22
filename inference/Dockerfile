FROM python:3.11-slim

# cpu (défaut) ou gpu (docker-compose.gpu.yml).
ARG TORCH_VARIANT=cpu
WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-modele.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Torch AVANT ultralytics, depuis l'index de PyTorch : sinon pip tirerait de
# PyPI la version CUDA par défaut (plusieurs Go), même pour une cible CPU.
# Même version que l'entraînement (training/requirements.txt).
RUN if [ "$TORCH_VARIANT" = "gpu" ]; then \
      pip install --no-cache-dir torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cu121 ; \
    else \
      pip install --no-cache-dir torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cpu ; \
    fi \
 && pip install --no-cache-dir -r requirements-modele.txt

# ultralytics écrit ses réglages dans le répertoire personnel : le garder dans l'image.
ENV YOLO_CONFIG_DIR=/srv/.ultralytics

COPY app ./app
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
