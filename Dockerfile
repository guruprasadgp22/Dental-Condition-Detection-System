FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=10000

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

RUN useradd -m -u 1000 user
COPY --chown=user . .
RUN mkdir -p static/results && chown -R user static/results
USER user

EXPOSE 10000
CMD gunicorn index:app --bind 0.0.0.0:${PORT} --workers 1 --threads 4 --timeout 120
