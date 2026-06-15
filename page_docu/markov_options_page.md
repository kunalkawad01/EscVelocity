# MarkovOptionsPage — `/markov-options`

## 1. What It Is Doing

6-regime Markov chain classifier + options strategy recommendation engine (~780 lines). The most quantitatively sophisticated page in MarketDNA.

**What it answers**: "Given this stock's current regime, what is the probability distribution over the next regime, and what options strategy does that probability distribution suggest?"

**Six regimes** (defined by ADX, RSI, % vs SMA50, monthly return, HV ratio):
| ID | Name | Color |
|----|------|-------|
| 0 | Strong Uptrend | Green |
| 1 | Volatile Bull | Lime |
| 2 | Sideways Quiet | Gray |
| 3 | Sideways Volatile | Amber |
| 4 | Steady Bear | Orange |
| 5 | Volatile Bear | Red |

**Key components**:
- `RegimeTimeline`: 56-month colored bar history (14×28px per bar) with Tooltip showing 5 regime metrics
- `TransitionMatrixView`: 6×6 Markov transition matrix. Each cell = P(next regime | current regime). Max per row highlighted. Cells with n<3 observations shown in yellow (insufficient data warning).
- `ForecastBar`: ranked probability bars for next regime. Tail risk callout if Volatile Bear probability > 15%.
- `StrategyCard`: recommended primary strategy, IV action (Buy/Sell), alternative strategies, avoid list, rationale paragraph.
- `MarketOverview`: sector chips (clickable filter), table with inline mini LinearProgress per regime probability.

**Load behavior**: stock loads immediately on mount with no gate. Market scan requires explicit "Run Market Scan" button (warned 30–60s), shown alongside a `/illustrations/market-scan.svg` illustration in the gate card before scan runs.

**Illustrations**: custom SVGs in `public/illustrations/` — `computing-regimes.svg` (LoadingCard spinner overlay), `markov-chain.svg` (hero right column, desktop only), `market-scan.svg` (market scan gate), `no-pairs.svg` (error state). All use `filter: brightness(0.90)` in dark mode.

**Anchored navigation**: `<Navbar sections={[{ label: 'Stock', anchor: 'stock-analysis' }, { label: 'Market', anchor: 'market-overview' }]} />` — Navbar renders in-page jump links in addition to global nav.

**Regime distribution chips** in `MarketOverview`: each regime chip is clickable and toggles a `filterRegime` state for in-place filtering of the table without a re-fetch.

**Transition matrix prior**: α=0.20 Dirichlet prior blended with empirical counts to smooth sparse cells. Formula: `P = (counts + α) / (row_sum + α × n_regimes)`.

---

## 2. Optimization

- `NIFTY50_SYMBOLS` is hardcoded (same as IndicatorsPage) — fetch from `/api/symbols`.
- RegimeTimeline re-renders 56 bars on every prop change. Memoize the bar grid with `useMemo` since regime history is static once loaded.
- Market scan (~30–60s) blocks the UI. Run the scan server-side on a schedule (nightly) and cache in Redis. The "Run Scan" button should trigger a cache refresh, not a full recompute.
- TransitionMatrixView renders a 6×6 grid with conditionally colored cells — this is correct and performant. No changes needed.
- The `StrategyCard` strategy map is hardcoded client-side. Strategy logic should live in the backend (MCP tool) so the AI agent can also call it without duplicating logic.
- No chart of regime persistence — showing how many days the stock typically stays in each regime before transitioning would significantly improve the options sizing decision.

---

## 3. Lessons Learnt

- The Dirichlet prior (α=0.20) is critical for rows with few observations. Without it, a stock that was in "Sideways Quiet" for 2 months with 0 transitions would show 100% probability of staying there — overconfident and wrong.
- Cells with n<3 observations (shown in yellow) should be treated as "unknown" not "confident small probability." The yellow warning is a good UI affordance — preserve it in any redesign.
- The 6-regime classifier uses heuristic thresholds (ADX>25 for trend, RSI>60 for bullish, etc.). These thresholds were chosen by inspection, not optimization. A proper validation would run a grid search over threshold combinations and score by regime predictive stability.
- Options strategy recommendations are currently hardcoded per regime. The correct approach is: given the forecast probability distribution over regimes, compute the expected P&L of multiple candidate strategies and recommend the highest expected P&L strategy. The current heuristic map is a starting point.

---

## 4. Business Logic

**Regime classification inputs** (per month, computed from daily data):
- `ADX`: trend strength (>25 = trending)
- `RSI`: momentum (>60 = bullish, <40 = bearish)
- `pct_vs_sma50`: price position vs 50-day SMA
- `monthly_ret`: calendar month return
- `hv_ratio`: HV20 / HV252 (realized vol ratio — >1 = vol expanding)

**Strategy map** (regime → options strategy):
| Regime | Primary Strategy | IV Action |
|--------|-----------------|-----------|
| Strong Uptrend | Long calls / bull call spread | Buy if IV low |
| Volatile Bull | Iron condor / call spread | Sell if IV high |
| Sideways Quiet | Short straddle / iron condor | Sell |
| Sideways Volatile | Long straddle / strangle | Buy |
| Steady Bear | Long puts / bear put spread | Buy if IV low |
| Volatile Bear | Long straddle / protective put | Buy |

**Transition matrix** blending:
```
P(i→j) = (empirical_count(i→j) + α) / (sum_over_j(empirical_count(i→j)) + α × 6)
α = 0.20
```

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI, LinearProgress |
| API | `markovApi.getStock(symbol)`, `markovApi.scan()` |
| Algorithm | Backend: hmmlearn / scikit-learn (regime classification), NumPy (transition matrix) |
| Charts | None (LinearProgress bars for probability) |
| State | `useState`, separate stock + market scan state |
| Caching | GARCH/HMM must be cached — slow computation |
| Design | `usePalette()`, standard CARD/TH/TD tokens |

---

## 6. Suggestions to Achieve the Objective

1. **Expected P&L strategy optimization**: given the 6-regime probability forecast, compute expected P&L for top-10 options strategies using current IV + forward return distribution. Recommend the highest expected-value strategy, not a hardcoded heuristic per regime. This is the foundational improvement for options trading objective.
2. **IV surface integration**: current regime forecast + IV surface overlay = powerful options edge identification. When the market is in "Sideways Volatile" but IV rank is at 10th percentile, buying straddles is doubly compelling. Show IV rank alongside each StrategyCard.
3. **Options payoff chart**: for the recommended strategy, show a payoff diagram at expiry (P&L vs underlying price). This is standard in any options platform and immediately communicates the risk profile.
4. **Regime persistence histogram**: show the distribution of days spent in each regime before transitioning. If "Volatile Bear" typically lasts 3–5 months, that informs options expiry selection — buy 3-month puts, not weekly.
5. **Portfolio-level regime exposure**: show the regime distribution across all stocks in a user's portfolio. A portfolio with 70% of stocks in "Volatile Bear" needs hedging even if the index shows "Sideways." Aggregate regime view is the bridge between this page and portfolio construction.
