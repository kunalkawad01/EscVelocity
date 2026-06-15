# ShortPage — `/short`

## 1. What It Is Doing

Short candidate screener + squeeze watch (~1,045 lines). Loads on mount (no scan gate). Two-column layout: 3fr (ShortCandidates) / 2fr (SqueezeWatch) on large screens.

**ShortCard** — per stock short intelligence:
- Win rate, expected value (EV), edge score
- Delivery% (signal quality)
- Regime indicator (color-coded 0–100)
- SMA alignment chips (SMA20, SMA50, SMA100, SMA200 — green = above, red = below)
- Days below SMA20 (momentum persistence)
- Vol ratio + delivery ratio (vs 20-day average)
- "Weak market boost" callout: highlights when regime < 40 amplifies short edge

**SqueezeCard** — squeeze candidates (stocks rallying into declining structure):
- Fall from 20D high (retracement %)
- Days below SMA20 (structural weakness duration)
- Trigger signal (what delivery/momentum pattern triggered it)
- Grade (A/B/C/D)
- Squeeze risk label (High/Medium/Low)

**AlgoGuide** — collapsible panel with:
- Full formula breakdown for both scores
- Grade table with thresholds
- Key concepts (weak market boost, squeeze triggers)

**DoodleDecor** — `SquiggleUnderline` SVG + `ResearchNote` decorative components. Editorial flourish consistent with the research platform identity.

---

## 2. Optimization

- Loads all 48 stocks on mount — no lazy loading. The full scan result should be cached in Redis (1-hour TTL) since short candidates change slowly intraday.
- ShortCard and SqueezeCard are defined inline — extract to `src/components/short/`.
- `AlgoGuide` renders its full content tree even when collapsed — use conditional rendering or CSS `display: none` to avoid invisible DOM weight.
- SMA alignment chips are computed frontend from backend data — verify that SMA values are returned directly, not requiring re-computation client-side.
- No sorting controls on the short candidates list. Default sort by edge score (descending) is assumed — add column sort for win rate, EV, and regime to allow custom research ranking.
- The "Weak market boost" callout fires whenever regime < 40. This threshold should be configurable, not hardcoded.

---

## 3. Lessons Learnt

- The "Weak market boost" is the most important innovation on this page. Short signals in a weak market (regime < 40) have empirically higher win rates — the formula correctly amplifies edge by up to 60% in bear conditions. This is regime-conditioning done right.
- Squeeze detection (stock falling from recent highs while still above its structure) is conceptually distinct from shorts. A squeeze candidate is a stock where buyers are trapped, creating overhead supply — not necessarily a weak fundamental story. Separating these two screeners into the same page is correct but should be more clearly differentiated in the UI with different heading colors or section dividers.
- DoodleDecor (SquiggleUnderline SVG) adds a "research notebook" feel that differentiates MarketDNA from terminal-style platforms. Keep these editorial flourishes — they reinforce the research brand.
- Grade thresholds (A/B/C/D based on WR and EV) are shared with DeliveryPage but are defined separately in each page. Extract to a shared utility function `gradeSignal(winRate, ev, occurrences)` in `src/utils/grading.ts`.

---

## 4. Business Logic

**Short score formula**:
```
short_score = edge × regime_factor × weak_boost

edge = (win_rate / 100) × max(EV, 0) × frequency
regime_factor = 1 + max(0, (50 - regime_score) / 50) × 0.6
weak_boost = 1.0 if regime ≥ 40
weak_boost = 1.0 + (40 - regime) × 0.015 if regime < 40
```

Interpretation: a stock in regime 20 (weak bear) gets `regime_factor` boost of ~1.60 and additional `weak_boost`. Final score can be up to 2.4× the base edge.

**Squeeze score formula**:
```
squeeze_score = edge × decline_factor × days_factor × wr_factor

decline_factor = max(fall_from_20d_high / 10, 1.0)  [normalized % decline]
days_factor = min(days_below_sma20 / 20, 2.0)  [persistence of weakness]
wr_factor = win_rate / 50  [scaled to 1.0 at 50% WR]
```

**Squeeze risk classification**:
- High: squeeze_score ≥ 3.0
- Medium: squeeze_score ≥ 1.5
- Low: squeeze_score < 1.5

**Grade table** (shared logic with DeliveryPage — should be centralized):
| Grade | Win Rate | EV |
|-------|----------|-----|
| A+ | ≥ 65% | ≥ 3% |
| A | ≥ 60% | ≥ 2% |
| B | ≥ 55% | ≥ 1% |
| C | ≥ 50% | ≥ 0% |
| D | < 50% | — |

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI |
| Layout | CSS Grid 3fr/2fr two-column |
| API | `shortApi.getScan()` → GET `/api/short/scan` |
| Decorative | SVG (SquiggleUnderline), custom `ResearchNote` component |
| State | `useState`, single fetch on mount |
| Design | `usePalette()`, CARD/TH/TD tokens |
| Backend | Python, Polars, DuckDB (delivery + OHLCV + regime scores) |

---

## 6. Suggestions to Achieve the Objective

1. **Portfolio hedging view**: for a user's long portfolio, automatically identify which of their longs have deteriorating delivery signals and regime scores — these are hedge candidates. Show "Your long HDFC Bank is now showing Distribution signals at regime 38 — consider protective put." This directly connects short intelligence to portfolio construction.
2. **Options hedge builder**: for the top squeeze candidates (Squeeze Risk = High), generate a protective put structure: ATM put, 30 days to expiry, estimated premium. The squeeze score should inform the option size (higher squeeze risk → larger hedge notional). Directly serves the options trading objective.
3. **Short + macro alignment**: only surface short candidates when the broader market breadth is deteriorating (Breadth < 40 AND Market DNA < 50). Shorting individual stocks in a strong market is risky. Regime-gating the short screener at the market level reduces false positives significantly.
4. **Time-to-cover calendar**: for active short positions, show estimated days to cover based on historical squeeze duration data. If squeeze candidates historically resolve in 10–15 days, the user knows when to revisit or exit the position.
5. **Centralize grading logic**: extract the shared grading function `gradeSignal(winRate, ev, occurrences)` to `src/utils/grading.ts` and import it in both ShortPage and DeliveryPage. Inconsistent grade thresholds across pages are a research integrity issue.
