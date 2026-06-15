# MarketDNA — ML & Statistical Algorithms

Each algorithm below is implemented as a backend endpoint. Raw OHLCV data goes in; structured, explainable intelligence comes out. No black boxes.

---

## 1. K-Nearest Neighbors (KNN)

### What it is

KNN finds the K historical days whose market environment (regime, momentum, drawdown, volatility) was most similar to today's, then predicts the forward return as the average of what actually followed those days.

The "environment" is represented as a feature vector in a normalized multi-dimensional space. Distance is measured using the same weighted Manhattan metric as the Historical Analog Engine.

### Rationale

Markets do not repeat exactly, but they rhyme. KNN makes this intuition operational: instead of looking at raw price levels, it looks at the _structure_ of the current situation — how trending, how stressed, how volatile — and asks "when has the market felt like this before, and what happened next?"

It is non-parametric: no assumptions about the shape of the distribution. Every prediction is directly traceable to real historical dates.

### When it is useful

- Regime transition periods where the past 6–12 months provide poor context but a 5-year database includes similar episodes
- After sharp drawdowns, where the key question is "how fast do stocks in this drawdown depth historically recover?"
- When the Analog Engine picks high-similarity matches — KNN gives a second opinion using a majority vote rather than a single closest match

---

## 2. Dynamic Time Warping (DTW)

### What it is

DTW matches the _shape_ of a recent price pattern against every historical window of the same length. Unlike straight correlation, DTW allows slight time stretching and compression — a pattern that took 21 days in 2019 might take 24 days now and still be the same structural move.

The DTW distance is the minimum-cost alignment between two sequences under the constraint that time can only move forward.

### Rationale

Markets repeat structural moves — panic selloffs, base-building consolidations, breakout accelerations — but not on exact schedules. Correlation-based matching penalizes a pattern that is one day "off." DTW finds genuinely similar shapes regardless of exact timing.

It answers a different question than the Analog Engine: not "when was the environment similar?" but "when did price _behave_ like this?"

### When it is useful

- Identifying technical pattern recurrences (double bottoms, flags, compression periods) without hard-coded rules
- When momentum indicators suggest a pattern is forming but you want historical precedent for how similar shapes resolved
- As a complement to KNN: if both KNN and DTW point to bullish outcomes, the signal has two independent structural supports

---

## 3. K-Means Clustering

### What it is

K-Means partitions every historical day into K clusters based on feature similarity. Each cluster represents a distinct _market regime type_. Once the clusters are fit, today's environment is assigned to the nearest cluster, and the historical forward-return distribution of that cluster is surfaced.

Features used: 1M return, 3M return, drawdown depth, ATR as % of price.

### Rationale

Market behavior is not continuous — it has modes. Bull markets, bear markets, high-volatility corrections, low-volatility melt-ups all have distinct statistical signatures. K-Means discovers these modes empirically from the data, without pre-defining what they are.

The forward-return profile of each cluster provides a data-driven base rate for the current environment.

### When it is useful

- Calibrating position sizing: if today's cluster historically had a 40% chance of a -10% outcome, that changes the risk calculus
- Identifying when a stock has entered a historically unusual cluster (one with few historical members) — a signal that the current situation is genuinely novel
- Cross-stock comparison: if most NIFTY 50 stocks are in "Cluster 3 — Bear" but a specific stock is in "Cluster 1 — Bull," it signals unusual relative strength

---

## 4. Hidden Markov Model (HMM)

### What it is

An HMM assumes the market is always in one of N hidden states (e.g., Bull / Bear / High-Volatility), and that we can only observe noisy signals (daily returns + short-term volatility). The model learns, via the Baum-Welch algorithm, which state configuration best explains the observed sequence of returns.

Once trained, the Viterbi algorithm decodes which state the market was in on each historical day, and posterior probabilities show how confident the model is about the current state.

### Rationale

Unlike K-Means (which classifies each day independently), HMM accounts for _temporal dependencies_. A bull market does not randomly jump to a bear market on a single bad day — there is persistence. HMM captures this with a transition probability matrix: P(Bear → Bull) is low; P(Bull → Bull) is high.

This makes HMM better than K-Means at identifying regime _changes_ (the transition event) rather than just the current state.

### When it is useful

- Detecting regime transitions early: when the posterior probability of the Bull state drops from 90% to 50%, a transition may be underway
- Risk management: if the HMM says you are in the High-Volatility state with 85% confidence, position sizing should reflect that
- Comparing with K-Means: if K-Means says "Bull" but HMM says "Bear," the disagreement is itself a signal worth investigating

---

## 5. Gaussian Mixture Model (GMM)

### What it is

GMM models the historical return distribution as a mixture of K Gaussian distributions. Each Gaussian represents a market regime. GMM is a "soft" version of K-Means: instead of hard-assigning each day to one cluster, it gives the probability of belonging to each component.

GMM also captures the non-Gaussian shape of return distributions — the fact that market returns have fat tails and are bimodal during crisis periods.

### Rationale

Stock returns are not normally distributed. GMM fits multiple Gaussians to the data, allowing it to capture multi-modal behaviour: the "normal times" distribution (small daily moves, positive drift) and the "crisis" distribution (large negative moves, high volatility) can coexist as separate components.

The probability output is more useful than a hard label when the situation is ambiguous — "60% Neutral, 40% Bear" is more honest than a forced "Neutral."

### When it is useful

- When the market is at a regime boundary and a hard classifier would be misleading
- Cross-checking HMM: both models should agree on the dominant state if the signal is clear
- Identifying tail-risk periods: if the high-volatility Gaussian has high probability, it should trigger elevated CVaR monitoring

---

## 6. Z-Score Mean Reversion

### What it is

The Z-Score measures how many standard deviations the current price is from its rolling mean (typically 252-day):

```
Z = (Current Price − 252d Mean) / 252d Std Dev
```

Extreme Z-scores signal statistical anomalies — prices that have deviated significantly from their historical distribution.

### Rationale

Price, left unchecked by fundamental anchoring, tends to oscillate around a long-run mean. Z-Score operationalises this observation: when a stock is 2+ standard deviations above its mean, it is statistically "expensive" relative to its own history; when 2+ below, it is "cheap."

It is not a prediction — it is a measure of how stretched or compressed the current price is relative to its own past. That context changes the risk/reward calculus.

### When it is useful

- Identifying exhaustion: a stock that has run +30% in one month with a Z-score of +2.8 is statistically extended and warrants caution about chasing
- Identifying recovery setups: a stock at Z = −2.5 is at a historically rare low — combined with improving relative strength, this can signal mean reversion opportunity
- Combined with Hurst Exponent: if H < 0.45 (mean-reverting) AND Z > 2.0, the statistical case for reversion is strong

---

## 7. Hurst Exponent

### What it is

The Hurst Exponent (H) characterises whether a time series tends to trend, behave randomly, or mean-revert:

- **H > 0.55** → Trending (persistence: up moves tend to follow up moves)
- **H ≈ 0.5** → Random Walk (no memory, Brownian motion)
- **H < 0.45** → Mean-Reverting (anti-persistence: up moves tend to be followed by down moves)

It is computed via Rescaled Range (R/S) analysis across multiple time scales.

### Rationale

Before applying any strategy, you need to know the _nature_ of the price process. Trend-following works when H > 0.55. Mean-reversion works when H < 0.45. Both fail in a random walk. Most traders apply strategies without first checking this — they apply momentum strategies to mean-reverting stocks and wonder why they fail.

### When it is useful

- Strategy selection: use Z-Score reversion signals only when H < 0.45; use momentum signals only when H > 0.55
- Regime detection: when a stock's Hurst drops from 0.6 to 0.48, the trending regime has broken — existing momentum positions face elevated risk
- Combined with HMM: if HMM says "Bull State" but Hurst says "Mean-Reverting," the rally may be choppier than it appears

---

## 8. Rolling Beta

### What it is

Beta measures how much a stock's return moves for a 1% move in the broader market (NIFTY 50 proxy). Rolling Beta computes this over a 63-day window, updated daily, to capture how the relationship changes over time.

```
Beta = Cov(Stock Returns, Index Returns) / Var(Index Returns)
```

- Beta > 1.3 → Aggressive (amplifies index moves)
- Beta 0.7–1.3 → Market-like
- Beta < 0.7 → Defensive (dampens index moves)

### Rationale

Beta is not fixed. A defensive pharma stock can become aggressive during a sector rotation. A stock's beta changes as its business cycle, debt, and market perception change. Rolling Beta tracks this dynamically and flags regime changes in market sensitivity.

### When it is useful

- Portfolio construction: during bear markets, shift toward low-beta stocks; during bull markets, high-beta for amplification
- Identifying beta expansion: if a stock's beta is rising from 0.8 to 1.4 over 3 months, it is becoming more correlated with market risk — appropriate for risk management
- Combined with Regime Score: a high-beta stock in a Bear regime has multiplicative downside

---

## 9. GARCH (Generalized Autoregressive Conditional Heteroskedasticity)

### What it is

GARCH(1,1) models how volatility clusters and evolves over time. Unlike realised volatility (which looks backward), GARCH fits a model to the time series of returns and forecasts tomorrow's conditional volatility:

```
σ²_t = ω + α × ε²_{t-1} + β × σ²_{t-1}
```

Where ε is the return shock and σ² is the conditional variance. The one-day-ahead forecast is the square root of σ²\_{t+1}.

### Rationale

Volatility is not constant. Calm periods are followed by calm periods; turbulent periods beget more turbulence. GARCH captures this clustering and provides a forward-looking volatility estimate — not what volatility was, but what it is likely to be tomorrow.

This is what options market makers use to price risk. Having a GARCH forecast allows comparing implied volatility in options against the model's estimate of fair volatility.

### When it is useful

- Position sizing: allocate more when GARCH forecasts low volatility; reduce when it forecasts high volatility
- Options analysis: if GARCH forecasts 18% annualised vol but options are pricing 28%, implied vol is elevated — potentially a selling opportunity
- Risk monitoring: if GARCH vol is rising (expanding regime), tighten stop-losses preemptively

---

## 10. Realized Volatility Percentile

### What it is

Realised Volatility (RV) is the standard deviation of daily returns over a 21-day rolling window, annualised:

```
RV = Std(daily returns, 21d) × √252 × 100
```

The percentile expresses where today's RV sits within the past year's RV distribution.

### Rationale

Volatility is mean-reverting. High volatility periods are followed by lower volatility (and vice versa). The percentile tells you whether today's volatility is historically cheap or expensive — which matters for options pricing, position sizing, and strategy selection.

A stock at the 90th percentile of its own volatility history is in a statistically elevated regime; expecting it to continue is not well-supported historically.

### When it is useful

- Options strategy: high-RV percentile → sell premium strategies (covered calls, cash-secured puts); low-RV percentile → buy volatility (long strangles before catalysts)
- Entry timing: stocks at low RV percentiles often precede breakout moves
- Cross-sectional screening: find the NIFTY 50 stocks with the lowest RV percentile — these are the quietest names and may be near inflection points

---

## 11. Lead-Lag Analysis

### What it is

Lead-Lag analysis measures which stocks' price moves _precede_ or _follow_ a target stock's moves, and by how many days. It is computed as the cross-correlation between two return series at multiple lags:

```
Corr(Stock_A(t), Stock_B(t − k)) for k ∈ {−5, …, +5}
```

If the peak correlation occurs at lag k = +2, Stock B's returns today correlate with Stock A's returns 2 days later — meaning B leads A by 2 days.

### Rationale

Information propagates through markets at different speeds. A sector heavyweight (RELIANCE, HDFC Bank) may move first, and downstream stocks in the value chain or sector move later as traders reprice them. Understanding who leads whom allows positioning in laggards after a move in leaders.

### When it is useful

- Identifying sector leaders: if HDFCBANK moves, find which banks consistently lag it and by how many days
- Catching derivative moves: if RELIANCE has strong lead-lag relationships with ONGC and BPCL, monitor RELIANCE for early signals
- Validating sector rotation: when a sector leader breaks out, screen its laggers for next-in-line setups

---

## 12. Dual Momentum

### What it is

Dual Momentum (Gary Antonacci, 2014) applies two momentum filters before taking a long position:

1. **Absolute Momentum**: Is the 12-month return positive? (If not, stay in cash regardless)
2. **Relative Momentum**: Is this stock's 12-month return higher than the index's 12-month return?

Only when both filters are satisfied does the strategy produce a "Buy" signal.

### Rationale

Absolute momentum filters out stocks in long-term downtrends — it keeps you out of a "value trap" where a stock looks statistically cheap but keeps falling. Relative momentum filters for the _best_ opportunity within the universe. Together, they avoid the worst outcomes while keeping you in the strongest positions.

Dual Momentum has a strong academic foundation and has outperformed buy-and-hold in multiple asset classes over multi-decade studies.

### When it is useful

- Portfolio-level filter: before entering any position, run Dual Momentum to confirm both conditions are met
- Regime-change signal: when absolute momentum flips negative after being positive for 12+ months, it often marks the end of a bull phase
- Cross-stock ranking: sort NIFTY 50 by relative momentum to identify the top 5 strongest stocks for the next month

---

## 13. Quantile Regression

### What it is

Ordinary regression predicts the _average_ outcome. Quantile regression predicts the outcome at a specific percentile of the distribution. For example:

- **Q10 forecast**: expected 21-day return in a pessimistic (10th percentile) scenario
- **Q50 forecast**: median expected return (more robust than mean for fat-tailed distributions)
- **Q90 forecast**: expected 21-day return in an optimistic (90th percentile) scenario

Features used as predictors: 1M return, 3M return, drawdown depth, regime score.

### Rationale

Markets have fat tails. The average outcome is a bad summary statistic for a highly skewed distribution. Quantile regression gives a complete picture of the _distribution of outcomes_ given today's conditions — not just "what will probably happen" but "what is the realistic downside and upside?"

This directly supports position sizing and stop-loss placement.

### When it is useful

- Risk budgeting: the Q10 forecast represents the return you should plan to survive. If Q10 = −15%, size the position so that loss is acceptable
- Asymmetry detection: if (Q90 − Q50) >> (Q50 − Q10), the distribution is right-skewed — upside potential dominates. If the reverse, downside risk dominates
- Identifying improving setups: when Q10 improves (becomes less negative) while Q90 stays constant, the downside is compressing — a constructive setup

---

## 14. Expected Shortfall (CVaR)

### What it is

CVaR (Conditional Value at Risk), also called Expected Shortfall, answers: _given that a loss occurs in the worst 5% of scenarios, what is the average loss?_

```
VaR_95 = 5th percentile of 21-day return distribution
CVaR_95 = Mean of all 21-day returns below VaR_95
```

CVaR is a more complete tail-risk measure than VaR alone because it captures the _severity_ of bad outcomes, not just their threshold.

### Rationale

VaR tells you "you will lose more than X% with 5% probability." CVaR tells you "when you are in that worst 5%, you will lose Y% on average." For fat-tailed return distributions (which equities have), CVaR is substantially larger than VaR and is the number that actually matters for portfolio survival.

CVaR is used by institutional risk managers and is required by Basel III for bank trading desks. It is the correct metric for assessing whether a position can blow up a portfolio.

### When it is useful

- Position sizing: CVaR replaces or supplements standard deviation as the risk input. Size position so that CVaR × position_size ≤ maximum acceptable portfolio loss
- Stop-loss calibration: the VaR level is a natural stop-loss reference; the CVaR gives context for what happens if you miss the stop
- Screening for tail-risk bombs: stocks with CVaR significantly worse than their peers carry outsized risk per unit of expected return — avoid unless the return profile compensates
