# Production Readiness — MarketDNA

---

## Critical — Fix Before Any Real Users

### 1. Kite Token Automation
The access token expires daily and requires manual refresh.
Automate it: build a `/auth/refresh` flow or a scheduled task that generates the token
at market open (9:00 AM IST) and writes it to `.env` without manual intervention.

### 2. Make Heavy Endpoints Async with Timeouts
`regime-clusters`, `volatility-lab`, `dual-momentum`, `market-dynamics` run CPU-heavy
computations synchronously on FastAPI's thread pool. Add `asyncio.wait_for` wrappers
or move them to background tasks with `BackgroundTasks`. Without this, 5+ simultaneous
users will freeze the backend.

### 3. Replace `--reload` with a Production Server
Never run `uvicorn --reload` in production.
Use `gunicorn -w 4 -k uvicorn.workers.UvicornWorker app.main:app`.
The `--reload` watchdog causes a double-process bind on port 8000 and is not safe
under load.

### 4. Pre-Compute and Cache Expensive Results
The 4 heavy endpoints re-compute from scratch on every request. Add Redis caching
with a TTL of 1 day — these metrics do not change intraday. Redis is already listed
in the architecture plan; implement it.

---

## High Priority — Before Public Launch

### 5. Scheduled Data Ingestion
Add a Windows Task Scheduler job (or cron on Linux) that runs `download_all_nse.py`
every evening after market close (3:45 PM IST). Currently data goes stale silently
with no alert when prices are more than 1 day old.

### 6. React Error Boundaries
A JS error in any section currently crashes the entire page. Wrap each `<Section>`
in a React `<ErrorBoundary>` that shows a graceful fallback instead of a blank page.

### 7. SQL Injection Hardening
`_fetch_ohlcv` uses direct f-string interpolation into SQL:
```python
WHERE symbol = '{symbol}'
```
Use parameterized queries or validate `symbol` strictly against the known symbol list
before it reaches the query.

### 8. Authentication
There is zero auth on the API. Anyone who can reach port 8000 can query all endpoints.
Add API key auth at minimum — FastAPI's `HTTPBearer` with a key stored in `.env`.

---

## Medium — Quality of Life

### 9. Structured Logging and Error Tracking
Add `structlog` or configure Python logging to emit JSON. Send errors to Sentry (free
tier). Right now errors vanish silently — the only signal is a hanging request.

### 10. Data Staleness Indicator
Surface the data freshness date in the UI. Show a banner when data is more than 1
trading day old so users know what they are looking at. The date is already in the
hero section's `date` field — just make it prominent when stale.

### 11. Docker and docker-compose
Containerize backend and frontend so deployment is reproducible. The current setup
requires manual Python venv management, system Python conflicts, and MKL env var
workarounds — all solved by a proper container image.

### 12. DuckDB — Switch to Read-Only Persistent File
`duckdb.connect(":memory:")` creates a new in-memory DB per thread. At scale this
becomes expensive. Switch to:
```python
duckdb.connect(database_path, read_only=True)
```
pointing to a persistent DuckDB file. Queries stay identical but connection creation
is instant and memory usage is shared.

---

## Nice to Have — Post Launch

| Item | Detail |
|------|--------|
| Frontend build | `npm run build` → serve static files via nginx, not `npm run dev` |
| Rate limiting | `slowapi` for FastAPI — without it a single user can DoS with rapid symbol switches |
| PostgreSQL for app state | User accounts, watchlists, saved research — move out of memory into Postgres |
| Deep health check | Current `/health` just returns `ok`. Verify DuckDB can query and last data date is recent |

---

## Priority Order

1. Kite token automation + Redis caching — highest ROI, everything else builds on reliable fresh data
2. Production server (gunicorn) + async timeouts — stability under any real load
3. Auth + SQL hardening — security baseline
4. Error boundaries + staleness indicator — user-facing reliability
5. Docker — deployment reproducibility
