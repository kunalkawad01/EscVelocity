# MarketDNA data/ingestion image — separate from marketdna-backend/Dockerfile because the
# dependency sets genuinely differ (kiteconnect/polars/duckdb only, no numpy/scipy/vectorbt/TA-Lib)
# — keeps this image small and fast to rebuild independent of the heavy backend stack.
#
# Source (ingestion/, config/, storage/, warehouse/, feature_engine/) is NOT copied into the
# image — bind-mounted at /marketdna-data by docker-compose.yml at runtime, same rationale as
# the backend image.
FROM python:3.12-slim
WORKDIR /marketdna-data

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# No CMD needed for real work — this service is never started resident (profiles: ["ingestion"]
# in docker-compose.yml). Real invocations: `docker compose run --rm ingestion python -m ingestion.<module>`.
CMD ["python", "--version"]
