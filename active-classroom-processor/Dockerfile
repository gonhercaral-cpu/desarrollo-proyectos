# Docker Official Image from Docker's public ECR registry; avoids Hub CI 429s.
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOME=/tmp PORT=8080
RUN apt-get update && apt-get install --no-install-recommends -y \
    libreoffice-impress libreoffice-writer poppler-utils fonts-liberation fonts-crosextra-carlito \
    fonts-dejavu-core fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py converter.py builds.py ./
COPY tests ./tests
RUN useradd --system --uid 10001 --no-create-home classroom
USER 10001:10001
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "1", "--timeout", "360", "--access-logfile", "-", "app:app"]
