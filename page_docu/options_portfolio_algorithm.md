# Options Strategy Portfolio — Complete Algorithm Specification

> Generated 2026-06-13 via 10 parallel algorithm-design agents.
> Companion to: `page_docu/options_strategy_portfolio_backlog.md`

---

## Module 1 — Regime Classification Engine

### 1.1 VIX Bucket with Hysteresis

Prevents flip-flopping at threshold boundaries. Transition requires 2 consecutive closes
beyond a ±0.5 hysteresis band.

```python
THRESHOLDS = {low_mid: 15.0, mid_high: 22.0}
BAND = 0.5

def classify_vix_bucket(vix_series, current_bucket):
    v0, v1 = vix_series[-2], vix_series[-1]

    if current_bucket == "LOW":
        if v0 > 15.5 and v1 > 15.5: return "MID"
    if current_bucket == "MID":
        if v0 > 22.5 and v1 > 22.5: return "HIGH"
        if v0 < 14.5 and v1 < 14.5: return "LOW"
    if current_bucket == "HIGH":
        if v0 < 21.5 and v1 < 21.5: return "MID"

    return current_bucket  # hold — no confirmed transition
```

Edge case: VIX oscillating 14.9 / 15.1 → never crosses 15.5 → bucket stays LOW.

### 1.2 Composite Regime (Markov × VIX → 5 States)

| Markov State     | VIX LOW    | VIX MID      | VIX HIGH |
|-----------------|------------|--------------|----------|
| Strong Uptrend  | CALM_BULL  | BULL_STRESS  | RISK_OFF |
| Volatile Bull   | BULL_STRESS| BULL_STRESS  | RISK_OFF |
| Sideways Quiet  | NEUTRAL    | NEUTRAL      | RISK_OFF |
| Sideways Volatile| NEUTRAL   | STRESS       | RISK_OFF |
| Steady Bear     | STRESS     | STRESS       | RISK_OFF |
| Volatile Bear   | RISK_OFF   | RISK_OFF     | RISK_OFF |

```python
composite = LOOKUP_TABLE[markov_state][vix_bucket]
```

### 1.3 Soft-Signal Override (demotion only — never promotion)

```python
def apply_overrides(composite, signals):
    demotion_count = 0
    if signals.vix_front_back_ratio > 1.05:    demotion_count += 1  # backwardation
    if signals.pcr > 1.3:                      demotion_count += 1  # put demand surge
    if signals.breadth_score < 40:             demotion_count += 1  # narrow leadership
    if signals.rv5 / signals.rv20 > 1.4:       demotion_count += 1  # RV acceleration

    ORDER = ["CALM_BULL","BULL_STRESS","NEUTRAL","STRESS","RISK_OFF"]
    if demotion_count >= 2:
        idx = min(ORDER.index(composite) + 1, 4)
        return ORDER[idx]
    return composite
```

### 1.4 Regime Output Schema

```python
class RegimeOutput(BaseModel):
    date: date
    vix_raw: float
    vix_bucket: Literal["LOW", "MID", "HIGH"]
    vix_bucket_confirmed: bool        # False = in hysteresis band
    markov_state: str                 # 6 states from existing classifier
    markov_confidence: float          # posterior probability [0,1]
    composite_regime: Literal["CALM_BULL","BULL_STRESS","NEUTRAL","STRESS","RISK_OFF"]
    override_triggered: bool
    override_signal_count: int
    strategy_weights: dict[str, float]  # sum = 1.0
    regime_age_days: int
    transition_pending: bool           # True if 1-of-2 confirms seen
```

Fallback: if VIX data missing → hold last bucket; if Markov confidence < 0.5 → hold
prior state; if both stale > 2 days → force RISK_OFF.

---

## Module 2 — Strategy Activation

### 2.1 Regime → Target Weights

| Composite Regime | S1 IC | S2 SS | S3 Cal | S4 LV | S5 CC |
|-----------------|-------|-------|--------|-------|-------|
| CALM_BULL       | 40%   | 30%   | 20%    | 0%    | 10%   |
| BULL_STRESS     | 30%   | 15%   | 15%    | 25%   | 15%   |
| NEUTRAL         | 25%   | 10%   | 15%    | 30%   | 20%   |
| STRESS          | 15%   | 0%    | 0%     | 50%   | 35%   |
| RISK_OFF        | 10%   | 0%    | 0%     | 65%   | 25%   |

### 2.2 Activation Gate

```python
MIN_WEIGHT_THRESHOLD = 0.08  # strategies below 8% stay dormant

def resolve_active_strategies(target_weights):
    active = {s: w for s, w in target_weights.items() if w >= MIN_WEIGHT_THRESHOLD}
    total = sum(active.values())
    return {s: w / total for s, w in active.items()}  # renormalize to 100%
```

### 2.3 Regime Transition Handling

```python
REGIME_CONFIRM_BARS = 3       # VIX must hold for 3 consecutive days
MID_WEEK_CUTOFF = "Wednesday 12:00 IST"

def schedule_transition(regime_change, current_datetime):
    vix_confirmed = all(same_regime for last 3 days)
    if not vix_confirmed:
        return HOLD

    if day_of_week <= TUESDAY or time < 12:00:
        return EXECUTE_NOW  # 2-day staged exit
    else:
        return DEFER_TO_MONDAY  # exception: VIX > 28 overrides deferral

# Staged exit:
# Day 0: flag strategies for exit, freeze new entries
# Day 1: close shortest-DTE legs first
# Day 2: close remaining, open new regime positions
```

### 2.4 S1 / S4 Conflict Resolution (Iron Condor + Long Strangle same underlying)

```python
def check_conflict(active_strategies):
    if S1 in active and S4 in active:
        net_vega = S1.vega + S4.vega
        if abs(net_vega) < 0.15 * portfolio_vega_limit:
            # positions nearly cancel — drop lower-weight one
            drop = min(active, key=lambda s: target_weights[s])
            active.remove(drop)
        elif abs(S1.delta + S4.delta) > 0.10:
            # widen S1 wings 50 points beyond S4 strikes
            S1.adjust_wings(direction=WIDEN, offset=50)
```

### 2.5 Entry Gate Checklist

```python
def entry_gate(strategy, symbol, expiry):
    iv_rank = compute_iv_rank(symbol, lookback=252)
    dte     = (expiry - today).days

    gates = {
        "S1": iv_rank >= 40 and 5 <= dte <= 12,
        "S2": iv_rank >= 35 and dte >= 2,
        "S3": 30 <= iv_rank <= 60 and 3 <= near_dte <= 7,
        "S4": iv_rank <= 35 and 7 <= dte <= 14,
        "S5": iv_rank >= 25 and 20 <= dte <= 35,
    }
    regime_stable = regime_age_days >= 3  # 5 for S3, S5
    greek_headroom = check_greek_limits_with_new_position()

    return gates[strategy] and regime_stable and greek_headroom
```

---

## Module 3 — Position Sizing

### 3.1 ERC Formula

```python
# Inputs: per-strategy P&L vol (20-day rolling), correlation matrix Ρ
# Covariance: Σ = diag(σ) · Ρ · diag(σ)

# Solve numerically (SciPy minimize):
# minimize Σᵢ Σⱼ (wᵢ·(Σw)ᵢ − wⱼ·(Σw)ⱼ)²
# s.t. Σwᵢ = 1, wᵢ ≥ 0

# Blend ERC with regime weights:
w_final = 0.5 * w_ERC + 0.5 * w_regime
```

### 3.2 Lot Sizing Pipeline

```
deployed_capital = 0.50 × total_capital      # hard cap
reserve          = 0.50 × total_capital      # never touch

for each active strategy i:
    capital_i     = w_final_i × deployed_capital
    SPAN_per_lot  = estimate_SPAN(strategy, IV, spot)  # see 3.3
    raw_lots      = capital_i / SPAN_per_lot
    lots_i        = floor(raw_lots)           # always round down

# Budget enforcement:
total_SPAN = Σ(lots_i × SPAN_per_lot_i)
if total_SPAN > deployed_capital:
    reduce lots for highest-SPAN/capital strategy, repeat

# Per-strategy cap:
if lots_i × SPAN_per_lot_i > 0.08 × total_capital:
    lots_i = floor(0.08 × total_capital / SPAN_per_lot_i)
```

### 3.3 SPAN Margin Estimation (Pre-Broker)

```python
# Iron Condor (Nifty):
SPAN_IC = 0.10 × Spot × LotSize × (IV/100) × sqrt(T/365) × 1.5 × 1.25

# Short Strangle (BankNifty):
SPAN_SS = 0.12 × Spot × LotSize × (IV/100) × sqrt(T/365) × 2.0 × 1.25

# 1.25 = safety buffer for intraday SPAN recomputation
```

### 3.4 Dynamic Reserve Check

```python
# Runs at 09:20 AM and 12:00 PM daily
if live_SPAN > 0.55 × total_capital:  # 5% breach buffer
    scale_factor = 0.50 × total_capital / live_SPAN
    for each strategy:
        lots_i = floor(lots_i × scale_factor)
```

### 3.5 Worked Example (Capital = ₹25,00,000)

| Step | Calculation | Result |
|------|-------------|--------|
| Deployed capital | 0.50 × 25L | ₹12,50,000 |
| S1 weight | 28% (post ERC-regime blend) | ₹3,50,000 |
| SPAN per lot (Nifty IC) | 0.10×24000×25×0.14×√(7/365)×1.5×1.25 | ₹39,375 |
| Raw lots | 3,50,000 / 39,375 | 8.88 → 8 lots |
| 8% cap check | 8% × 25L = ₹2,00,000; 8 lots = ₹3,15,000 → exceeds | Reduce to 5 lots |
| Final S1 SPAN | 5 × 39,375 | ₹1,96,875 ✓ |

---

## Module 4 — Entry Timing Protocol

### 4.1 Entry Day and Time

| Strategy | Underlying | Expiry | Enter | Window |
|----------|-----------|--------|-------|--------|
| S1 Iron Condor | Nifty | Thursday | Monday | 10:30–11:30 IST |
| S2 Short Strangle | BankNifty | Wednesday | Monday | 11:00–12:00 IST |
| S3 Calendar | Nifty | Near/Far monthly | 2nd Tuesday of month | 14:00–15:00 IST |
| S4 Long Strangle | Nifty | Thursday | 2 sessions before event | 10:30–11:30 IST |
| S5 Covered Call | Large-cap stock | Monthly | Last Thursday of prior month | 13:00–14:00 IST |

S4 skip condition: if no scheduled event in next 10 days, skip the week.

### 4.2 Strike Selection

| Strategy | Short/Long Delta | Wing/Spread Width | IVR Adjustment |
|----------|-----------------|-------------------|----------------|
| S1 Nifty IC | ±0.15–0.18 | 200 pts | IVR>70: widen to 250-300; IVR<30: narrow to 150 + cut size 50% |
| S2 BNF Strangle | ±0.12–0.15 | 400 pts | IVR<30: skip — credit insufficient after wings |
| S3 Calendar | ATM (Δ≈0.50 buy leg) | Near weekly/Far monthly | Put calendar default (NSE put skew structurally higher) |
| S4 Strangle | ±0.25–0.30 | — | IVR<25: use strangle; IVR 25-45: use ATM debit spread |
| S5 CC | 0.15–0.30 OTM | — | IVR>50: Δ0.25-0.30; IVR<30: Δ0.15 or skip |

### 4.3 Checklist Failure Protocol

- IVR fails → skip the week, do not adjust threshold
- OI fails → wait 1 session; skip after 2 sessions
- Regime unstable → wait up to 2 sessions; skip if still unstable
- Greek headroom fails → trim existing position first, do not breach limits

---

## Module 5 — Exit Algorithm

### 5.1 Exit Priority Order

```
GREEK stop  → priority 1 (IMMEDIATE)
P&L stop    → priority 2 (INTRADAY_NEXT_BAR)
TIME stop   → priority 3 (EOD)
```

### 5.2 T-1 Close Times

| Underlying | Expiry | Hard Close Time |
|-----------|--------|-----------------|
| Nifty | Thursday | Wednesday 15:20 IST |
| BankNifty | Wednesday | Tuesday 15:20 IST |
| Stock options | Monthly Thursday | T-2, 15:20 IST |

If 15:20 fill fails → retry at closing auction (15:30); if still unfilled on T-1 TIME signal → market order (accept slippage).

### 5.3 Exit Decision Tree

```python
# Runs every 5-minute bar
def check_exits(position, portfolio_greeks, NAV):
    signals = []
    dte = (position.expiry - today).days

    # TIME stop
    if is_T1_close_time():
        signals.append(ExitSignal(trigger="TIME", priority=3,
                                   action="CLOSE_STRATEGY", urgency="EOD"))

    # P&L stop — reference: premium collected AT ENTRY (fixed)
    loss = -1 * position.mtm_pnl
    if loss >= 2.0 * position.total_premium_collected:
        signals.append(ExitSignal(trigger="PNL", priority=2,
                                   action="CLOSE_STRATEGY", urgency="INTRADAY_NEXT_BAR"))

    # GREEK stop
    if abs(position.net_delta) > 0.30:
        signals.append(ExitSignal(trigger="GREEK", priority=1,
                                   action="CLOSE_STRATEGY", urgency="IMMEDIATE"))

    if signals:
        return min(signals, key=lambda s: s.priority)
    return None
```

### 5.4 Partial Close Rule

**Never close one side of a defined-risk structure in isolation.**

If put spread of iron condor breaches delta threshold but call spread is fine →
close the FULL condor. Keeping the naked call spread concentrates tail risk.

### 5.5 Failed Exit Escalation

```python
def execute_exit(signal, position):
    order = place_limit_order(mid_price, timeout=60s)
    if not filled:
        order = place_limit_order(bid - 0.5*spread, timeout=60s)
    if not filled:
        if signal.trigger == "TIME":    # must exit
            place_market_order()
        else:                           # Greek/PnL
            hedge_delta_with_futures()  # neutralize, don't abandon
            flag_for_manual_review()
            alert("FAILED EXIT — delta hedged, manual close required")
```

---

## Module 6 — Greek Aggregation

### 6.1 Common Currency Normalization (INR P&L)

```python
# Delta — express as % of NAV
delta_INR_i  = delta_contract_i × LotSize_i × Spot_i
delta_port   = sum(delta_INR_i)
delta_pct    = delta_port / NAV          # limit: |delta_pct| <= 0.005

# Vega — INR per 1-vol-point move
vega_INR_i   = vega_contract_i × LotSize_i × Spot_i × 0.01

# Correlation-adjusted portfolio vega
# ρ = 60-day rolling Pearson of daily ATM IV log-returns (NF vs BNF)
V_vec        = [sum(vega_INR NF legs), sum(vega_INR BNF legs)]
V_portfolio  = sqrt(V_vec.T @ rho @ V_vec)
vega_pct     = V_portfolio / NAV         # limit: <= 0.02

# Gamma — gap-loss equivalent
gamma_INR_i  = 0.5 × gamma_i × LotSize_i × (Spot_i × 0.02)²
gap_loss     = sum(gamma_INR_i)
gap_loss_pct = gap_loss / NAV            # limit: <= 0.01

# Theta
theta_INR_i  = theta_contract_i × LotSize_i
theta_port   = sum(theta_INR_i)
theta_pct    = theta_port / NAV          # target: 0.0005–0.0010
```

### 6.2 Monitoring Frequency

| Metric | Frequency |
|--------|-----------|
| Delta | Per tick (continuous) |
| Vega, Gamma | Every 15 min (IV surface refresh) |
| ρ matrix | Daily at 09:20 |
| Greek limit check | Every 15 min |

### 6.3 Limit Breach Actions

```python
def monitor_greeks(greeks, NAV, rho):
    V_port = sqrt(greeks.V_vec @ rho @ greeks.V_vec)
    breaches = {}

    if abs(greeks.delta_pct) > 0.004:        breaches["DELTA"] = "ALERT"
    if abs(greeks.delta_pct) > 0.005:        breaches["DELTA"] = "AUTO_HEDGE"    # futures
    if V_port / NAV > 0.018:                 breaches["VEGA"]  = "ALERT"
    if V_port / NAV > 0.020:                 breaches["VEGA"]  = "AUTO_CLOSE"
    if greeks.gap_loss_pct > 0.008:          breaches["GAMMA"] = "ALERT"
    if greeks.gap_loss_pct > 0.010:          breaches["GAMMA"] = "AUTO_CLOSE"
    if greeks.theta_pct < 0.0003:            breaches["THETA"] = "ALERT"
    return breaches
```

AUTO_CLOSE: close smallest strategy first until breach resolved.

### 6.4 Theta Efficiency Tracker (Daily)

```python
def theta_efficiency(date):
    expected_theta  = portfolio_theta_at_SOD(date)
    realized_pnl    = mtm_EOD - mtm_SOD
    delta_pnl       = avg_delta × spot_move
    gamma_pnl       = 0.5 × avg_gamma × spot_move²
    vega_pnl        = avg_vega × iv_change
    theta_realized  = realized_pnl - delta_pnl - gamma_pnl - vega_pnl
    efficiency      = theta_realized / expected_theta
    # < 0.7 → IV expansion eroding; > 1.3 → favorable IV crush
    # Persistent deviation outside [0.7, 1.3] → strategy review
```

---

## Module 7 — Weekly State Machine

```
States: IDLE → REGIME_CHECK → PRE_ENTRY → ACTIVE_MONITORING
         → BANKNIFTY_CLOSE → POST_EXPIRY_REEVAL → NIFTY_CLOSE
         → EXPIRY_MGMT → RESET → IDLE
```

| State | Trigger | Key Actions | Next State |
|-------|---------|-------------|------------|
| IDLE | Monday 09:00 | Emit WEEK_START | REGIME_CHECK |
| REGIME_CHECK | WEEK_START | MarketDNA, Breadth, IV surface, VIX bucket | PRE_ENTRY if pass; IDLE if fail |
| PRE_ENTRY | Regime pass | Liquidity, IVR, DTE, event-risk, Greek headroom | ACTIVE_MON if all pass; IDLE if fail |
| ACTIVE_MONITORING | Every 30 min Mon–Tue | Greeks, stop-losses | BANKNIFTY_CLOSE at Tue 15:20 |
| BANKNIFTY_CLOSE | Tue 15:20 | Close all S2 legs; log P&L | POST_EXPIRY_REEVAL at Wed 09:15 |
| POST_EXPIRY_REEVAL | Wed 09:15 | Re-run regime; check S1 wing breach; S3 roll? | NIFTY_CLOSE at Wed 15:20 |
| NIFTY_CLOSE | Wed 15:20 | Close S1 short legs, S4 short legs; retain longs | EXPIRY_MGMT at Thu 09:15 |
| EXPIRY_MGMT | Thu 09:15 | Manage S3/S4 long residuals; force-close all by 15:00 | RESET at Thu 15:30 |
| RESET | Thu 15:30 | P&L reconciliation; feature store write; metrics update | IDLE |

Special rule in ACTIVE_MONITORING: stop-loss breach → exit that strategy only → remain in ACTIVE_MONITORING for remaining strategies.

Special rule in POST_EXPIRY_REEVAL: if S1 short strike within 0.5% of spot → roll untested side OR close full condor (not just breached side).

---

## Module 8 — Walk-Forward Backtester

### 8.1 Minimum Dataset Schema

```
spot_close, spot_open, spot_high, spot_low
strike, expiry_date, option_type (CE/PE)
bid, ask, iv_mid, delta, gamma, theta, vega
open_interest, volume, days_to_expiry
```

Derived at load time: `mid = (bid+ask)/2`, `spread_pct = (ask-bid)/mid`, `atm_iv`.

### 8.2 Slippage Model

| Instrument | Slippage |
|-----------|----------|
| Nifty liquid strikes (OI > 500, DTE > 2) | 0.3% of mid |
| BankNifty | 0.5% of mid |
| Illiquid (OI < 500 or volume < 50) | 1.5% or REJECT |
| Far expiry (DTE > 30) | +0.2% additional |

Reject any leg where spread_pct > 5% or volume == 0.

### 8.3 SPAN Proxy

```python
scan_range = 0.035 × spot  # Nifty; 0.045 for BankNifty
margin = max(
    abs(net_delta_exposure) × scan_range,
    net_vega_exposure × 0.20 × atm_iv × spot
) × 1.15  # conservative buffer
```

### 8.4 Walk-Forward Loop

```python
TRAIN_WINDOW = 252   # trading days
TEST_WINDOW  = 63
STEP         = 21
MAX_PARAMS   = 6     # 5 weights + 1 target vol

for each rolling window:
    # TRAIN: fit min-CVaR weights on train data
    weights = fit_min_cvar(
        train_pnl,
        target_vol   = 0.12,
        constraints  = [w >= 0.05, w <= 0.60, sum(w) == 1.0],
        n_params     = MAX_PARAMS
    )

    # TEST: OOS simulation with fitted weights
    oos_pnl    = simulate_portfolio(weights, test_dates)
    oos_sharpe = annualized_sharpe(oos_pnl)

# VERDICT:
if median_oos_sharpe >= 1.0 and pct_windows_above_1.0 >= 65%:
    verdict = "PASS"
else:
    verdict = "FAIL"
```

### 8.5 Failure Triage

| Condition | Action |
|-----------|--------|
| Single window Sharpe 0.7–1.0 | Flag "weak window", log regime context |
| 3+ consecutive windows < 0.7 | Suspend lowest-weight strategy in that regime |
| Median OOS Sharpe < 1.0 | Hard fail — do not deploy |

**Rule:** never reduce position size to rescue Sharpe. A broken edge requires a regime filter or strategy removal, not shrinkage.

### 8.6 Overfitting Guard

- Max free parameters = N_windows / 10 (≈6 for 3-year history)
- No delta-target optimization inside train window (fixed: 0.15Δ for strangles, 0.25Δ for long vol)
- Ledoit-Wolf shrinkage on correlation matrix
- Deflated Sharpe Test (Bailey & Lopez de Prado): reject if observed Sharpe doesn't exceed
  the expected max Sharpe under null at 95% confidence

---

## Module 9 — Monthly Stress Test

### 9.1 IV Shock (+50% multiplicative)

```python
for each leg i:
    sigma_shocked = sigma_i * 1.50
    price_shocked = black_scholes(S, K, T, r, sigma_shocked)
    pnl_iv_i      = (price_shocked - price_market_i) * position_size_i * lot_size_i

total_pnl_iv = sum(pnl_iv_i)  # negative for short vega books
```

### 9.2 Spot Shock (±5%, Taylor expansion)

```python
for ΔS in [S * 0.05, S * -0.05]:
    for each leg i:
        pnl_i = (delta_i * ΔS) + (0.5 * gamma_i * ΔS²)
    total_pnl_spot[direction] = sum(pnl_i)

worst_spot_loss = min(total_pnl_spot["+5%"], total_pnl_spot["-5%"])
```

### 9.3 Liquidity Shock (3× spread)

```python
extra_cost = sum(spread_i * position_size_i * lot_size_i for each leg)
# (already accounts for 2× extra cost vs normal exit)
```

### 9.4 Correlation Stress

Under IV spike → force ρ_NF_BNF = 1.0:
```python
V_portfolio_stressed = V_nifty_net + V_bnf_net  # simple sum, no diversification
pnl_vega_stressed    = V_portfolio_stressed × delta_iv
```

### 9.5 Combined Weighted Scenario

```python
pnl_combined = pnl_iv + worst_spot_loss + extra_liquidity_cost

# Weighted blend (avoids over-conservatism of pure simultaneous):
stress_loss = (0.60 * pnl_combined
             + 0.25 * max(abs(pnl_iv), abs(worst_spot_loss))
             + 0.15 * extra_liquidity_cost)
```

### 9.6 Historical Overlays

```python
SCENARIOS = {
    "covid_crash": {"iv_mult": 6.0, "spot_move": -0.38, "spread_mult": 8.0},
    "bear_2022":   {"iv_mult": 1.8, "spot_move": -0.17, "spread_mult": 2.5},
}
# Advisory only — do not gate on historical; gate on weighted combined.
```

### 9.7 Gate Logic

```python
tail_loss_pct = abs(stress_loss) / NAV

if tail_loss_pct > 0.15:
    block_new_positions()
    alert("Stress test FAILED — reduce gross exposure before next cycle")
else:
    allow_new_cycle()
```

---

## Integration: Module Execution Order

```
[WEEKLY CYCLE]
Monday 09:00 ─► Module 7: REGIME_CHECK
                  └─► Module 1: classify_vix + composite_regime + overrides
Monday 09:30 ─► Module 7: PRE_ENTRY
                  ├─► Module 2: resolve_active_strategies + entry_gate
                  └─► Module 3: compute lots + SPAN check
Monday 10:30 ─► Module 7: ACTIVE_MONITORING
                  ├─► Module 4: enter positions at strike selection targets
                  ├─► Module 6: aggregate Greeks + limit check (every 15 min)
                  └─► Module 5: exit signals (every 5 min bar)
Tuesday 15:20 ─► Module 7: BANKNIFTY_CLOSE (S2)
Wednesday 09:15 ─► Module 7: POST_EXPIRY_REEVAL
Wednesday 15:20 ─► Module 7: NIFTY_CLOSE (S1 short legs)
Thursday 09:15 ─► Module 7: EXPIRY_MGMT (residual longs)
Thursday 15:30 ─► Module 7: RESET + feature store write

[MONTHLY]
1st Monday ─► Module 9: stress test → gate decision before new cycle
```

---

## Algorithm Parameter Summary

| Parameter | Value | Module |
|-----------|-------|--------|
| VIX hysteresis band | ±0.5 | M1 |
| VIX transition confirms | 2 consecutive closes | M1 |
| Override demotion threshold | ≥2 soft signals | M1 |
| Min strategy weight | 8% | M2 |
| Regime confirm bars | 3 | M2 |
| Mid-week cutoff | Wednesday 12:00 | M2 |
| ERC-regime blend | 50/50 | M3 |
| SPAN deployment cap | 50% of capital | M3 |
| Per-strategy SPAN cap | 8% of capital | M3 |
| SPAN safety buffer | 1.25× | M3 |
| S1 short delta target | ±0.15–0.18 | M4 |
| S2 short delta target | ±0.12–0.15 | M4 |
| S4 long delta target | ±0.25–0.30 | M4 |
| P&L stop | 2× premium at entry | M5 |
| T-1 close (Nifty) | Wednesday 15:20 | M5 |
| T-1 close (BankNifty) | Tuesday 15:20 | M5 |
| Delta limit | ±0.5% NAV | M6 |
| Vega limit | 2% NAV per vol-pt | M6 |
| Gamma limit | 1% NAV per 2% gap | M6 |
| Greek recompute | 15 min | M6 |
| Train window | 252 days | M8 |
| Test window | 63 days | M8 |
| Step | 21 days | M8 |
| Min OOS Sharpe | 1.0 | M8 |
| Max free params | 6 | M8 |
| Tail loss gate | 15% NAV | M9 |
| Combined scenario weight | 60/25/15 | M9 |
