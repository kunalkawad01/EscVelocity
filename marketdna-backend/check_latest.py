from app.services.duckdb_client import get_connection

cur = get_connection()

rows = cur.execute("""
    SELECT
        MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) as latest,
        MIN(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) as earliest,
        COUNT(DISTINCT symbol) as symbols
    FROM equities_prices
""").fetchone()

print(f"Latest date : {rows[0]}")
print(f"Earliest date: {rows[1]}")
print(f"Total symbols: {rows[2]}")

# Check a few specific symbols
for sym in ['TATASTEEL', 'HDFCBANK', 'TCS', 'RELIANCE']:
    r = cur.execute(
        "SELECT MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) FROM equities_prices WHERE symbol = ?",
        [sym]
    ).fetchone()
    print(f"  {sym}: latest = {r[0]}")
