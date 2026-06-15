"""Export RELIANCE OHLCV + derived metrics from DuckDB to JSON for the frontend."""
import json
from collections import defaultdict
from pathlib import Path
from warehouse.register_views import get_connection

SYMBOL = 'RELIANCE'
OUT_PATH = Path('../marketdna-web/public/data/reliance.json')

con = get_connection()

df = con.execute(f"""
WITH base AS (
    SELECT
        STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
        ROUND(open,  2) AS open,
        ROUND(high,  2) AS high,
        ROUND(low,   2) AS low,
        ROUND(close, 2) AS close,
        volume::BIGINT   AS volume,
        ROW_NUMBER() OVER (ORDER BY date) AS rn
    FROM equities_prices
    WHERE symbol = '{SYMBOL}'
    ORDER BY date
),
sma AS (
    SELECT *,
        CASE WHEN rn >= 20  THEN ROUND(AVG(close) OVER (ORDER BY date ROWS BETWEEN 19  PRECEDING AND CURRENT ROW), 2) END AS sma20,
        CASE WHEN rn >= 50  THEN ROUND(AVG(close) OVER (ORDER BY date ROWS BETWEEN 49  PRECEDING AND CURRENT ROW), 2) END AS sma50,
        CASE WHEN rn >= 200 THEN ROUND(AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW), 2) END AS sma200,
        ROUND((close - LAG(close,1) OVER (ORDER BY date)) / LAG(close,1) OVER (ORDER BY date) * 100, 4) AS daily_return_pct
    FROM base
)
SELECT date, open, high, low, close, volume, sma20, sma50, sma200, daily_return_pct
FROM sma
ORDER BY date
""").pl()

candles = df.to_dicts()

# Compute drawdown
closes = [c['close'] for c in candles]
peak = closes[0]
drawdowns = []
for c in closes:
    if c > peak:
        peak = c
    drawdowns.append(round((c - peak) / peak * 100, 4))

# Monthly returns
monthly_map = defaultdict(list)
for c in candles:
    monthly_map[c['date'][:7]].append(c['close'])
monthly_returns = [
    {'period': k, 'return_pct': round((v[-1] - v[0]) / v[0] * 100, 3)}
    for k, v in sorted(monthly_map.items())
]

# Yearly returns
yearly_map = defaultdict(list)
for c in candles:
    yearly_map[c['date'][:4]].append(c['close'])
yearly_returns = [
    {'period': k, 'return_pct': round((v[-1] - v[0]) / v[0] * 100, 2)}
    for k, v in sorted(yearly_map.items())
]

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
with open(OUT_PATH, 'w') as f:
    json.dump({
        'meta': {'symbol': SYMBOL, 'name': 'Reliance Industries Ltd.', 'sector': 'Energy & Petrochemicals'},
        'candles': candles,
        'drawdowns': drawdowns,
        'monthly_returns': monthly_returns,
        'yearly_returns': yearly_returns,
    }, f, default=str)

print(f"Exported {len(candles)} candles to {OUT_PATH}")
last = candles[-1]
print(f"Latest: {last['date']}  close={last['close']}")
