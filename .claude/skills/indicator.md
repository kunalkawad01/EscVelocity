# Skill: Indicator Edge Lab

# Goal

Determine which technical indicators historically provide the strongest predictive edge for a specific stock.

The system should answer:

- Which indicators work best?
- Which indicator thresholds generate the highest returns?
- Which indicators produce the highest probability of success?
- Which indicators should be ignored?
- What indicator setup currently exists?

---

# Inputs

Required:

- OHLCV monthly Data

Optional:

- Benchmark Index
- Sector Index

---

# User Configurable Settings

Lookback:

- 3 Years
- 5 Years
- 10 Years
- Full History

Forward Returns:

- 1 Week
- 2 Weeks
- 1 Month
- 3 Months
- 6 Months

Minimum Samples:

- Default: 20

---

# Core Analysis Framework

For every indicator:

1. Calculate indicator history
2. Identify signal occurrences
3. Measure future returns
4. Calculate probability of success
5. Calculate expectancy
6. Rank indicators

---

# RSI Analysis

Default:

RSI Length = 14

Oversold Threshold = 30

Overbought Threshold = 70

User can modify all values.

---

## RSI Oversold Study

Condition:

RSI < Oversold Threshold

Example:

RSI < 30

Calculate:

- Number of Occurrences
- Average 1 Week Return
- Average 2 Week Return
- Average 1 Month Return
- Median Return
- Maximum Return
- Minimum Return
- Standard Deviation
- Win Rate
- Positive Return Probability
- Expected Value

Display:

| Metric        | Value |
| ------------- | ----- |
| Samples       | 42    |
| Avg 1W Return | 2.8%  |
| Median Return | 1.9%  |
| Win Rate      | 69%   |
| Max Return    | 14.5% |
| Min Return    | -8.1% |

---

## RSI Overbought Study

Condition:

RSI > Overbought Threshold

Example:

RSI > 70

Calculate:

- Average Forward Return
- Negative Return Probability
- Positive Return Probability
- Win Rate
- Max Drawdown
- Distribution

Display:

| Metric                      | Value |
| --------------------------- | ----- |
| Samples                     | 31    |
| Avg 1W Return               | -1.6% |
| Negative Return Probability | 74%   |

---

## RSI Distribution Analysis

Calculate:

- Minimum RSI
- Maximum RSI
- Mean RSI
- Median RSI
- 5th Percentile
- 10th Percentile
- 25th Percentile
- 75th Percentile
- 90th Percentile
- 95th Percentile

Display percentile curve.

---

## RSI Threshold Optimization

Test:

RSI < 10

RSI < 15

RSI < 20

RSI < 25

RSI < 30

RSI < 35

RSI < 40

Calculate:

- Average Return
- Win Rate
- Sample Count

Determine:

Best RSI Buy Threshold

Example:

| Threshold | Avg Return |
| --------- | ---------- |
| 20        | 4.8%       |
| 25        | 3.7%       |
| 30        | 2.9%       |

Winner:

RSI < 20

---

# Stochastic RSI

User Configurable:

- Length
- Oversold Threshold
- Overbought Threshold

Perform identical analysis.

Calculate:

- Forward Returns
- Win Rate
- Expectancy
- Distribution

Determine:

Best Threshold

---

# Williams %R

Default:

Oversold = -80

Overbought = -20

User Configurable.

Calculate:

- Future Returns
- Win Rate
- Probability Analysis

Determine:

Optimal Thresholds

---

# Commodity Channel Index (CCI)

Default:

Oversold = -100

Overbought = +100

User Configurable.

Calculate:

- Average Forward Return
- Success Probability
- Distribution

Determine:

Optimal Threshold

---

# Money Flow Index (MFI)

Default:

Oversold = 20

Overbought = 80

User Configurable.

Calculate:

- Forward Returns
- Win Rate
- Expected Value

Determine:

Best Threshold

---

# Bollinger Band Analysis

Parameters:

- Length
- Standard Deviations

Signals:

Close Below Lower Band

Close Above Upper Band

Calculate:

- Future Returns
- Win Probability

Determine:

Best Band Setup

---

# Bollinger %B

Calculate:

%B < 0.1

%B < 0.2

%B > 0.8

%B > 0.9

Measure predictive power.

---

# MACD Analysis

Signals:

- Bullish Cross
- Bearish Cross
- Zero Line Cross

Calculate:

- Average Future Returns
- Win Rate
- Probability Distribution

Determine:

Most Effective Signal

---

# Moving Average Analysis

Test:

SMA

EMA

Lengths:

- 10
- 20
- 50
- 100
- 200

Signals:

Price Above MA

Price Below MA

MA Crossovers

Calculate:

- Future Returns
- Success Rate

Determine:

Best MA Length

---

# ADX Analysis

Thresholds:

- ADX > 20
- ADX > 25
- ADX > 30
- ADX > 40

Calculate:

Trend persistence.

Measure:

Probability trend continues.

---

# Relative Strength Analysis

Against:

- NIFTY50
- Sector Index

Signals:

RS Rank

RS Percentile

Measure:

Future outperformance probability.

---

# Volume Analysis

Signals:

Volume Spike

Volume Dry-Up

Volume Breakout

Calculate:

Forward Returns

Win Rate

Expectancy

---

# Volatility Analysis

Indicators:

- ATR
- Historical Volatility
- Volatility Percentile

Conditions:

Low Volatility

High Volatility

Volatility Expansion

Volatility Compression

Measure:

Future return profile.

---

# Indicator Scorecard

For every indicator calculate:

## Edge Score

Edge Score =

Win Rate
× Average Return
× Signal Frequency

---

## Reliability Score

Reliability =

Sample Count
× Consistency

---

## Expectancy Score

Expectancy =

(Win Rate × Avg Win)

−

(Loss Rate × Avg Loss)

---

# Indicator Ranking Table

| Rank | Indicator    | Setup     | Edge Score |
| ---- | ------------ | --------- | ---------- |
| 1    | RSI          | RSI < 22  | 94         |
| 2    | MFI          | MFI < 18  | 90         |
| 3    | Bollinger %B | %B < 0.08 | 87         |

---

# Current Market Scan

Analyze latest bar.

Display:

| Indicator | Current Value | Signal   |
| --------- | ------------- | -------- |
| RSI       | 27            | Oversold |
| MFI       | 21            | Neutral  |
| MACD      | Bullish       | Buy      |

---

# Current Best Opportunities

Based on current readings:

Determine:

- Active Signals
- Historical Win Rate
- Historical Expectancy

Example:

Current Setup:

RSI = 24

Historical Results:

- Avg 1 Month Return = 5.1%
- Positive Return Probability = 73%

---

# Final Verdict

Answer:

1. Which indicator works best for this stock?
2. What threshold works best?
3. Which indicator is most reliable?
4. Which indicator has highest expectancy?
5. Which indicators are currently active?
6. What has historically happened after similar setups?

Output:

Stock Indicator Report Card

Grade:

A+
A
B
C
D

with supporting evidence and rankings.
