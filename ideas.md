# MarketDNA — Feature Ideas for Equity Analysts

Ideas generated 2026-07-14. Guiding constraint: help the analyst **do** their work (not check it),
using data MarketDNA already ingests (OHLCV NSE 500, delivery, options chain + IV history, futures
basis, regime/breadth/RS feature store). Every idea must be deterministic, explainable, and
validated before shipping (Golden Rule).

---

## 1. Precedent Engine (conditional base-rate explorer) — top pick

**Question it answers:** "I'm seeing this setup — what usually happens next?"

The analyst describes a market state in plain English (same vocabulary the Portfolio Builder
parser already understands) — e.g. *"regime score 60–70, drawdown under 10%, RS rank top
quartile, delivery accumulation fired in the last 5 days"*. The engine sweeps all 500 symbols ×
6 years of the feature store for every historical bar matching that state and returns the
precedent set: n occurrences, forward 1M/3M/6M return distribution, hit rate, median vs tail
outcomes, plus the actual precedent list (symbol + date), each linkable to StockPage.

**Why it helps:** Analysts do analogical reasoning from memory — biased and tiny. This does it
exhaustively. It also converts every existing feature into a queryable research instrument, and
becomes the natural MCP power tool for the AI copilot ("what's the base rate from here?" →
one tool call returning a distribution with n, per Principle 2).

**Implementation:** One DuckDB scan over the feature store with WHERE clauses compiled from
parsed conditions; forward returns already precomputed in `returns_features`. Sub-500ms realistic.
Generalizes the per-stock DTW analogs ("this price shape") to cross-sectional state matching
("any stock in this state") — predicate filtering, not O(n²) curve matching.

**Caveats (mandatory):** Refuse to show a distribution when n < ~30; always display n and date
range. De-duplicate overlapping precedent windows into *episodes* (first matching bar per symbol
per cluster) before computing distributions — 15 consecutive matching days on one stock is one
episode, not 15, or hit rates look falsely significant.

---

## 2. Entry Timing Assistant ("you've picked the stock — is now the time?")

**Question it answers:** "I've decided what to own; is now a good moment?"

Cleanest division of labor: the analyst decides *what* (fundamental judgment), MarketDNA decides
*when*. One card per watchlist stock fusing existing features — regime trajectory, RS trend,
delivery accumulation/distribution, IV percentile, distance from pattern support, breadth
context — into a single explainable timing read: "strong entry conditions" / "wait —
distribution active and regime rolling over" / "no edge either way". Every component clickable
through to its source page.

**Why it helps:** Respects the analyst's core skill (selection) while removing their weakest one
(timing). Highest daily-use frequency of all ideas — every watchlist stock, every day, one glance.

**Implementation:** Composition layer over existing features, no new math. Explainability by
construction (each component is an existing scored feature).

---

## 3. Marginal Contribution ("what does this actually add to my book?")

**Question it answers:** "Is this a new idea or more of the same bet?"

Before adding a position, run it against the existing portfolio: correlation with current
holdings, cointegration-cluster membership (engine already knows statistical peer groups),
overlap in regime/RS/sector tilts, downside co-movement. Killer output is one sentence:
*"This looks like a new idea, but it's 0.78 correlated with your existing basket and adds
concentration to the same high-RS-industrials bet — effective independent positions go from
6.2 to 6.3."*

**Why it helps:** Analysts systematically buy the same bet in different tickers; nobody tells
them. Hidden concentration is how books blow up — this prevents the most expensive class of
mistake.

**Implementation:** Slots into Portfolio Builder next to edge-health badges. First real
deliverable of Phase 6 (Portfolio Construction Engine) thinking.

---

## 4. Drawdown Forensics ("is this dip buyable?")

**Question it answers:** "A name I like just fell 15% — normal turbulence or regime change?"

Answer from the stock's own history: *"This is HDFCBANK's 11th drawdown beyond 12% in six years;
median depth 17%, median time to recover 61 days; past recoveries began only after delivery
accumulation reappeared and breadth was above 45 — neither is true yet."*

**Why it helps:** Shows up at the exact moment the analyst is stressed — converts panic into a
checklist. Wins the most user loyalty per unit of build effort.

**Implementation:** Join over existing drawdown series, Recovery Score, delivery signals, and
breadth history, plus a well-designed card. No new computation.

---

## 5. Stress Card ("what happens to this in a correction?")

**Question it answers:** "If NIFTY falls 10% from here, what does my stock / portfolio do?"

Per stock: historical downside capture (*"−13.5% for a −10% market; in the 2024 and 2025
corrections it drew down 1.4× the market with volume drying up"*). Per portfolio: expected
drawdown in a 10% market fall, ranked by which holdings contribute most. Key insight surfaced:
downside beta ≠ upside beta for most stocks, and analysts rarely look at the asymmetry until
it hurts.

**Why it helps:** Pure historical conditioning, no prediction — squarely inside the
explainability rule.

**Implementation:** Cheapest to build — crash-period behavior already computed in
`stock_health_service`; reframe from "archetype metric" to "answer to a question I was already
asking".

---

## 6. Move Decomposition ("why did it move?")

**Question it answers:** "TITAN is down 3% — the stock, the sector, or just the market?"

Regress each stock's daily return against the equal-weight index proxy and a sector basket;
decompose any window's move into market + sector + idiosyncratic components. *"2.1% of that 3%
was market beta; only 0.6% is stock-specific"* — saves the analyst from chasing ghosts.

**Why it helps:** The idiosyncratic residual is the only part worth investigating. The residual
series also becomes a new first-class feature (idiosyncratic momentum, residual z-score) that
feeds the Precedent Engine and quietly upgrades several existing scores.

**Implementation:** One rolling regression per stock over existing data. Needs a sector mapping
table for the sector leg.

---

## 7. Divergence Radar (price vs. evidence disagreement)

**Question it answers:** "Where are the tape and the data telling different stories?"

Cross-sectional scan scoring each stock on disagreement: price making highs while delivery shows
distribution and RS fades (fragile rally — short/avoid candidates), or price flat-to-down while
accumulation builds and regime quietly improves (coiled spring — research candidates). Ranked
two-sided table.

**Why it helps:** Idea generation is the analyst's real job; disagreement is the richest hunting
ground. Highest new-research-leads per unit of build effort. Framed as "go find out why" — a cue
to dig, not a signal.

**Implementation:** Composite over existing features. Differs from Short page by being symmetric
(both fragile rallies and coiled springs).

---

## 8. Expectations Gauge ("what's priced in")

**Question it answers:** "Is 'good' already priced before this event?"

Per stock: implied move to expiry (options chain), that stock's historical implied-vs-realized
ratio (does it typically realize 0.7× or 1.3× what's implied?), and IV percentile against its
own history (from the new `extract_iv` job). The analyst brings the fundamental view; MarketDNA
states the hurdle the market has set.

**Why it helps:** Turns options data into a research input for *equity* analysts — the best
strategic bridge between the platform's equity and options halves; no current page makes it.

**Implementation:** Builds on `extract_iv` IV history — worth doing once that series has a few
more months of depth (started ~2026-06).

---

## 9. Morning Briefing (ranked "what's unusual today")

**Question it answers:** "What changed overnight, in priority order?"

Post-close job scores every data change — regime crossings, RS rank jumps, delivery anomalies,
IV spikes, futures basis shifts — by *unusualness* (z-score against that stock's own history, so
a 2% move in a sleepy stock outranks 3% in a volatile one), takes the top ~15 across the
watchlist universe, and the LLM layer renders a short readable note with links into the relevant
pages.

**Why it helps:** Replaces the analyst's first hour of scanning. Highest daily-use stickiness —
creates a reason to open MarketDNA every single morning.

**Implementation:** Generalizes the existing per-stock `what-changed` endpoint from a diagnostic
to a prioritized universe view. Fits the standalone post-close job pattern (`jobs/`).

---

## 10. One-Click Dossier (the quantitative appendix, generated)

**Question it answers:** "Assemble the charts and stats for my note."

One button per symbol: a structured, exportable brief (markdown/PDF) — regime history, RS
trajectory, drawdown table, delivery behavior, seasonality, peer context, Precedent Engine base
rates, IV context — with the LLM writing connective narration strictly from MCP tool outputs
(Principle 2 enforced by construction). The analyst pastes their fundamental thesis on top and
the note is done.

**Why it helps:** Note assembly is hours of zero-judgment work. This makes MarketDNA part of the
analyst's *deliverable*, not just their research — the best long-term retention play.

**Implementation:** Depends on Precedent Engine (#1) for base-rate section; otherwise a
composition + templating layer over existing MCP tools.

---

## 11. Capacity & Exit-Liquidity Analyzer

**Question it answers:** "How long to exit this position, and does liquidity vanish in stress?"

Given a position size or portfolio weight: days to exit at a sane participation rate (e.g. 20%
of average delivery-adjusted volume), and how that liquidity behaves in stress — does volume dry
up exactly when the stock falls? A great small-cap idea that takes 40 days to exit is a
different idea.

**Why it helps:** Unglamorous, almost universally missing from research platforms, changes
conclusions.

**Implementation:** Pure arithmetic over volume + delivery data. Per-holding badge in the
Portfolio Builder next to edge-health badges.

---

## 12. Thesis Monitor (falsifiable, data-linked theses)

*Original top pick, reframed after feedback: build it as a **research aid** (the system watches
the data so the analyst doesn't have to), not as accountability/checking.*

Analyst creates a thesis on a symbol: free-text narrative + 2–5 falsifiable conditions expressed
against existing metrics (*"Regime Score stays ≥ 55", "RS rank stays top quartile", "IV
percentile < 70"*). A daily post-close job (same pattern as `measure_edges.py`) writes pass/fail
per condition to Postgres, append-only. UI: per-thesis health strip — conditions green/amber/red,
days-since-violation. The most valuable alert: **thesis broken, price flat** — the window to act
before the market agrees with the data. Closed theses become a research dataset for post-mortems.

**Implementation:** Reuses the plain-English condition parser, Postgres, and the standalone-job
pattern. Later composes with the Precedent Engine ("historical base rate for your entry
conditions").

---

## Suggested priority

| Rank | Idea | Rationale |
|------|------|-----------|
| 1 | Precedent Engine | Multiplies every existing feature; powers copilot + Dossier |
| 2 | Entry Timing Assistant | Most-used surface — every watchlist stock, every day |
| 3 | Morning Briefing | Daily-habit stickiness; cheap (generalizes `what-changed`) |
| 4 | Stress Card | Cheapest build — mostly exists in `stock_health_service` |
| 5 | Marginal Contribution | Prevents the most expensive mistakes; Phase 6 opener |
| 6 | Drawdown Forensics | Highest loyalty — appears at the analyst's worst moment |
| 7 | Divergence Radar | Most new research leads per build effort |
| 8 | Move Decomposition | Unlocks residual-return feature for other scores |
| 9 | One-Click Dossier | Best retention; depends on #1 |
| 10 | Capacity Analyzer | Small, practical, Portfolio Builder badge |
| 11 | Expectations Gauge | Wait for IV history depth (~few more months) |
| 12 | Thesis Monitor | Valuable, but frame as aid not audit |
