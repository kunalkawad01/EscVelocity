# Classic Strategies — MarketDNA

Five rule-based strategies, each built on a **different validated edge**, written in plain
English with exact rule-DSL translations for the custom portfolio builder
(`/portfolios/new`). Together they form a deliberately diversified stable: no market
regime favors all five, and none kills all five.

**How to use:** copy the DSL rows of any strategy into the Portfolio Builder (or paste the
plain-English description into the "Describe in plain English" box once `ANTHROPIC_API_KEY`
is set). Creating a portfolio starts its forward ₹100 track record — the only performance
evidence that counts.

> **Status: all five are LIVE** as custom portfolios (keys: `ride_the_leaders`,
> `buy_the_dip`, `sleep_well`, `fresh_highs`, `the_comeback`) since **2026-07-13**, on
> Nifty 500. Their forward ₹100 curves are recording daily via the post-market snapshot.
> Empty screens (dip/breakout on quiet days) constitute automatically the first day their
> rules fire.

| # | Strategy | Edge | Rebalance | Personality |
|---|----------|------|-----------|-------------|
| 1 | Ride the Leaders | Momentum / trend | Monthly | The engine |
| 2 | Buy the Dip, Not the Falling Knife | Mean reversion in uptrends | Weekly | The scalper |
| 3 | The Sleep-Well Portfolio | Low-volatility anomaly | Quarterly | The ballast |
| 4 | Fresh Highs | Breakout + volume | Monthly | The lottery with a seatbelt |
| 5 | The Comeback | Drawdown recovery | Monthly | The contrarian |

---

## 1. Ride the Leaders — trend-following momentum

### The idea in one sentence
Own the strongest stocks in confirmed uptrends, hold them while they lead, and exit
without debate the moment they break — rebalancing monthly.

### What to buy (all must be true)
1. **Real uptrend** — price above the 200-day average, and the 50-day above the 200-day
   (golden cross). *Most of a stock's big gains happen above the 200-day line; below it is
   where disasters live.*
2. **A leader, not a laggard** — 6–12 month return in the top 25% of the universe.
   *Momentum is the most validated edge in market history — winners keep winning for
   months at a time.*
3. **Outperforming the market itself** — relative strength rank above 60. *"Up because
   everything is up" is not leadership.*
4. **Not wildly volatile** — daily swings (ATR) below ~4% of price. *Momentum in
   ultra-volatile names gives its gains back in whipsaws.*

### How many, how weighted
- Top **15** qualifying stocks, ranked by momentum score, **weighted by rank** — best
  ideas get more money, nothing dominates.
- If fewer than 15 qualify (weak market), **hold the rest in cash**. Forcing money into
  mediocre setups is how trend strategies die. Cash is a position.

### When to sell (eviction — checked daily, between rebalances)
- **Stop hits** — down **12% from entry**. Momentum stocks that break usually break hard;
  the first loss is the cheapest.
- **Trend breaks** — closes below the 200-day average. The reason you bought is gone.
- Freed money sits in cash until the next rebalance — don't chase replacements mid-month.

### Rebalancing — monthly
First trading day of each month: re-run entry rules → drop what no longer qualifies →
add new leaders back to 15 → re-weight by momentum rank. *Momentum is measured in
months — weekly churns on noise, quarterly holds broken stocks too long. The ranking
deliberately skips the most recent month's return (it tends to reverse).*

### Honest expectations
- Works best in trending markets (breadth above ~50).
- Suffers in sharp choppy tape — stop-outs and re-entries. The cash rule and 200-day
  filter keep those periods survivable rather than fatal.
- Expect 3–5 significant drawdowns per year of 8–15%. The edge is over years, not weeks.
- Turnover: roughly 3–5 names change per month.

### Rule DSL
| Field | Rule |
|---|---|
| Entry | `above_sma200 and golden_cross and ret_12m_rank <= 25 and rs_rank > 60 and atr_pct < 0.04` |
| Rank by | `mom_score` |
| Max holdings | 15 |
| Weight | By score |
| Eviction | `since_entry_pct < -12 or close < sma200` |
| Eviction weight | Hold as cash |
| Rebalance | Monthly (blank rule — reuses entry) |
| Universe | Nifty 500 |

**Variants:** conservative — stop at −8% and require `adx14 > 20` (stronger trends only).
Aggressive — top-10 names at `ret_12m_rank <= 15`, inverse-volatility weighting.

---

## 2. Buy the Dip, Not the Falling Knife — mean reversion in uptrends

### The idea in one sentence
Buy quality stocks in long-term uptrends when they get briefly oversold — then sell the
bounce.

### What to buy (all must be true)
1. **Long-term uptrend intact** — above the 200-day average. *The dip is only a bargain if
   the trend is alive.*
2. **Genuinely oversold** — RSI below 35 **and** price stretched more than 1.5 standard
   deviations below its 20-day average. *Two independent measures of panic, not one.*
3. **Not a chronic loser** — 12-month return rank in the top half. *Weak stocks that dip
   keep dipping.*

### When to sell (eviction — checked daily)
- **The bounce came** — RSI back above 60. Take it. *Mean reversion pays fast or not at all.*
- **It kept falling** — down 8% from entry. *If the dip becomes a slide, the thesis was wrong.*
- **Nothing happened in 15 trading days** — time stop; money moves on. *Dead capital is a cost.*

### Rebalancing — weekly
*Mean reversion lives on a days-to-weeks clock — monthly is too slow to catch dips.*

### Honest expectations
Many small wins, occasional sharp losses. Works in choppy/sideways markets — exactly when
momentum suffers. Dies in a crash (everything looks "oversold" all the way down — the
200-day filter is the seatbelt).

### Rule DSL
| Field | Rule |
|---|---|
| Entry | `above_sma200 and rsi14 < 35 and z20 < -1.5 and ret_12m_rank <= 50` |
| Rank by | `-z20` (most stretched first) |
| Max holdings | 10 |
| Weight | Equal |
| Eviction | `rsi14 > 60 or since_entry_pct < -8 or days_held > 15` |
| Eviction weight | Hold as cash |
| Rebalance | Weekly |
| Universe | Nifty 500 |

---

## 3. The Sleep-Well Portfolio — low-volatility compounders

### The idea in one sentence
Own the boring stocks that grind up smoothly and fall less than everything else.

### What to buy (all must be true)
1. **Among the calmest** — volatility (ATR%) rank in the bottom 30% of the universe. *The
   low-vol anomaly: calm stocks return more per unit of risk than they "should."*
2. **Actually compounding** — positive 1-year CAGR and a smooth path (efficiency ratio
   above 0.1 — roughly the top quartile on this field's scale — and up-day consistency
   above 50%). *Calm and going nowhere is a savings account.*
3. **Didn't crater recently** — worst drawdown this year better than −25%.

### When to sell (eviction)
Only on real damage — down 15% from entry, or below the 200-day average. *Wide stop by
design; this basket is meant to be left alone.*

### Rebalancing — quarterly
*These names change character slowly; frequent rebalancing just pays costs.* Weight by
**inverse volatility** — the calmest get the most.

### Honest expectations
Will **lag badly** in raging bull markets — that's the price. Earns its keep in flat and
falling tape. This is the ballast of the five, not the engine.

### Rule DSL
| Field | Rule |
|---|---|
| Entry | `atr_pct_rank <= 30 and cagr > 0 and efficiency_ratio > 0.1 and consistency > 50 and max_dd_1y > -0.25` |
| Rank by | `efficiency_ratio` |
| Max holdings | 20 |
| Weight | Inverse volatility |
| Eviction | `since_entry_pct < -15 or close < sma200` |
| Eviction weight | Redistribute to survivors |
| Rebalance | Quarterly |
| Universe | Nifty 500 |

---

## 4. Fresh Highs — breakout with volume proof

### The idea in one sentence
Buy stocks breaking to new 52-week highs on heavy volume — strength that announces itself.

### What to buy (all must be true)
1. **New 52-week high** or clearing its 60-day high. *Nobody who owns it is losing money —
   no overhead sellers waiting to "get back to even."*
2. **Volume at least 1.5× its 20-day average.** *A breakout without volume is a rumor.*
3. **Uptrend + market leadership** — above the 200-day, RS rank above 60.

### When to sell (eviction)
Down 10% from entry, or closes below the 50-day average. *Good breakouts don't come back —
a tight leash is the whole risk model.*

### Rebalancing — monthly
The daily eviction does most of the real work here.

### Honest expectations
The lowest hit rate of the five — maybe 4 winners in 10 — but the winners run 30–50%.
Psychologically the hardest to hold ("it's already up so much!"). Feeds on bull markets;
starve it in bad tape.

### Rule DSL
| Field | Rule |
|---|---|
| Entry | `(new_52w_high or break_60d_high) and vol_surge > 1.5 and above_sma200 and rs_rank > 60` |
| Rank by | `vol_surge` |
| Max holdings | 10 |
| Weight | Equal |
| Eviction | `since_entry_pct < -10 or close < sma50` |
| Eviction weight | Hold as cash |
| Rebalance | Monthly |
| Universe | Nifty 500 |

---

## 5. The Comeback — recovery after deep drawdowns

### The idea in one sentence
Buy beaten-down stocks only after they *prove* the turn has started — never on hope.

### What to buy (all must be true)
1. **Still deeply marked down** — 20%+ below its 52-week high. *That's where the
   mispricing lives.*
2. **Proof of the turn** — making higher lows, back above the 50-day average, relative
   strength line rising. *Three confirmations; the discount alone is not a reason.*
3. **Momentum flipping** — 3-month return positive.

### When to sell (eviction)
Down 10% from entry, or loses the 50-day again (the recovery failed).

### Rebalancing — monthly

### Honest expectations
The contrarian of the stable — buys what the momentum strategies just evicted. Shines in
the first year after corrections; drags in late-stage bull markets when nothing is beaten
down. Most likely to catch the occasional dead company — the confirmation stack and the
stop keep those small.

### Rule DSL
| Field | Rule |
|---|---|
| Entry | `dist_52w_high < -0.20 and higher_lows and above_sma50 and rs_slope_up and ret_3m > 0` |
| Rank by | `ret_3m` |
| Max holdings | 12 |
| Weight | Equal |
| Eviction | `since_entry_pct < -10 or close < sma50` |
| Eviction weight | Hold as cash |
| Rebalance | Monthly |
| Universe | Nifty 500 |

---

## Why these five, together

They are built on **conflicting edges** — momentum buys strength, mean reversion buys
weakness, low-vol buys calm, breakout buys noise, recovery buys wreckage:

- **Trending bull market** → Leaders and Fresh Highs carry; Sleep-Well lags; Comeback drags.
- **Choppy / sideways** → Buy the Dip earns; momentum strategies churn.
- **Bear / falling** → Sleep-Well and cash rules preserve capital; everything else goes
  quiet by design (cash-on-eviction, 200-day filters).
- **First year after a correction** → The Comeback's moment.

**The forward ₹100 track records are the referee.** Create all five, let them run, and in
six months the argument about "which strategy is best" is read off the curves instead of
debated. When the Edge Decay Observatory ships, these five are its first patients — each
strategy's underlying edge gets a live health status (HEALTHY / FADING / DORMANT / DEAD).

## Caveats (read once, believe forever)

- All rules operate on end-of-day data; evictions fire on the daily snapshot, not intraday.
- Ranks (`ret_12m_rank`, `rs_rank`, `atr_pct_rank`) are relative to the chosen universe —
  the same stock can pass in Nifty 500 and fail in Nifty 200.
- No transaction costs or slippage are modeled in the forward tracks' rule logic; small-cap
  names in Nifty 500 can be expensive to trade in size.
- None of this is investment advice — these are research specifications for a validation
  platform whose whole point is to let the evidence decide.
