# MarketDNA — Workflow & Code Guide

A plain-English explanation of how the system works, how data flows, and how to extend it.

---

## 1. What MarketDNA Does

MarketDNA takes raw stock price data and turns it into structured intelligence — regime scores, relative strength rankings, drawdown analysis, return distributions, and more. Everything is calculated deterministically in Python/DuckDB. The React frontend only visualises; it never computes.

---

## 2. System Architecture

```
Raw Data (Parquet files)
        │
        ▼
    DuckDB view
  (equities_prices)
        │
        ▼
  Python Services          ← all metric calculations live here
  (stock_metrics.py)
        │
        ▼
   FastAPI Routers          ← HTTP endpoints, input validation
  (stock.py / assistant.py)
        │
        ▼
   React Frontend           ← fetches data, renders charts
  (StockPage + components)
```

---

## 3. Repository Layout

```
EscVel/
├── marketdna-data/          Raw data ingestion
│   ├── ingestion/           Kite Connect download scripts
│   ├── storage/             Parquet writer
│   └── data_lake/
│       └── raw/equities/    Parquet files (hive-partitioned by symbol)
│
├── marketdna-backend/       FastAPI application
│   └── app/
│       ├── main.py          App entry point, CORS, router registration
│       ├── config.py        Settings (data path, CORS origins)
│       ├── models/
│       │   └── stock.py     All Pydantic response models
│       ├── routers/
│       │   ├── stock.py     /api/stock/* endpoints
│       │   └── assistant.py /api/stock/{symbol}/chat endpoint
│       └── services/
│           ├── duckdb_client.py   DuckDB connection (per-thread)
│           ├── stock_metrics.py   All metric calculations
│           └── ai_assistant.py    LangChain + Ollama agent
│
└── marketdna-web/           React frontend
    └── src/
        ├── main.tsx         React entry point
        ├── App.tsx          ThemeProvider wrapper
        ├── theme.ts         MUI + Highcharts dark theme
        ├── types/stock.ts   TypeScript interfaces (mirrors Pydantic models)
        ├── api/stockApi.ts  All fetch calls to the backend
        └── pages/
            └── StockPage.tsx    Main page — fetches all data, renders sections
        └── components/stock/
            ├── HeroSection.tsx        Price, regime, SMA status bar
            ├── WhatChangedToday.tsx   Event feed (derived from loaded data)
            ├── PriceChart.tsx         Candlestick + SMA chart
            ├── MarketStructure.tsx    Regime timeline
            ├── TrendPersistence.tsx   SMA streak analysis
            ├── RelativeStrengthSection.tsx  Rank chart
            ├── ReturnIntelligence.tsx       Histogram + yearly bars
            ├── RiskIntelligence.tsx         ATR chart + percentile bar
            ├── DrawdownSection.tsx          Drawdown area chart
            ├── OpportunityDashboard.tsx     Composite score gauge
            ├── PercentileDashboard.tsx      Percentile command center
            ├── ResearchInsights.tsx         Auto-generated insights
            ├── HistoricalAnalog.tsx         Placeholder (Sprint 3)
            ├── AIResearchAssistant.tsx      Chat interface
            └── StatCard.tsx                 Reusable KPI card
```

---

## 4. Data Pipeline

### How raw data gets in

```
Kite Connect API
      │
      ▼
ingestion/download_symbol.py   ← downloads OHLCV for one symbol
      │
      ▼
storage/parquet_writer.py      ← writes to data_lake/raw/equities/
                                  partitioned as symbol=RELIANCE/year=2024/data.parquet
```

### How the backend reads data

Every request goes through `duckdb_client.py`:

```python
def get_connection() -> duckdb.DuckDBPyConnection:
    # One DuckDB connection per thread (thread-local storage)
    # Reads ALL parquet files at once via a glob pattern
    con.execute("""
        CREATE VIEW equities_prices AS
        SELECT * FROM read_parquet('data_lake/raw/equities/**/*.parquet',
                                   hive_partitioning = true)
    """)
```

The view `equities_prices` has columns: `date, open, high, low, close, volume, symbol`.  
Every SQL query in `stock_metrics.py` runs against this view.

---

## 5. Backend — Endpoint to Response

### How a request flows

```
GET /api/stock/RELIANCE/regime
      │
      ▼
routers/stock.py  @router.get("/{symbol}/regime")
      │
      ▼
stock_metrics.get_regime("RELIANCE")
      │  runs SQL via DuckDB
      │  post-processes with numpy
      ▼
returns RegimeResponse (Pydantic model → JSON)
```

### Complete endpoint list

| Method | Path | What it returns |
|--------|------|-----------------|
| GET | `/api/stock/symbols` | List of all available symbols |
| GET | `/api/stock/{symbol}/summary` | Latest price, regime, SMA status, 52W range |
| GET | `/api/stock/{symbol}/ohlcv` | Full OHLCV history + SMA20/50/200 |
| GET | `/api/stock/{symbol}/regime` | Regime timeline (Bear/Neutral/Bull/Super Bull) |
| GET | `/api/stock/{symbol}/trend-persistence` | Streak days above/below each SMA |
| GET | `/api/stock/{symbol}/relative-strength` | Rolling 1M return rank among NIFTY 50 |
| GET | `/api/stock/{symbol}/returns` | Daily/monthly/yearly return histograms + stats |
| GET | `/api/stock/{symbol}/risk` | ATR(14) series + percentile + trend |
| GET | `/api/stock/{symbol}/drawdown` | 5-year drawdown series + recovery stats |
| GET | `/api/stock/{symbol}/market-comparison` | Stock/index ratio + SMA50/200 |
| GET | `/api/stock/{symbol}/percentiles` | Current value vs historical percentile for 6 metrics |
| GET | `/api/stock/{symbol}/insights` | Up to 10 auto-generated data-driven insights |
| POST | `/api/stock/{symbol}/chat` | AI Research Copilot (body: `{ question }`) |

Interactive API docs: http://localhost:8000/docs

---

## 6. Backend — Metric Calculation Pattern

Every metric follows this exact pattern:

```python
def get_regime(symbol: str) -> RegimeResponse:
    con = get_connection()          # 1. get thread-local DuckDB connection

    df = con.execute(f"""           # 2. run SQL — all heavy lifting here
        SELECT date, score ...
        FROM equities_prices
        WHERE symbol = '{symbol}'
    """).pl()                       # → Polars DataFrame

    rows = df.to_dicts()            # 3. convert to plain Python dicts

    # 4. light post-processing (loop, numpy stats)
    timeline = [RegimePoint(date=r['date'], regime=...) for r in rows]

    return RegimeResponse(          # 5. return Pydantic model → FastAPI serialises to JSON
        symbol=symbol,
        timeline=timeline,
        stats=RegimeStats(...),
    )
```

**Rule:** DuckDB does the aggregation, windowing, and ranking. Python/numpy only does post-processing that SQL can't express cleanly (e.g. computing streak lengths, percentile ranks).

---

## 7. Regime Scoring

The regime at each date is based on how many SMAs the close is above:

| SMAs above | Score | Regime |
|---|---|---|
| 0 or 1 | 0–1 | Bear |
| 2 | 2 | Neutral |
| 3 | 3 | Bull |
| 4 (SMA20/50/100/200) | 4 | Super Bull |

---

## 8. AI Research Copilot

```
User types a question
        │
        ▼
POST /api/stock/{symbol}/chat
        │
        ▼
ai_assistant._run_sync()        ← synchronous agent loop, run in thread pool
        │
        ├── LangChain ChatOllama (llama3.2)
        │     decides whether to call run_query tool
        │
        ├── run_query(sql)       ← calls _execute_query() → DuckDB → JSON
        │
        ├── LLM reads JSON result, may call run_query again
        │
        └── LLM writes final plain-English answer
        │
        ▼
{ answer: "...", queries: [{ label, sql }, ...] }
```

**Key rule:** The LLM never calculates anything. It only calls `run_query` to get data, then explains the results.

---

## 9. Frontend — Page Load Flow

When a user selects a symbol, `StockPage.tsx` fires all API calls in parallel:

```typescript
// Fast sections (lightweight SQL)
fetch('summary',     () => stockApi.getSummary(symbol))
fetch('ohlcv',       () => stockApi.getOHLCV(symbol))
fetch('percentiles', () => stockApi.getPercentiles(symbol))
fetch('drawdown',    () => stockApi.getDrawdown(symbol))
fetch('risk',        () => stockApi.getRisk(symbol))
fetch('regime',      () => stockApi.getRegime(symbol))
fetch('persistence', () => stockApi.getTrendPersistence(symbol))

// Heavier sections (cross-symbol SQL)
fetch('returns',     () => stockApi.getReturns(symbol))
fetch('rs',          () => stockApi.getRelativeStrength(symbol))
fetch('insights',    () => stockApi.getInsights(symbol))   // calls 4 endpoints internally
```

Each call is independent. Components render as soon as their data arrives (loading spinner until then).

### Components that need no new API call

Two components derive everything from already-loaded data:

- **WhatChangedToday** — reads `summary`, `rs`, `risk`, `drawdown`, `percentiles` and derives events client-side
- **OpportunityDashboard** — computes a 0–100 score from `summary`, `rs`, `risk`, `drawdown`

---

## 10. Theme

`theme.ts` defines two things:

| Export | Used by |
|--------|---------|
| `theme` | MUI ThemeProvider — controls all component colours, typography, shape |
| `hcDarkTheme` | Spread into every Highcharts options object — controls chart colours |

**Colour rules:**
- `#f1f5f9` white — primary text
- `#64748b` slate — secondary text / axis labels
- `#3b82f6` blue — interactive elements only (buttons, links, active state)
- `#22c55e` green — positive financial data (price up, above SMA, good score)
- `#ef4444` red — negative financial data (price down, below SMA, drawdown)
- `#f59e0b` amber — warning / neutral / volatility
- `#6366f1` indigo — secondary series (SMA200 lines)

---

## 11. TypeScript ↔ Python Contract

Every Pydantic model in `app/models/stock.py` has a matching TypeScript interface in `src/types/stock.ts`.

When you add a new endpoint:
1. Add Pydantic model in `models/stock.py`
2. Add calculation in `services/stock_metrics.py`
3. Add route in `routers/stock.py`
4. Add TypeScript interface in `src/types/stock.ts`
5. Add fetch call in `src/api/stockApi.ts`
6. Build the React component

---

## 12. How to Add a New Metric (Example: Volume Surge Score)

**Step 1 — Pydantic model** (`app/models/stock.py`):
```python
class VolumeSurgeResponse(BaseModel):
    symbol: str
    current_volume: int
    volume_20d_avg: int
    surge_ratio: float          # current / 20d avg
    surge_percentile: float     # where this ratio sits historically
```

**Step 2 — Calculation** (`app/services/stock_metrics.py`):
```python
def get_volume_surge(symbol: str) -> VolumeSurgeResponse:
    con = get_connection()
    df = con.execute(f"""
        SELECT volume,
               AVG(volume) OVER (ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg20
        FROM equities_prices
        WHERE symbol = '{symbol}'
        ORDER BY date
    """).pl()
    rows = df.to_dicts()
    last = rows[-1]
    ratio = last["volume"] / last["avg20"] if last["avg20"] else 1
    all_ratios = [r["volume"] / r["avg20"] for r in rows if r["avg20"]]
    pct = round(float(np.mean(np.array(all_ratios) <= ratio) * 100), 1)
    return VolumeSurgeResponse(
        symbol=symbol,
        current_volume=int(last["volume"]),
        volume_20d_avg=int(last["avg20"]),
        surge_ratio=round(ratio, 2),
        surge_percentile=pct,
    )
```

**Step 3 — Route** (`app/routers/stock.py`):
```python
@router.get("/{symbol}/volume-surge", response_model=VolumeSurgeResponse)
def stock_volume_surge(symbol: str):
    try:
        return stock_metrics.get_volume_surge(symbol.upper())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Step 4 — TypeScript type** (`src/types/stock.ts`):
```typescript
export interface VolumeSurgeResponse {
  symbol: string
  current_volume: number
  volume_20d_avg: number
  surge_ratio: number
  surge_percentile: number
}
```

**Step 5 — API call** (`src/api/stockApi.ts`):
```typescript
getVolumeSurge: (symbol: string) => get<VolumeSurgeResponse>(`${BASE}/${symbol}/volume-surge`),
```

**Step 6 — Component** (`src/components/stock/VolumeSurge.tsx`) — build a component that accepts `data: VolumeSurgeResponse | null` and renders it.

**Step 7 — Wire into StockPage.tsx** — add to the `StockData` interface, `INITIAL`, `INIT_LOAD`, the fetch call, and the JSX section.

---

## 13. Running Locally

```
# Backend
cd marketdna-backend
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Frontend
cd marketdna-web
npm run dev -- --host 127.0.0.1
```

| URL | What |
|-----|------|
| http://localhost:5173 | React frontend |
| http://localhost:8000/docs | FastAPI Swagger UI |
| http://localhost:8000/health | Backend health check |

The frontend proxies `/api/*` to port 8000 via Vite config (no CORS issues in dev).

---

## 14. Key Rules (Non-Negotiable)

1. **All calculations happen in Python/DuckDB.** Never calculate metrics in JavaScript.
2. **DuckDB does aggregation; Python does post-processing.** Keep the split clean.
3. **Every metric is deterministic.** Same inputs → same output. No randomness or hidden state.
4. **The LLM never calculates.** It only calls `run_query` and explains the result.
5. **Raw parquet data is immutable.** Never write to `data_lake/raw/`.
6. **Every response model has a TypeScript mirror.** Keep them in sync.
