from app.services.duckdb_client import get_connection

cur = get_connection()

# Check for duplicate dates
dups = cur.execute("""
    SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) as d, COUNT(*) as cnt, MIN(close) as lo, MAX(close) as hi
    FROM equities_prices
    WHERE symbol = 'TATASTEEL'
    GROUP BY d
    HAVING COUNT(*) > 1
    ORDER BY d DESC
    LIMIT 10
""").fetchall()

print("=== Duplicate dates for TATASTEEL ===")
if dups:
    for r in dups: print(r)
else:
    print("No duplicates found")

# Raw rows for last 5 dates
rows = cur.execute("""
    SELECT date, close
    FROM equities_prices
    WHERE symbol = 'TATASTEEL'
    ORDER BY date DESC
    LIMIT 10
""").fetchall()

print("\n=== Last 10 raw rows (newest first) ===")
for r in rows:
    print(r)

# Cross-check against a known return
# Jun 19 = 198.96, Jun 18 = 200.52 → -0.778%
# User says -0.62% → what would Jun18 close need to be?
c19, c18 = 198.96, 200.52
ret = (c19 - c18) / c18 * 100
print(f"\nJun19={c19}, Jun18={c18} → 1D = {ret:.4f}%")
print(f"For -0.62%, Jun18 would need to be {c19 / (1 - 0.0062):.2f}")
