# Hireclaw website: one Python process, no database, no secret.
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml config.yaml README.md testnet-deployment.json testnet-proof.json ./
COPY boss ./boss
COPY data ./data
COPY web ./web
COPY media ./media
# listed on /code (repository inventory); not needed to run the site
COPY tests ./tests
COPY contract/src ./contract/src
COPY scripts/*.mjs scripts/*.sh ./scripts/
RUN pip install --no-cache-dir -e .
ENV PORT=8137
EXPOSE 8137
CMD ["sh", "-c", "python -m boss.webapp --host 0.0.0.0 --port ${PORT}"]
