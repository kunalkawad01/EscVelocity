# MarketDNA backend — FastAPI/uvicorn.
#
# Source code (app/, jobs/, content/, mcp_server/) is NOT copied into this image — it's
# bind-mounted at /marketdna-backend by docker-compose.yml at runtime. This lets `git pull &&
# docker compose restart backend` pick up code changes with no rebuild; a rebuild is only needed
# when requirements.txt changes.
FROM python:3.12-slim
WORKDIR /marketdna-backend

# NSE trading hours and every naive datetime.now() call in the codebase (live_trading_service.py
# etc.) assume the host's local wall clock is IST — true on the Windows dev machine, false on a
# UTC-default Linux container. Bake IST in at the image level so intraday tick timestamps,
# session-state labels, and chart x-axes all line up with market hours (9:15-15:30 IST).
ENV TZ=Asia/Kolkata
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

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
