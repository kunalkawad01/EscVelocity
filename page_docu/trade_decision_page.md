# TradeDecisionPage — `/trade-decision`

## What It Does

The Trade Decision Agent is MarketDNA's live trade intelligence layer. It answers one question: **should I take this trade right now?**

Two entry modes:

- **Analyze Mode** — trader inputs symbol + direction (LONG/SHORT) + instrument type (EQUITY/OPTIONS/FUTURES). Agent runs immediately.
- **Scan Mode** — scans the NIFTY 50 universe for high-confidence setups. Takes 30–90 seconds. Clicking any result drills into the full brief.

The right panel always shows the full **TradeBrief**: a research report with verdict, confidence score, and five analytical sections from five parallel sub-agents.

---

## Agent Architecture

```
TradeDecisionAgent (orchestrator)
          │
    ┌─────┴──────────────────────────────────────────────┐
    │            Phase 1 (parallel)                       │
    ▼                  ▼                  ▼               │
MarketContext    InstrumentAnalysis   SignalConvergence   │
SubAgent         SubAgent             SubAgent            │
(25% weight)     (35% weight)         (20% weight)        │
    │                  │                  │               │
    └──────────────────┴──────────────────┘               │
                       │                                  │
             ┌─────────┴──────────┐                       │
             │   Phase 2 (parallel)│                      │
             ▼                    ▼                       │
     RiskCalibration      HistoricalContext               │
     SubAgent              SubAgent                       │
     (10% weight)          (10% weight)                   │
             │                    │                       │
             └─────────┬──────────┘                       │
                       │                                  │
             confidence = weighted sum                    │
             verdict = STRONG GO / GO / WEAK GO /         │
                       NO-GO / STRONG NO-GO               │
             narrative = Anthropic SDK (Haiku)            │
```

### Sub-Agent responsibilities

| Sub-Agent | Data sources | Key output |
|-----------|-------------|------------|
| **MarketContextSubAgent** | `regime_service.get_snapshot()`, `get_breadth()` | regime score, breadth score, posture (BULL/BEAR/SIDEWAYS) |
| **InstrumentAnalysisSubAgent** | `stock_metrics.get_summary()`, `markov_options_service.get_symbol()` | DNA score, RS score, IV rank, instrument score |
| **SignalConvergenceSubAgent** | `indicators_service.get_symbol()`, `patterns_service.get_stock_dna()`, `delivery_service.get_delivery_report()`, `regime_service.get_symbol_regime()` | confirming/contradicting/neutral signals, alignment score |
| **RiskCalibrationSubAgent** | `stock_metrics.get_volatility()` | ATR-based stop loss, targets, R/R ratio, position size |
| **HistoricalContextSubAgent** | `delivery_service.get_delivery_report()` | win rate, regime-conditioned WR, comparable setups |

### Verdict thresholds

| Confidence | Verdict | Color |
|-----------|---------|-------|
| ≥ 75 | STRONG GO | `#22c55e` |
| ≥ 60 | GO | `#4ade80` |
| ≥ 50 | WEAK GO | `#fbbf24` |
| ≥ 35 | NO-GO | `#f97316` |
| < 35 | STRONG NO-GO | `#ef4444` |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/trade-decision/analyze` | Full 5-agent brief for one symbol. Body: `AnalyzeRequest` |
| `POST` | `/api/trade-decision/scan` | Scan top-60 universe for setups. Body: `ScanRequest` |

### AnalyzeRequest
```json
{
  "symbol":          "RELIANCE",
  "direction":       "LONG",
  "instrument_type": "EQUITY",
  "entry_price":     2950.0,
  "account_size":    500000.0
}
```

### ScanRequest
```json
{
  "instrument_types": ["EQUITY"],
  "min_confidence":   55.0,
  "max_results":      20
}
```

### TradeBriefResponse (abridged)
```json
{
  "symbol": "RELIANCE",
  "direction": "LONG",
  "confidence": 71.4,
  "verdict": "GO",
  "verdict_color": "#4ade80",
  "narrative": "...",
  "trade_checklist": ["✅ ...", "❌ ..."],
  "market_context":      { "regime_score": 68, "breadth_score": 72, "posture": "BULL" },
  "instrument_analysis": { "dna_score": 74, "regime_score": 71, "rs_score": 68 },
  "signal_convergence":  { "confirming_signals": ["..."], "contradicting_signals": [] },
  "risk_calibration":    { "risk_reward_ratio": 2.3, "stop_loss": 2908, "target_1": 3040 },
  "historical_context":  { "win_rate_similar": 63.0, "comparable_setups_count": 28 }
}
```

---

## UI Layout

```
[Navbar]
[Hero: gradient, Live Intelligence badge, headline, mode toggle]

[Left 4-col: sticky]           [Right 8-col]
  Analyze Mode                   ┌─ Verdict Header ────────────────┐
  ├─ Symbol input                │  ▲ RELIANCE  EQUITY             │
  ├─ LONG / SHORT toggle         │  Narrative paragraph            │
  ├─ Instrument selector         │  Trade checklist (5 items)      │
  ├─ Entry price (optional)      │  Confidence ring 71  [GO ◆]     │
  ├─ Capital (optional)          └─────────────────────────────────┘
  └─ Run Analysis button
                                 ┌─ 01 Market Context ─┐ ┌─ 02 Instrument ─┐
  Scan Mode                      │ regime · breadth    │ │ DNA · RS · IV   │
  ├─ Run Scan button             └────────────────────┘ └─────────────────┘
  └─ Scan results list           ┌─ 03 Signal Convergence (full width) ──────┐
     (ScanRow per setup)         │ [signal pills: green confirm / red contra] │
                                 └────────────────────────────────────────────┘
                                 ┌─ 04 Risk Calibration ─┐ ┌─ 05 Historical ─┐
                                 │ Stop · T1 · T2 · R/R  │ │ WR · setups     │
                                 └──────────────────────┘ └────────────────┘
[Footer]
```

---

## File Map

| Layer | File |
|-------|------|
| Agent (orchestrator + 5 sub-agents) | `agents/trade_decision_agent.py` |
| Pydantic models | `marketdna-backend/app/models/trade_decision.py` |
| Service (router↔agent bridge) | `marketdna-backend/app/services/trade_decision_service.py` |
| FastAPI router | `marketdna-backend/app/routers/trade_decision.py` |
| TypeScript types | `marketdna-web/src/types/trade_decision.ts` |
| API client | `marketdna-web/src/api/tradeDecisionApi.ts` |
| React page | `marketdna-web/src/pages/TradeDecisionPage.tsx` |

---

## Optimization

- **Phase 1 sub-agents run in parallel** via `asyncio.gather` (market + instrument + signal simultaneously). Phase 2 (risk + history) also parallel. Total latency: ~3–6 seconds.
- **Scan caps at 60 symbols** in batches of 10. De-duplicates by keeping best direction per symbol.
- **LLM narrative** uses `claude-haiku-4-5-20251001` with MAX 300 tokens. Falls back to template string on error — never blocks the brief.
- **No startup prewarm** for this service — it is on-demand by nature. All data is pulled from already-warmed caches in regime/delivery/indicators services.

---

## Lessons Learnt

- Sub-agents use `asyncio.to_thread()` for all synchronous service calls — this prevents DuckDB blocking the asyncio event loop.
- The agents/ directory requires a sys.path insert at service import time because it lives outside the `app/` package. The `_get_agent()` factory handles this.
- All sub-agents catch and swallow exceptions individually — a failure in one does not abort the whole brief. Defaults to 50/100 scores.
- Risk calibration requires an entry_price to compute stops. Without it, risk_score defaults to 50 and all price levels are null.
- Short direction scoring inverts DNA/regime: a low DNA stock is a GOOD short candidate, not a bad one.

---

## Business Logic

### Weight rationale
- **Instrument (35%)** is the highest weight because a strong setup in a bad market can still work — but a weak instrument in a good market almost never does.
- **Market (25%)** is the second — regime and breadth are the tide that lifts all boats.
- **Signal convergence (20%)** — multi-factor confirmation significantly improves reliability.
- **Risk (10%)** and **History (10%)** are supporting factors: necessary but not sufficient.

### Direction scoring
- LONG: uses raw DNA + regime + RS scores (high = better)
- SHORT: inverts DNA + regime + RS (low scores = better short candidates)
- Options: LONG prefers low IV rank (cheap premium); SHORT/sell prefers high IV rank (rich premium)

### Trade checklist (5 mandatory checks)
1. Market posture aligns with direction
2. Instrument score ≥ 60
3. Confirming signals outnumber contradicting
4. R/R ratio ≥ 2:1
5. Stop loss is defined

---

## Tech Stack

- **Backend**: FastAPI + Pydantic v2, asyncio.gather, Anthropic SDK (Haiku)
- **Frontend**: React + MUI, usePalette/useTokens, ToggleButtonGroup, LinearProgress, custom SVG ScoreRing

---

## Suggestions

1. **Cache analyze results** per (symbol, direction, instrument_type, date) in an in-process dict — avoids re-running the full agent on repeated requests for the same setup within a session.
2. **Scan prewarm**: run the scan nightly after data ingestion and save to `data_lake/derived/trade_decision/scan.parquet`. Morning open: serve instantly.
3. **India VIX integration**: wire `vix_level` to live NSE VIX data (currently always `null`). High VIX = reduce confidence for directional longs; increase for vol-selling strategies.
4. **Options-specific sub-agent**: expand `InstrumentAnalysisSubAgent._analyze_options()` to pull full IV surface, PCR, max pain from `options_service`.
5. **Futures basis**: wire `InstrumentAnalysisSubAgent._analyze_futures()` to `futures_service` for real basis premium and OI data.
6. **Streaming verdict**: stream the LLM narrative token by token using `client.messages.stream()` for perceived speed improvement.
7. **Trade journal integration**: after taking a trade, save the TradeBrief as a timestamped JSON to `data_lake/derived/trade_journal/`. Build a journal page to review GO decisions vs outcomes.
