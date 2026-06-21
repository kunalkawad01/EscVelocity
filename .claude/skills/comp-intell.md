---
name: marketdna-company-intelligence
description: >
  Backend intelligence layer for any Nifty 500 company inside MarketDNA.
  Builds a FastAPI service that: (1) fetches live quotes, OHLCV, OI, and
  fundamentals from Kite Connect, (2) generates AI-powered qualitative
  analysis via Claude API covering business overview, supply chain, Porter's
  5 forces, margin profile, client base, sector growth, tailwinds/headwinds,
  and revenue predictors, (3) caches everything in DuckDB with a 24-hour TTL,
  and (4) pre-warms Nifty 50 at 08:45 IST via APScheduler. Use this skill
  whenever Kunal asks to implement, wire up, or extend the company
  intelligence backend, add Kite data to the intelligence page, build the
  FastAPI endpoints for company data, or integrate Claude analysis into
  MarketDNA. This skill covers backend and data layer only — Kite Connect,
  Claude API, FastAPI endpoints, DuckDB caching, and APScheduler jobs.
  Do not touch or suggest changes to the existing frontend or GUI theme.
---

# MarketDNA — Company Intelligence Backend

## What this skill builds

Three FastAPI endpoints backed by Kite Connect + Claude API + DuckDB:

| Endpoint                                      | Source                      | Data                         |
| --------------------------------------------- | --------------------------- | ---------------------------- |
| `POST /api/intelligence/{ticker}`             | Claude API + DuckDB cache   | All 11 qualitative modules   |
| `GET /api/intelligence/quote/{ticker}`        | Kite Connect live           | Price, volume, OI, 52W range |
| `GET /api/intelligence/fundamentals/{ticker}` | Kite Connect + DuckDB OHLCV | Historical + derived ratios  |
| `DELETE /api/intelligence/cache/{ticker}`     | DuckDB                      | Cache invalidation           |

All Claude API calls stay server-side. Endpoints return clean JSON.
`ANTHROPIC_API_KEY` never leaves the FastAPI process.

---

## Implementation steps

Work through these in order. Ask Kunal to confirm each step before moving on.
Never overwrite an existing file without asking first.

---

### Step 1 — Confirm existing structure

Before writing any files, ask:

1. "What is your FastAPI app entry point — `main.py`, `app/main.py`, or something else?"
2. "Where do your existing routers live — `app/routers/`?"
3. "Where is your DuckDB init code — where do you `CREATE TABLE` for other tables?"
4. "Where is your Kite client singleton — what file and function name?"
5. "Do you already have `ANTHROPIC_API_KEY` in your `.env`?"
6. "Do you have six years of OHLCV already in DuckDB, and what is the table name and schema?"

Adapt all paths below to match his answers.

---

### Step 2 — Install Python dependencies

```bash
pip install anthropic kiteconnect apscheduler --break-system-packages
```

Verify: `python -c "import anthropic; import kiteconnect; import apscheduler; print('ok')`

---

### Step 3 — Environment variables

Add to `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...         # console.anthropic.com — backend only, never frontend
KITE_API_KEY=...                      # kite.trade developer console
KITE_ACCESS_TOKEN=...                # refreshed daily — see Step 9 for auto-refresh
DUCKDB_PATH=./data/marketdna.duckdb  # match your existing path exactly
```

Load in FastAPI with `python-dotenv` or however you already load env vars.

---

### Step 4 — DuckDB tables

Add to your existing DuckDB init block:

```python
db.execute("""
    CREATE TABLE IF NOT EXISTS company_intelligence (
        ticker        VARCHAR PRIMARY KEY,
        company_name  VARCHAR,
        analysis_json JSON,
        fetched_at    TIMESTAMP DEFAULT NOW()
    )
""")

db.execute("""
    CREATE TABLE IF NOT EXISTS company_quotes_cache (
        ticker       VARCHAR PRIMARY KEY,
        quote_json   JSON,
        fetched_at   TIMESTAMP DEFAULT NOW()
    )
""")
```

`company_intelligence` TTL = 24 hours (qualitative data doesn't change intraday).
`company_quotes_cache` TTL = 5 minutes (use for rate-limit protection only;
prefer live Kite calls during market hours).

---

### Step 5 — Kite service: what to fetch per company

This is the full set of data to pull from Kite for each company.
Wire this into your existing Kite client singleton — don't create a second one.

```python
# app/services/kite_intelligence.py

import os
from app.db import get_duckdb          # adjust to your import
from app.services.kite import get_kite_client  # your existing singleton

def get_live_quote(ticker: str) -> dict:
    """Live quote — call during market hours (09:15–15:30 IST)."""
    kite = get_kite_client()
    symbol = f"NSE:{ticker}"
    q = kite.quote(symbol)[symbol]
    ohlc = q.get("ohlc", {})
    depth = q.get("depth", {})

    return {
        "ticker":         ticker,
        "last_price":     q.get("last_price"),
        "open":           ohlc.get("open"),
        "high":           ohlc.get("high"),
        "low":            ohlc.get("low"),
        "close":          ohlc.get("close"),
        "net_change":     round(q.get("net_change", 0), 2),
        "pct_change":     round(
            (q.get("net_change", 0) / max(ohlc.get("close", 1), 1)) * 100, 2
        ),
        "volume":         q.get("volume"),
        "avg_price":      q.get("average_price"),
        "oi":             q.get("oi"),                 # F&O stocks only
        "oi_day_high":    q.get("oi_day_high"),
        "oi_day_low":     q.get("oi_day_low"),
        "buy_qty":        q.get("buy_quantity"),
        "sell_qty":       q.get("sell_quantity"),
        "upper_circuit":  q.get("upper_circuit_limit"),
        "lower_circuit":  q.get("lower_circuit_limit"),
        "52w_high":       q.get("upper_circuit_limit"),  # approximate; replace with
        "52w_low":        q.get("lower_circuit_limit"),  # historical if available
        "bid":            depth.get("buy", [{}])[0].get("price"),
        "ask":            depth.get("sell", [{}])[0].get("price"),
    }


def get_historical_summary(ticker: str, db=None) -> dict:
    """
    Derives rolling metrics from your existing OHLCV DuckDB table.
    Adjust table name and column names to match your actual schema.
    """
    if db is None:
        db = get_duckdb()

    # Change 'ohlcv' and column names to match your table
    row = db.execute("""
        SELECT
            MAX(high)                                          AS high_52w,
            MIN(low)                                          AS low_52w,
            AVG(volume)                                       AS avg_vol_30d,
            STDDEV(close / LAG(close) OVER (ORDER BY date) - 1)
                                                              AS daily_vol,
            LAST(close ORDER BY date)                         AS last_close,
            LAST(close ORDER BY date)
                / FIRST(close ORDER BY date) - 1             AS ret_1y
        FROM ohlcv
        WHERE ticker = ?
          AND date >= CURRENT_DATE - INTERVAL '365 days'
    """, [ticker]).fetchone()

    if not row:
        return {}

    return {
        "high_52w":    round(row[0], 2) if row[0] else None,
        "low_52w":     round(row[1], 2) if row[1] else None,
        "avg_vol_30d": int(row[2]) if row[2] else None,
        "daily_vol":   round(row[3] * 100, 2) if row[3] else None,   # % annualised
        "last_close":  round(row[4], 2) if row[4] else None,
        "ret_1y_pct":  round(row[5] * 100, 2) if row[5] else None,
    }


def get_instrument_meta(ticker: str) -> dict:
    """
    Pulls instrument metadata from Kite instruments list.
    Includes exchange, segment, lot size, tick size.
    """
    kite = get_kite_client()
    instruments = kite.instruments("NSE")
    match = next(
        (i for i in instruments if i["tradingsymbol"] == ticker), None
    )
    if not match:
        return {}
    return {
        "instrument_token": match.get("instrument_token"),
        "exchange":         match.get("exchange"),
        "segment":          match.get("segment"),
        "instrument_type":  match.get("instrument_type"),
        "lot_size":         match.get("lot_size"),
        "tick_size":        match.get("tick_size"),
        "expiry":           str(match.get("expiry")) if match.get("expiry") else None,
    }
```

---

### Step 6 — Claude service: qualitative intelligence

````python
# app/services/claude_intelligence.py

import anthropic
import json
import os

client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

SYSTEM_PROMPT = (
    "You are a senior equity research analyst at a top Indian institutional "
    "research firm with deep expertise in NSE/BSE listed companies, Indian "
    "sector dynamics, supply chain analysis, and F&O markets. "
    "Return ONLY valid JSON with no markdown, no preamble, no backtick fences. "
    "All numbers are approximate and for directional/educational use."
)

JSON_SCHEMA = """{
  "company":              "Full official company name",
  "ticker":               "NSE ticker",
  "tagline":              "One plain sentence, max 15 words, zero jargon",
  "what_they_do":         "2-3 sentences plain English. What do they make/sell/serve. How do they earn money.",
  "sector":               "GICS sector",
  "industry":             "Specific industry within sector",
  "sub_industry":         "Sub-industry or niche",
  "industry_keywords":    ["keyword1","keyword2","keyword3","keyword4"],
  "supply_chain": [
    {"stage": "Raw Material",   "players": "key inputs and where they come from"},
    {"stage": "Manufacturing",  "players": "how the product is made / processed"},
    {"stage": "Distribution",   "players": "channels used to reach market"},
    {"stage": "End Customer",   "players": "who ultimately buys and uses"}
  ],
  "company_position_in_sc": "Which stage above and what that means for margin capture",
  "sc_risks": [
    {"risk": "name", "severity": "HIGH",   "desc": "One sentence."},
    {"risk": "name", "severity": "HIGH",   "desc": "One sentence."},
    {"risk": "name", "severity": "MEDIUM", "desc": "One sentence."},
    {"risk": "name", "severity": "LOW",    "desc": "One sentence."}
  ],
  "client_types": [
    {"name": "Client segment", "pct": 40},
    {"name": "Client segment", "pct": 35},
    {"name": "Client segment", "pct": 25}
  ],
  "client_concentration":      "CONCENTRATED | MODERATE | DIVERSIFIED",
  "client_concentration_note": "One sentence. e.g. Top 5 clients = 65% of revenue.",
  "top_clients_examples":      ["Client A", "Client B", "Client C"],
  "market_leader":    true,
  "market_rank":      "#1 by revenue in India",
  "market_share_pct": 35,
  "main_competitors": [
    {"name": "Competitor 1", "share_pct": 25},
    {"name": "Competitor 2", "share_pct": 20},
    {"name": "Others",       "share_pct": 20}
  ],
  "porter": {
    "rivalry":        {"score": 7, "desc": "One sentence on competitive rivalry intensity."},
    "buyer_power":    {"score": 5, "desc": "One sentence on buyer bargaining power."},
    "supplier_power": {"score": 4, "desc": "One sentence on supplier bargaining power."},
    "new_entrants":   {"score": 3, "desc": "One sentence on barriers to entry."},
    "substitutes":    {"score": 4, "desc": "One sentence on threat of substitutes."}
  },
  "sector_growing":         true,
  "sector_cagr_pct":        12,
  "sector_growth_drivers":  ["Driver 1", "Driver 2", "Driver 3"],
  "sector_stage":           "EARLY | GROWTH | MATURE | DECLINING",
  "margins": {
    "gross_margin_co":       45,
    "gross_margin_industry": 40,
    "gross_margin_market":   35,
    "ebitda_margin_co":      22,
    "ebitda_margin_industry":18,
    "ebitda_margin_market":  16,
    "pat_margin_co":         14,
    "pat_margin_industry":   11,
    "pat_margin_market":      9
  },
  "tailwinds": ["Tailwind 1", "Tailwind 2", "Tailwind 3", "Tailwind 4"],
  "headwinds": ["Headwind 1", "Headwind 2", "Headwind 3"],
  "predictors": [
    {"name": "Leading indicator name", "why": "Why it leads revenue or margin by 1-3 months."},
    {"name": "Leading indicator name", "why": "Why it leads revenue or margin."},
    {"name": "Leading indicator name", "why": "Why it leads revenue or margin."},
    {"name": "Leading indicator name", "why": "Why it leads revenue or margin."},
    {"name": "Leading indicator name", "why": "Why it leads revenue or margin."}
  ]
}"""


async def fetch_company_intelligence(ticker: str) -> dict:
    msg = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": (
                f'Analyze Indian Nifty 500 company: "{ticker}"\n\n'
                f'Return ONLY this JSON schema, populated with real data:\n{JSON_SCHEMA}'
            )
        }]
    )
    raw = "".join(b.text for b in msg.content if b.type == "text")
    clean = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(clean)   # caller must catch JSONDecodeError
````

---

### Step 7 — FastAPI router

```python
# app/routers/intelligence.py

from fastapi import APIRouter, HTTPException
from app.db import get_duckdb
from app.services.claude_intelligence import fetch_company_intelligence
from app.services.kite_intelligence import (
    get_live_quote, get_historical_summary, get_instrument_meta
)
import json

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])


# ── Qualitative intelligence (Claude API + DuckDB cache) ─────────────────────

@router.post("/{ticker}")
async def get_intelligence(ticker: str):
    """
    Returns all 11 qualitative modules from Claude.
    Cache TTL: 24 hours. First call is ~3-5s; cache hits are instant.
    """
    ticker = ticker.upper().strip()
    db = get_duckdb()

    cached = db.execute("""
        SELECT analysis_json FROM company_intelligence
        WHERE ticker = ?
          AND fetched_at > NOW() - INTERVAL '24 hours'
    """, [ticker]).fetchone()

    if cached:
        return {**json.loads(cached[0]), "_cache": "hit"}

    try:
        data = await fetch_company_intelligence(ticker)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Claude returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")

    db.execute("""
        INSERT OR REPLACE INTO company_intelligence
            (ticker, company_name, analysis_json, fetched_at)
        VALUES (?, ?, ?, NOW())
    """, [ticker, data.get("company", ticker), json.dumps(data)])

    return {**data, "_cache": "miss"}


# ── Live quote from Kite ──────────────────────────────────────────────────────

@router.get("/quote/{ticker}")
def get_quote(ticker: str):
    """
    Live price, volume, OI, bid/ask, circuit limits from Kite.
    Call this separately from the Claude endpoint — fire both in parallel
    from the frontend so live data doesn't block qualitative analysis.
    """
    ticker = ticker.upper().strip()
    try:
        return get_live_quote(ticker)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Kite error: {e}")


# ── Historical summary from DuckDB OHLCV ─────────────────────────────────────

@router.get("/fundamentals/{ticker}")
def get_fundamentals(ticker: str):
    """
    Derived metrics from the 6-year OHLCV DuckDB table:
    52W high/low, avg volume, realised volatility, 1Y return.
    """
    ticker = ticker.upper().strip()
    db = get_duckdb()
    try:
        hist = get_historical_summary(ticker, db)
        meta = get_instrument_meta(ticker)
        return {"ticker": ticker, **hist, **meta}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Cache management ──────────────────────────────────────────────────────────

@router.delete("/cache/{ticker}")
def invalidate_cache(ticker: str):
    """Bust the Claude cache for a ticker — forces a fresh analysis next call."""
    ticker = ticker.upper().strip()
    db = get_duckdb()
    db.execute("DELETE FROM company_intelligence WHERE ticker = ?", [ticker])
    return {"status": "cleared", "ticker": ticker}


@router.get("/cache/status/{ticker}")
def cache_status(ticker: str):
    """Check if a ticker has a fresh cached analysis."""
    ticker = ticker.upper().strip()
    db = get_duckdb()
    row = db.execute("""
        SELECT fetched_at,
               fetched_at > NOW() - INTERVAL '24 hours' AS is_fresh
        FROM company_intelligence WHERE ticker = ?
    """, [ticker]).fetchone()
    if not row:
        return {"ticker": ticker, "cached": False}
    return {"ticker": ticker, "cached": True, "fresh": row[1], "fetched_at": str(row[0])}
```

---

### Step 8 — Register router in main.py

```python
from app.routers.intelligence import router as intelligence_router
app.include_router(intelligence_router)
```

Verify at: `http://localhost:8000/docs` → check all four `/api/intelligence/` routes appear.

---

### Step 9 — Kite access token daily refresh

Kite access tokens expire at midnight. Add this to your APScheduler:

```python
# Add to your existing scheduler setup

import requests
import os

@scheduler.scheduled_job("cron", hour=8, minute=30, timezone="Asia/Kolkata")
def refresh_kite_token():
    """
    Calls your Kite login callback to get a fresh access token each morning.
    Requires KITE_REQUEST_TOKEN to be set, or use a stored refresh mechanism.

    Option A — if you have a stored request_token from yesterday's login:
    """
    from kiteconnect import KiteConnect
    kite = KiteConnect(api_key=os.environ["KITE_API_KEY"])
    # You must provide request_token — this comes from the login redirect URL
    # Automate by storing the redirect URL from a headless browser session
    # or by using Kite's TOTP-based login if your account supports it
    request_token = os.environ.get("KITE_REQUEST_TOKEN")
    if not request_token:
        print("KITE_REQUEST_TOKEN not set — skipping token refresh")
        return
    data = kite.generate_session(request_token, api_secret=os.environ["KITE_API_SECRET"])
    os.environ["KITE_ACCESS_TOKEN"] = data["access_token"]
    # Persist to .env or a secrets store for the singleton to pick up
    print(f"Kite token refreshed at 08:30 IST: {data['access_token'][:8]}…")
```

**Note:** Full Kite token automation requires either a TOTP-based headless
login script or manual daily login. Ask Kunal how he currently handles this
in his existing Kite setup — adapt rather than replace.

---

### Step 10 — APScheduler pre-warm (Nifty 50)

Pre-warm Claude analysis for Nifty 50 tickers every morning at 08:45 IST
so users get instant cache hits for the most common companies:

```python
from app.services.claude_intelligence import fetch_company_intelligence
from app.db import get_duckdb
import json, asyncio

NIFTY50 = [
    "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","HINDUNILVR","ITC",
    "KOTAKBANK","AXISBANK","LT","BAJFINANCE","MARUTI","SUNPHARMA","TATAMOTORS",
    "NESTLEIND","ASIANPAINT","ULTRACEMCO","WIPRO","ONGC","NTPC",
    "POWERGRID","TECHM","HCLTECH","TITAN","BAJAJ-AUTO","M&M","DRREDDY",
    "GRASIM","ADANIPORTS","JSWSTEEL","TATASTEEL","COALINDIA","DIVISLAB",
    "CIPLA","EICHERMOT","SBILIFE","BHARTIARTL","INDUSINDBK","HDFCLIFE",
    "BPCL","IOC","SHREECEM","BRITANNIA","HEROMOTOCO","TATACONSUM",
    "APOLLOHOSP","BAJAJFINSV","UPL","LTIM","PIDILITIND"
]

@scheduler.scheduled_job("cron", hour=8, minute=45, timezone="Asia/Kolkata")
async def prewarm_intelligence():
    db = get_duckdb()
    for ticker in NIFTY50:
        # Skip if already fresh
        row = db.execute("""
            SELECT 1 FROM company_intelligence
            WHERE ticker = ? AND fetched_at > NOW() - INTERVAL '20 hours'
        """, [ticker]).fetchone()
        if row:
            continue
        try:
            data = await fetch_company_intelligence(ticker)
            db.execute("""
                INSERT OR REPLACE INTO company_intelligence
                    (ticker, company_name, analysis_json, fetched_at)
                VALUES (?, ?, ?, NOW())
            """, [ticker, data.get("company", ticker), json.dumps(data)])
            await asyncio.sleep(1)   # avoid rate-limiting Claude API
        except Exception as e:
            print(f"Pre-warm failed {ticker}: {e}")
```

---

### Step 11 — Verify end-to-end

Run these curl tests in order:

```bash
# 1. Qualitative intelligence (expect ~3-5s first call)
curl -X POST http://localhost:8000/api/intelligence/RELIANCE | python -m json.tool

# 2. Cache hit (expect <100ms)
curl -X POST http://localhost:8000/api/intelligence/RELIANCE | python -m json.tool

# 3. Cache status
curl http://localhost:8000/api/intelligence/cache/status/RELIANCE

# 4. Live Kite quote (run during market hours for live data)
curl http://localhost:8000/api/intelligence/quote/RELIANCE | python -m json.tool

# 5. Historical fundamentals from your OHLCV table
curl http://localhost:8000/api/intelligence/fundamentals/RELIANCE | python -m json.tool

# 6. Cache invalidation
curl -X DELETE http://localhost:8000/api/intelligence/cache/RELIANCE
```

Expected response shape for `POST /api/intelligence/RELIANCE`:

```json
{
  "company": "Reliance Industries Limited",
  "ticker": "RELIANCE",
  "tagline": "India's largest conglomerate spanning energy, retail, and telecom",
  "what_they_do": "...",
  "sector": "Energy",
  "supply_chain": [...],
  "porter": {...},
  "margins": {...},
  "_cache": "miss"
}
```

---

## Data sources by field

| Field                                                             | Source                | Notes                           |
| ----------------------------------------------------------------- | --------------------- | ------------------------------- |
| `last_price`, `volume`, `oi`, `bid/ask`                           | Kite live quote       | Real-time during market hours   |
| `52w_high`, `52w_low`                                             | DuckDB OHLCV (6yr)    | Exact from your historical data |
| `avg_vol_30d`, `daily_vol`, `ret_1y`                              | DuckDB OHLCV derived  | Computed via SQL in Step 5      |
| `lot_size`, `tick_size`, `segment`                                | Kite instruments list | Static; cache on startup        |
| `what_they_do`, `supply_chain`, `porter`, `margins`, `predictors` | Claude API            | Cached 24h in DuckDB            |
| `sector`, `industry`, `market_share_pct`, `client_types`          | Claude API            | Cached 24h in DuckDB            |

---

## Troubleshooting

| Problem                            | Fix                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `502 Claude API error`             | Check `ANTHROPIC_API_KEY` is set in env; print `os.environ.get("ANTHROPIC_API_KEY")`                                   |
| `502 Claude returned invalid JSON` | Add `print(raw)` in `fetch_company_intelligence` to see raw output; usually a partial response — increase `max_tokens` |
| `502 Kite error` on quote          | Access token expired — run token refresh manually or check Step 9                                                      |
| OHLCV query returns empty          | Confirm your table name and ticker format match exactly; Kite uses `RELIANCE` not `RELIANCE.NS`                        |
| Pre-warm fails silently            | Check APScheduler timezone is `Asia/Kolkata`; check logs for per-ticker errors                                         |
| Cache not expiring                 | DuckDB `NOW()` uses UTC by default — convert to IST or use epoch math                                                  |

---

## Files in this skill

| File                    | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `SKILL.md`              | This file — full backend implementation guide |
| `references/backend.md` | Extended FastAPI + Kite Connect reference     |
