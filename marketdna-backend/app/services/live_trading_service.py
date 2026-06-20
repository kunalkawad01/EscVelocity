"""Sector & Stock Intelligence Terminal — Layer 1-4 live market intelligence.

Data flow:
  Historical context  → DuckDB (equities_prices view, refreshed once per day)
  Live prices/volume  → Kite Connect quote() API
  Intraday history    → in-process accumulator (resets each calendar day)

Thread safety: one lock per shared mutable dict; no per-request DuckDB connections.
"""
import hashlib
import logging
import threading
from datetime import date, datetime

import numpy as np

from app.services.duckdb_client import get_connection
from app.services.kite_client import get_kite

log = logging.getLogger(__name__)

# ── Sector → constituent symbol mapping ──────────────────────────────────────
SECTOR_MAP: dict[str, list[str]] = {
    "Banking":        ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK",
                       "INDUSINDBK", "BANDHANBNK", "FEDERALBNK", "IDFCFIRSTB"],
    "Finance":        ["BAJFINANCE", "BAJAJFINSV", "CHOLAFIN", "SBILIFE",
                       "HDFCLIFE", "MUTHOOTFIN", "ICICIGI"],
    "IT":             ["TCS", "INFY", "HCLTECH", "WIPRO", "TECHM",
                       "LTIM", "MPHASIS", "PERSISTENT", "COFORGE"],
    "Energy":         ["RELIANCE", "ONGC", "NTPC", "BPCL", "POWERGRID",
                       "COALINDIA", "TATAPOWER", "ADANIGREEN", "ADANIPOWER"],
    "Auto":           ["MARUTI", "TATAMOTORS", "M&M", "BAJAJ-AUTO",
                       "EICHERMOT", "HEROMOTOCO", "MOTHERSON", "BOSCHLTD"],
    "Pharma":         ["SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB",
                       "APOLLOHOSP", "AUROPHARMA", "TORNTPHARM", "ALKEM"],
    "FMCG":           ["HINDUNILVR", "ITC", "NESTLE", "BRITANNIA",
                       "TATACONSUM", "DABUR", "GODREJCP", "MARICO", "COLPAL"],
    "Metals":         ["TATASTEEL", "HINDALCO", "JSWSTEEL", "VEDL",
                       "SAIL", "NMDC", "NATIONALUM", "JINDALSTEL"],
    "Infrastructure": ["LT", "ADANIPORTS", "ULTRACEMCO", "GRASIM",
                       "SIEMENS", "ABB", "BHEL", "BEL", "HAL"],
    "Telecom":        ["BHARTIARTL", "IDEA"],
    "Consumer":       ["TITAN", "ASIANPAINT", "PIDILITIND", "VOLTAS",
                       "HAVELLS", "VGUARD"],
}

_ALL_SYMBOLS: list[str] = list({s for syms in SECTOR_MAP.values() for s in syms})


# ── Historical context cache (daily refresh) ──────────────────────────────────
_hist_date: str = ""
_hist: dict[str, dict] = {}
_hist_lock = threading.Lock()


def _compute_hist(symbols: list[str]) -> dict[str, dict]:
    con = get_connection()
    sym_sql = ", ".join(f"'{s}'" for s in symbols)
    rows = con.execute(f"""
        WITH ranked AS (
            SELECT symbol, open, high, low, close, volume,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM equities_prices
            WHERE symbol IN ({sym_sql})
        )
        SELECT
            symbol,
            MAX(CASE WHEN rn = 1  THEN close  END)                          AS prev_close,
            MAX(CASE WHEN rn = 1  THEN high   END)                          AS prev_high,
            MAX(CASE WHEN rn = 1  THEN low    END)                          AS prev_low,
            MAX(CASE WHEN rn = 1  THEN open   END)                          AS today_open,
            MAX(CASE WHEN rn = 1  THEN volume END)                          AS today_volume,
            MAX(CASE WHEN rn = 2  THEN close  END)                          AS yesterday_close,
            AVG(CASE WHEN rn <= 14 THEN high - low END)                     AS atr14,
            AVG(CASE WHEN rn <= 20 THEN close END)                          AS sma20,
            AVG(CASE WHEN rn <= 50 THEN close END)                          AS sma50,
            AVG(CASE WHEN rn <= 200 THEN close END)                         AS sma200,
            MAX(CASE WHEN rn <= 252 THEN high  END)                         AS high_52w,
            MIN(CASE WHEN rn <= 252 THEN low   END)                         AS low_52w,
            AVG(CASE WHEN rn <= 20  THEN volume END)                        AS avg_vol20,
            MAX(CASE WHEN rn <= 5   THEN close END)                         AS peak_5d,
            MAX(CASE WHEN rn <= 20  THEN close END)                         AS peak_20d,
            MAX(CASE WHEN rn <= 60  THEN close END)                         AS peak_60d,
            MAX(CASE WHEN rn <= 252 THEN close END)                         AS peak_252d,
            AVG(CASE WHEN rn <= 5   THEN high - low END)                    AS atr_5d,
            AVG(CASE WHEN rn BETWEEN 6 AND 25 THEN high - low END)          AS atr_prior_20d,
            MAX(CASE WHEN rn BETWEEN 2 AND 11 THEN high  END)               AS high_10d_prior,
            MIN(CASE WHEN rn BETWEEN 2 AND 11 THEN low   END)               AS low_10d_prior,
            MAX(CASE WHEN rn <= 10  THEN high  END)                         AS high_10d,
            MIN(CASE WHEN rn <= 10  THEN low   END)                         AS low_10d,
            LIST(close ORDER BY rn ASC)  FILTER (WHERE rn <= 60)            AS closes_60d
        FROM ranked
        WHERE rn <= 252
        GROUP BY symbol
    """).fetchall()

    cols = [
        "symbol", "prev_close", "prev_high", "prev_low",
        "today_open", "today_volume", "yesterday_close",
        "atr14", "sma20", "sma50", "sma200", "high_52w", "low_52w", "avg_vol20",
        "peak_5d", "peak_20d", "peak_60d", "peak_252d",
        "atr_5d", "atr_prior_20d", "high_10d_prior", "low_10d_prior",
        "high_10d", "low_10d", "closes_60d",
    ]
    result: dict[str, dict] = {}
    for row in rows:
        d = dict(zip(cols, row))
        closes = d.get("closes_60d") or []
        d["closes_60d"] = [round(float(c), 2) for c in closes]
        result[d["symbol"]] = d
    log.info("Live trading: historical context for %d symbols", len(result))
    return result


def _get_hist() -> dict[str, dict]:
    global _hist_date, _hist
    today = date.today().isoformat()
    if _hist_date != today:
        with _hist_lock:
            if _hist_date != today:
                _hist = _compute_hist(_ALL_SYMBOLS)
                _hist_date = today
    return _hist


# ── Intraday LTP accumulator ──────────────────────────────────────────────────
_iday_date: str = ""
_iday: dict[str, list[tuple[str, float]]] = {}  # symbol → [(HH:MM, ltp)]
_iday_lock = threading.Lock()
_IDAY_MAX = 4800  # ~6.5 h × 2 readings/min at 5 s cadence


def _push_intraday(quotes: dict[str, dict]) -> None:
    global _iday_date, _iday
    today = date.today().isoformat()
    now_str = datetime.now().strftime("%H:%M")
    with _iday_lock:
        if _iday_date != today:
            _iday = {}
            _iday_date = today
        for sym, q in quotes.items():
            buf = _iday.setdefault(sym, [])
            buf.append((now_str, round(float(q["ltp"]), 2)))
            if len(buf) > _IDAY_MAX:
                del buf[0]


def _ltps(sym: str, max_pts: int = 120) -> list[float]:
    buf = _iday.get(sym, [])
    pts = [ltp for _, ltp in buf]
    if len(pts) <= max_pts:
        return pts
    step = (len(pts) - 1) / (max_pts - 1)
    return [pts[round(i * step)] for i in range(max_pts - 1)] + [pts[-1]]


def _iday_with_times(sym: str, max_pts: int = 78) -> tuple[list[str], list[float]]:
    buf = _iday.get(sym, [])
    if not buf:
        return [], []
    if len(buf) <= max_pts:
        return [t for t, _ in buf], [ltp for _, ltp in buf]
    step = (len(buf) - 1) / (max_pts - 1)
    idx = [round(i * step) for i in range(max_pts - 1)] + [len(buf) - 1]
    return [buf[i][0] for i in idx], [buf[i][1] for i in idx]


# ── Kite quote fetch ──────────────────────────────────────────────────────────
def _quotes(symbols: list[str]) -> dict[str, dict]:
    """Kite quote() — returns {} on failure. Cached nothing; caller decides refresh."""
    try:
        kite = get_kite()
        instruments = [f"NSE:{s}" for s in symbols]
        result: dict[str, dict] = {}
        for i in range(0, len(instruments), 500):
            chunk = instruments[i : i + 500]
            data = kite.quote(chunk)
            for key, val in data.items():
                sym = key.replace("NSE:", "")
                result[sym] = {
                    "ltp":        val["last_price"],
                    "open":       val["ohlc"]["open"],
                    "high":       val["ohlc"]["high"],
                    "low":        val["ohlc"]["low"],
                    "prev_close": val["ohlc"]["close"],
                    "vwap":       val.get("average_price"),
                    "volume":     val.get("volume_traded", 0),
                }
        return result
    except Exception as exc:
        log.warning("Kite quote failed: %s", exc)
        return {}


# ── EOD fallback: synthesise quotes from DuckDB when Kite is offline ─────────
def _fallback_quotes(hist: dict[str, dict]) -> dict[str, dict]:
    """Use today's DuckDB close (rn=1) as LTP, yesterday's close (rn=2) as prev_close.

    This lets the scatter and stock card show meaningful 3:30 PM end-of-day data
    when Kite access token is expired or the market is closed.
    """
    result: dict[str, dict] = {}
    for sym, h in hist.items():
        ltp = h.get("prev_close")       # rn=1 close  = today's 3:30 PM close
        pc  = h.get("yesterday_close")  # rn=2 close  = yesterday's close
        vol = h.get("today_volume") or 0
        if not ltp or not pc:
            continue
        result[sym] = {
            "ltp":        float(ltp),
            "open":       float(h.get("today_open") or ltp),
            "high":       float(h.get("prev_high") or ltp),
            "low":        float(h.get("prev_low") or ltp),
            "prev_close": float(pc),
            "vwap":       None,
            "volume":     float(vol),
        }
    log.info("Live trading: EOD fallback — %d symbols from DuckDB (3:30 PM close)", len(result))
    return result


def _get_quotes(hist: dict[str, dict], symbols: list[str] | None = None) -> tuple[dict[str, dict], str]:
    """Return (quotes_dict, data_mode).

    data_mode is "live" when Kite responds, "eod_fallback" when Kite is offline
    and DuckDB EOD data is used instead.
    """
    syms = symbols or list(hist.keys())
    live = _quotes(syms)
    if live:
        return live, "live"
    fb = _fallback_quotes({s: hist[s] for s in syms if s in hist})
    return fb, "eod_fallback"


# ── Helpers ───────────────────────────────────────────────────────────────────
def _r(v: float | None, dp: int = 2) -> float | None:
    return round(v, dp) if v is not None else None


def _atr_pct(sym: str, hist: dict[str, dict]) -> float:
    h = hist.get(sym, {})
    atr = h.get("atr14") or 0.0
    pc = h.get("prev_close") or 1.0
    return round(float(atr) / float(pc) * 100, 2)


def _intraday_return(sym: str, q: dict, h: dict) -> float:
    ltp = q["ltp"]
    pc = q.get("prev_close") or h.get("prev_close") or 0
    return round((ltp - pc) / pc * 100, 2) if pc else 0.0


def _market_is_open() -> bool:
    """True only during NSE trading hours: Mon–Fri, 09:15–15:30 IST."""
    from datetime import timedelta as td
    ist_now = datetime.utcnow() + td(hours=5, minutes=30)
    if ist_now.weekday() >= 5:          # Saturday=5, Sunday=6
        return False
    mins = ist_now.hour * 60 + ist_now.minute
    return 555 <= mins < 930            # 9:15 → 15:30


def _symbol_sector(symbol: str) -> str | None:
    for sector, syms in SECTOR_MAP.items():
        if symbol in syms:
            return sector
    return None


def _avg_pairwise_corr(symbols: list[str], window: int = 60) -> float:
    series = []
    for s in symbols:
        pts = _ltps(s, max_pts=window)
        if len(pts) >= 5:
            series.append(pts)
    if len(series) < 2:
        return 0.0
    min_len = min(len(s) for s in series)
    arrays = [np.array(s[-min_len:], dtype=float) for s in series]
    total, n = 0.0, 0
    for i in range(len(arrays)):
        for j in range(i + 1, len(arrays)):
            a, b = arrays[i], arrays[j]
            if np.std(a) > 0 and np.std(b) > 0:
                c = float(np.corrcoef(a, b)[0, 1])
                if not np.isnan(c):
                    total += c
                    n += 1
    return round(total / n, 3) if n else 0.0


def _corr_history(symbols: list[str], n_snaps: int = 20) -> tuple[list[str], list[float]]:
    buf_lens = [len(_iday.get(s, [])) for s in symbols if s in _iday]
    if not buf_lens:
        return [], []
    buf_len = min(buf_lens)
    if buf_len < 15:
        return [], []
    step = max(1, buf_len // n_snaps)
    times, corrs = [], []
    for end in range(step * 5, buf_len + 1, step):
        snap: dict[str, list[float]] = {}
        for sym in symbols:
            buf = _iday.get(sym, [])
            if len(buf) >= end:
                snap[sym] = [ltp for _, ltp in buf[:end]]
        if len(snap) < 2:
            continue
        min_len = min(len(v) for v in snap.values())
        if min_len < 5:
            continue
        arrays = [np.array(v[-min(30, min_len):], dtype=float) for v in snap.values()]
        total, np2 = 0.0, 0
        for i in range(len(arrays)):
            for j in range(i + 1, len(arrays)):
                a, b = arrays[i], arrays[j]
                if np.std(a) > 0 and np.std(b) > 0:
                    c = float(np.corrcoef(a, b)[0, 1])
                    if not np.isnan(c):
                        total += c
                        np2 += 1
        ref_sym = symbols[0]
        ref_buf = _iday.get(ref_sym, [])
        t = ref_buf[end - 1][0] if end <= len(ref_buf) else "?"
        times.append(t)
        corrs.append(round(total / np2, 3) if np2 else 0.0)
    return times, corrs


# ── All-sector progression cache (15-min, keyed by trade date) ───────────────
_all_prog_cache: dict[str, list[dict]] = {}   # sector → progression
_all_prog_trade_date: str = ""
_all_prog_lock = threading.Lock()


def _last_trade_date_str() -> str:
    """Return the last completed trading day as YYYY-MM-DD (IST-aware)."""
    from datetime import timedelta as td
    ist_now = datetime.utcnow() + td(hours=5, minutes=30)
    d = ist_now.date()
    mins = ist_now.hour * 60 + ist_now.minute
    # If before 9:15 or weekend, use previous trading day
    if d.weekday() >= 5 or mins < 555:
        d -= td(days=1)
    while d.weekday() >= 5:
        d -= td(days=1)
    return d.isoformat()


def _get_all_sectors_live_progression() -> dict[str, list[dict]]:
    """Build return progression for all sectors from the live _iday accumulator."""
    if not _iday:
        return {}
    hist = _get_hist()
    ref_sym = max(_iday.keys(), key=lambda s: len(_iday[s]))
    ref_buf = _iday[ref_sym]
    max_pts, step = 78, max(1, len(ref_buf) // 78)

    result: dict[str, list[dict]] = {}
    for idx in range(0, len(ref_buf), step):
        t = ref_buf[idx][0]
        for sector, syms in SECTOR_MAP.items():
            pt_rets: list[float] = []
            for sym in syms:
                buf  = _iday.get(sym, [])
                h    = hist.get(sym, {})
                pc   = float(h.get("prev_close") or 0)
                if idx < len(buf) and pc:
                    pt_rets.append((buf[idx][1] - pc) / pc * 100)
            if pt_rets:
                result.setdefault(sector, []).append({
                    "time":       t,
                    "return_pct": round(float(np.mean(pt_rets)), 3),
                })
    return result


def _get_all_sectors_15min_progression() -> dict[str, list[dict]]:
    """Fetch 15-min Kite bars for 2 rep symbols per sector, normalised to 0% at 9:15 AM.

    Result is cached per trade date so Kite is only hit once per day.
    """
    global _all_prog_cache, _all_prog_trade_date

    trade_date = _last_trade_date_str()
    if _all_prog_trade_date == trade_date and _all_prog_cache:
        return _all_prog_cache

    with _all_prog_lock:
        if _all_prog_trade_date == trade_date and _all_prog_cache:
            return _all_prog_cache

        data = _fetch_all_sectors_15min(trade_date)
        _all_prog_cache = data
        _all_prog_trade_date = trade_date

    return _all_prog_cache


def _fetch_all_sectors_15min(trade_date: str) -> dict[str, list[dict]]:
    """Inner: actually call Kite. Called at most once per trade date."""
    from datetime import timedelta

    # 2 representative symbols per sector
    rep_map: dict[str, list[str]] = {
        sector: syms[:2] for sector, syms in SECTOR_MAP.items() if syms
    }
    all_rep = list({s for syms in rep_map.values() for s in syms})

    try:
        kite = get_kite()

        # Single ltp() call to get all instrument tokens
        ltp_resp = kite.ltp([f"NSE:{s}" for s in all_rep])
        tokens: dict[str, int] = {
            k.replace("NSE:", ""): int(v["instrument_token"])
            for k, v in ltp_resp.items()
        }

        year, month, day = (int(x) for x in trade_date.split("-"))
        from_dt = datetime(year, month, day, 9, 0)
        to_dt   = datetime(year, month, day, 15, 35)

        sym_bars: dict[str, list] = {}
        for sym in all_rep:
            tok = tokens.get(sym)
            if not tok:
                continue
            try:
                bars = kite.historical_data(tok, from_dt, to_dt, "15minute")
                if bars:
                    sym_bars[sym] = bars
            except Exception as exc:
                log.debug("15m fetch %s: %s", sym, exc)

        if not sym_bars:
            return {}

        result: dict[str, list[dict]] = {}
        for sector, rep_syms in rep_map.items():
            avail = [s for s in rep_syms if s in sym_bars]
            if not avail:
                continue
            bases = [float(sym_bars[s][0]["open"]) for s in avail if sym_bars[s]]
            if not bases:
                continue
            n = min(len(sym_bars[s]) for s in avail)

            pts: list[dict] = [{"time": "09:15", "return_pct": 0.0}]
            for i in range(n):
                bar_end = sym_bars[avail[0]][i]["date"] + timedelta(minutes=15)
                rets = [
                    (float(sym_bars[s][i]["close"]) - base) / base * 100
                    for s, base in zip(avail, bases)
                ]
                pts.append({
                    "time":       bar_end.strftime("%H:%M"),
                    "return_pct": round(float(np.mean(rets)), 3),
                })
            result[sector] = pts

        log.info("15-min all-sectors: %d sectors, trade_date=%s", len(result), trade_date)
        return result

    except Exception as exc:
        log.warning("_fetch_all_sectors_15min failed: %s", exc)
        return {}


def get_sector_progressions() -> dict:
    """Return progression time-series for all sectors (live or 15-min Kite)."""
    trade_date = _last_trade_date_str()

    if _market_is_open():
        prog = _get_all_sectors_live_progression()
        source = "live" if prog else "none"
    else:
        prog = _get_all_sectors_15min_progression()
        source = "15min_kite" if prog else "none"

    return {
        "trade_date":   trade_date,
        "source":       source,
        "progressions": prog,
    }


# ── Signal deduplication ID ───────────────────────────────────────────────────
def _sig_id(symbol: str, signal_type: str) -> str:
    raw = f"{symbol}:{signal_type}:{date.today().isoformat()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ── Layer 1 — Sector Scatter ──────────────────────────────────────────────────
def get_sector_scatter() -> dict:
    hist = _get_hist()
    live, data_mode = _get_quotes(hist)
    if data_mode == "live":
        _push_intraday(live)

    sym_ret: dict[str, float] = {}
    for sym, q in live.items():
        if sym in hist:
            ret = _intraday_return(sym, q, hist[sym])
            sym_ret[sym] = ret

    nifty_return = round(float(np.mean(list(sym_ret.values()))), 2) if sym_ret else 0.0

    sectors = []
    for sector, syms in SECTOR_MAP.items():
        valid = [s for s in syms if s in sym_ret and s in hist]
        if not valid:
            continue
        rets = [sym_ret[s] for s in valid]
        atrs = [_atr_pct(s, hist) for s in valid]
        avg_ret = round(float(np.mean(rets)), 2)
        avg_atr = round(float(np.mean(atrs)), 2)
        sectors.append({
            "sector":      sector,
            "return_pct":  avg_ret,
            "atr_pct":     avg_atr,
            "stock_count": len(valid),
            "direction":   "long" if avg_ret > 0.1 else ("short" if avg_ret < -0.1 else "neutral"),
        })

    return {
        "as_of":        datetime.now().isoformat(timespec="seconds"),
        "kite_live":    data_mode == "live",
        "data_mode":    data_mode,
        "nifty_return": nifty_return,
        "sectors":      sectors,
    }


# ── 15-min Kite historical fallback for sector progression ───────────────────
def _get_sector_15min_data(syms: list[str]) -> tuple[list[dict], dict[str, list[dict]], dict[str, list[float]]]:
    """Fetch last trading session's 15-min OHLCV from Kite for sector symbols.
    Returns (sector_avg_progression, stock_progressions, sparklines):
      sector_avg_progression: [{time, sector_return, nifty_return}]
      stock_progressions:     {symbol: [{time, return_pct}]}
      sparklines:             {symbol: [close, close, ...]}  raw prices for mini-chart display
    """
    from datetime import timedelta

    try:
        kite = get_kite()

        instruments = [f"NSE:{s}" for s in syms]
        ltp_resp = kite.ltp(instruments)
        tokens: dict[str, int] = {
            key.replace("NSE:", ""): int(val["instrument_token"])
            for key, val in ltp_resp.items()
        }
        if not tokens:
            return [], {}

        ist_now = datetime.utcnow() + timedelta(hours=5, minutes=30)
        trade_date = ist_now.date()
        mins_ist = ist_now.hour * 60 + ist_now.minute
        if trade_date.weekday() >= 5 or mins_ist < 555:
            trade_date -= timedelta(days=1)
        while trade_date.weekday() >= 5:
            trade_date -= timedelta(days=1)

        from_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 9, 0)
        to_dt   = datetime(trade_date.year, trade_date.month, trade_date.day, 15, 35)

        all_bars: dict[str, list] = {}
        for sym, token in list(tokens.items())[:8]:
            try:
                bars = kite.historical_data(token, from_dt, to_dt, "15minute")
                if bars:
                    all_bars[sym] = bars
            except Exception as exc:
                log.debug("15-min fetch failed for %s: %s", sym, exc)

        if not all_bars:
            return [], {}, {}

        sym_base: dict[str, float] = {
            sym: float(bars[0]["open"])
            for sym, bars in all_bars.items()
            if bars and bars[0].get("open")
        }

        ref_sym  = next(iter(all_bars))
        ref_bars = all_bars[ref_sym]

        # Synthetic zero-anchor at 09:15 for both sector avg and per-stock
        sector_progression: list[dict] = [{"time": "09:15", "sector_return": 0.0, "nifty_return": 0.0}]
        stock_progressions: dict[str, list[dict]] = {
            sym: [{"time": "09:15", "return_pct": 0.0}] for sym in all_bars
        }
        # Sparkline: raw close prices per symbol (open of first bar = anchor, then closes)
        sparklines: dict[str, list[float]] = {
            sym: [sym_base[sym]] for sym in all_bars if sym in sym_base
        }

        for i, ref_bar in enumerate(ref_bars):
            bar_end = ref_bar["date"] + timedelta(minutes=15)
            time_label = bar_end.strftime("%H:%M")

            pt_rets: list[float] = []
            for sym, bars in all_bars.items():
                if i >= len(bars):
                    continue
                base = sym_base.get(sym)
                if not base:
                    continue
                close = float(bars[i]["close"])
                ret = (close - base) / base * 100
                pt_rets.append(ret)
                stock_progressions[sym].append({"time": time_label, "return_pct": round(ret, 3)})
                sparklines.setdefault(sym, []).append(close)

            if pt_rets:
                sector_progression.append({
                    "time":          time_label,
                    "sector_return": round(float(np.mean(pt_rets)), 3),
                    "nifty_return":  0.0,
                })

        log.info("15-min data: %d bars, %d symbols, base=09:15 open", len(sector_progression), len(all_bars))
        return sector_progression, stock_progressions, sparklines

    except Exception as exc:
        log.warning("15-min sector data failed: %s", exc)
        return [], {}, {}


def _get_sector_15min_progression(syms: list[str]) -> list[dict]:
    prog, _, _ = _get_sector_15min_data(syms)
    return prog


def _get_stock_15min_sparkline(sym: str) -> list[float]:
    """Last trading day's 15-min close prices for a single symbol.
    Returns [open_of_9:15_bar, close_bar1, close_bar2, ...] so the
    sparkline starts at the opening price and traces the day's moves.
    """
    from datetime import timedelta
    try:
        kite = get_kite()
        ltp_resp = kite.ltp([f"NSE:{sym}"])
        token = int(ltp_resp[f"NSE:{sym}"]["instrument_token"])

        ist_now = datetime.utcnow() + timedelta(hours=5, minutes=30)
        trade_date = ist_now.date()
        mins_ist = ist_now.hour * 60 + ist_now.minute
        if trade_date.weekday() >= 5 or mins_ist < 555:
            trade_date -= timedelta(days=1)
        while trade_date.weekday() >= 5:
            trade_date -= timedelta(days=1)

        from_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 9, 0)
        to_dt   = datetime(trade_date.year, trade_date.month, trade_date.day, 15, 35)

        bars = kite.historical_data(token, from_dt, to_dt, "15minute")
        if not bars:
            return []

        # Anchor at open of first 9:15 bar then append each bar's close
        return [float(bars[0]["open"])] + [float(b["close"]) for b in bars]

    except Exception as exc:
        log.debug("_get_stock_15min_sparkline %s: %s", sym, exc)
        return []


# ── Layer 2 — Sector Drill-Down ───────────────────────────────────────────────
def get_sector_detail(sector_name: str) -> dict | None:
    syms = SECTOR_MAP.get(sector_name)
    if not syms:
        return None

    hist = _get_hist()
    all_live, data_mode = _get_quotes(hist)
    if data_mode == "live":
        _push_intraday(all_live)

    # Nifty proxy return
    all_rets = []
    for sym, q in all_live.items():
        if sym in hist:
            all_rets.append(_intraday_return(sym, q, hist[sym]))
    nifty_ret = round(float(np.mean(all_rets)), 2) if all_rets else 0.0

    # Sector constituents
    constituents = []
    sector_rets = []
    for sym in syms:
        q = all_live.get(sym)
        h = hist.get(sym)
        if not q or not h:
            continue
        ret = _intraday_return(sym, q, h)
        atr = _atr_pct(sym, hist)
        sector_rets.append(ret)
        constituents.append({
            "symbol":     sym,
            "return_pct": ret,
            "atr_pct":    atr,
            "ltp":        round(float(q["ltp"]), 2),
            "direction":  "long" if ret > 0 else "short",
        })
    constituents.sort(key=lambda x: x["return_pct"], reverse=True)

    avg_ret = round(float(np.mean(sector_rets)), 2) if sector_rets else 0.0
    avg_atr = round(float(np.mean([c["atr_pct"] for c in constituents])), 2) if constituents else 0.0

    # Intraday sector progression (live accumulator)
    ref_sym = next((s for s in syms if s in _iday), None)
    progression = []
    if ref_sym:
        ref_buf = _iday.get(ref_sym, [])
        max_pts = 78
        step = max(1, len(ref_buf) // max_pts)
        for idx in range(0, len(ref_buf), step):
            t = ref_buf[idx][0]
            pt_rets = []
            for sym in syms:
                buf = _iday.get(sym, [])
                h = hist.get(sym, {})
                pc = h.get("prev_close") or 0
                if idx < len(buf) and pc:
                    pt_rets.append((buf[idx][1] - pc) / pc * 100)
            if pt_rets:
                progression.append({
                    "time":          t,
                    "sector_return": round(float(np.mean(pt_rets)), 2),
                    "nifty_return":  nifty_ret,
                })

    # Live stock progressions from _iday accumulator
    stock_progressions: dict[str, list[dict]] = {}
    if _market_is_open() and ref_sym:
        ref_buf_live = _iday.get(ref_sym, [])
        max_pts_live = 78
        step_live = max(1, len(ref_buf_live) // max_pts_live)
        for sym in syms:
            buf = _iday.get(sym, [])
            h = hist.get(sym, {})
            pc = float(h.get("prev_close") or 0)
            if not pc or not buf:
                continue
            pts: list[dict] = []
            for idx in range(0, len(ref_buf_live), step_live):
                if idx >= len(buf):
                    break
                ret = (buf[idx][1] - pc) / pc * 100
                pts.append({"time": ref_buf_live[idx][0], "return_pct": round(ret, 3)})
            if pts:
                stock_progressions[sym] = pts

    # Use 15-min Kite historical data whenever market is not open.
    # This covers: weekend (→ Friday data), after 15:30, before 9:15.
    # Without this check, weekend Kite LTPs can pollute _iday and
    # produce a meaningless "live" progression with weekend prices.
    progression_source = "live"
    hist_sparklines: dict[str, list[float]] = {}
    if not _market_is_open() or len(progression) < 3:
        hist_prog, hist_stock_prog, hist_sparklines = _get_sector_15min_data(syms)
        if hist_prog:
            progression = hist_prog
            progression_source = "15min_kite"
        if hist_stock_prog:
            stock_progressions = hist_stock_prog

    # Mini charts — live 5-sec ticks when open, last trading day's 15-min closes when closed
    mini_charts = []
    for c in constituents:
        if _market_is_open():
            intraday = _ltps(c["symbol"], max_pts=78)
        else:
            intraday = hist_sparklines.get(c["symbol"], [])
        if not intraday:
            # Final fallback: EOD closes (stored most-recent-first → reverse to chronological)
            raw = hist.get(c["symbol"], {}).get("closes_60d", [])
            intraday = list(reversed(raw[:20]))
        mini_charts.append({
            "symbol":     c["symbol"],
            "return_pct": c["return_pct"],
            "ltp":        c["ltp"],
            "direction":  c["direction"],
            "sparkline":  intraday,
        })

    corr_times, corr_vals = _corr_history(syms, n_snaps=20)
    current_corr = _avg_pairwise_corr(syms)

    return {
        "sector":              sector_name,
        "as_of":               datetime.now().isoformat(timespec="seconds"),
        "data_mode":           data_mode,
        "return_pct":          avg_ret,
        "atr_pct":             avg_atr,
        "vs_nifty":            round(avg_ret - nifty_ret, 2),
        "short_bias":          (avg_ret - nifty_ret) < -0.5,
        "current_correlation": current_corr,
        "constituents":        constituents,
        "intraday_progression":        progression,
        "intraday_progression_source": progression_source,
        "stock_progressions":          stock_progressions or None,
        "mini_charts":                 mini_charts,
        "correlation_history": corr_vals,
        "correlation_times":   corr_times,
    }


# ── Layer 3 — Stock Intelligence Card ────────────────────────────────────────
def get_stock_intelligence(symbol: str) -> dict | None:
    symbol = symbol.upper()
    hist = _get_hist()
    h = hist.get(symbol)
    if not h:
        return None

    all_live, data_mode = _get_quotes(hist)
    if data_mode == "live":
        _push_intraday(all_live)
    q = all_live.get(symbol)
    if not q:
        return None

    ltp = float(q["ltp"])
    pc = float(q.get("prev_close") or h.get("prev_close") or ltp)
    ret = round((ltp - pc) / pc * 100, 2) if pc else 0.0
    vwap = q.get("vwap")

    sma20  = _r(h.get("sma20"))
    sma50  = _r(h.get("sma50"))
    sma200 = _r(h.get("sma200"))

    # Universe rank
    sym_rets: dict[str, float] = {}
    for s, qq in all_live.items():
        hh = hist.get(s, {})
        pc_s = float(qq.get("prev_close") or hh.get("prev_close") or 0)
        if pc_s:
            sym_rets[s] = (float(qq["ltp"]) - pc_s) / pc_s * 100
    sorted_syms = sorted(sym_rets, key=sym_rets.get, reverse=True)  # type: ignore[arg-type]
    u_rank = sorted_syms.index(symbol) + 1 if symbol in sorted_syms else None
    u_total = len(sorted_syms)

    # Sector rank
    sector = _symbol_sector(symbol)
    s_rank, s_total = None, None
    if sector:
        sec_syms = [s for s in SECTOR_MAP[sector] if s in sym_rets]
        sec_sorted = sorted(sec_syms, key=lambda s: sym_rets.get(s, -999), reverse=True)
        s_rank  = sec_sorted.index(symbol) + 1 if symbol in sec_sorted else None
        s_total = len(sec_sorted)

    # Bias
    above_vwap = ltp > float(vwap) if vwap else False
    above_sma200 = ltp > float(sma200) if sma200 else False
    above_sma50  = ltp > float(sma50)  if sma50  else False
    above_prev_h = ltp > float(h["prev_high"]) if h.get("prev_high") else False
    below_prev_l = ltp < float(h["prev_low"])  if h.get("prev_low")  else False

    bull = sum([ret > 0.5, above_sma200, above_sma50, above_vwap, above_prev_h])
    bear = sum([ret < -0.5, not above_sma200 and sma200 is not None,
                not above_sma50 and sma50 is not None,
                not above_vwap and vwap is not None, below_prev_l])

    if bull >= 3 and bull > bear:
        bias = "long"
        bias_rationale = f"Price {ret:+.1f}%, above VWAP and key SMAs — bullish momentum"
    elif bear >= 3 and bear > bull:
        bias = "short"
        bias_rationale = f"Price {ret:+.1f}%, below VWAP and key SMAs — bearish momentum"
    else:
        bias = "neutral"
        bias_rationale = f"Mixed signals — {bull} bullish vs {bear} bearish factors"

    # Drawdowns
    closes_60d = h.get("closes_60d") or []
    def _dd(peak_key: str) -> float:
        pk = h.get(peak_key)
        if not pk:
            return 0.0
        return round((ltp - float(pk)) / float(pk) * 100, 2)

    high_52w = _r(h.get("high_52w"))
    low_52w  = _r(h.get("low_52w"))

    return {
        "symbol":          symbol,
        "as_of":           datetime.now().isoformat(timespec="seconds"),
        "data_mode":       data_mode,
        "bias":            bias,
        "bias_rationale":  bias_rationale,
        "ltp":             round(ltp, 2),
        "prev_close":      round(pc, 2),
        "return_pct":      ret,
        "vwap":            _r(vwap),
        "above_vwap":      above_vwap,
        "prev_high":       _r(h.get("prev_high")),
        "prev_low":        _r(h.get("prev_low")),
        "above_prev_high": above_prev_h,
        "below_prev_low":  below_prev_l,
        "sma": {
            "above_sma20":  ltp > float(sma20)  if sma20  else False,
            "above_sma50":  above_sma50,
            "above_sma200": above_sma200,
            "sma20":  sma20,
            "sma50":  sma50,
            "sma200": sma200,
        },
        "sector":       sector,
        "sector_rank":  s_rank,
        "sector_total": s_total,
        "universe_rank":  u_rank,
        "universe_total": u_total,
        "sparkline_intraday": _ltps(symbol, max_pts=120) if _market_is_open() else _get_stock_15min_sparkline(symbol),
        "sparkline_5d":  closes_60d[:5],
        "sparkline_20d": closes_60d[:20],
        "sparkline_60d": closes_60d,
        "drawdown_1w":  _dd("peak_5d"),
        "drawdown_1m":  _dd("peak_20d"),
        "drawdown_3m":  _dd("peak_60d"),
        "drawdown_1y":  _dd("peak_252d"),
        "high_52w": high_52w,
        "low_52w":  low_52w,
        "pct_from_52w_high": round((ltp - float(high_52w)) / float(high_52w) * 100, 2) if high_52w else None,
        "pct_from_52w_low":  round((ltp - float(low_52w))  / float(low_52w)  * 100, 2) if low_52w  else None,
    }


# ── Layer 4 — Breakthrough Signals ───────────────────────────────────────────
def _make_card(
    symbol: str, signal_type: str, direction: str, ltp: float,
    what: str, why: str, confirm: str, invalidate: str,
    entry: float, target: float, stop: float, priority: int,
) -> dict:
    target_pct = round((target - entry) / entry * 100 * (1 if direction == "long" else -1), 1)
    stop_pct   = round((entry - stop)   / entry * 100 * (1 if direction == "long" else -1), 1)
    rr = round(abs(target_pct) / abs(stop_pct), 1) if stop_pct else 0.0
    return {
        "id":           _sig_id(symbol, signal_type),
        "direction":    direction,
        "symbol":       symbol,
        "signal_type":  signal_type,
        "time":         datetime.now().strftime("%I:%M %p"),
        "what_happening":    what,
        "why_matters":       why,
        "confirm_trigger":   confirm,
        "invalidate_trigger": invalidate,
        "entry":        round(entry, 2),
        "target":       round(target, 2),
        "stop":         round(stop, 2),
        "risk_reward":  rr,
        "target_pct":   target_pct,
        "stop_pct":     stop_pct,
        "priority":     priority,
    }


def get_breakthrough_signals() -> dict:
    hist = _get_hist()
    live, data_mode = _get_quotes(hist)
    if data_mode == "live":
        _push_intraday(live)

    signals: list[dict] = []
    seen_ids: set[str] = set()

    for sym, q in live.items():
        h = hist.get(sym)
        if not h:
            continue

        ltp    = float(q["ltp"])
        pc     = float(q.get("prev_close") or h.get("prev_close") or 0)
        vol    = float(q.get("volume") or 0)
        avg_v  = float(h.get("avg_vol20") or 1)
        vol_ratio = vol / avg_v if avg_v else 0.0

        high52 = h.get("high_52w")
        low52  = h.get("low_52w")
        # In EOD fallback use prior-10d range (rn 2-11) so today's OHLC bar
        # doesn't trivially bound every signal impossible.
        if data_mode == "eod_fallback":
            h10d = h.get("high_10d_prior")
            l10d = h.get("low_10d_prior")
        else:
            h10d = h.get("high_10d")
            l10d = h.get("low_10d")
        atr5   = float(h.get("atr_5d") or 0)
        atrp   = float(h.get("atr_prior_20d") or 1)
        atr14  = float(h.get("atr14") or 0)
        compressed = atr5 < 0.6 * atrp and atrp > 0

        if not pc:
            continue

        # ── Signal 1: 52-week high breakout ──────────────────────────────
        if high52 and ltp > float(high52) and vol_ratio >= 1.5:
            sid = _sig_id(sym, "52W_HIGH")
            if sid not in seen_ids:
                seen_ids.add(sid)
                entry  = round(ltp * 1.001, 2)
                target = round(ltp * 1.08, 2)
                stop   = round(float(high52) * 0.99, 2)
                card = _make_card(
                    sym, "52-Week High Breakout", "long", ltp,
                    what=f"{sym} crossed its 52-week high of ₹{high52:.2f} "
                         f"with volume {vol_ratio:.1f}× the 20-day average.",
                    why=f"52-week high breakouts with volume confirmation signal institutional "
                        f"accumulation. Price is {((ltp/float(high52))-1)*100:.1f}% above the prior ceiling.",
                    confirm=f"15-min close above ₹{ltp:.2f} with sustained volume",
                    invalidate=f"Reversal below ₹{high52:.2f} (prior resistance now support)",
                    entry=entry, target=target, stop=stop, priority=1,
                )
                if card["risk_reward"] >= 1.5:
                    signals.append(card)

        # ── Signal 2: 52-week low breakdown ──────────────────────────────
        if low52 and ltp < float(low52) and vol_ratio >= 1.5:
            sid = _sig_id(sym, "52W_LOW")
            if sid not in seen_ids:
                seen_ids.add(sid)
                entry  = round(ltp * 0.999, 2)
                target = round(ltp * 0.92, 2)
                stop   = round(float(low52) * 1.01, 2)
                card = _make_card(
                    sym, "52-Week Low Breakdown", "short", ltp,
                    what=f"{sym} broke its 52-week low of ₹{low52:.2f} "
                         f"with volume {vol_ratio:.1f}× the 20-day average.",
                    why=f"52-week low breakdowns with volume confirm institutional distribution. "
                        f"All price memory below has been exhausted — strong sell signal.",
                    confirm=f"15-min close below ₹{ltp:.2f} with continued volume",
                    invalidate=f"Reclaim above ₹{low52:.2f} (prior support now resistance)",
                    entry=entry, target=target, stop=stop, priority=1,
                )
                if card["risk_reward"] >= 1.5:
                    signals.append(card)

        # ── Signal 3: Consolidation breakout ─────────────────────────────
        if compressed and h10d and ltp > float(h10d) and vol_ratio >= 1.2:
            sid = _sig_id(sym, "CONSOL_BREAK_UP")
            if sid not in seen_ids:
                seen_ids.add(sid)
                entry  = round(ltp * 1.001, 2)
                target = round(ltp + 3.0 * atr14, 2)
                stop   = round(float(h10d) * 0.99, 2)
                card = _make_card(
                    sym, "Consolidation Breakout", "long", ltp,
                    what=f"{sym} broke above the 10-day range high of ₹{h10d:.2f} "
                         f"after ATR compression ({atr5:.2f} vs {atrp:.2f} prior).",
                    why=f"ATR compressed to {atr5/atrp:.0%} of its 20-day average, "
                        f"signalling coiled energy. Breakout with {vol_ratio:.1f}× volume confirms expansion.",
                    confirm=f"15-min close above ₹{h10d:.2f} with volume above avg",
                    invalidate=f"Reversal back into the range below ₹{h10d:.2f}",
                    entry=entry, target=target, stop=stop, priority=2,
                )
                if card["risk_reward"] >= 1.5:
                    signals.append(card)

        # ── Signal 4: Consolidation breakdown ────────────────────────────
        if compressed and l10d and ltp < float(l10d) and vol_ratio >= 1.2:
            sid = _sig_id(sym, "CONSOL_BREAK_DOWN")
            if sid not in seen_ids:
                seen_ids.add(sid)
                entry  = round(ltp * 0.999, 2)
                target = round(ltp - 3.0 * atr14, 2)
                stop   = round(float(l10d) * 1.01, 2)
                card = _make_card(
                    sym, "Consolidation Breakdown", "short", ltp,
                    what=f"{sym} broke below the 10-day range low of ₹{l10d:.2f} "
                         f"after ATR compression ({atr5:.2f} vs {atrp:.2f} prior).",
                    why=f"ATR compressed to {atr5/atrp:.0%} of its 20-day average. "
                        f"Breakdown with {vol_ratio:.1f}× volume signals trapped longs capitulating.",
                    confirm=f"15-min close below ₹{l10d:.2f} with continued selling",
                    invalidate=f"Reclaim above ₹{l10d:.2f} (range floor now resistance)",
                    entry=entry, target=target, stop=stop, priority=2,
                )
                if card["risk_reward"] >= 1.5:
                    signals.append(card)

        # ── Signal 5: VWAP reclaim after gap-up ──────────────────────────
        vwap = q.get("vwap")
        open_ = float(q.get("open") or pc)
        gap_up   = open_ > pc * 1.005
        gap_down = open_ < pc * 0.995
        if vwap and gap_up and ltp > float(vwap) and ltp > open_:
            sid = _sig_id(sym, "VWAP_RECLAIM")
            if sid not in seen_ids:
                seen_ids.add(sid)
                entry  = round(float(vwap) * 1.001, 2)
                target = round(float(vwap) + 2.0 * atr14, 2)
                stop   = round(float(vwap) * 0.995, 2)
                card = _make_card(
                    sym, "VWAP Reclaim Post Gap-Up", "long", ltp,
                    what=f"{sym} gapped up {((open_/pc)-1)*100:.1f}% and is holding above VWAP (₹{vwap:.2f}), "
                         f"currently at ₹{ltp:.2f}.",
                    why=f"First touch and hold above VWAP after a gap-up signals buyers absorbing the gap. "
                        f"VWAP becomes dynamic support.",
                    confirm=f"Hold above VWAP ₹{vwap:.2f} on any intraday dip",
                    invalidate=f"Close below VWAP ₹{vwap:.2f} — gap fills become distribution",
                    entry=entry, target=target, stop=stop, priority=5,
                )
                if card["risk_reward"] >= 1.5:
                    signals.append(card)

        if vwap and gap_down and ltp < float(vwap) and ltp < open_:
            sid = _sig_id(sym, "VWAP_REJECTION")
            if sid not in seen_ids:
                seen_ids.add(sid)
                entry  = round(float(vwap) * 0.999, 2)
                target = round(float(vwap) - 2.0 * atr14, 2)
                stop   = round(float(vwap) * 1.005, 2)
                card = _make_card(
                    sym, "VWAP Rejection Post Gap-Down", "short", ltp,
                    what=f"{sym} gapped down {((open_/pc)-1)*100:.1f}% and is being rejected below VWAP (₹{vwap:.2f}), "
                         f"currently at ₹{ltp:.2f}.",
                    why=f"First VWAP touch post gap-down with rejection signals sellers controlling. "
                        f"VWAP acts as overhead resistance.",
                    confirm=f"Sustained price below VWAP ₹{vwap:.2f} with selling volume",
                    invalidate=f"Reclaim of VWAP ₹{vwap:.2f} — gap fill bullish reversal",
                    entry=entry, target=target, stop=stop, priority=5,
                )
                if card["risk_reward"] >= 1.5:
                    signals.append(card)

    # Sort by priority (lower = higher), then R:R
    signals.sort(key=lambda x: (x["priority"], -x["risk_reward"]))

    return {
        "as_of":        datetime.now().isoformat(timespec="seconds"),
        "kite_live":    data_mode == "live",
        "data_mode":    data_mode,
        "signal_count": len(signals),
        "signals":      signals[:20],  # cap at 20 most actionable
    }


# ── Layer 3 supplementary — OHLCV chart + multi-TF ranks ─────────────────────
def get_stock_chart(symbol: str) -> dict | None:
    """Return 365 bars of OHLCV+SMA, drawdown series, and multi-TF universe/sector ranks."""
    symbol = symbol.upper()
    con = get_connection()

    # OHLCV + SMA over full history, return last 365 bars
    ohlcv_rows = con.execute("""
        WITH all_bars AS (
            SELECT
                STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS dt,
                open, high, low, close, volume,
                ROW_NUMBER() OVER (ORDER BY date DESC) AS rn_desc
            FROM equities_prices
            WHERE symbol = ?
        ),
        with_sma AS (
            SELECT dt, open, high, low, close, volume, rn_desc,
                   AVG(close) OVER (ORDER BY dt ROWS BETWEEN 19  PRECEDING AND CURRENT ROW) AS sma20,
                   AVG(close) OVER (ORDER BY dt ROWS BETWEEN 49  PRECEDING AND CURRENT ROW) AS sma50,
                   AVG(close) OVER (ORDER BY dt ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200
            FROM all_bars
        )
        SELECT dt, open, high, low, close, volume, sma20, sma50, sma200
        FROM with_sma
        WHERE rn_desc <= 365
        ORDER BY dt
    """, [symbol]).fetchall()

    if not ohlcv_rows:
        return None

    closes_arr = np.array([float(r[4]) for r in ohlcv_rows], dtype=float)
    running_max = np.maximum.accumulate(closes_arr)
    drawdowns = np.where(running_max > 0, (closes_arr - running_max) / running_max * 100, 0.0)

    bars = [
        {
            "t":     r[0],
            "o":     round(float(r[1]), 2) if r[1] is not None else None,
            "h":     round(float(r[2]), 2) if r[2] is not None else None,
            "l":     round(float(r[3]), 2) if r[3] is not None else None,
            "c":     round(float(r[4]), 2) if r[4] is not None else None,
            "v":     int(r[5]) if r[5] else 0,
            "sma20":  round(float(r[6]), 2) if r[6] is not None else None,
            "sma50":  round(float(r[7]), 2) if r[7] is not None else None,
            "sma200": round(float(r[8]), 2) if r[8] is not None else None,
            "dd":    round(float(drawdowns[i]), 2),
        }
        for i, r in enumerate(ohlcv_rows)
    ]

    # Batch universe rank query
    sym_sql = ", ".join(f"'{s}'" for s in _ALL_SYMBOLS)
    rank_rows = con.execute(f"""
        WITH ranked AS (
            SELECT symbol, close,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM equities_prices
            WHERE symbol IN ({sym_sql})
        )
        SELECT symbol,
               MAX(CASE WHEN rn = 1   THEN close END) AS c0,
               MAX(CASE WHEN rn = 2   THEN close END) AS c1,
               MAX(CASE WHEN rn = 6   THEN close END) AS c5,
               MAX(CASE WHEN rn = 21  THEN close END) AS c20,
               MAX(CASE WHEN rn = 64  THEN close END) AS c63,
               MAX(CASE WHEN rn = 127 THEN close END) AS c126,
               MAX(CASE WHEN rn = 253 THEN close END) AS c252
        FROM ranked
        WHERE rn <= 253
        GROUP BY symbol
    """).fetchall()

    universe_rets: dict[str, dict[str, float]] = {}
    for row in rank_rows:
        sym, c0 = row[0], row[1]
        if not c0:
            continue
        tf_bases = {"1d": row[2], "1w": row[3], "1m": row[4], "3m": row[5], "6m": row[6], "1y": row[7]}
        universe_rets[sym] = {}
        for tf, base in tf_bases.items():
            if base and float(base) > 0:
                universe_rets[sym][tf] = (float(c0) - float(base)) / float(base) * 100

    sector = _symbol_sector(symbol)
    sector_syms = set(SECTOR_MAP.get(sector, [])) if sector else set()

    ranks_tf: dict[str, dict] = {}
    for tf in ("1d", "1w", "1m", "3m", "6m", "1y"):
        all_vals = [(s, r[tf]) for s, r in universe_rets.items() if tf in r]
        all_vals.sort(key=lambda x: x[1], reverse=True)
        u_rank = next((i + 1 for i, (s, _) in enumerate(all_vals) if s == symbol), None)

        sec_vals = [(s, r[tf]) for s, r in universe_rets.items() if tf in r and s in sector_syms]
        sec_vals.sort(key=lambda x: x[1], reverse=True)
        s_rank = next((i + 1 for i, (s, _) in enumerate(sec_vals) if s == symbol), None)

        my_ret = universe_rets.get(symbol, {}).get(tf)
        ranks_tf[tf] = {
            "return_pct":     round(my_ret, 2) if my_ret is not None else None,
            "universe_rank":  u_rank,
            "universe_total": len(all_vals),
            "sector_rank":    s_rank,
            "sector_total":   len(sec_vals),
        }

    log.info("Live chart: %s — %d bars, %d universe syms", symbol, len(bars), len(universe_rets))
    return {"symbol": symbol, "bars": bars, "ranks_tf": ranks_tf}
