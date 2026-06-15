# IndicatorsPage — `/indicators`

## 1. What It Is Doing

**This is the canonical UI reference page for MarketDNA.** All other pages should match its design language.

Technical indicator scanner and edge research lab (~1,275 lines). Five sections from market breadth to per-stock statistical validation.

**Five analytical sections** (defined in `SECTION_META`):
| Section | Component | Purpose |
|---------|-----------|---------|
| Market Regime & Breadth | `MarketRegimeDashboard` | How many NIFTY 50 stocks are above SMA 20/50/200 + per-stock Regime Score |
| Market Indicator Scan | `ScanSection` | RSI, MACD, BB %B, ATR, Volume Ratio, trend alignment across all 50 symbols |
| Edge Summary Table | `EdgeSummaryTable` | Ranks which indicator has the best validated edge per stock (win rate, expected return) |
| Indicator Edge Lab | `IndicatorEdgeLab` | Forward-return distribution for one indicator + one stock across full history |
| Stock Indicator Detail | `StockDetailSection` | Current readings: 4 cards (Trend, Momentum, Volatility, Volume) + divergence alerts |

Each section is preceded by a `SectionInfo` card with an undraw illustration, "What this shows", "Best used when", and "Avoid when" columns.

**Three layout modes** (user-selectable in hero):
- **Classic** (`▤`): all sections stacked vertically — best for exploratory sessions
- **Focused** (`◫`): one section at a time via `TabBar` — best when you know what to look for
- **Split** (`◧`): sticky scanner on left, stock detail on right — click row → right panel updates instantly

**ScanSection**: `Run Scan` → signal distribution strip → 4 client-side filters (Overall Signal, RSI, MACD Cross, Trend) + symbol search → sortable `MaterialTable` of all 50 NIFTY 50 symbols. Clicking a row pre-loads the symbol into StockDetailSection (scroll/tab depending on layout mode).

**StockDetailSection**: overall signal banner + divergence alert rows + 4 metric cards (TrendCard, MomentumCard, VolatilityCard, VolumeCard).

**BbBar**: visual mini progress bar showing Bollinger Band %B position (0 = lower band, 100 = upper band).

**TabBar**: CYAN underline for active tab, INK3 for inactive — the reusable tab pattern across MarketDNA.

---

## 2. Optimization

- `NIFTY50_SYMBOLS` is hardcoded as a 50-item array inside the component. Should be fetched from `/api/symbols` and shared via context so all pages stay in sync.
- ScanSection filters are already client-side — no re-fetch on filter change. Good. But the filter state is not in the URL so a page refresh resets all filters.
- `SECTION_META` object documents what/useful/avoid for each indicator. This metadata should drive the UI automatically — render cards from the meta object rather than hard-coding each card separately.
- The three layout modes each re-render the full section tree — use `display: none` / CSS visibility instead of conditional rendering to avoid Highcharts re-init costs on tab switch.
- No virtualization on the 48-symbol scanner table. With 200+ symbols, this will be the first thing to break.

---

## 3. Lessons Learnt

- **Indicators page as design reference**: Every new page should open IndicatorsPage and copy the CARD/TH/TD/TabBar/SectionHead patterns exactly. Do not re-invent.
- `BbBar` (the inline mini progress bar for %B) is a reusable component that should live in `src/components/shared/` — it is useful for any 0–100 range visualization.
- The Split layout mode (sticky left scanner + scrollable right detail) is the highest-value layout for research workflows. Other pages should adopt it where there is a list-to-detail relationship.
- Divergence detection (price making new highs while RSI makes lower highs) is the most analytically sophisticated part of this page — but it requires at least 2 swing points, which is hard to compute reliably on 5-year data without a peak-detection algorithm.

---

## 4. Business Logic

- **Regime score**: 3-component — price position vs SMAs (40pts), SMA alignment (30pts), SMA slope (30pts)
- **RSI**: 14-period; ≥70 = overbought, ≤30 = oversold; RSI slope direction for momentum quality
- **MACD**: 12/26/9; histogram sign change = signal cross; histogram expansion = momentum strength
- **Bollinger %B**: `(price - lower_band) / (upper_band - lower_band)` × 100; >80 = extended, <20 = compressed
- **ATR%**: `ATR_14 / close × 100`; used for position sizing (target risk / ATR% = position size)
- **Signal aggregation**: each indicator votes (+1 bullish, -1 bearish, 0 neutral); net vote / indicator count = signal strength 0–100
- **Divergence**: RSI or MACD lower high vs price higher high over trailing 20 bars

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI |
| Design | `usePalette()`, `useTokens()` — CARD, TH, TD, TabBar, BbBar |
| API | `indicatorsApi.scan()`, `indicatorsApi.getSymbol(symbol)` |
| Charts | Highcharts (price chart with SMA overlays) |
| State | `useState`, parallel API calls on symbol change |
| Fonts | IBM Plex Sans (body), IBM Plex Mono (numbers) |

---

## 6. Suggestions to Achieve the Objective

1. **Indicator edge validation tab**: add a 5th layout mode — "Edge Lab" — where users can select any indicator + parameter combination, run a forward-return decile analysis, and see if the indicator has real predictive value. This directly serves the "research over opinions" principle.
2. **Factor exposure panel**: when a stock is selected in Split mode, show its current factor exposures (momentum factor, value factor, quality factor) alongside the technical indicators. Bridges technical and quantitative research for portfolio construction.
3. **Alert rules builder**: let users set a rule like "notify me when RELIANCE crosses RSI 30 AND regime ≥ 60." Requires a backend rule engine and notification system. This turns the page from a dashboard into a research workflow tool.
4. **Indicator correlation matrix**: show how the 5 indicator layers correlate across the current NIFTY 50. Highly correlated indicators (RSI and MACD often agree) should be shown as redundant — the system should suggest using only the most independent indicators.
5. **Macro overlay**: add a top strip showing current Market DNA score, Breadth score, and India VIX. Technical signals without macro context are incomplete — a regime-filtered indicator scanner is far more powerful for portfolio construction decisions.
