# MarketDNA - Stock Intelligence Page Module

# Sprint 1

## Objective

Build a premium stock intelligence page that summarizes everything important about a stock using only pricing data.

This page should answer:

> "What is happening in this stock right now, how strong is it, how risky is it, and how is it performing relative to the market?"

The page will serve as a foundational building block for:

- Stock DNA
- Sector DNA
- Market DNA
- Relative Strength Models
- Breadth Models
- Regime Models
- Research Copilot

---

# Technical Requirements

##

Frontend

React
TypeScript
Material UI
Highcharts
AG Grid

## Backend

FastAPI
DuckDB
Polars
Pydantic

## Storage

Parquet

## Testing

Pytest

Research

VectorBT

## AI

LangGraph
LiteLLM
LangChain
Ollama

## Infrastructure

Docker
GitHub Actions

## Important Rules

- All calculations must happen in Python/DuckDB.
- Never calculate metrics in JavaScript or TypeScript.
- Frontend is only responsible for visualization.
- Backend provides pre-computed metrics and datasets.
- All charts should be based on real market data.

---

# Design Principles

The page should feel like a premium research workstation rather than a broker dashboard.

### Use

- Modern design
- Spacious layout
- Card-based UI
- Premium analytics feel
- Large whitespace
- Soft shadows
- Smooth transitions
- Responsive design
- Minimal clutter
- Subtle animations
- Strong typography

### Avoid

- Dense tables
- Tiny charts
- Cluttered layouts
- Overuse of colors
- Broker-style interfaces

---

# Page Layout

1. Hero Section
2. Technical Analysis
3. Relative Strength
4. Return Intelligence
5. Risk Intelligence
6. Drawdown Intelligence
7. Market Comparison
8. Percentile Dashboard
9. AI Research Assistant

---

# Technical Analysis Section

## Interactive Price Chart

Display candlestick chart with the following timeframes:

- 1 Day
- 5 Day
- 1 Month
- 3 Month
- 6 Month
- YTD
- 1 Year
- 2 Year
- 3 Year
- 5 Year

### Indicators

- SMA20
- SMA50
- SMA200

### Features

- Zoom
- Pan
- Tooltip
- Crosshair
- Responsive layout

---

# Relative Strength Section

## Rolling Rank Among NIFTY 50

Calculate 1-Month Return Rank among all NIFTY 50 constituents.

Example:

| Date        | Rank |
| ----------- | ---- |
| 21-Jan-2021 | 5    |
| 22-Jan-2021 | 6    |
| 23-Jan-2021 | 4    |

Visualize using a line chart.

### Display

- Current Rank
- Best Rank
- Worst Rank
- Average Rank
- Rank Percentile

---

# Return Intelligence Section

## Return Histograms

### Daily Returns Histogram

Display:

- Mean
- Median
- Standard Deviation

---

### Monthly Returns Histogram

Display:

- Mean
- Median

---

### Yearly Returns Histogram

Display:

- Mean
- Median

---

# Return Statistics Cards

Display:

- 95th Percentile Daily Return
- 5th Percentile Daily Return
- Median Daily Return
- Mean Daily Return
- Maximum Daily Return
- Minimum Daily Return

Use premium KPI cards.

---

# Risk Intelligence Section

## ATR Analysis

Calculate:

ATR(14)

Display:

- Current ATR
- ATR Percentile
- ATR Trend

Visualizations:

- ATR Line Chart
- ATR Percentile Indicator

---

# Drawdown Intelligence

## Drawdown Chart

Display 5-Year Drawdown History.

Chart Type:

- Area Chart

Metrics:

- Current Drawdown
- Maximum Drawdown
- Average Drawdown

---

## Drawdown Statistics

Display:

- Current Drawdown
- Maximum Drawdown
- Average Drawdown
- Recovery Time
- Time Under Water

---

# Market Comparison Section

## Stock vs NIFTY Ratio Chart

Formula:

Stock Close / NIFTY Close

Timeframe:

5 Years

Overlay:

- SMA50
- SMA200

Display:

- Current Ratio
- Ratio Trend
- Relative Strength Status

Status:

- Outperforming
- Neutral
- Underperforming

---

# Percentile Dashboard

Purpose:

Show where today's metrics sit relative to history.

### Example

| Metric         | Current Value | Historical Percentile |
| -------------- | ------------- | --------------------- |
| ATR            | 12.5          | 87th                  |
| Volume         | 4.2M          | 93rd                  |
| Drawdown       | -8%           | 22nd                  |
| 1-Month Return | 15%           | 91st                  |

### Metrics

- ATR
- Volume
- Daily Return
- Monthly Return
- Drawdown
- 1-Month Return
- 3-Month Return
- 1-Year Return

Use percentile bars and gauges.

---

# AI Research Assistant

Chat interface powered entirely by pricing data.

## Rules

- Must never hallucinate.
- Must only answer using DuckDB queries and metric calculations.
- LLM explains results.

- LLM does not perform calculations.

---

## Example Questions

### Trend Analysis

- When did the stock rise 3 consecutive days?
- When was the longest winning streak?
- When was the longest losing streak?
- How often does the stock close above SMA200?

---

### Returns Analysis

- What was the best month in the last 5 years?
- What was the worst year in the last 5 years?
- What is the average monthly return?

---

### Risk Analysis

- What was the largest drawdown?
- How many times did daily losses exceed 5%?
- When was ATR above the 90th percentile?

---

### Relative Strength Analysis

- When was the stock ranked in the top 10 of NIFTY50?
- How long has the stock outperformed NIFTY?

---

### Distribution Analysis

- How many days exceeded the 95th percentile return?
- How many days were below the 5th percentile return?

---

### Pattern Discovery

- Find all periods where ATR doubled within 30 days.
- Show all 5-day winning streaks.
- Show all 10% drawdowns.
- Find all periods where the stock outperformed NIFTY by more than 20%.

---

# Development Strategy

## Phase 1

- Candlestick Chart
- SMA20
- SMA50
- SMA200

## Phase 2

- Rolling Rank
- Relative Strength

## Phase 3

- Histograms
- Return Statistics

## Phase 4

- ATR
- Risk Intelligence

## Phase 5

- Drawdown Intelligence

## Phase 6

- Ratio vs NIFTY

## Phase 7

- Percentile Dashboard

## Phase 8

- AI Research Assistant

---

# Engineering Standards

- Keep files small and modular.
- Maximum backend module size: 300 lines.
- Maximum frontend component size: 300 lines.
- One responsibility per component.
- DuckDB is the calculation engine.
- Highcharts.js is the primary visualization library.
- Build reusable chart components.
- All metrics should be independently testable.

# Sprint 2

# MarketDNA - Stock Intelligence Page

## Mission

Transform raw pricing data into actionable market intelligence.

The Stock Intelligence Page should answer:

- What is happening in this stock?
- How strong is the trend?
- How risky is the stock?
- Is the stock leading or lagging the market?
- How unusual is the current environment?
- Has a similar situation occurred before?

---

# 2. What Changed Today

## Purpose

Highlight only significant events.

### Examples

- Rank improved from **12 → 5**
- Entered **Bull Regime**
- Relative Strength reached **52-week high**
- ATR entered **90th percentile**
- Price crossed **SMA200**

### Display

- Timeline Cards
- Event Feed
- Significant Events Only

### Research Question

> What changed today?

---

# 3. Technical Analysis

## Interactive Price Chart

### Timeframes

- 1D
- 5D
- 1M
- 3M
- 6M
- YTD
- 1Y
- 2Y
- 3Y
- 5Y

### Indicators

- SMA20
- SMA50
- SMA100
- SMA200

### Features

- Zoom
- Pan
- Crosshair
- Tooltips
- Responsive Layout

### Research Question

> What is the trend?

---

# 4. Market Structure Intelligence

## Inputs

- Price
- SMA20
- SMA50
- SMA100
- SMA200

## Regimes

| Regime     | Description          |
| ---------- | -------------------- |
| Bear       | Weak Structure       |
| Neutral    | Mixed Structure      |
| Bull       | Strong Structure     |
| Super Bull | Exceptional Strength |

## Display

- Current Regime
- Previous Regime
- Days in Regime
- Regime Strength
- Regime Timeline

### Research Question

> What market structure currently exists?

---

# 5. Relative Strength Intelligence

## Rolling Rank

### Calculation

1-Month Return Rank among all NIFTY 50 stocks

### Display

- Current Rank
- Best Rank
- Worst Rank
- Average Rank
- Rank Percentile

### Charts

#### Rolling Rank History

```
Date → Rank
```

#### Relative Strength Ratio

```
Stock Close
------------
NIFTY Close
```

## Leadership Metrics

- Days in Top 10
- Days in Top Quartile
- Rank Persistence

### Leadership Status

| Status  | Meaning                      |
| ------- | ---------------------------- |
| Leader  | Top Performer                |
| Strong  | Above Average                |
| Average | Neutral                      |
| Weak    | Below Average                |
| Laggard | Significant Underperformance |

### Research Question

> Is this stock leading or lagging the market?

---

# 6. Trend Persistence

## Display

- Days Above SMA20
- Days Above SMA50
- Days Above SMA200

## Metrics

- Current Streak
- Historical Percentile

### Example

#### Above SMA200

**Current Streak:** 147 Days

**Historical Percentile:** 95%

### Research Question

> How durable is the trend?

---

# 7. Return Intelligence

## Daily Returns Histogram

### Statistics

- Mean
- Median
- Standard Deviation

---

## Monthly Returns

### Statistics

- Mean
- Median

---

## Yearly Returns

### Statistics

- Mean
- Median

---

## Return Statistics Dashboard

- Mean Return
- Median Return
- Maximum Return
- Minimum Return
- 95th Percentile Return
- 5th Percentile Return

### Rolling Return Percentiles

- 20-Day Return Percentile
- 60-Day Return Percentile
- 252-Day Return Percentile

### Research Question

> How unusual are current returns?

---

# 8. Risk Intelligence

## ATR Dashboard

### Calculation

ATR(14)

### Display

- Current ATR
- ATR Percentile
- ATR Trend

---

## Volatility Dashboard

### Metrics

- Volatility Percentile
- Drawdown Percentile
- Risk Score

### Volatility Regimes

| Regime  | Meaning            |
| ------- | ------------------ |
| Low     | Calm Market        |
| Normal  | Typical Conditions |
| High    | Elevated Risk      |
| Extreme | Exceptional Risk   |

### Research Question

> How risky is the current environment?

---

# 9. Drawdown & Recovery Intelligence

## Drawdown Chart

### Timeframe

5 Years

### Metrics

- Current Drawdown
- Maximum Drawdown
- Average Drawdown

---

## Recovery Dashboard

### Metrics

- Recovery Time
- Time Under Water
- Recovery Score
- Recovery Efficiency

### Example

**Current Drawdown:** -8%

**Average Recovery:** 48 Days

### Research Question

> How well does this stock recover?

---

# 10. Opportunity Dashboard

## Purpose

Identify attractive opportunities.

### Inputs

- Trend Strength
- Relative Strength
- Recovery Strength
- Drawdown Health
- Volatility Health
- Regime Strength

### Output

## Opportunity Score

| Score    | Rating      |
| -------- | ----------- |
| 0 - 20   | Avoid       |
| 20 - 40  | Weak        |
| 40 - 60  | Neutral     |
| 60 - 80  | Strong      |
| 80 - 100 | Exceptional |

### Research Question

> Does this stock deserve attention?

---

# 11. Percentile Command Center

## Purpose

Normalize all metrics into percentile form.

### Example

| Metric     | Value | Percentile |
| ---------- | ----- | ---------- |
| ATR        | 12.5  | 87         |
| Rank       | 4     | 95         |
| Drawdown   | -2%   | 12         |
| 20D Return | 15%   | 91         |
| Volume     | 89M   | 92         |

### Metrics

- ATR Percentile
- Rank Percentile
- Volume Percentile
- Drawdown Percentile
- Return Percentile
- Volatility Percentile

### Research Question

> How unusual is today's environment?

---

# 12. Historical Analog Engine

## Purpose

Find similar historical environments.

### Inputs

- Regime
- ATR
- Relative Strength Rank
- Drawdown
- Momentum
- Trend Persistence

### Outputs

- Similarity Score
- Historical Date Range
- Forward 1-Month Return
- Forward 3-Month Return
- Forward 6-Month Return

### Example

#### Most Similar Period

**July 2023**

- Similarity: 91%
- Next 3-Month Return: +18%

### Research Question

> When has this happened before and what happened next?

---

## MarketDNA Moat

The Historical Analog Engine is one of the platform's strongest differentiators and core competitive advantages.

---

# 13. Research Insights Engine

## Purpose

Generate actionable observations automatically.

### Example Insights

- Rank improved from **29 → 4** within **37 trading days**.
- Fastest improvement since **2022**.
- Current volatility is in the **94th percentile**.
- Historically similar periods produced below-average returns.
- Price has remained above **SMA200** for **147 consecutive sessions**.
- Longer than **95% of historical periods**.

### Rules

- Data-driven only
- No generic commentary
- Prioritize unusual events
- Prioritize statistical significance
- Maximum 10 insights

### Research Question

> What matters right now?

---

# 14. AI Research Copilot

## Architecture

```text
User
  ↓
LangGraph
  ↓
Intent Detection
  ↓
Metric Engine
  ↓
DuckDB
  ↓
Results
  ↓
LLM Explanation
```

## Rules

- Never hallucinate
- DuckDB performs calculations
- LLM explains only
- Every answer must be traceable to data

---

## Supported Questions

### Trend Analysis

- When was the longest winning streak?
- Show all 5-day winning streaks.
- How often does price remain above SMA200?

---

### Risk Analysis

- What was the largest drawdown?
- When was ATR above the 90th percentile?

---

### Relative Strength Analysis

- When was the stock ranked in the top 10?
- How long has the stock outperformed NIFTY?

---

### Distribution Analysis

- How many days exceeded the 95th percentile return?
- How many days were below the 5th percentile return?

---

### Pattern Discovery

- Show all 20% drawdowns.
- Show all periods similar to today.
- Find all ATR doubling events.
- Find all periods where rank improved by 20 positions.

---

# MarketDNA Proprietary Edge

### Core Differentiators

1. Market Structure Intelligence
2. Relative Strength Intelligence
3. Historical Analog Engine
4. Opportunity Score
5. Research Insights Engine
6. AI Research Copilot
7. Percentile Command Center

Together these transform raw pricing data into a professional-grade quantitative research platform.
