# FastAPI + Kite Connect Backend

## Endpoint

```
GET /api/sector-heatmap
Query params:
  universe    = nifty50 | nifty200 | nifty500 | fno   (default: nifty500)
  timeframes  = comma-separated: 1d,5d,1m,3m,6m,1y,2y (default: all)
```

---

## Project structure

```
marketdna/
├── main.py                    # FastAPI app entry point
├── routers/
│   └── sector_heatmap.py      # this file
├── models/
│   └── heatmap.py             # Pydantic response models
├── services/
│   ├── kite.py                # KiteConnect singleton + auth
│   └── ohlc_cache.py          # DuckDB caching layer
├── data/
│   └── marketdna.duckdb
└── universe/
    └── map.py                 # Python version of universe-map.md
```

---

## Pydantic models (`models/heatmap.py`)

```python
from pydantic import BaseModel
from typing import Dict, List, Optional

class Week52(BaseModel):
    low: float
    high: float
    current: float

class StockOut(BaseModel):
    symbol: str
    name: str
    isFnO: bool
    returns: Dict[str, float]
    series: Dict[str, List[float]]
    week52: Week52
    rs_vs_nifty: Dict[str, float]

class SectorOut(BaseModel):
    name: str
    color: str
    momentum_score: float
    breadth: Dict[str, float]
    returns: Dict[str, float]
    series: Dict[str, List[float]]
    stocks: List[StockOut]

class HeatmapResponse(BaseModel):
    universe: str
    as_of: str
    nifty_returns: Dict[str, float]
    sectors: List[SectorOut]
```

---

## Timeframe → Kite interval mapping

| Timeframe | Kite interval | Candles needed     |
| --------- | ------------- | ------------------ |
| 1D        | `minute`      | 375 (full session) |
| 5D        | `day`         | 5                  |
| 1M        | `day`         | 22                 |
| 3M        | `day`         | 66                 |
| 6M        | `day`         | 130                |
| 1Y        | `day`         | 252                |
| 2Y        | `day`         | 504                |

Downsample to target points for chart rendering:

```python
TF_TARGET_POINTS = {
    '1d': 8, '5d': 14, '1m': 22, '3m': 40,
    '6m': 60, '1y': 90, '2y': 140
}
```

---

## KiteConnect singleton (`services/kite.py`)

```python
# services/kite.py
from kiteconnect import KiteConnect
import os

_kite: KiteConnect | None = None

def get_kite() -> KiteConnect:
    global _kite
    if _kite is None:
        _kite = KiteConnect(api_key=os.environ['KITE_API_KEY'])
        _kite.set_access_token(os.environ['KITE_ACCESS_TOKEN'])
    return _kite
```

---

## DuckDB cache layer (`services/ohlc_cache.py`)

```python
# services/ohlc_cache.py
import duckdb, json
from pathlib import Path
from typing import Optional

DB_PATH = Path('data/marketdna.duckdb')
_con: duckdb.DuckDBPyConnection | None = None

def get_con() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        _con = duckdb.connect(str(DB_PATH))
        _con.execute("""
            CREATE TABLE IF NOT EXISTS ohlc_cache (
                symbol      VARCHAR,
                tf          VARCHAR,
                fetched_at  TIMESTAMPTZ DEFAULT now(),
                series      JSON,
                PRIMARY KEY (symbol, tf)
            )
        """)
    return _con

def get_cached(symbol: str, tf: str, max_age_minutes: int = 15) -> Optional[list]:
    con = get_con()
    row = con.execute("""
        SELECT series FROM ohlc_cache
        WHERE symbol = ? AND tf = ?
        AND fetched_at > now() - INTERVAL (?) MINUTE
    """, [symbol, tf, max_age_minutes]).fetchone()
    return json.loads(row[0]) if row else None

def set_cache(symbol: str, tf: str, series: list) -> None:
    con = get_con()
    con.execute("""
        INSERT OR REPLACE INTO ohlc_cache (symbol, tf, fetched_at, series)
        VALUES (?, ?, now(), ?)
    """, [symbol, tf, json.dumps(series)])
```

---

## Main router (`routers/sector_heatmap.py`)

```python
# routers/sector_heatmap.py
import asyncio
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Query, HTTPException
from fastapi.concurrency import run_in_threadpool

from models.heatmap import HeatmapResponse, SectorOut, StockOut, Week52
from services.kite import get_kite
from services.ohlc_cache import get_cached, set_cache
from universe.map import load_universe

router = APIRouter(prefix='/api', tags=['sector-heatmap'])

MOMENTUM_WEIGHTS = {
    '1d': 0.05, '5d': 0.08, '1m': 0.12,
    '3m': 0.15, '6m': 0.18, '1y': 0.20, '2y': 0.22
}
TF_DAYS = {
    '1d': 1, '5d': 5, '1m': 22, '3m': 66,
    '6m': 130, '1y': 252, '2y': 504
}
TF_TARGET_POINTS = {
    '1d': 8, '5d': 14, '1m': 22, '3m': 40,
    '6m': 60, '1y': 90, '2y': 140
}
NIFTY_TOKEN = 256265


# ── helpers ──────────────────────────────────────────────────────────────────

def downsample(series: list, target: int) -> list:
    if len(series) <= target:
        return series
    idx = np.round(np.linspace(0, len(series) - 1, target)).astype(int)
    return [series[i] for i in idx]

def pct_return(series: list) -> float:
    if not series or series[0] == 0:
        return 0.0
    return round((series[-1] - series[0]) / series[0] * 100, 2)

def calc_momentum(returns: dict) -> float:
    return round(sum(MOMENTUM_WEIGHTS.get(tf, 0) * ret for tf, ret in returns.items()), 2)


# ── Kite fetch (blocking I/O → run in threadpool) ────────────────────────────

def _fetch_series_sync(token: int, tf: str) -> list:
    """Blocking Kite historical fetch. Called via run_in_threadpool."""
    symbol = str(token)
    cached = get_cached(symbol, tf)
    if cached:
        return cached

    kite = get_kite()
    today = date.today()
    days = TF_DAYS[tf]
    from_date = today - timedelta(days=int(days * 1.45))

    if tf == '1d':
        data = kite.historical_data(token, from_date, today, 'minute')
        closes = [c['close'] for c in data[-375:]]
    else:
        data = kite.historical_data(token, from_date, today, 'day')
        closes = [c['close'] for c in data[-days:]]

    series = downsample(closes, TF_TARGET_POINTS[tf])
    set_cache(symbol, tf, series)
    return series

def _fetch_week52_sync(token: int) -> dict:
    kite = get_kite()
    today = date.today()
    data = kite.historical_data(token, today - timedelta(days=370), today, 'day')
    closes = [c['close'] for c in data]
    return {
        'low':     round(min(closes), 2),
        'high':    round(max(closes), 2),
        'current': round(closes[-1], 2)
    }


# ── async wrappers ────────────────────────────────────────────────────────────

async def fetch_series(token: int, tf: str) -> list:
    return await run_in_threadpool(_fetch_series_sync, token, tf)

async def fetch_week52(token: int) -> dict:
    return await run_in_threadpool(_fetch_week52_sync, token)


# ── stock builder ─────────────────────────────────────────────────────────────

async def build_stock(stock: dict, timeframes: list, nifty_returns: dict) -> tuple[StockOut, dict]:
    """Returns (StockOut, {tf: [returns]}) — the per-TF return dict feeds sector breadth."""
    token = stock['token']

    # Fetch all TF series + 52W concurrently
    series_tasks = {tf: fetch_series(token, tf) for tf in timeframes}
    w52_task = fetch_week52(token)

    series_results = {tf: await t for tf, t in series_tasks.items()}
    w52 = await w52_task

    returns = {tf: pct_return(series_results[tf]) for tf in timeframes}
    rs_1m = round(returns.get('1m', 0) - nifty_returns.get('1m', 0), 2)

    out = StockOut(
        symbol=stock['symbol'],
        name=stock['name'],
        isFnO=stock['isFnO'],
        returns=returns,
        series=series_results,
        week52=Week52(**w52),
        rs_vs_nifty={'1m': rs_1m}
    )
    return out, returns


# ── sector builder ────────────────────────────────────────────────────────────

async def build_sector(sector: dict, timeframes: list, nifty_returns: dict) -> SectorOut:
    # All stocks in this sector built concurrently
    results = await asyncio.gather(*[
        build_stock(s, timeframes, nifty_returns)
        for s in sector['stocks']
    ])

    stocks_out = [r[0] for r in results]
    all_returns = [r[1] for r in results]  # list of {tf: float} dicts

    # Sector = equal-weight avg of stocks
    sec_returns = {
        tf: round(float(np.mean([r[tf] for r in all_returns])), 2)
        for tf in timeframes
    }

    # Breadth
    breadth = {
        tf: round(sum(1 for r in all_returns if r[tf] > 0) / max(len(all_returns), 1), 2)
        for tf in ['1d', '1m'] if tf in timeframes
    }

    # Sector series = point-wise mean across stocks
    sec_series: dict[str, list[float]] = {}
    for tf in timeframes:
        matrix = [s.series[tf] for s in stocks_out]
        n = min(len(x) for x in matrix)
        sec_series[tf] = [
            round(float(np.mean([row[i] for row in matrix])), 4)
            for i in range(n)
        ]

    return SectorOut(
        name=sector['name'],
        color=sector['color'],
        momentum_score=calc_momentum(sec_returns),
        breadth=breadth,
        returns=sec_returns,
        series=sec_series,
        stocks=stocks_out
    )


# ── route ─────────────────────────────────────────────────────────────────────

@router.get('/sector-heatmap', response_model=HeatmapResponse)
async def sector_heatmap(
    universe: str = Query('nifty500', regex='^(nifty50|nifty200|nifty500|fno)$'),
    timeframes: str = Query('1d,5d,1m,3m,6m,1y,2y')
):
    tfs = [t.strip() for t in timeframes.split(',')]
    invalid = [t for t in tfs if t not in TF_DAYS]
    if invalid:
        raise HTTPException(400, f'Invalid timeframes: {invalid}')

    universe_data = load_universe(universe)

    # Nifty baseline + all sectors — fully concurrent
    nifty_task = asyncio.gather(*[fetch_series(NIFTY_TOKEN, tf) for tf in tfs])
    nifty_series_list = await nifty_task
    nifty_series = dict(zip(tfs, nifty_series_list))
    nifty_returns = {tf: pct_return(s) for tf, s in nifty_series.items()}

    sectors_out = await asyncio.gather(*[
        build_sector(sec, tfs, nifty_returns)
        for sec in universe_data['sectors']
    ])

    return HeatmapResponse(
        universe=universe,
        as_of=pd.Timestamp.now(tz='Asia/Kolkata').isoformat(),
        nifty_returns=nifty_returns,
        sectors=list(sectors_out)
    )
```

---

## App entry point (`main.py`)

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import sector_heatmap

app = FastAPI(title='MarketDNA API', version='2.0.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173'],  # Vite dev server
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(sector_heatmap.router)
```

---

## Pre-warm scheduler (APScheduler)

Runs at 15:45 IST after market close — fills DuckDB cache so first page load is instant.

```python
# scheduler.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from routers.sector_heatmap import fetch_series, TF_DAYS
from universe.map import load_universe
import asyncio

scheduler = AsyncIOScheduler(timezone='Asia/Kolkata')

@scheduler.scheduled_job('cron', hour=15, minute=45)
async def prewarm():
    print('Pre-warming OHLC cache...')
    universe = load_universe('nifty500')
    tfs = list(TF_DAYS.keys())
    tasks = [
        fetch_series(stock['token'], tf)
        for sector in universe['sectors']
        for stock in sector['stocks']
        for tf in tfs
    ]
    await asyncio.gather(*tasks)
    print(f'Cache warmed: {len(tasks)} series fetched.')

# Add to main.py:
# from scheduler import scheduler
# @app.on_event('startup')
# async def start_scheduler(): scheduler.start()
```

---

## Run

```bash
pip install fastapi uvicorn kiteconnect duckdb numpy pandas apscheduler

# Development
uvicorn main:app --reload --port 8000

# Production
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

Auto-generated docs available at:

- `http://localhost:8000/docs` (Swagger UI)
- `http://localhost:8000/redoc` (ReDoc)

---

## Concurrency profile

For Nifty 500 (~300 stocks × 7 TFs = 2,100 Kite calls):

| Approach                          | Estimated time                     |
| --------------------------------- | ---------------------------------- |
| Flask (sequential)                | ~12–15 min                         |
| FastAPI + threadpool gather       | ~45–90 sec (Kite rate limit bound) |
| FastAPI + pre-warmed DuckDB cache | ~200ms                             |

The pre-warm scheduler makes cold-load irrelevant in production.
