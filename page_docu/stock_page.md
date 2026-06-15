# StockPage — `/stock`

## 1. What It Is Doing

Comprehensive per-stock research profile (~461 lines of page shell + many sub-components). The deepest analytical view in MarketDNA — 19 analytical sections covering every quantitative dimension of a stock.

Route: `/stock/:symbol` (URL param support — linkable to any symbol).

**Navigation structure**:
- **Row 1** (sticky): logo + symbol + live price + regime chip + symbol selector dropdown
- **Row 2** (sticky): 19-section jump strip with CYAN active underline — identical to IndicatorsPage TabBar

**19 sections** (from `SECTION_INDEX` array):
| # | Section | Accent |
|---|---------|--------|
| 1 | Hero — price, regime, DNA score | CYAN |
| 2 | Price Chart — candlestick + SMA overlays | Indigo |
| 3 | Relative Strength — vs NIFTY 50 proxy | Violet |
| 4 | Return Intelligence — forward return deciles | Amber |
| 5 | Risk Intelligence — ATR, drawdown risk, VaR | Teal |
| 6 | Drawdown — underwater equity curve | Red |
| 7 | Percentile Dashboard — all metrics vs history | Purple |
| 8 | AI Research Assistant — LLM-powered Q&A | CYAN |
| 9 | What Changed Today — delta from prior close | Lime |
| 10 | Market Structure — supply/demand zones | Orange |
| 11 | Trend Persistence — trend quality metrics | Blue |
| 12 | Opportunity Dashboard — signal confluence | Green |
| 13 | Research Insights — automated research notes | Indigo |
| 14 | Historical Analog — DTW pattern matching | Violet |
| 15 | Z-Score — price vs rolling distribution | Amber |
| 16 | Dual Momentum — absolute + relative momentum | Teal |
| 17 | Statistical Signals — regime cluster output | Red |
| 18 | Volatility Lab — HV surface, vol cone | Purple |
| 19 | Regime Clusters — K-Means cluster assignments | Lime |
| 20 | Pattern Match — current pattern detections | Orange |
| 21 | Market Dynamics — breadth context | Blue |

**All 18+ API calls fire in parallel** on symbol change via `load()` helper — maximum responsiveness.

**`Section` wrapper component**: 2px gradient top border, PAPER2 header with monospace section number, consistent card shell across all 19 sections.

---

## 2. Optimization

- **18+ parallel API calls on load** is aggressive. While parallel is correct, consider a priority tier: Hero/Price/Regime/DNA = Tier 1 (fire immediately, render), all others = Tier 2 (fire with 100ms delay after Tier 1 resolves). This prevents 18 simultaneous DuckDB queries on the shared connection.
- DTW (Historical Analog, section 14) is O(n²) — must be pre-computed and cached. Never compute on request. This is the most expensive operation in the page.
- AI Research Assistant (section 8) streams from an LLM — this is correct. Ensure the stream is properly cancelled via `AbortController` on symbol change to avoid stale responses.
- `SECTION_INDEX` array drives both the section jump strip and the section render order. This is good — adding a new section means updating one array, not two places.
- The page shell is 461 lines but each section is a sub-component. This is the correct architecture. Verify that heavy sections (VolatilityLab, RegimeClusters) are lazy-loaded with `React.lazy` + `Suspense`.
- Sticky two-row nav means 96px of fixed header height on mobile — the section jump strip collapses poorly on small screens. Add horizontal scroll on the jump strip for mobile.

---

## 3. Lessons Learnt

- Firing all 18 API calls in parallel was the right call — sequential loading produced a 15–20s page load time. Parallel reduced it to 3–5s for the slowest section (DTW/GARCH-based).
- The sticky 2-row nav with section jump strip is the most used UI feature on this page — users navigate sections constantly. This pattern should be replicated anywhere there is a long scrollable research report.
- The `Section` wrapper with monospace section number (`01`, `02`, ...) is a strong design pattern that gives the page a "research report" feel. Every page with multiple analytical sections should use this pattern.
- AI Research Assistant must be clearly labeled as "AI-generated — verify with data" to prevent users from treating LLM output as ground truth. The AI agent is a reasoning layer, not a data source.
- Historical Analog (DTW) is the section users find most interesting but also most confusing. It needs a clear explanation of "what makes two periods similar" — otherwise users don't know how to interpret the analog matches.

---

## 4. Business Logic

**Regime chip**: colored 0–100 score. Green ≥ 65, amber 40–64, red < 40. Formula: price position (40pts) + SMA alignment (30pts) + SMA slope (30pts).

**Return Intelligence deciles**: historical forward returns at 1d/1w/1m/3m horizons, split into 10 deciles by signal strength. Shows whether the stock's current signal level predicts anything.

**Risk Intelligence (VaR)**:
```
VaR_95 = -mean_daily_return - 1.645 × daily_vol
VaR_99 = -mean_daily_return - 2.326 × daily_vol
```

**Drawdown (underwater equity curve)**:
```
drawdown(t) = (price(t) - rolling_max(price)) / rolling_max(price)
```

**Percentile Dashboard**: each metric (RSI, ATR%, HV20, RS score, etc.) shown as its percentile vs trailing 252 days. Immediate visual sense of whether current readings are historically extreme.

**Dual Momentum**:
- Absolute: stock's own 12-1 month return > 0
- Relative: stock's 12-1 month return > NIFTY proxy 12-1 month return
- Both positive = strongest long signal

**Z-Score**: `(current_price - rolling_mean_252) / rolling_std_252`

**Historical Analog (DTW)**: finds top 3 price path matches in the last 5 years using Dynamic Time Warping on normalized 60-day price windows.

**Section wrapper**:
```tsx
<Box sx={{ borderTop: `2px solid ${accent}`, bgcolor: PAPER2, ... }}>
  <Typography sx={{ fontFamily: 'IBM Plex Mono' }}>0{index}</Typography>
  {title}
</Box>
```

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI, Highcharts/Highstock |
| Routing | React Router (`/stock/:symbol`) |
| API | 18+ parallel calls: regime, DNA, RS, drawdown, returns, VaR, percentiles, AI assistant, what-changed, market structure, trend persistence, opportunity, insights, analog, z-score, dual-momentum, statistical signals, vol lab, clusters, patterns, dynamics |
| AI | LLM streaming (AI Research Assistant section) |
| DTW | Backend: tslearn or fastdtw — cached |
| Charts | Highcharts candlestick (price), area (drawdown), scatter (Z-score distribution), spline (vol cone) |
| State | `useState` × 18+ data objects, parallel `Promise.all` load |
| Design | `usePalette()`, `useTokens()`, custom `Section` wrapper, 2-row sticky nav |

---

## 6. Suggestions to Achieve the Objective

1. **Portfolio position sizing panel**: in section 5 (Risk Intelligence), add a position sizing calculator: user inputs portfolio size → system outputs recommended position size based on ATR-based risk (1% portfolio risk = ATR% / 1% × position size). This makes the risk section actionable for portfolio construction.
2. **Options quick-builder**: from the current regime, vol rank, and momentum score, generate a one-click options strategy recommendation in section 18 (Volatility Lab). Strike selection based on delta (e.g., 0.30 delta calls for bull call spread). Directly serves the options trading objective.
3. **Research annotation layer**: let users add private research notes to any section (sticky to that symbol + section). Notes persist in PostgreSQL. This turns the page into a research journal, not just a dashboard — supporting deep research workflows.
4. **AI Research Assistant quality gate**: before displaying an AI Research Assistant response, validate that every factual claim in the output is sourced from the Feature Store (not hallucinated). Implement a response validator that checks numeric values against the actual API data returned in parallel. AI agents must only summarize, never invent.
5. **Export to research brief**: add a one-click "Export Research Brief" that compiles the key findings from all 19 sections into a structured Markdown/PDF document: current regime, strongest signals, risk profile, top-3 historical analogs, recommended action. This bridges per-stock research to portfolio-level decisions — the final output of a research session.
