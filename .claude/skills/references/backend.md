# Backend Integration — FastAPI + Kite Connect

This file documents the FastAPI endpoints needed to serve the Company
Intelligence page with live market data from Kite Connect, and cached
AI analysis via DuckDB.

---

## Architecture

```
React Frontend
    │
    ├── POST /api/intelligence/{ticker}   ← AI analysis (DuckDB cached)
    └── GET  /api/quote/{ticker}          ← Live Kite Connect data
```

Both calls are fired in parallel on page load. The AI analysis populates
the 11 modules; the quote overlays the ticker bar with live prices.

---

## DuckDB cache schema

```sql
CREATE TABLE IF NOT EXISTS company_intelligence (
    ticker       VARCHAR PRIMARY KEY,
    company_name VARCHAR,
    analysis_json JSON,
    fetched_at   TIMESTAMP DEFAULT NOW(),
    cache_ttl_h  INTEGER DEFAULT 24
);

-- Query pattern
SELECT analysis_json
FROM company_intelligence
WHERE ticker = ?
  AND fetched_at > NOW() - INTERVAL (cache_ttl_h || ' hours');
```

Cache TTL: 24 hours for qualitative analysis (sector, supply chain,
Porter's, etc. don't change intraday). Invalidate on explicit user refresh.

---

## Endpoint 1 — AI Intelligence

```python
# app/routers/intelligence.py

from fastapi import APIRouter, HTTPException
from app.db import get_duckdb
from app.services.claude import fetch_company_intelligence
import json

router = APIRouter(prefix="/api/intelligence")

@router.post("/{ticker}")
async def get_intelligence(ticker: str):
    ticker = ticker.upper().strip()
    db = get_duckdb()

    # Check cache
    row = db.execute("""
        SELECT analysis_json FROM company_intelligence
        WHERE ticker = ?
          AND fetched_at > NOW() - INTERVAL '24 hours'
    """, [ticker]).fetchone()

    if row:
        return json.loads(row[0])

    # Fetch from Claude API
    try:
        data = await fetch_company_intelligence(ticker)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")

    # Cache in DuckDB
    db.execute("""
        INSERT OR REPLACE INTO company_intelligence
            (ticker, company_name, analysis_json, fetched_at)
        VALUES (?, ?, ?, NOW())
    """, [ticker, data.get("company", ticker), json.dumps(data)])

    return data
```

---

## Endpoint 2 — Live Quote from Kite

```python
# app/routers/quote.py

from fastapi import APIRouter, HTTPException
from app.services.kite import get_kite_client

router = APIRouter(prefix="/api/quote")

@router.get("/{ticker}")
async def get_quote(ticker: str):
    ticker = ticker.upper().strip()
    kite = get_kite_client()

    try:
        # Kite instrument token lookup
        instruments = kite.instruments("NSE")
        token = next(
            (i["instrument_token"] for i in instruments
             if i["tradingsymbol"] == ticker), None
        )
        if not token:
            raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found on NSE")

        quote = kite.quote(f"NSE:{ticker}")[f"NSE:{ticker}"]
        ohlc = quote.get("ohlc", {})

        return {
            "ticker": ticker,
            "last_price": quote.get("last_price"),
            "net_change": round(quote.get("net_change", 0), 2),
            "pct_change": round(
                (quote.get("net_change", 0) / ohlc.get("close", 1)) * 100, 2
            ),
            "volume": quote.get("volume"),
            "high_52w": quote.get("upper_circuit_limit"),  # approximate
            "low_52w": quote.get("lower_circuit_limit"),   # approximate
            "oi": quote.get("oi"),
            "buy_quantity": quote.get("buy_quantity"),
            "sell_quantity": quote.get("sell_quantity"),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
```

---

## Kite client singleton

```python
# app/services/kite.py

from kiteconnect import KiteConnect
from functools import lru_cache
import os

@lru_cache(maxsize=1)
def get_kite_client() -> KiteConnect:
    kite = KiteConnect(api_key=os.environ["KITE_API_KEY"])
    kite.set_access_token(os.environ["KITE_ACCESS_TOKEN"])
    return kite
```

---

## Claude service wrapper

````python
# app/services/claude.py

import anthropic
import json
import os
from app.prompts import INTELLIGENCE_SYSTEM_PROMPT, INTELLIGENCE_USER_TEMPLATE, JSON_SCHEMA

client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

async def fetch_company_intelligence(ticker: str) -> dict:
    message = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        system=INTELLIGENCE_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": INTELLIGENCE_USER_TEMPLATE.format(
                company=ticker,
                schema=JSON_SCHEMA
            )
        }]
    )
    raw = "".join(b.text for b in message.content if b.type == "text")
    clean = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(clean)
````

---

## React — parallel fetch pattern

```javascript
// hooks/useCompanyIntelligence.js

import { useState, useEffect } from "react";

export function useCompanyIntelligence(ticker) {
  const [intelligence, setIntelligence] = useState(null);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);

    // Fire both in parallel
    Promise.allSettled([
      fetch(`/api/intelligence/${ticker}`, { method: "POST" }).then((r) =>
        r.json(),
      ),
      fetch(`/api/quote/${ticker}`).then((r) => r.json()),
    ])
      .then(([intResult, quoteResult]) => {
        if (intResult.status === "fulfilled") setIntelligence(intResult.value);
        else setError(intResult.reason);

        if (quoteResult.status === "fulfilled") setQuote(quoteResult.value);
        // quote failure is non-fatal — AI data still renders
      })
      .finally(() => setLoading(false));
  }, [ticker]);

  // Merge: live quote overrides ticker bar fields from AI analysis
  const merged = intelligence
    ? {
        ...intelligence,
        ...(quote
          ? {
              last_price: quote.last_price,
              net_change: quote.net_change,
              pct_change: quote.pct_change,
              high_52w: quote.high_52w
                ? `₹${quote.high_52w}`
                : intelligence.high_52w,
              low_52w: quote.low_52w
                ? `₹${quote.low_52w}`
                : intelligence.low_52w,
            }
          : {}),
      }
    : null;

  return { data: merged, loading, error };
}
```

---

## Environment variables

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
KITE_API_KEY=...
KITE_ACCESS_TOKEN=...
DUCKDB_PATH=./data/marketdna.duckdb
```

---

## APScheduler — pre-warm cache

Pre-warm analysis for a watchlist of Nifty 50 companies every morning at
08:45 IST (before market open) so users get instant results for popular
tickers.

```python
# app/scheduler.py

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.services.claude import fetch_company_intelligence
from app.db import get_duckdb
import json

NIFTY50_TICKERS = [
    "RELIANCE", "INFY", "HDFCBANK", "ICICIBANK", "TCS",
    "KOTAKBANK", "HINDUNILVR", "AXISBANK", "ITC", "LT",
    # ... add full list
]

scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

@scheduler.scheduled_job("cron", hour=8, minute=45)
async def prewarm_intelligence():
    db = get_duckdb()
    for ticker in NIFTY50_TICKERS:
        try:
            data = await fetch_company_intelligence(ticker)
            db.execute("""
                INSERT OR REPLACE INTO company_intelligence
                    (ticker, company_name, analysis_json, fetched_at)
                VALUES (?, ?, ?, NOW())
            """, [ticker, data.get("company", ticker), json.dumps(data)])
        except Exception as e:
            print(f"Pre-warm failed for {ticker}: {e}")
```
