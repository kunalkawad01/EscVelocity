# Options OI Analysis Page (`/options`)

## What It Does

Full options open interest (OI) intelligence for the F&O universe (~211 symbols). Two views in one page:

**Left — OI Chain Detail** (per symbol, loads on row click or symbol selector):
- **OI Butterfly Chart**: Horizontal bar, CE OI left (red) / PE OI right (green), ATM line (CYAN dash), up to 40 strikes.
- **Max Pain Curve**: Line chart showing total option-buyer payout at each candidate expiry price. Vertical lines at Max Pain (amber) and Spot (CYAN dot).
- **OI Change Chart**: Bar chart of per-strike CE/PE OI change since yesterday. Shows "data available from 2nd day" message on first ingestion.
- **Stats strip** (hero): Spot, Max Pain, PCR, CE Wall, PE Wall, ATM IV, Basis%.
- **Interpretation callout**: Plain-English summary of CE/PE wall and Max Pain meaning.

**Right — F&O OI Buildup Scanner** (loads on mount, all symbols):
- Table columns: Symbol, PCR, ATM IV%, CE OI, PE OI, Fut Chg%, Signal, CE Wall / PE Wall.
- Signal filter chips: Long Build / Short Build / Long Unwind / Short Cover / Neutral.
- Sortable by all numeric columns.
- Below scanner: **Signal Guide** card explaining the 4-way classification logic.

## Optimization

- Scanner loads once on mount; per-symbol detail loads on selection.
- Both are in-process Python dict caches keyed by date string — fresh every calendar day.
- `ensure_fo_views()` called at both endpoints to handle cold-start (backend started before data ingested).
- No background preload needed — scanner is fast (<2s) once views are registered.

## Lessons Learnt

- **PCR color semantics differ between Indian and Western markets.** PCR > 1.3 = green (bullish: more put writing = floor support), PCR < 0.7 = red (bearish: call writers dominating). Opposite of the textbook Western interpretation. Be careful not to accidentally flip this — the StatChip color and the scanner table must both use the Indian convention.
- **Route ordering in FastAPI**: Static routes (`/scan/all`, `/scan/invalidate`) MUST be registered before `/{symbol}`. Otherwise `/scan/all` matches as `symbol="scan"` and returns a 404.
- **7-way signal: Aggressive Long/Short Build requires futures confirmation.** When both CE and PE OI zones expand simultaneously, price direction is the only disambiguator. If futures price is stable/unknown (first ingestion day), emit Neutral rather than guessing. Same for both-declining case.
- **`ELSE 0` in SUM CASE breaks oi_change aggregation.** When summing CE OI change for CE rows only, `SUM(CASE WHEN option_type='CE' THEN oi_change END)` is correct — PE rows return NULL and SQL SUM ignores NULLs. Adding `ELSE 0` makes PE rows contribute 0, corrupting the sum when oi_change itself is legitimately 0 vs null.
- **`if bp` falsy check fails for basis_pct=0.0.** Use `if bp is not None` to avoid treating a zero basis as missing.
- **`futures_chg_pct` is None on first ingestion day.** The LAG() window function needs a prior row. This is correct behavior — will activate naturally from second ingestion onwards. No code fix needed.
- **OI zone aggregation beats single-strike wall signal.** Using SUM of OI change for all strikes from (0, ce_wall] and (0, pe_wall] is more stable than reading only the wall strike. The wall (max OI strike) changes strike on reorganization; zone aggregation is smooth.

## Business Logic

### Indian Seller-Market OI Interpretation
India's F&O market is predominantly **seller-driven** (70%+ open interest is from writers, not buyers). This inverts the standard interpretation:
- CE OI ↑ → call writers adding resistance overhead → **bearish**
- PE OI ↑ → put writers adding support below → **bullish**
- PCR > 1 → more put writing than call writing → **bullish** floor

### Max Pain Algorithm
For each candidate expiry price P (= each listed strike K):
```
pain(P) = Σ_K max(0, P−K) × CE_OI(K)   [call buyer losses]
         + Σ_K max(0, K−P) × PE_OI(K)   [put buyer losses]
```
Max Pain = strike P that minimises `pain(P)`. This is the strike where option writers collectively retain most premium on expiry. Spot tends to gravitate toward Max Pain as expiry approaches (via delta hedging and pinning).

### CE Wall / PE Wall
- **CE Wall** = strike with highest total CE OI → primary resistance (call writers defending this level).
- **PE Wall** = strike with highest total PE OI → primary support (put writers defending this level).

### 7-Way OI Buildup Signal
Inputs: `ce_zone_change` (sum of CE OI change for strikes ≤ CE wall), `pe_zone_change` (sum of PE OI change for strikes ≤ PE wall), `futures_chg_pct` (today's futures LTP vs yesterday).

| CE Zone | PE Zone | Futures       | Signal                | Color   |
|---------|---------|---------------|-----------------------|---------|
| ↓       | ↑       | ↑ or stable   | Bullish Build-up      | green   |
| ↑       | ↓       | ↓ or stable   | Bearish Build-up      | red     |
| ↓       | ↓       | ↑             | Short Covering        | blue    |
| ↓       | ↓       | ↓             | Long Unwinding        | amber   |
| ↑       | ↑       | ↑             | Aggressive Long Build | teal    |
| ↑       | ↑       | ↓             | Aggressive Short Build| orange  |
| ↑       | ↑       | stable/unknown| Neutral               | gray    |
| ↓       | ↓       | stable/unknown| Neutral               | gray    |
| null    | null    | any           | PCR heuristic fallback| —      |

**Key design decisions:**
- Bullish/Bearish Build-up are **price-independent** — the OI direction is unambiguous on its own.
- Aggressive Long/Short Build: both OI zones expanding **requires** futures confirmation; stable price → Neutral.
- Short Covering / Long Unwinding: both OI zones shrinking **requires** futures confirmation; stable price → Neutral.
- PCR fallback only when OI change data is unavailable (first ingestion day): PCR > 1.3 = Bullish Build-up, PCR < 0.7 = Bearish Build-up.

## Tech Stack

**Backend:**
- `app/services/options_service.py` — DuckDB CTE query for scanner + per-symbol OI chain
- `app/routers/options.py` — prefix `/api/options`; routes: `GET /scan/all`, `GET /{symbol}`, `POST /scan/invalidate`, `POST /{symbol}/invalidate`
- `app/models/options.py` — Pydantic: `OIAnalysis`, `OIBuildupItem`, `OIScannerResponse`, `StrikeData`, `MaxPainPoint`
- `app/services/duckdb_client.py` — `ensure_fo_views()` registers options_chain + futures_chain views on demand

**Frontend:**
- `src/pages/OptionsPage.tsx` — ~755 lines; self-contained components: `OIButterflyChart`, `MaxPainChart`, `OIChangeChart`, `ScannerTable`, `SectionHead`, `StatChip`
- `src/api/optionsApi.ts` — `getOIAnalysis(symbol)`, `getScanner()`, `invalidateSymbol()`, `invalidateScanner()`
- `src/types/options.ts` — TypeScript interfaces matching Pydantic models

**Data:**
- Options: `data_lake/raw/options/date=YYYY-MM-DD/data.parquet` (hive-partitioned)
- Futures: `data_lake/raw/futures/date=YYYY-MM-DD/data.parquet` (hive-partitioned)
- View: `options_chain`, `futures_chain` in DuckDB (registered via `ensure_fo_views()`)

## Suggestions

1. **Add Max Pain distance alert**: Highlight symbols where Spot is > 2% from Max Pain — these are candidates for pin-to-max-pain trades as expiry nears.
2. **Add expiry countdown**: Show days to expiry next to the Expiry chip. Urgency increases as expiry approaches.
3. **PCR trend chart**: Plot PCR over the last 5–10 sessions for a symbol to show whether put writers are adding or reducing exposure over time.
4. **Straddle premium**: Compute CE_LTP + PE_LTP at ATM strike. This is the market's implied move for the expiry.
5. **OI vs Volume divergence**: High OI but low volume = stale positions (no fresh activity). Low OI but high volume = positions closing. Surface this as a quality indicator.
6. **Historical OI change timeline**: Once 5+ sessions of data exist, plot daily ce_zone_change and pe_zone_change as stacked bars to show how walls have evolved.
7. **Split page file**: `OptionsPage.tsx` is 755 lines. Consider extracting `OIButterflyChart`, `MaxPainChart`, `OIChangeChart` to `src/components/options/` when the page grows further.
