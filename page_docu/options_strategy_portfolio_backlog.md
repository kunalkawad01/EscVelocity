# Options Strategy Portfolio — Research & Product Backlog

> Research completed 2026-06-13 via 5 parallel agents.
> Scope: portfolio construction theory + Indian market fit → prioritized build tasks.

---

## Core Thesis

Running a single options strategy (e.g., short straddle on RELIANCE) leaves P&L exposed to
regime risk. A portfolio of 4–5 complementary strategies with dynamically reweighted allocations
based on the India VIX regime produces smoother equity curves, lower drawdowns, and more
consistent theta income — without requiring superior directional prediction.

The Markov regime classifier already in MarketDNA is the allocation engine. What's missing is
the layer that translates regime → strategy weights → portfolio Greeks → risk limits.

---

## The Indian Options Strategy Basket

Anchored on Nifty weekly (Thursday expiry) and BankNifty weekly (Wednesday expiry).
Stock options are NOT used for multi-leg strategies — physical delivery risk, wide spreads,
and thin OI make them structurally unsuitable. Stock options are reserved for covered call
overlay on held equity positions only.

| ID | Strategy | Vehicle | Regime Activation |
|----|----------|---------|-------------------|
| S1 | Short Iron Condor | Nifty weekly | Core — always on, scaled |
| S2 | Short Strangle (defined-risk wings) | BankNifty weekly | VIX < 15 (high weight) |
| S3 | Calendar Spread (sell near / buy far) | Nifty monthly | VIX < 15, uptrend |
| S4 | Long Strangle / ATM Debit Spread | Nifty weekly | VIX > 22 or pre-event |
| S5 | Covered Call Overlay | Large-cap stocks (monthly) | Always on for held positions |

---

## Regime → Allocation Table

| India VIX | S1 Iron Condor | S2 Short Strangle | S3 Calendar | S4 Long Vol | S5 CC Overlay |
|-----------|---------------|-------------------|-------------|-------------|---------------|
| < 15 | 40% | 30% | 20% | 0% | 10% |
| 15–22 | 30% | 15% | 15% | 25% | 15% |
| > 22 | 10% | 0% | 0% | 65% | 25% |

Capital % = share of total SPAN margin budget (max 50% of capital deployed).

Regime transition rule: if VIX closes above/below threshold for 2 consecutive days,
reweight within 1 trading session. Never reweight on intraday VIX noise.

---

## Regime Transition Signals (Inputs to Allocation Engine)

1. **VIX term structure slope** — front-month / next-month IV ratio. Backwardation (>1) → vol expansion imminent.
2. **Put-Call Ratio** — Nifty PCR > 1.3 → institutional hedging; precedes vol expansion.
3. **Breadth Score < 40** — already computed in MarketDNA; narrow leadership = fragile regime.
4. **RV acceleration** — 5-day realized vol crossing above 20-day RV → regime transition.
5. **FII net derivatives position** — sustained net short in index futures amplifies gamma events.

---

## Portfolio Risk Framework

### Greek Limits (enforced before entry each week)

| Greek | Limit |
|-------|-------|
| Net delta | ≤ ±0.5% of portfolio notional |
| Net vega | ≤ 2% of NAV per 1-vol-point move |
| Net gamma | Loss from 2% overnight gap ≤ 1% NAV |
| Net theta | Target 0.05–0.10% NAV/day (income book) |

### Strategy Stop-Loss Rules

1. **P&L stop (primary)**: exit if strategy loss = 2× net premium collected.
2. **Greek stop (early warning)**: reduce position if delta exceeds 0.15× notional.
3. **Time stop (backstop)**: close all short premium positions at 21 DTE.

### Capital Sizing

- Total SPAN margin ≤ 50% of capital (reserves buffer for SPAN spikes in high-VIX regimes).
- Per-strategy SPAN ≤ 8–10% of capital (caps at 5–6 concurrent strategies).
- Peak margin reporting (SEBI 2021) means all legs must be margined simultaneously at entry.

### Monthly Stress Test

Run before each month's position entry:
1. IV +50% → vega P&L = Net Vega × 8 vol points
2. Underlying ±5% → delta + gamma P&L
3. Bid-ask widen 3× → liquidity haircut on forced exits

Portfolio survives if tail loss ≤ 15% of NAV.

---

## Current Codebase State

### What Exists

| Asset | Location | Notes |
|-------|----------|-------|
| 6-regime Markov classifier | `marketdna-backend/app/services/markov_options_service.py` | Regime IDs, transition matrix, per-stock forecast |
| Regime Score (0–100) | `marketdna-backend/app/services/regime_service.py` | Price position + SMA alignment + SMA slope |
| Breadth Score | same file | Market participation across NIFTY 50 |
| HV20 | computed in markov_options_service | 20-day annualized realized vol |
| Strategy maps (hardcoded) | markov_options_service + quant_strategies_service | Regime → strategy heuristic, not P&L-optimized |
| Quant strategy engine | `app/services/quant_strategies_service.py` | 4 signals mapped to option strategy names |

### Critical Gaps

| Gap | Impact |
|-----|--------|
| No implied volatility data | Cannot compute IV rank/IVR — core allocation signal |
| No options chain ingestion | No bid/ask, OI, volume by strike/expiry |
| No Black-Scholes / Greeks | Cannot compute delta/gamma/vega/theta per leg |
| No portfolio constructor | No ERC sizing, no aggregate Greek calculation |
| No strategy optimizer | Recommendations are heuristic, not expected-value ranked |
| No regime persistence model | Cannot size expiry intelligently per regime duration |

---

## Product Backlog — Prioritized Build Tasks

### PHASE A — Foundation (Weeks 1–6)
> Prerequisite layer. Nothing above this works without it.

**A1. Options Chain Data Ingestion**
- Ingest Nifty/BankNifty options chain from Kite Connect (strike, expiry, bid, ask, OI, volume, IV quote if available)
- Schema: `data_lake/raw/options/symbol=NIFTY/expiry=YYYY-MM-DD/data.parquet`
- Register DuckDB view: `options_chain`
- Validation: reject records with bid > ask, zero OI on ATM strikes, missing greeks

**A2. Implied Volatility Computation**
- Compute mid-market IV per strike using Black-Scholes inversion (Newton-Raphson)
- Build IV surface: term structure × strike-skew grid per expiry
- IV rank (IVR): percentile of current IV vs rolling 252-day IV history
- Feature store write: `data_lake/features/iv_surface/`
- Service: `app/services/iv_surface_service.py`

**A3. Black-Scholes Greeks Engine**
- Compute delta, gamma, vega, theta, rho per option leg
- Inputs: spot, strike, expiry, IV, risk-free rate (91-day T-bill proxy)
- Service: `app/services/options_greeks_service.py`
- Unit tests: verify against known BS values, validate put-call parity

---

### PHASE B — Portfolio Engine (Weeks 7–10)
> Core of the new product. Depends on Phase A.

**B1. Strategy Portfolio Constructor**
- Input: current India VIX, current Markov regime state, available capital
- Output: list of strategies with lot sizes, entry parameters, margin estimates
- Sizing method: Equal Risk Contribution (ERC) using regime-conditional correlation matrix
- Allocate using the Regime → Allocation Table above
- Service: `app/services/options_portfolio_service.py`
- Pydantic model: `app/models/options_portfolio.py`

**B2. Aggregate Greek Aggregator**
- Input: list of active strategy positions (legs with quantities)
- Output: portfolio-level net delta, vega, gamma, theta
- Apply correlation adjustment for cross-underlying vega:
  `Portfolio Vega = sqrt(V^T · Ρ · V)` where Ρ = IV correlation matrix
- Include Greek limit checker (flag breaches before entry)
- Service: extend `options_portfolio_service.py`

**B3. Risk Limit Enforcer**
- Pre-entry check: verify all Greek limits pass
- P&L stop monitor: flag when strategy loss ≥ 2× premium collected
- 21 DTE alert: surface positions approaching close threshold
- SPAN utilization tracker: flag if total margin > 50% capital
- Service: `app/services/options_risk_service.py`

---

### PHASE C — Intelligence Layer (Weeks 11–13)
> Upgrades heuristic recommendations to evidence-based.

**C1. Regime-to-Allocation Engine**
- Replace hardcoded strategy maps in markov_options_service with regime-conditional weight table
- Accept VIX level + Markov regime as inputs; output strategy weights + entry parameters
- Integrate VIX term structure slope and PCR as soft signals (override logic)
- MCP tool: `calculate_strategy_portfolio(regime, vix_level, capital)` → portfolio spec

**C2. Walk-Forward Strategy Portfolio Backtester**
- Backtest the full 5-strategy basket over 3+ years of Nifty weekly data
- Walk-forward windows: 252-day train, 63-day test
- Output per window: Sharpe, Sortino, max DD, win rate, avg theta harvested
- Store in: `data_lake/derived/options_portfolio_backtest/`
- Validation gate: portfolio Sharpe > 1.0 OOS before production deployment

**C3. Monthly Stress Test Runner**
- Automate the 3-scenario stress test: IV +50%, gap ±5%, spread widening
- Input: current portfolio positions + Greeks
- Output: tail loss estimate vs NAV; pass/fail vs 15% NAV limit
- Report written to: `data_lake/derived/stress_tests/`

---

### PHASE D — Frontend (Weeks 14–16)
> Options Portfolio Dashboard — new route `/options-portfolio`

**D1. Page Spec**

```
Route:     /options-portfolio
File:      marketdna-web/src/pages/OptionsPortfolioPage.tsx
Accent:    #7C3AED  (violet — distinct from markov-options cyan)

Layout: two-column (L=5fr / R=7fr)
  Left:  Regime + VIX status card → Allocation weight table → Risk gauge
  Right: Active strategy cards (S1–S5) → Aggregate Greeks bar → Weekly P&L
```

**D2. Components to Build**

| Component | Props | Purpose |
|-----------|-------|---------|
| `RegimeAllocationCard` | regime, vix, weights | Shows current VIX regime + S1–S5 allocation % |
| `StrategyCard` | strategy, legs, status, pnl | Collapsible card per active strategy |
| `GreekAggregator` | delta, vega, gamma, theta | Progress bars vs limit thresholds |
| `StressTestWidget` | scenario results | Monthly stress test pass/fail |
| `MarginUtilization` | used, total | Donut: SPAN used vs 50% cap |

**D3. API Endpoints Needed**

- `GET /api/options-portfolio/recommendation` → strategy basket for current regime
- `GET /api/options-portfolio/greeks` → aggregate portfolio Greeks
- `GET /api/options-portfolio/risk-check` → pre-entry limit check
- `GET /api/options-portfolio/stress-test` → latest stress test results

---

## What NOT to Build (This Phase)

- Stock option multi-leg strategies (iron condors on individual stocks) — liquidity impaired
- Kelly sizing — requires 3+ years OOS Sharpe estimates; defer to Phase 2
- Real-time P&L tracking via Kite Connect positions API — order management is out of scope
- Options strategy on midcap names — OI too thin
- Automated trade execution — MarketDNA is a research platform, not a trading bot

---

## Build Sequence Dependencies

```
A1 (options chain data)
  └── A2 (IV surface + IVR)
       └── A3 (Greeks engine)
            ├── B1 (portfolio constructor)
            │    └── B2 (Greek aggregator)
            │         └── B3 (risk enforcer)
            │              ├── C1 (allocation engine)
            │              ├── C2 (backtester)
            │              └── C3 (stress tester)
            │                   └── D1–D3 (frontend)
            └── [also feeds existing markov_options_service for IV inputs]
```

---

## MCP Tools to Add

```python
calculate_strategy_portfolio(regime: str, vix_level: float, capital: float) -> PortfolioSpec
calculate_portfolio_greeks(positions: list[Position]) -> GreekSummary
check_risk_limits(portfolio_spec: PortfolioSpec) -> RiskCheckResult
run_stress_test(positions: list[Position]) -> StressTestReport
get_iv_rank(symbol: str, expiry: str) -> IVRankResult
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Portfolio Sharpe (OOS walk-forward) | > 1.0 |
| Portfolio Sortino | > 1.5 |
| Max drawdown | < 20% NAV |
| Monthly theta harvested vs NAV | 0.05–0.10%/day average |
| Stress test tail loss | ≤ 15% NAV |
| SPAN utilization | ≤ 50% capital |

---

## Research Sources

5 parallel research agents (2026-06-13):
1. Options portfolio construction theory (ERC, Kelly, regime-conditional correlation)
2. Indian market constraints (NSE liquidity tiers, SPAN/SEBI margin, physical delivery)
3. Regime × strategy sensitivity matrix (India VIX allocation table, historical examples)
4. MarketDNA codebase audit (existing assets vs gaps)
5. Portfolio risk management (Greek aggregation, stop-loss rules, stress testing)
