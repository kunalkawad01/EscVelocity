# Stock Drivers — Fundamental Context Layer

Feature plan drafted 2026-07-14. Status: **Steps 1–4 done; Step 5 infrastructure done, batch
production paused by choice.** Backend live at `/api/drivers/*`; StockPage section + chart event
overlay shipped. Step 5 assets in place: authoring skill (`.claude/skills/drivers-author/`),
shared forecast-block library (`content/drivers/_library/forecast_blocks.yaml`), status/staleness
job (`jobs/drivers_status.py`, run via `python -m jobs.drivers_status`), F&O coverage target =
211 symbols from `marketdna-data/FO.csv`. BHARATFORG dossier finalized: FY26 actuals filled in
(defence order book ₹10,961 cr, FY27 ~25% India growth guidance), event dates pinned to exact
trading days measured from our own price series (deal rally 2026-02-02 +15%/3 sessions; tariff
scare 2025-04-03 ~-17%/3 sessions).

**Batch status (paused 2026-07-14, user call):** 7 dossiers served — BHARATFORG (reviewed
quality) + 6 web-researched DRAFTS pending human review: HDFCBANK, INFY, BEL, TATASTEEL,
RELIANCE, TCS. All drafts carry verify_notes on unconfirmed figures (rendered as amber warnings
in the UI by design). Research already done but dossiers NOT yet written for: ICICIBANK (Q4 FY26
PAT ₹13,702 cr +8.5%, NIM 4.32%, advances +15.8%, NNPA 0.33%), SBIN (FY26 PAT ₹80,032 cr, FY27
guide 13-15% credit growth / NIM >3%), LT (FY26 inflows ₹4.4 trn +22%, book ₹7.4 trn, FY27 guide
10-12%, muted H1 on Middle East disruption, pipeline ₹17.8 trn), MARUTI (Q4 record 676k units,
exports +61%, GST-cut small-car revival, FY27 industry 4-6%), SUNPHARMA (US innovative crossed
$1bn FY26, specialty $354m +20% = 22% of sales, generics -1.1%), BAJFINANCE (Q1 FY27 AUM
₹5.47 lakh cr +24%, credit cost <2%, FY27 guide 25%+). Resume with `/drivers-author <SYMBOLS>`.
To unserve any draft: move it to `content/drivers/_drafts/` + `POST /api/drivers/invalidate`.

## What it is

A per-stock "Stock Drivers" section on StockPage that explains *why the stock moves*: the
fundamental forces (demand cycles, policy, order flow, input costs, ownership) behind price
action. Universe: **F&O stocks** (~190 symbols) for now.

Each driver carries three layers:

1. **Narrative** — analyst-grade description of the driver.
2. **Simple English** — a causal chain a non-finance reader can follow ("company sells X to Y;
   when Z happens, Y buys more X; that's why the stock reacts to Z").
3. **How to Forecast** — observable leading indicators (name / source / cadence / lead-lag),
   the causal logic for why they lead, and a falsifiable rule of thumb. Never a prediction.

## Core architectural decision

Everything else in MarketDNA is *computed from data we own*. Drivers are **curated knowledge** —
they cannot be derived from OHLCV, and live LLM generation would violate Principle 2
(hallucinated order values, stale tariff numbers, invented shareholding).

Therefore: **drivers are content, treated as data** — authored offline (AI-drafted,
human-reviewed), stored as YAML files in git (versioning, diffs, review for free), date-stamped,
validated against Pydantic models at server startup, served like any other feature.

## Schema (one YAML per symbol)

Location: `marketdna-backend/content/drivers/<SYMBOL>.yaml`
Models: `marketdna-backend/app/models/drivers.py`

Top level: `symbol`, `company`, `sector`, `last_reviewed`, `review_cadence`, `drivers[]`.

Per driver:

| Field | Purpose |
|-------|---------|
| `title` | Short driver name |
| `category` | `demand` \| `policy` \| `orders` \| `input_costs` \| `competition` \| `ownership` \| `catalyst` |
| `weight` | `primary` \| `secondary` \| `background` — controls card prominence |
| `narrative` | Analyst-grade description |
| `simple_english` | Causal chain in plain language |
| `forecast` | `how` (lead-lag logic) + `leading_indicators[]` (name/source/cadence/lead) + `rule_of_thumb` |
| `events[]` | Dated events (`date`, `label`, `observed_move`) → chart annotations |
| `watch` | The single datapoint to monitor, one line |
| `direction` | Which way the driver cuts ("higher X → positive") |
| `verify_note` | Unresolved factual uncertainty carried into the product |
| `as_of` | Date stamp for point-in-time facts (e.g. shareholding quarter) |

Top-level `sources[]` records the primary documents each dossier draws from
(`doc_type`: annual_report | investor_presentation | concall_transcript | filing, plus
title/period/url) — so the refresh pass knows which editions are already incorporated.

**Load-bearing safety features (never hide in UI):** `last_reviewed` + staleness badge, `as_of`
dates, `verify_note`. Drivers content rots; a stale dossier must be *visibly* stale.

## Authoring disciplines

1. **`simple_english` is a causal chain, not a summary.** Test: could someone who has never read
   a balance sheet explain why the stock moved after reading it? If it just restates the
   narrative in shorter words, reject in review.
2. **`forecast` is "how to see it coming," never a prediction.** Only observable, publicly
   checkable, named indicators with source and cadence. "Watch industry sentiment" gets deleted.
   `rule_of_thumb` must be threshold-shaped (falsifiable).
3. **Unforecastable is a valid answer.** Event-driven drivers (defence order announcements) get
   `forecast.how: "Not forecastable — event-driven"` plus the earliest visible footprint to
   track (tender pipeline mentions, MoD acceptance-of-necessity announcements). Never invent a
   fake indicator to fill the field.
4. **Sector-level reuse.** Forecast logic for "US truck demand" is identical across forging
   names; "credit growth" is shared across banks. Build a shared forecast-block library keyed by
   driver archetype that dossiers reference and override — fix the lead-lag logic once, every
   stock inherits it.

## Build order (6 steps)

1. **Schema + models + pilot dossier** ← current step. YAML schema, Pydantic models in
   `app/models/drivers.py`, full BHARATFORG pilot (`content/drivers/BHARATFORG.yaml`).
2. **Backend** — `app/services/drivers_service.py`: glob + parse + validate all YAML at startup
   (malformed file fails loudly at startup, not request time), in-process dict, no expiry.
   Router `app/routers/drivers.py`: `GET /api/drivers/{symbol}` (clean 404 payload when absent),
   `GET /api/drivers/coverage` (symbols with dossiers — frontend shows/hides section),
   `POST /api/drivers/invalidate` (re-read files without server restart).
3. **StockPage section** — new numbered `Section`. Driver cards grouped by `weight` (primary
   full-width on top; secondary/background collapsed via `Record<string, boolean>` toggle).
   Three-tab micro-toggle per card: Driver / Plain English / How to Forecast (reuse
   StockHealthPage MetricRow two-level expand pattern). Category chip with fixed color per
   category, `watch` line in IBM Plex Mono, leading-indicator table with `TH`/`TD` tokens,
   rule-of-thumb in amber callout, staleness badge top-right. Section renders only if symbol in
   coverage.
4. **Chart event overlay** — toggle pushes all dated driver `events` onto the existing Highstock
   candlestick as plotLines/flags ("that −10% gap = the tariff scare").
5. **Content production at scale** — authoring skill with two-pass generation (narrative +
   simple_english first; forecast in a separate web-search pass focused on "what leads this
   indicator"), shared forecast-block library, mandatory human review (fix numbers, delete
   anything unsourced, set `last_reviewed`), batch 10–15 symbols/session toward F&O coverage.
   **Primary sources per symbol: latest annual report, latest investor presentation, last 2
   concall transcripts** — read these before web search; they anchor segment mix, export share,
   order book, and management's own stated drivers. Record each in the dossier's `sources[]`.
   Seed the universe list from the NFO symbol set in `live_trading_service` — don't hardcode.
   Quarterly refresh post-results as diffs against existing files; script lists dossiers past
   `review_cadence`.
6. **Live-data wiring** — convert editorial claims into live metrics where data exists.
   **Shipped 2026-07-14 for BHARATFORG** (mechanism is generic; only BHARATFORG wired):
   - Schema: optional `live: {metric, label}` per driver; resolved values arrive in the API
     response as `live_values` (computed at request time, never stored in YAML, day-cached,
     failures degrade silently — card renders without the chip, never a 500).
   - Registry (`drivers_service._LIVE_REGISTRY`): `atm_iv_percentile` (via new
     `options_service.get_atm_iv_snapshot()`; falls back to raw ATM IV while history < 20d)
     and `futures_basis` (latest `futures_chain` row).
   - BHARATFORG wiring: tariff driver → ATM IV percentile ("headline-risk premium priced now");
     FY27 driver → futures basis ("leveraged positioning into the growth year").
   - Frontend: green pulsing LIVE chip on wired driver cards (`LiveChip` in StockDrivers.tsx).
   - `POST /api/drivers/invalidate` also clears the live cache — added to the post-close
     Step 2 list in CLAUDE.md.
   - Future wirings when data exists: USDINR (needs CDS ingestion), shareholding from BSE
     filings, delivery signals (needs delivery universe beyond NIFTY 50).

Steps 1–4 ≈ a few days of build. Step 5 is the real project (weeks, in batches, ongoing).
