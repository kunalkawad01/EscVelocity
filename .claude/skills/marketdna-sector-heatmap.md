---
name: marketdna:sector-heatmap
description: >
  Build and render the MarketDNA Sector & Stock Heatmap — an interactive, drill-down
  performance grid for Indian equity markets. Each row is a sector; columns are 7 timeframes
  (1D, 5D, 1M, 3M, 6M, 1Y, 2Y); each cell shows a line chart plus % return with heatmap
  cell-background coloring. Clicking a sector expands per-stock rows with the same treatment.
  Includes: universe selector (Nifty 500 / Nifty 200 / F&O / Nifty 50), momentum rank column,
  breadth bar (% stocks green per sector), sort controls, and relative-strength vs Nifty badge.

  Use this skill whenever the user asks for: sector heatmap, sector performance grid,
  sector sparklines, sector drill-down, MarketDNA sector view, NSE sector chart, sector vs
  stock timeframe view, or any variation of "show me sectors and their stocks across timeframes".
  Also trigger when user says "spruce up the sector page", "add universe selector", or references
  breadth / momentum rank in the context of a sector grid.
---

# MarketDNA Sector Heatmap

## What this builds

A single-page React-style HTML artifact:

- **Universe selector** — tabs: Nifty 50 | Nifty 200 | Nifty 500 | F&O
- **Sort bar** — sort sectors by: Momentum Score | 1D | 1M | 3M | Breadth
- **Header row** — columns: Sector name | Momentum | Breadth | 1D | 5D | 1M | 3M | 6M | 1Y | 2Y
- **Sector rows** — one per sector; each timeframe cell = line chart (72×38px) + % return label with heatmap background tint
- **Breadth bar** — thin horizontal bar showing % of stocks in sector that are positive on the current sort timeframe
- **Momentum score** — weighted composite across all 7 TFs: `score = Σ(weight_i × ret_i)` with weights [0.05,0.08,0.12,0.15,0.18,0.20,0.22]
- **Drill-down** — click sector → expands stock rows with same column treatment
- **Stock-level extras**: 52W range bar, relative-strength vs Nifty indicator

---

## Tech stack

- Pure HTML + vanilla JS artifact (no external framework)
- Chart.js NOT used — draw line charts as inline SVG paths (faster, no flash)
- Colors: MarketDNA dark/gold theme — see Color System below
- Data: Kite Connect API via FastAPI `/api/sector-heatmap` endpoint (see API Contract)
- Fallback: seeded deterministic mock data when API unavailable

---

## Color System

```
Background:     #0d0d0d  (page)
Surface:        #141414  (rows)
Surface hover:  #1a1a1a
Border:         #2a2a2a
Gold accent:    #d4a017
Text primary:   #e8e8e8
Text muted:     #888

Positive line:  #00c87a   fill: rgba(0,200,122,0.10)
Negative line:  #ff4d4d   fill: rgba(255,77,77,0.10)
Neutral line:   #888      fill: rgba(136,136,136,0.08)

Heatmap cell backgrounds (ret-based tint, very subtle):
  strong pos (>5%):   rgba(0,200,122,0.18)
  mild pos (1–5%):    rgba(0,200,122,0.08)
  flat (±1%):         transparent
  mild neg (-1–-5%):  rgba(255,77,77,0.08)
  strong neg (<-5%):  rgba(255,77,77,0.18)
```

---

## Universe → Sector → Stock Mapping

Read the full mapping from `references/universe-map.md`.

Key structure:

```
Universe
  └── Sector[]
        └── Stock[]  { symbol, name, isFnO }
```

The universe selector filters which sectors/stocks are shown:

- **Nifty 50** — ~8 sectors, top 1–3 stocks each
- **Nifty 200** — ~13 sectors, top 4–6 stocks each
- **Nifty 500** — ~16 sectors, top 8–12 stocks each
- **F&O** — all sectors, only stocks with active F&O contracts flagged `isFnO: true`

---

## Layout Blueprint

```
┌─────────────────────────────────────────────────────────────────────┐
│  MarketDNA · Sector Heatmap          [N50] [N200] [N500] [F&O]     │
├─────────────────────────────────────────────────────────────────────┤
│  Sort by: [Momentum ▼] [1D] [1M] [3M] [Breadth]                    │
├──────────────┬──────────┬────────┬────┬────┬────┬────┬────┬────┬───┤
│ Sector       │ Momentum │ Breadth│ 1D │ 5D │ 1M │ 3M │ 6M │ 1Y │2Y │
├──────────────┼──────────┼────────┼────┴────┴────┴────┴────┴────┴───┤
│ ▶ Banking    │  +2.4 ★  │████░░  │  [line chart + %] × 7          │
│ ▶ IT         │  +1.8    │███░░░  │  [line chart + %] × 7          │
│   ...        │          │        │                                  │
└──────────────┴──────────┴────────┴─────────────────────────────────┘
  [expanded sector]
├──────────────────────────────────────────────────────────────────────┤
│   HDFC Bank   [52W bar ░░░█░░░░]  RS↑  │ [charts × 7]             │
│   ICICI Bank  [52W bar ░░░░░█░░]  RS→  │ [charts × 7]             │
```

---

## API Contract

### Endpoint

```
GET /api/sector-heatmap?universe=nifty500&timeframes=1d,5d,1m,3m,6m,1y,2y
```

### Response shape

```json
{
  "universe": "nifty500",
  "as_of": "2026-06-21T15:30:00+05:30",
  "nifty_returns": { "1d": 0.4, "5d": 1.2, "1m": 3.1, "3m": 5.4, "6m": 8.1, "1y": 14.2, "2y": 28.5 },
  "sectors": [
    {
      "name": "Banking & Finance",
      "color": "#378ADD",
      "momentum_score": 2.41,
      "breadth": { "1d": 0.75, "1m": 0.60 },
      "returns": { "1d": 0.8, "5d": 1.4, "1m": 3.2, "3m": 6.1, "6m": 9.0, "1y": 18.2, "2y": 34.1 },
      "series": {
        "1d":  [100, 100.2, 99.8, 100.8],
        "5d":  [...],
        "1m":  [...],
        "3m":  [...],
        "6m":  [...],
        "1y":  [...],
        "2y":  [...]
      },
      "stocks": [
        {
          "symbol": "HDFCBANK",
          "name": "HDFC Bank",
          "isFnO": true,
          "returns": { "1d": 0.9, ... },
          "series": { "1d": [...], ... },
          "week52": { "low": 1363, "high": 1880, "current": 1720 },
          "rs_vs_nifty": { "1m": 0.8 }
        }
      ]
    }
  ]
}
```

### FastAPI implementation skeleton

See `references/fastapi-endpoint.md` for the full Kite Connect → DuckDB → JSON pipeline (FastAPI + asyncio.gather for concurrent fetching).

---

## Rendering Rules

### Line chart SVG (per cell)

```
Width: 72px, Height: 38px, padding: 3px all sides
- Compute min/max of series, map to y-axis
- Draw filled area path first, then line path on top
- End-point dot: r=2, filled with line color
- No axes, no labels, no gridlines inside the SVG
```

### Heatmap cell background

Apply as `background-color` on the `.chart-cell` div based on the `returns[tf]` value.
Use the tint scale from the Color System section.

### Breadth bar

```html
<div class="breadth-bar">
  <div class="breadth-fill" style="width: {breadth*100}%"></div>
</div>
```

Width: 64px, height: 6px, border-radius: 3px.
Fill color: interpolate between #ff4d4d (0%) and #00c87a (100%).

### Momentum score

- Compute as weighted sum of 7 TF returns
- Weights: [1D=0.05, 5D=0.08, 1M=0.12, 3M=0.15, 6M=0.18, 1Y=0.20, 2Y=0.22]
- Display: `+2.41` in gold if positive, red if negative
- Add ★ icon next to top-3 ranked sectors

### 52W range bar (stock level only)

```
pos = (current - low) / (high - low)
<div style="width:60px; height:4px; background:#2a2a2a; border-radius:2px">
  <div style="width:4px; margin-left:{pos*56}px; height:4px; background:#d4a017; border-radius:2px"/>
</div>
```

### RS vs Nifty (stock level)

```
rs = stock_return_1m - nifty_return_1m
rs > 1%  → ↑ green
rs < -1% → ↓ red
else     → → gray
```

---

## Sort Logic

```js
function sortSectors(sectors, by) {
  if (by === "momentum")
    return [...sectors].sort((a, b) => b.momentum_score - a.momentum_score);
  if (["1d", "5d", "1m", "3m", "6m", "1y", "2y"].includes(by))
    return [...sectors].sort((a, b) => b.returns[by] - a.returns[by]);
  if (by === "breadth")
    return [...sectors].sort((a, b) => b.breadth["1m"] - a.breadth["1m"]);
  return sectors;
}
```

Re-sort on click; animate row reorder with a 150ms CSS transition on `transform: translateY`.

---

## Mock Data Fallback

When the API is unavailable, generate deterministic mock data with a seeded PRNG so the UI
is always populated and usable during development.

```js
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
```

Generate series lengths matching TF_POINTS = [8,14,22,40,60,90,140].
Compute `returns` as `(last - first) / first * 100` from the generated series.
Compute `momentum_score` from those returns using the weights above.

---

## Implementation Steps

1. Read `references/universe-map.md` to get the full sector/stock lists
2. Scaffold the HTML artifact with the dark/gold theme CSS variables
3. Build universe selector tabs → filter `currentUniverse` state
4. Build sort bar → `currentSort` state
5. Render header row
6. For each sector: render sector row with SVG line charts, breadth bar, momentum score
7. Wire drill-down: click → toggle stock sub-rows
8. For each stock: render stock row with SVG charts, 52W bar, RS arrow
9. Wire sort: on sort change, re-rank and re-render sector list
10. Add API fetch with mock fallback
11. Final polish: hover states, active sector highlight, smooth expand/collapse

---

## Files in this skill

| File                             | Purpose                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `SKILL.md`                       | This file — architecture + rendering rules                                                  |
| `references/universe-map.md`     | Full Nifty 50/200/500/F&O → sector → stock mapping                                          |
| `references/fastapi-endpoint.md` | FastAPI + Kite Connect backend (async, Pydantic models, DuckDB cache, APScheduler pre-warm) |
