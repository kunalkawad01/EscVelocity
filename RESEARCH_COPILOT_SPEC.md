# MarketDNA — Research Copilot & Live Market Agent

**Build specification — implementation & reproducibility reference**
Status: proposed · Owner: Kunal · Last updated: 2026-07-23

---

## 0. Purpose of this document

This spec describes two LLM agents built on top of the existing MarketDNA data + quant stack, and is written to be **directly buildable and reproducible**: every tool has a schema, every phase has acceptance criteria, and every numeric output is traceable through a computation manifest.

It supersedes the current per-symbol assistant (`app/routers/assistant.py` + `app/services/ai_assistant.py`), which is stock-scoped and wired to the 8 feature tools. The Copilot is a **fresh tool-use loop** over `equities_prices` and a purpose-built quant toolset — not a reuse of the existing feature tools.

Two agents, one shared engine:

| Agent | Timeframe | Job | Page |
|-------|-----------|-----|------|
| **Research Agent** | Historical (EOD) | Screen, EDA, backtest, event study, validate | New `/research-copilot` page |
| **Live Market Agent** | Intraday (Kite) | Observe, detect state changes, narrate, hypothesize, monitor — **read-only** | Existing `/live-trading` page (new section) |

The Live Agent never invents a signal or a statistic: it either reads a **deterministic detector** or calls the Research Agent's tools to validate a claim against history.

---

## 1. Non-negotiable principles

These come from `CLAUDE.md` and are hard constraints, not preferences.

1. **LLM never computes.** No indicator, ratio, probability, or return is ever produced by the model in text. Every number comes from a tool invocation. No tool call → no answer.
2. **Determinism is mandatory.** Identical inputs → identical output. All seeds fixed (`random_state=42`, `np.random.seed(42)`). No hidden state feeds signals.
3. **Every answer ships a computation manifest** (§6). An answer is auditable and re-runnable or it doesn't ship.
4. **Validation-gated claims.** A hypothesis or "strategy for today" is never presented as a conclusion until validated against a historical sample by a tool. (`CLAUDE.md` golden rule: validation over intuition.)
5. **Live layer is read-only.** It observes, computes, alerts. It never places, modifies, or cancels an order. No exceptions.
6. **Detectors decide signals; the LLM only narrates.** The model's narrative never feeds back into what counts as a signal. This is how a non-deterministic narrator sits on a deterministic core without violating principle 2.

---

## 2. Architecture

```
                         ┌─────────────────────────────┐
                         │   Shared Research Engine     │
                         │  (deterministic, cached,     │
                         │   manifest-logged)           │
                         └──────────────┬───────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                                                                │
┌───────▼────────┐                                              ┌────────▼────────┐
│ RESEARCH AGENT │  historical OHLCV                            │  LIVE AGENT     │  intraday Kite
│                │                                              │                 │
│ Planner (LLM)  │──► query_data / load_prices                  │ Detectors run   │
│                │──► compute_indicators / compute_stats        │ on a timer      │──► regime/breadth/
│                │──► screen / eda_profile                      │ (deterministic) │    breakout/sector/OI
│                │──► backtest / event_study / ranking          │                 │
│                │──► optimize / walk_forward / monte_carlo      │ LLM wakes only  │──► narrate / hypothesize
│                │──► run_python  (sandboxed escape hatch)       │ on state-change │──► validate via Research
│                │                                              │ event or ask    │    Agent tools
└────────────────┘                                              └─────────────────┘
```

**Model tiering.** The planner does multi-step reasoning and needs a stronger model than the current `claude-haiku-4-5`. Recommended: a stronger planner model (Sonnet/Opus tier) for the agentic loop, haiku for narrow narration/summary sub-calls. Configurable via env (`ANTHROPIC_PLANNER_MODEL`, `ANTHROPIC_WORKER_MODEL`).

**Hybrid execution.** The planner chooses per step:
- **Fast path** — a pre-baked deterministic tool (covers ~90% of asks). Cached, auditable.
- **Escape hatch** — `run_python` sandbox when no tool fits (§7). Still logged + cached by `(code, data_version)`.

**Loop mechanics.** Reuse the proven pattern in `ai_assistant.py::_run_sync` (Anthropic tool-use loop, `stop_reason` handling, `tool_calls_log`). Raise `MAX_IT` from 12 → ~20 for research chains. Run in `asyncio.to_thread` as today.

---

## 3. Data layer (already exists — do not rebuild)

From `app/services/duckdb_client.py`, registered views on one shared in-memory connection, per-thread cursors:

| View | Contents | Notes |
|------|----------|-------|
| `equities_prices` | OHLCV, 500 NSE symbols, ~6y | Hive-partitioned by symbol. Primary research surface. |
| `delivery_data` | NSE delivery %, NIFTY 50 | Not hive-partitioned — bulk-load once, never per-symbol. Lags price 1–2 days. |
| `options_chain` | ATM ±20 strikes, CE+PE, IV | If ingested. |
| `futures_chain` | Current monthly expiry, basis | If ingested. |
| `returns_features` | Pre-computed 11 return horizons | Only if parquet exists — guard. |
| `std_deviation_features` | Pre-computed vol | Only if parquet exists — guard. |

**Hard DuckDB rules (from CLAUDE.md):**
- `date` is `Asia/Calcutta` tz-aware — always `STRFTIME('%Y-%m-%d', CAST(date AS DATE))`.
- Never `duckdb.connect()` per request — use `get_connection()` (thread-local cursor).
- Never JOIN `equities_prices × delivery_data` (kills partition pushdown) — two queries + Python merge.
- Universe is dynamic — never hardcode symbol lists; use `get_universe()` from `stock_metrics.py`.

Live intraday prices come from `live_trading_service` (Kite quote polling), held in memory during the session — **not** in the parquet lake until after close.

---

## 4. Tool catalog

Design rule: **collapse families, don't enumerate.** One parameterized `compute_indicators` replaces 15 indicator tools; one `compute_stats` replaces the whole stats list. Target ~14 research tools + ~6 live tools, staying inside the planner's tool-selection budget.

### 4.1 Research Agent tools

Full Anthropic-schema for the core set; the rest follow the same shape.

```json
[
  {
    "name": "query_data",
    "description": "Run a parameterized read-only DuckDB query over equities_prices/delivery_data/options_chain. Prefer this over raw SQL when the shape is known. Returns rows as records. Always applies the date cast rule and a universe/symbol filter.",
    "input_schema": {
      "type": "object",
      "properties": {
        "symbols": {"type": "array", "items": {"type": "string"}, "description": "NSE tickers; omit for whole universe"},
        "start": {"type": "string", "description": "YYYY-MM-DD inclusive"},
        "end": {"type": "string", "description": "YYYY-MM-DD inclusive"},
        "columns": {"type": "array", "items": {"type": "string"}, "description": "subset of date,open,high,low,close,volume"},
        "universe": {"type": "string", "enum": ["nse500", "nifty50", "fno"], "default": "nse500"}
      },
      "required": []
    }
  },
  {
    "name": "load_prices",
    "description": "Load OHLCV for one or more symbols into a cached in-memory frame handle usable by compute_* and run_python. Returns a data_version hash for the manifest.",
    "input_schema": {
      "type": "object",
      "properties": {
        "symbols": {"type": "array", "items": {"type": "string"}},
        "start": {"type": "string"},
        "end": {"type": "string"},
        "timeframe": {"type": "string", "enum": ["daily"], "default": "daily"}
      },
      "required": ["symbols"]
    }
  },
  {
    "name": "compute_indicators",
    "description": "Compute one or more TA-Lib indicators for a symbol/frame. Replaces per-indicator tools. Never computes in text.",
    "input_schema": {
      "type": "object",
      "properties": {
        "symbol": {"type": "string"},
        "specs": {
          "type": "array",
          "description": "list of indicator requests",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string", "enum": ["RSI","MACD","ADX","ATR","EMA","SMA","VWAP","OBV","CCI","STOCH","MFI","WILLR","BBANDS","SUPERTREND","ICHIMOKU"]},
              "params": {"type": "object", "description": "e.g. {\"timeperiod\": 14}"}
            },
            "required": ["name"]
          }
        },
        "as_of": {"type": "string", "description": "YYYY-MM-DD; default latest bar"}
      },
      "required": ["symbol", "specs"]
    }
  },
  {
    "name": "compute_stats",
    "description": "Statistical / EDA operations over a price or return series. Replaces the entire stats+EDA tool family.",
    "input_schema": {
      "type": "object",
      "properties": {
        "symbol": {"type": "string"},
        "benchmark": {"type": "string", "description": "for correlation/beta, e.g. NIFTY proxy"},
        "ops": {
          "type": "array",
          "items": {"type": "string", "enum": [
            "returns","log_returns","rolling_return","cumulative_return",
            "volatility","std_deviation","zscore","percentile","rank",
            "correlation","rolling_correlation","covariance","rolling_beta","autocorrelation",
            "mean","median","skewness","kurtosis","quantiles","drawdown"
          ]},
          "description": "one call can request several ops"
        },
        "window": {"type": "integer", "description": "rolling window in trading days"},
        "start": {"type": "string"}, "end": {"type": "string"}
      },
      "required": ["symbol", "ops"]
    }
  },
  {
    "name": "screen",
    "description": "Filter the universe by compound criteria on indicators/stats. Powers 'all stocks below 20 RSI' through multi-condition scans. Returns matching symbols + values, ranked.",
    "input_schema": {
      "type": "object",
      "properties": {
        "universe": {"type": "string", "enum": ["nse500","nifty50","fno"], "default": "nse500"},
        "as_of": {"type": "string", "description": "snapshot date; default latest bar"},
        "criteria": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "field": {"type": "string", "description": "e.g. rsi_14, ema_20, volume_ratio_20, atr_percentile"},
              "op": {"type": "string", "enum": ["<","<=",">",">=","==","between"]},
              "value": {"description": "number or [lo,hi] for between"}
            },
            "required": ["field","op","value"]
          }
        },
        "sort_by": {"type": "string"},
        "limit": {"type": "integer", "default": 50}
      },
      "required": ["criteria"]
    }
  },
  {
    "name": "eda_profile",
    "description": "Standard one-shot EDA panel for a symbol or universe: return distribution, rolling volatility, rolling correlation to benchmark, drawdown, key moments. Used to make the page feel like a research terminal on first load.",
    "input_schema": {
      "type": "object",
      "properties": {
        "target": {"type": "string", "description": "symbol OR universe name"},
        "benchmark": {"type": "string", "default": "NIFTY"},
        "lookback_days": {"type": "integer", "default": 504}
      },
      "required": ["target"]
    }
  },
  {
    "name": "backtest",
    "description": "Run a vectorbt backtest from declarative entry/exit rules with costs and sizing. All statistics come from vectorbt — never estimated. Returns CAGR, Sharpe, max DD, win rate, trade stats + equity curve handle.",
    "input_schema": {
      "type": "object",
      "properties": {
        "symbols": {"type": "array", "items": {"type": "string"}},
        "entry": {"type": "array", "items": {"type": "object"}, "description": "rule list ANDed, e.g. [{field:ema_20,op:>,ref:ema_50},{field:rsi_14,op:>,value:60}]"},
        "exit": {"type": "array", "items": {"type": "object"}},
        "stop": {"type": "object", "description": "e.g. {type:atr, mult:2}"},
        "sizing": {"type": "object", "description": "e.g. {type:risk_pct, value:1}"},
        "costs_bps": {"type": "number", "default": 15},
        "start": {"type": "string"}, "end": {"type": "string"}
      },
      "required": ["symbols","entry","exit"]
    }
  },
  {
    "name": "event_study",
    "description": "Given a condition, measure forward returns over horizons across all historical occurrences. Returns hit rate, mean/median/worst return per horizon, sample size. Sign-adjusts for bearish signals.",
    "input_schema": {
      "type": "object",
      "properties": {
        "condition": {"type": "object", "description": "e.g. {event:rsi_cross_above, level:30}"},
        "universe": {"type": "string", "default": "nse500"},
        "horizons": {"type": "array", "items": {"type": "integer"}, "default": [5,10,20]},
        "min_occurrences": {"type": "integer", "default": 30}
      },
      "required": ["condition"]
    }
  },
  {
    "name": "ranking",
    "description": "Rank the universe by a factor or composite (momentum, relative strength, volatility, quality). Rolling 20-day rank by default. Deterministic.",
    "input_schema": {
      "type": "object",
      "properties": {
        "factor": {"type": "string", "enum": ["momentum_12_1","relative_strength","volatility","quality","composite"]},
        "universe": {"type": "string", "default": "nse500"},
        "weights": {"type": "object", "description": "for composite only"},
        "top_n": {"type": "integer", "default": 25}
      },
      "required": ["factor"]
    }
  },
  {
    "name": "optimize",
    "description": "Vectorbt parameter sweep over a grid for a given strategy. Returns a heatmap handle + best params with the caveat that in-sample optima overfit.",
    "input_schema": {
      "type": "object",
      "properties": {
        "strategy": {"type": "object"},
        "grid": {"type": "object", "description": "param -> list of values"},
        "objective": {"type": "string", "enum": ["sharpe","cagr","calmar"], "default": "sharpe"}
      },
      "required": ["strategy","grid"]
    }
  },
  {
    "name": "walk_forward",
    "description": "Rolling optimize-in-window / test-out-of-window evaluation. Returns per-fold OOS performance. This is the anti-overfit tool.",
    "input_schema": {
      "type": "object",
      "properties": {
        "strategy": {"type": "object"},
        "grid": {"type": "object"},
        "train_years": {"type": "number", "default": 3},
        "test_years": {"type": "number", "default": 1}
      },
      "required": ["strategy","grid"]
    }
  },
  {
    "name": "monte_carlo",
    "description": "Robustness test: resample/shuffle trade sequence to produce a distribution of outcomes (drawdown, CAGR). Returns percentiles.",
    "input_schema": {
      "type": "object",
      "properties": {
        "backtest_ref": {"type": "string", "description": "handle from a prior backtest"},
        "n_sims": {"type": "integer", "default": 1000},
        "method": {"type": "string", "enum": ["resample_returns","shuffle_trades"], "default": "resample_returns"}
      },
      "required": ["backtest_ref"]
    }
  },
  {
    "name": "run_python",
    "description": "SANDBOXED escape hatch. Execute whitelisted Python (pandas/numpy/vectorbt/talib/scipy) against pre-loaded read-only data for ad-hoc analysis no other tool covers. MUST return a typed result object, not free text. Logged + cached by (code, data_version).",
    "input_schema": {
      "type": "object",
      "properties": {
        "code": {"type": "string", "description": "python; `df`(prices) and `con`(read-only duckdb cursor) are pre-bound; must assign `result`"},
        "frames": {"type": "array", "items": {"type": "string"}, "description": "data handles to expose"}
      },
      "required": ["code"]
    }
  },
  {
    "name": "make_chart",
    "description": "Render a chart spec (histogram, line, heatmap, scatter, QQ, equity curve) from a prior tool's result. Returns a chart handle for the UI. No computation here.",
    "input_schema": {
      "type": "object",
      "properties": {
        "kind": {"type": "string", "enum": ["histogram","line","heatmap","scatter","qq","equity_curve","bar"]},
        "data_ref": {"type": "string"},
        "options": {"type": "object"}
      },
      "required": ["kind","data_ref"]
    }
  }
]
```

### 4.2 Live Agent tools (read-only)

Most are **thin wrappers over existing services** — build the wrapper, not the logic.

| Tool | Backed by (existing) | Returns |
|------|----------------------|---------|
| `live_snapshot()` | `live_trading_service` (Kite quotes) | live prices, %chg, breadth, index, regime |
| `detect_events(kinds[])` | `breakout_service`, `sector_heatmap_service`, `regime_service`, `fno_momentum_service`, `fno_tactical_service`, `markov_options_service` | list of fired events with type, symbol, magnitude |
| `positions()` | `live_trading_service` | open positions + running P&L (read-only) |
| `why_move(symbol)` | `drivers_service` | ranked driver attribution ("why is X up 4%") |
| `opportunity_board(weights?)` | `ranking` + detectors | live leaderboard of strongest setups |
| `set_alert(condition)` | new state-store | registers a state-change alert (no order action) |
| `recall_events(since?)` | new event-memory store | thread of what fired today for narrative |

`detect_events` kinds map 1:1 to ChatGPT's "eyes": `breakout, volume_spike, gap, new_high, trend_change, regime_change, volatility_expansion, relative_strength, sector_rotation, option_unusual_activity`.

---

## 5. Phased roadmap

Each phase has a **deliverable** and an **acceptance test** (the question/behavior that must work before moving on).

### Phase 1 — Data + compute spine  *(Research Agent MVP)*
- **Build:** fresh tool-use loop (new `research_copilot_service.py`, not the 8-tool assistant); tools `query_data`, `load_prices`, `compute_indicators`, `compute_stats`, `screen`, `eda_profile`, `make_chart`; new `/api/research/*` router; new `/research-copilot` page shell (design-system compliant, `usePalette`/`useTokens`); stronger planner model wired via env.
- **Accept:** "all stocks below 20 RSI" returns a correct ranked table; "show me RELIANCE's return distribution and 60-day rolling vol" renders EDA charts; every answer carries a manifest.

### Phase 2 — Research surface
- **Build:** `backtest`, `event_study`, `ranking`; computation-manifest renderer in the UI; result-handle store so charts/backtests can be referenced across turns.
- **Accept:** "After a 52-week high on 2× volume, what are 5/10/20-day forward returns and hit rate?" and "backtest EMA20/50 with ATR stop, 15bps costs — CAGR/Sharpe/maxDD" both return vectorbt-sourced numbers with a re-runnable manifest.

### Phase 3 — Sandbox
- **Build:** `run_python` with the §7 guardrails; caching/replay harness shipped **with** it (not after); `data_version` hashing.
- **Accept:** an open-ended ask ("breakout setups in high-vol regimes over the last decade") executes in the sandbox, returns a typed result, and re-running produces byte-identical output from cache.

### Phase 4 — Optimize / walk-forward / robustness
- **Build:** `optimize`, `walk_forward`, `monte_carlo`; nightly precompute for heavy universes (mirror the stock-health parquet-first pattern → `data_lake/derived/research/`).
- **Accept:** "optimize Supertrend, then walk-forward it 3y/1y and show OOS decay" runs and clearly separates in-sample vs OOS.

### Phase 5 — Live Market Agent  *(read-only, on `/live-trading`)*

- **5a — Detectors + state-change alerting.** Wrap existing services as `detect_events`; build the state store; alerts fire only on meaningful *change* (regime flip, new leadership sector, breadth break, vol-regime shift, RS ranking shift), not every RSI cross.
  - *Accept:* alert log shows state transitions, not a firehose; `live_snapshot` + `why_move` work during market hours.
- **5b — Event memory + narrative.** Per-session event store + `recall_events`; LLM threads events into a narrative ("10:01 broke resistance → 10:18 volume doubled → confidence rising") instead of repeating alerts.
  - *Accept:* two related events on one symbol produce one evolving narrative, not two duplicate alerts.
- **5c — Opportunity leaderboard.** `opportunity_board` with the weighted score (trend 20, RS 15, volume 15, vol-breakout 10, sector 10, breadth 10, pattern 10, R/R 10); live setup-tracker tiles on the page.
  - *Accept:* leaderboard updates intraday and ties each tile back to a researched setup.
- **5d — Hypothesis engine (validation-gated).** LLM generates hypotheses ("banking leadership expanding while IT weakens → historically favors PSU banks 5–10 sessions") that are **auto-validated** against history via Research Agent tools before display; unvalidated = labeled "hypothesis, unverified".
  - *Accept:* no hypothesis is shown as a conclusion without a historical sample + result attached.
- **5e — Live strategy-performance monitoring.** Track each live-fired setup vs its historical expectancy; flag divergence ("RSI reversals firing 2× normal rate today"). Not ML learning — performance monitoring.
  - *Accept:* a live setup's realized hit-rate today is shown against its backtested expectancy.

**Guardrail across all of 5:** read-only. No `place_order`/`modify_order`/`cancel_order` tool exists in the Live Agent's toolset at all.

---

## 6. Computation manifest (reproducibility harness)

Every agent response returns, alongside the prose answer, a structured manifest — this is the moat and the audit trail.

```json
{
  "answer": "…plain-English interpretation…",
  "manifest": {
    "data_version": "sha256 of (parquet mtimes + row counts) at query time",
    "methodology_version": "research_copilot v1",
    "steps": [
      {"tool": "screen", "input": {...}, "result_hash": "…", "rows": 12, "ms": 84},
      {"tool": "event_study", "input": {...}, "result_hash": "…", "ms": 210}
    ],
    "seed": 42,
    "reproducible": true
  }
}
```

Rules:
- Cache key = `(tool_name, canonical_json(input), data_version)`. Identical inputs → cache hit → identical bytes.
- `run_python` also hashes source code into the key.
- `methodology_version` bumps whenever a tool's formula changes (mirror the existing `METHODOLOGY_VERSION` edge pattern) — history is never silently rewritten.
- The frontend renders the manifest as an expandable "how this was computed" panel under each answer.

---

## 7. Sandbox design & guardrails (`run_python`)

- **Whitelist imports:** `pandas`, `numpy`, `vectorbt`, `talib`, `scipy`, `polars`. Everything else blocked.
- **Pre-bound, read-only:** `df` (requested price frames), `con` (a read-only DuckDB cursor). No write access to the parquet lake or Postgres.
- **No I/O:** no network, no filesystem writes, no `open`, no `subprocess`, no `os`/`sys` escape.
- **Typed return:** code must assign `result` (dict/DataFrame/number); free-text output is rejected.
- **Resource caps:** wall-clock (e.g. 20s) + memory ceiling; kill on breach.
- **Determinism:** seeds forced before exec; `(code, data_version)` cached and replayable.
- **Isolation:** run in the existing Linux sandbox / a restricted subprocess, never in the FastAPI worker process.

The sandbox exists so the tool count stays small — it's the release valve for the long tail of one-off EDA, not the default path.

---

## 8. Backend file plan

New (follow existing conventions — services pure, no FastAPI imports; Pydantic models in `app/models/`; router prefix `/api/…`; `response_model_exclude_none=True`):

```
marketdna-backend/
  app/routers/
    research_copilot.py         # /api/research/*  (chat, tool passthrough, manifest)
    live_agent.py               # /api/live-agent/* (snapshot, events, board, alerts)
  app/services/
    research_copilot_service.py # fresh agentic loop (planner+worker models, MAX_IT~20)
    research_tools.py           # deterministic tool implementations (query/compute/screen/eda)
    research_backtest.py        # vectorbt: backtest/optimize/walk_forward/monte_carlo/event_study
    research_sandbox.py         # run_python executor + guardrails + cache
    live_agent_service.py       # detector orchestration, state store, event memory, narrative
    manifest.py                 # data_version hashing + cache keying + replay
  app/models/
    research.py                 # request/response + manifest Pydantic models
  mcp_server/
    research_schemas.py         # the §4 TOOLS list + dispatch (separate from the 8-tool server)
```

Register routers in `app/main.py`; add `POST /api/research/invalidate` and `POST /api/live-agent/invalidate` to the post-market invalidation list in `CLAUDE.md`. Nightly research precompute writes to `data_lake/derived/research/`.

**Reuse, don't rebuild:** detector logic already lives in `breakout_service`, `sector_heatmap_service`, `regime_service`, `fno_momentum_service`, `fno_tactical_service`, `markov_options_service`, `drivers_service`, `short_service`. The Live Agent wraps these.

---

## 9. Frontend file plan

```
marketdna-web/src/
  pages/ResearchCopilotPage.tsx     # new page, design-system compliant
  api/researchApi.ts                # chat + manifest client
  api/liveAgentApi.ts               # live snapshot/events/board/alerts client
  components/research/
    ManifestPanel.tsx               # expandable "how this was computed"
    EdaPanel.tsx                    # return dist / rolling vol / rolling corr / drawdown
    BacktestResult.tsx              # equity curve + stat cards
    OpportunityBoard.tsx           # live setup tiles (also used on /live-trading)
    EventNarrative.tsx              # live event thread
```

Design system is mandatory: `usePalette()`/`useTokens()` at render time, IBM Plex Sans/Mono, `CARD`/`TH`/`TD`/`t1..t3` tokens, hero pattern per `IndicatorsPage`. Live sections mount into the existing `LiveTradingPage`. Add a `page_docu/research_copilot_page.md` (six-section template) alongside the build.

---

## 10. Acceptance question bank

"Done" = these run end-to-end with a manifest.

- *Screen:* "All NSE500 stocks below 20 RSI right now." · "RSI<30 AND volume>2× avg AND EMA20>EMA50."
- *EDA:* "RELIANCE return distribution + 60-day rolling vol + rolling corr to NIFTY."
- *Research:* "Is RSI(14) predictive on NIFTY500? Compare 7/14/21 by forward-20d decile."
- *Event study:* "Forward 5/10/20-day returns after a 52-week high on 2× volume — hit rate + distribution."
- *Backtest:* "EMA20/50 crossover, ATR stop, 1% risk, 15bps — CAGR/Sharpe/maxDD."
- *Robustness:* "Optimize Supertrend, walk-forward 3y/1y, Monte Carlo the drawdown."
- *Open-ended (sandbox):* "Which breakout setups worked best in high-vol regimes over the last decade?"
- *Live:* "What changed that matters in the last 30 minutes?" · "Why is TATAMOTORS up 4%?" · "Alert me when market regime or leadership sector changes."
- *Hypothesis:* "Given today's conditions, what kind of strategy is favored?" → regime read → historical analog validation → labeled recommendation, never a bare "buy".

---

## 11. Open decisions (resolve before/during build)

1. **Intraday data lake.** Live indicators (live RSI/VWAP) need current-session ticks. Decision pending: daily-timeframe only, or build an intraday history lake so intraday strategies can be *researched*, not just watched. (Currently deferred.)
2. **Planner model choice + budget.** Sonnet vs Opus for the planner; token/latency ceiling per research chain.
3. **Alerting transport.** In-app feed only, or also push (the `market-alerts` skill pattern) / scheduled tasks.
4. **Nightly precompute scope.** Which research artifacts to precompute vs compute on demand.

---

## 12. Decision log (locked)

- Two agents, one shared validated research engine.
- Hybrid execution: pre-baked deterministic tools + guarded `run_python` sandbox.
- New `/research-copilot` page; Live Agent as a new section on existing `/live-trading`.
- Live layer = read-only + alerts/monitoring; **no order placement, ever.**
- Collapse tool families (one `compute_indicators`, one `compute_stats`); ~14 research + ~6 live tools.
- Every answer carries a reproducible computation manifest; hypotheses are validation-gated.
- Wrap existing detector services; do not rebuild detection logic.
```
