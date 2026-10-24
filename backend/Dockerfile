# Build from the repository root (the API reads scenarios from data/):
#   docker build -f backend/Dockerfile -t aegis-backend .
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY data data

WORKDIR /srv/backend
EXPOSE 8000
# Imported scenarios and saved plans are planner data: mount volumes there (see docker-compose.yml).
# Hosts like Render set PORT; 8000 otherwise.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
