import logging
from datetime import datetime, date

from app.services.duckdb_client import get_connection
from app.services.stock_metrics import get_universe
from app.services.kite_client import get_kite

log = logging.getLogger(__name__)

# ── Daily cache for historical levels ────────────────────────────────────────
_CACHE_DATE: str = ""
_DAY_CACHE: dict[str, dict] = {}  # symbol → {high_1d, …, sma200, prev_close}

# ── Intraday LTP accumulator (resets each trading day) ───────────────────────
_INTRADAY: dict[str, list[float]] = {}   # symbol → ordered list of LTPs
_INTRADAY_DATE: str = ""
_INTRADAY_MAX = 2400                     # ~6.5 hours × 360 readings/hr at 10s

def _update_intraday(live: dict[str, dict]) -> None:
    global _INTRADAY_DATE, _INTRADAY
    today = date.today().isoformat()
    if _INTRADAY_DATE != today:
        _INTRADAY = {}
        _INTRADAY_DATE = today
    for sym, data in live.items():
        buf = _INTRADAY.setdefault(sym, [])
        buf.append(round(data["ltp"], 2))
        if len(buf) > _INTRADAY_MAX:
            del buf[0]  # drop oldest to cap memory

def _get_intraday_sparkline(sym: str, max_pts: int = 100) -> list[float]:
    pts = _INTRADAY.get(sym, [])
    if not pts:
        return []
    if len(pts) <= max_pts:
        return pts
    step = (len(pts) - 1) / (max_pts - 1)
    return [pts[round(i * step)] for i in range(max_pts - 1)] + [pts[-1]]


def _compute_levels() -> dict[str, dict]:
    """One bulk DuckDB query for all universe symbols."""
    con = get_connection()
    symbols = get_universe()
    sym_sql = ", ".join(f"'{s}'" for s in symbols)

    rows = con.execute(f"""
        WITH ranked AS (
            SELECT symbol, high, close,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM equities_prices
            WHERE symbol IN ({sym_sql})
        ),
        levels AS (
            SELECT
                symbol,
                MAX(CASE WHEN rn = 1   THEN high END) AS high_1d,
                MAX(CASE WHEN rn = 2   THEN high END) AS high_2d,
                MAX(CASE WHEN rn = 3   THEN high END) AS high_3d,
                MAX(CASE WHEN rn = 4   THEN high END) AS high_4d,
                MAX(CASE WHEN rn = 5   THEN high END) AS high_5d,
                MAX(CASE WHEN rn = 10  THEN high END) AS high_10d,
                AVG(CASE WHEN rn <= 20  THEN close END) AS sma20,
                AVG(CASE WHEN rn <= 50  THEN close END) AS sma50,
                AVG(CASE WHEN rn <= 200 THEN close END) AS sma200,
                MAX(CASE WHEN rn = 1    THEN close END) AS prev_close
            FROM ranked
            WHERE rn <= 200
            GROUP BY symbol
        ),
        sparklines AS (
            SELECT symbol,
                   LIST(close ORDER BY rn DESC) AS closes_20
            FROM ranked
            WHERE rn <= 20
            GROUP BY symbol
        )
        SELECT l.*, s.closes_20
        FROM levels l
        JOIN sparklines s ON l.symbol = s.symbol
    """).fetchall()

    result: dict[str, dict] = {}
    for row in rows:
        result[row[0]] = {
            "high_1d":    row[1],
            "high_2d":    row[2],
            "high_3d":    row[3],
            "high_4d":    row[4],
            "high_5d":    row[5],
            "high_10d":   row[6],
            "sma20":      row[7],
            "sma50":      row[8],
            "sma200":     row[9],
            "prev_close": row[10],
            "closes_20":  row[11] or [],
        }
    log.info("Breakout levels computed for %d symbols", len(result))
    return result


def _get_historical_levels() -> dict[str, dict]:
    global _CACHE_DATE, _DAY_CACHE
    today = date.today().isoformat()
    if _CACHE_DATE != today:
        _DAY_CACHE = _compute_levels()
        _CACHE_DATE = today
    return _DAY_CACHE


def _fetch_live_prices(symbols: list[str]) -> dict[str, dict]:
    """Fetch LTP + previous day's close from Kite (ohlc.close = actual yesterday close).
    Returns {} on failure. Dict value: {"ltp": float, "prev_close": float}
    """
    try:
        kite = get_kite()
        instruments = [f"NSE:{s}" for s in symbols]
        prices: dict[str, dict] = {}
        for i in range(0, len(instruments), 500):
            chunk = instruments[i : i + 500]
            result = kite.ohlc(chunk)
            for key, val in result.items():
                sym = key.replace("NSE:", "")
                prices[sym] = {
                    "ltp":        val["last_price"],
                    "prev_close": val["ohlc"]["close"],  # actual previous trading day close
                }
        return prices
    except Exception as exc:
        log.warning("Kite OHLC failed: %s", exc)
        return {}


def _r(v: float | None, dp: int = 2) -> float | None:
    return round(v, dp) if v is not None else None


def get_scan() -> dict:
    levels = _get_historical_levels()
    live = _fetch_live_prices(list(levels.keys()))
    if live:
        _update_intraday(live)

    rows = []
    for sym, lev in levels.items():
        live_data = live.get(sym)
        if live_data is None:
            continue

        ltp = live_data["ltp"]
        pc  = live_data["prev_close"] or 0   # actual yesterday close from Kite
        change_pct = round((ltp - pc) / pc * 100, 2) if pc else 0.0

        def cx(field: str) -> bool:
            v = lev.get(field)
            return bool(ltp > v) if v else False

        c1   = cx("high_1d")
        c2   = cx("high_2d")
        c3   = cx("high_3d")
        c4   = cx("high_4d")
        c5   = cx("high_5d")
        c10  = cx("high_10d")
        s20  = cx("sma20")
        s50  = cx("sma50")
        s200 = cx("sma200")

        rows.append({
            "symbol":       sym,
            "live_price":   round(ltp, 2),
            "prev_close":   _r(pc),
            "change_pct":   change_pct,
            "high_1d":      _r(lev["high_1d"]),
            "high_2d":      _r(lev["high_2d"]),
            "high_3d":      _r(lev["high_3d"]),
            "high_4d":      _r(lev["high_4d"]),
            "high_5d":      _r(lev["high_5d"]),
            "high_10d":     _r(lev["high_10d"]),
            "sma20":        _r(lev["sma20"]),
            "sma50":        _r(lev["sma50"]),
            "sma200":       _r(lev["sma200"]),
            "crossed_1d":   c1,
            "crossed_2d":   c2,
            "crossed_3d":   c3,
            "crossed_4d":   c4,
            "crossed_5d":   c5,
            "crossed_10d":  c10,
            "above_sma20":  s20,
            "above_sma50":  s50,
            "above_sma200": s200,
            "score":        sum([c1, c2, c3, c4, c5, c10, s20, s50, s200]),
            "closes_20":    [round(v, 2) for v in lev["closes_20"]] + [round(ltp, 2)],
            "day_spark":    _get_intraday_sparkline(sym),
        })

    rows.sort(key=lambda r: r["score"], reverse=True)

    return {
        "as_of": datetime.now().isoformat(timespec="seconds"),
        "count": len(rows),
        "kite_live": bool(live),
        "rows": rows,
    }
