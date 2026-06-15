from app.services.duckdb_client import get_connection
con = get_connection()

tests = [
    ("min/max date",  "SELECT MIN(date), MAX(date) FROM equities_prices WHERE symbol = 'RELIANCE'"),
    ("date filter",   "SELECT COUNT(*) FROM equities_prices WHERE symbol = 'RELIANCE' AND date >= '2023-01-01'"),
    ("monthly group", "SELECT STRFTIME(date::DATE, '%Y-%m') AS month, AVG(close) FROM equities_prices WHERE symbol = 'RELIANCE' GROUP BY month ORDER BY month LIMIT 3"),
    ("yearly group",  "SELECT STRFTIME(date::DATE, '%Y') AS year, AVG(close) FROM equities_prices WHERE symbol = 'RELIANCE' GROUP BY year ORDER BY year LIMIT 3"),
    ("daily return",  "SELECT date, (close - LAG(close) OVER (ORDER BY date)) / LAG(close) OVER (ORDER BY date) * 100 AS ret FROM equities_prices WHERE symbol = 'RELIANCE' LIMIT 5"),
    ("sma20",         "SELECT date, AVG(close) OVER (ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS sma20 FROM equities_prices WHERE symbol = 'RELIANCE' LIMIT 3"),
]

for name, sql in tests:
    try:
        row = con.execute(sql).fetchone()
        print(f"OK  {name}: {row}")
    except Exception as e:
        print(f"ERR {name}: {e}")
