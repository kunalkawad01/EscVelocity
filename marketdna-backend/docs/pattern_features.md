# Pattern DNA Intelligence — Feature Documentation

## Overview

Five advanced research features extending the Pattern DNA Intelligence system.
All features use validated historical OHLCV data from DuckDB over the Parquet data lake.

---

## Feature 1 — Pattern History Timeline

### Purpose
For any selected stock, show every past pattern detection with its actual realised forward return.
Transforms the Pattern DNA black-box into a transparent, auditable record.

### Methodology
- Runs all 9 dated scanner variants (`_scan_dated_*`) against the full price history.
- Each scanner uses the same detection logic as its corresponding `_scan_*` counterpart
  but also records the date at the detection bar.
- Forward returns: `f21 = (close[end+21] / close[end] - 1) * 100`, same for `f63`.
- Outcome classification:
  - `Win` — f21 > 0 (for bullish patterns) or f21 < 0 (for bearish)
  - `Loss` — opposite of Win
  - `Pending` — f21 is NaN (detection too recent, forward bar not yet available)

### API Endpoint
```
GET /api/patterns/{symbol}/history?timeframe=daily
```
Response: `PatternHistoryResponse` — sorted by date descending, max 200 items.

### Pass / Fail Criteria
- Win/Loss determination uses raw f21 sign, not regime-adjusted.
- Pending items are excluded from win-rate calculations on the frontend.

### Data Requirements
- Minimum: enough bars for the respective scanner's lookback window (~80 bars for simple patterns,
  ~120 bars for Head & Shoulders variants).

### Limitations
- Volume confirmation is used as a filter (same as the parent `_scan_*` functions).
  Detections without volume confirmation are excluded to keep DNA representative.
- For the most recent 21 bars, f21 will always be Pending.

---

## Feature 2 — Pattern Breakout Tracker

### Purpose
Patterns detected in the last N trading days — track which confirmed, which failed, which are still forming.
Converts historical detection into actionable lifecycle monitoring.

### Methodology
- For each symbol, fetches full OHLCV.
- Steps through `range(max(0, n - days_back - 20), n - 10, 10)` in 10-bar increments.
- At each step `i`, runs all 9 current-pattern detectors on `closes[:i]` slices.
- Records the first detection per (symbol, pattern) within the lookback window
  (oldest detection is kept to track the full lifecycle).
- Status determination:
  - **Confirmed** — for bullish: `current_price > breakout_level`; for bearish: `current_price < breakout_level`
  - **Failed** — for bullish: `current_price < support_level`; for bearish: `current_price > resistance_level`
  - **Forming** — otherwise
- Entry price = closing price at the detection bar slice end.
- Change% = `(current / entry - 1) * 100`.

### API Endpoint
```
GET /api/patterns/breakout-tracker?days_back=60
```
Response: `BreakoutTrackerResponse` — sorted Confirmed → Forming → Failed.

### Data Requirements
- Minimum `days_back + 20` bars of history per symbol.
- `days_back` is clamped to 10–120 via query validation.

### Limitations
- 10-bar stepping means detection granularity is ±10 bars, not daily.
- Status is point-in-time (at last available close), not tracked daily.
- Does not account for intra-period re-entry or multiple touches.

---

## Feature 3 — Market Pattern Heatmap

### Purpose
Show which patterns are clustering across the market simultaneously.
If 8 stocks are forming Bull Flags, that is a structural signal about market character.

### Methodology
- Calls `detect_current_patterns(sym, timeframe)` for every symbol.
- Groups detections by pattern name: count, avg confidence, list of symbols.
- Sorted by count descending.

### API Endpoint
```
GET /api/patterns/heatmap?timeframe=daily
```
Response: `PatternHeatmapResponse`.

### Data Requirements
- Same requirements as `detect_current_patterns` per symbol.

### Limitations
- Counts raw detections, not adjusted for pattern reliability or DNA score.
- A high count of low-confidence patterns can be misleading — the frontend displays
  avg_confidence alongside count for context.

---

## Feature 4 — Regime-Conditioned DNA

### Purpose
Does a pattern on RELIANCE work better in bull markets or sideways markets?
Split DNA scores by market regime at the time of each historical detection.

### Methodology
- Fetches full OHLCV and runs all dated scanners via `_get_dated_samples`.
- For each detection bar, classifies regime:
  - **Bull** — `close > SMA200` (200-bar simple moving average)
  - **Bear** — `close < SMA50` (50-bar simple moving average)
  - **Sideways** — between SMA50 and SMA200
- Groups (pattern, regime) → list of f21 values.
- Computes success rate and avg f21 per bucket.
- Only reports buckets with ≥ 3 detections.
- `best_regime` = regime with highest success rate among buckets with ≥ 3 detections.

### API Endpoint
```
GET /api/patterns/{symbol}/regime-dna
```
Response: `RegimeDNAResponse`.

### Pass / Fail Criteria
- Minimum 3 detections per regime bucket to be included in output.
- At least one regime bucket must meet the minimum for the pattern to appear.

### Data Requirements
- Requires sufficient history for SMA200 calculation (200+ bars).
- Same scanner requirements as Feature 1.

### Limitations
- SMA-based regime classification is a simplification.
  It does not distinguish between early-bull and late-bull market phases.
- Regime at detection is point-in-time (single bar), not the regime over the holding period.
- Small sample sizes in individual regime buckets should be treated with caution.

---

## Feature 5 — Pattern Failure Analysis

### Purpose
Which stocks consistently fail each pattern — avoiding bad setups is as important
as finding good ones. Negative edge quantification.

### Methodology
- Uses the same `_scan_*` + `_aggregate` pipeline as the Pattern Screener.
- Filters to stocks with ≥ 6 occurrences (minimum statistical relevance).
- `failure_rate = 1.0 - (success_rate / 100)`.
- `avg_loss`:
  - For bullish patterns: mean of negative f21 values only.
  - For bearish patterns: mean of positive f21 values only (price moved against the bearish thesis).
- Returns top 20 stocks by failure rate descending.

### API Endpoint
```
GET /api/patterns/failures/{pattern_name}
```
Pattern name uses hyphen-separated lowercase (e.g., `double-bottom`).
Response: `PatternFailureResponse`.

### Pass / Fail Criteria
- Minimum 6 occurrences per stock required to be included.
- Rows with `failure_rate > 70%` are tint-highlighted in the frontend UI.

### Data Requirements
- Same as Pattern Screener / Pattern DNA (`_fetch_data` + individual scanner).

### Limitations
- `avg_loss` uses raw f21 only, not risk-adjusted or position-sized.
- High failure rate does not automatically mean the stock should be avoided —
  it may reflect a specific market phase or regime that has changed.
- With 6 occurrences minimum, confidence intervals are wide.

---

## Lookback and Data Requirements Summary

| Feature               | Min bars | Lookback window  | Min occurrences |
|-----------------------|----------|------------------|-----------------|
| History Timeline      | 80–120   | Full history     | 1               |
| Breakout Tracker      | days_back + 20 | days_back  | 1               |
| Market Heatmap        | 80–120   | Current bars     | N/A             |
| Regime DNA            | 200+     | Full history     | 3 per bucket    |
| Failure Analysis      | 200+     | Full history     | 6 per stock     |

---

## Architecture Notes

All five features are implemented as new service functions in
`app/services/pattern_service.py` and exposed via new endpoints in
`app/routers/patterns.py`.

Static-path endpoints (`/breakout-tracker`, `/heatmap`, `/failures/{name}`) are
registered **before** the dynamic `/{symbol}` routes in the router to prevent
FastAPI from matching them as symbol names.

The nine `_scan_dated_*` functions are independent of the existing `_scan_*`
functions. The existing functions are called by `_aggregate` which expects
`list[tuple[float, float]]`; the dated variants return
`list[tuple[str, float, float]]` (date, f21, f63) and must not be passed to
`_aggregate`.
