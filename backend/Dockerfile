FROM python:3.11-slim
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Applique les migrations, amorce l'authentification (idempotent) puis démarre l'API.
CMD ["sh", "-c", "alembic upgrade head && python -m app.seed_auth && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
