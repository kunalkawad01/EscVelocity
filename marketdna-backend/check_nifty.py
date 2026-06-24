from app.services.duckdb_client import get_connection
import numpy as np

cur = get_connection()

N50_SYMBOLS = [
    'HDFCBANK','ICICIBANK','KOTAKBANK','AXISBANK',
    'TCS','INFY','HCLTECH','WIPRO',
    'SUNPHARMA','CIPLA','DRREDDY',
    'HINDUNILVR','ITC','NESTLEIND',
    'MARUTI','TATAMOTORS','M&M','BAJAJ-AUTO',
    'TATASTEEL','JSWSTEEL','HINDALCO',
    'RELIANCE','ONGC','POWERGRID',
    'LT','SIEMENS',
]

# Bulk fetch
placeholders = ','.join(['?' for _ in N50_SYMBOLS])
rows = cur.execute(
    f"SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)) as d, close "
    f"FROM equities_prices WHERE symbol IN ({placeholders}) ORDER BY symbol, d",
    N50_SYMBOLS
).fetchall()

closes_map = {}
for sym, d, close in rows:
    closes_map.setdefault(sym, []).append(float(close))

print(f"{'Symbol':<14} {'Bars':>5} {'Latest date':<12} {'1Y return':>10}")
print('-' * 45)

returns_1y = []
NIFTY_BARS = 252
for sym in N50_SYMBOLS:
    closes = closes_map.get(sym, [])
    if len(closes) < 2:
        print(f"{sym:<14} {'NO DATA':>5}")
        returns_1y.append(0.0)
        continue

    n = len(closes)
    window = closes[-NIFTY_BARS:] if n >= NIFTY_BARS else closes
    ret = (window[-1] - window[0]) / window[0] * 100 if window[0] else 0.0

    # Latest date
    date_rows = cur.execute(
        "SELECT MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) FROM equities_prices WHERE symbol = ?",
        [sym]
    ).fetchone()

    returns_1y.append(ret)
    print(f"{sym:<14} {n:>5} {str(date_rows[0]):<12} {ret:>+10.2f}%")

print('-' * 45)
print(f"{'Equal-weight avg':<14} {'':>5} {'':>12} {np.mean(returns_1y):>+10.2f}%")

# Check if M&M and BAJAJ-AUTO exist
print('\n=== Checking problem symbols ===')
for sym in ['M&M', 'BAJAJ-AUTO', 'NESTLEIND', 'SIEMENS']:
    r = cur.execute(
        "SELECT COUNT(*) FROM equities_prices WHERE symbol = ?", [sym]
    ).fetchone()
    print(f"{sym}: {r[0]} rows")
