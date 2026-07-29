# MarketDNA backend — FastAPI/uvicorn.
#
# Source code (app/, jobs/, content/, mcp_server/) is NOT copied into this image — it's
# bind-mounted at /marketdna-backend by docker-compose.yml at runtime. This lets `git pull &&
# docker compose restart backend` pick up code changes with no rebuild; a rebuild is only needed
# when requirements.txt changes.
FROM python:3.12-slim
WORKDIR /marketdna-backend

COPY requirements.txt .

# TA-Lib==0.7.1 ships prebuilt manylinux wheels (cp312, x86_64 and aarch64) with the C library
# bundled — plain pip install resolves to a wheel here, no compiler or apt packages needed.
RUN pip install --no-cache-dir -r requirements.txt

# --- FALLBACK: only uncomment if a future TA-Lib/numpy version bump breaks the wheel resolution
# above with "Building wheel for TA-Lib (setup.py): finished with status 'error'" ---
# RUN apt-get update && apt-get install -y --no-install-recommends build-essential wget \
#     && wget https://github.com/ta-lib/ta-lib/releases/download/v0.6.4/ta-lib-0.6.4-src.tar.gz \
#     && tar -xzf ta-lib-0.6.4-src.tar.gz && cd ta-lib-0.6.4 \
#     && ./configure --prefix=/usr --build=$(/bin/arch)-unknown-linux-gnu \
#     && make -j$(nproc) && make install && ldconfig && cd .. \
#     && rm -rf ta-lib-0.6.4* /var/lib/apt/lists/*

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
