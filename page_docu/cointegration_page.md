# CointegrationPage — `/cointegration`

## 1. What It Is Doing

Statistical pairs trading research module. On mount, calls `cointegrationApi.getScan()` once and displays results. The page answers: "Which pairs of NIFTY 50 stocks move together in a statistically meaningful, mean-reverting relationship?"

Key output sections:
- **Stats row**: four `StatCard` components — Universe (total pairs), Correlation passed, Cointegrated (count, accent-colored), Computed timestamp
- **Active signal alert**: amber banner listing pairs where |Z-score| ≥ 2 (up to 5, then "+N more") — actionable deviation from equilibrium
- **Pair table**: wrapped in `SectionCard` component with `tag="Engle-Granger · Johansen"` — rows show symbol pair, correlation, p-value, Z-score, half-life, signal direction

**Illustrations** (custom SVGs in `public/illustrations/`):
- `pair-analysis.svg`: hero right column (desktop only, `brightness(0.92)` dark)
- `data-scan.svg`: loading state inside the pair table card
- `no-pairs.svg`: error and empty-result states

**Components**: uses `SectionCard` and `StatCard` from `../components/SectionCard` — not the standard CARD token. `SectionCard` renders the accent-colored tag + title header; `StatCard` renders a labeled metric chip.

The hero sub-text shows the actual p-value and correlation thresholds from the scan response: `p < {scan.pvalue_threshold} · |r| ≥ {scan.correlation_threshold}`.

Statistical tests used:
- **Engle-Granger**: OLS regression of Stock A on Stock B, ADF test on residuals to confirm stationarity
- **Johansen**: multivariate test allowing more than two series

Accent color: `#34D399` (emerald green — distinct from bullish `#22c55e`).

---

## 2. Optimization

- Single API call on mount is correct. But the scan takes 5–15s for the full NIFTY 50 universe — add a skeleton loader, not just a spinner, so users see the page structure immediately.
- The pair universe is computed on every request. Pre-compute and cache in the Feature Store with daily refresh via a scheduled job. The API should serve cached results in <100ms.
- The active signal alert should support **push notification** — when |Z-score| crosses 2, the user should be notified even without the page open.
- No time-series chart of the spread — this is a significant gap. Users need to see the spread history to trust the Z-score.
- No filtering controls: sector filter (filter pairs to same sector, reduces spurious cointegration), half-life range filter, minimum pair correlation threshold — all are missing.

---

## 3. Lessons Learnt

- Engle-Granger assumes one-way causality (A on B). Always run both directions and pick the lower p-value. The backend must handle this or results are unstable.
- Half-life from the Ornstein-Uhlenbeck process is the most actionable number — short half-life (5–15 days) = practical pairs trade. Long half-life (60+ days) = theoretical but not tradeable. Surface this more prominently.
- Cointegration is regime-dependent. A pair that was cointegrated in 2020–2022 may break down in a trending bull market. The page must show test period and out-of-sample validity.

---

## 4. Business Logic

1. **Universe**: all combinations of NIFTY 50 symbols → C(48,2) = 1,128 candidate pairs
2. **Correlation filter**: Pearson |r| ≥ 0.70 over trailing 252 days — reduces universe ~65% (threshold shown dynamically from `scan.correlation_threshold`)
3. **Engle-Granger**: residuals ADF test, p-value ≤ 0.05 → cointegrated
4. **Z-score**: `z = (spread - spread_mean) / spread_std` over 252-day rolling window
5. **Signal**: |Z-score| ≥ 2 → active signal; Z > 0 → short A / long B; Z < 0 → long A / short B
6. **Half-life**: `ln(2) / abs(AR1_coefficient)` from AR(1) on spread

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI, `usePalette()` |
| API | `cointegrationApi.getScan()` → GET `/api/cointegration/scan` |
| Statistics | Statsmodels (backend): ADF, Johansen |
| Charts | None currently |
| State | Local `useState`, single fetch |

---

## 6. Suggestions to Achieve the Objective

1. **Spread time-series chart**: Show the 252-day spread history with ±1σ and ±2σ bands, and mark where current Z-score sits. Use Highcharts. This is the most important missing piece — without it users cannot trust the signal.
2. **Regime-conditioning filter**: only show pairs that were cointegrated during the current regime (regime ≥ 60 = trending market may break cointegration). Combine with MarkovOptions regime output.
3. **Portfolio construction link**: from a cointegrated pair with active Z-score, one-click to generate a hedge ratio, notional size for equal dollar-neutrality, and suggested options hedge (spread/straddle on the wider-moving leg).
4. **OOS validation badge**: for each pair, show the out-of-sample test period and whether cointegration held. Failed OOS pairs should be grayed out, not shown as active signals.
5. **Scheduled alerting**: push notification when any pair crosses |Z| = 2. Requires a backend scheduler + user notification prefs — foundational for a research platform.
