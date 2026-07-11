"""Sector & Stock Intelligence Terminal — Layer 1-4 live market intelligence.

Data flow:
  Historical context  → DuckDB (equities_prices view, refreshed once per day)
  Live prices/volume  → Kite Connect quote() API
  Intraday history    → in-process accumulator (resets each calendar day)

Thread safety: one lock per shared mutable dict; no per-request DuckDB connections.
"""
import csv
import hashlib
import logging
import os
import threading
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import numpy as np

from app.services.duckdb_client import get_connection
from app.services.kite_client import get_kite
from app.services.stock_metrics import get_universe

log = logging.getLogger(__name__)

# ── Sector → constituent symbol mapping (loaded from ind_nifty500list.csv) ───
def _load_sector_map() -> dict[str, list[str]]:
    csv_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..",
        "marketdna-data", "ind_nifty500list.csv",
    )
    csv_path = os.path.normpath(csv_path)
    sectors: dict[str, list[str]] = defaultdict(list)
    try:
        with open(csv_path, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row.get("Series", "").strip() == "EQ":
                    sectors[row["Industry"].strip()].append(row["Symbol"].strip())
        # Split large sectors so each drill-down stays under ~55 symbols
        for sector in list(sectors):
            syms = sectors[sector]
            if len(syms) > 55:
                mid = len(syms) // 2
                sectors[f"{sector} 1"] = syms[:mid]
                sectors[f"{sector} 2"] = syms[mid:]
                del sectors[sector]

        log.info("Loaded SECTOR_MAP: %d sectors, %d symbols",
                 len(sectors), sum(len(v) for v in sectors.values()))
    except Exception as exc:
        log.error("Failed to load ind_nifty500list.csv: %s", exc)
    return dict(sectors)


SECTOR_MAP: dict[str, list[str]] = _load_sector_map()
_SECTOR_MAPS: dict[str, dict[str, list[str]]] = {"nifty500": SECTOR_MAP, "nifty200": SECTOR_MAP}



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
                _hist = _compute_hist(get_universe())
                _hist_date = today
    return _hist


def invalidate() -> None:
    """Force the daily historical-context cache to recompute on next access.

    _get_hist() is keyed by the calendar date, so same-day re-ingestion — the
    post-market OHLCV run that appends today's candle after the backend has
    already cached hist earlier in the day — does NOT refresh it: the key
    (today's date) is unchanged, so the guard short-circuits and the page keeps
    serving the prior session. Resetting _hist_date forces a recompute from the
    fresh parquet on the next call, so every page built on _get_hist (F&O
    tactical, live trading, intraday race, sector heatmap) picks up the new bar
    without a backend restart.
    """
    global _hist_date
    with _hist_lock:
        _hist_date = ""
    log.info("Live trading: historical-context cache invalidated")


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

    data_mode is "live" when Kite responds during market hours.
    Outside market hours Kite's last_price == ohlc.close (both yesterday's close),
    making every return 0 — so we skip the Kite call and use the EOD fallback
    which computes returns as (rn=1 close) / (rn=2 close) - 1 from DuckDB.
    """
    syms = symbols or list(hist.keys())
    if _market_is_open():
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
    # After market close Kite sets ohlc.close == last_price (both = today's close),
    # making the return 0. Use DuckDB yesterday_close (rn=2) as the true baseline.
    if _market_is_open():
        pc = q.get("prev_close") or h.get("prev_close") or 0
    else:
        pc = h.get("yesterday_close") or q.get("prev_close") or h.get("prev_close") or 0
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


# ── All-sector progression cache (15-min, keyed by universe + trade date) ────
_all_prog_cache: dict[str, dict[str, list[dict]]] = {}  # universe → {sector → progression}
_all_prog_trade_date: dict[str, str] = {}               # universe → trade_date
_all_prog_lock = threading.Lock()

# ── Per-sector 3-min Kite historical cache (all constituents) ────────────────
# First call per sector per trade date fetches N historical bars from Kite (~30-60s).
# All subsequent calls for the same sector on the same trade date return instantly.
# keyed by sector_hash → (trade_date_str, (sector_prog, stock_prog, sparklines, sym_base))
_sector_3min_cache: dict[str, tuple[str, tuple]] = {}
_sector_3min_lock = threading.Lock()

# ── Per-symbol 1-min intraday Kite historical cache ──────────────────────────
# Refreshed at most once per minute — prevents Kite call on every 5-second poll.
# tuple: (date_str, minute_key "HHMM", bars, vwap, volume_ratio)
_intra_kite_cache: dict[str, tuple[str, str, list[dict], float | None, float | None]] = {}
_intra_kite_lock = threading.Lock()

# ── Per-strike Kite historical cache (FUT+CE+PE) ─────────────────────────────
# key: "symbol:strike:expiry" → (minute_key "HHMM", result_dict)
_strike_chart_cache: dict[str, tuple[str, dict]] = {}
_strike_chart_lock = threading.Lock()

# ── Today's intraday historical backfill (refreshed every 15 min during market) ──
_sess_hist: dict[str, list[dict]] = {}   # sector → [{time, return_pct}]
_sess_opens: dict[str, float] = {}       # symbol → true 9:15 open from Kite bars
_sess_hist_date: str = ""
_sess_hist_until: int = 0               # last refresh as minutes since midnight
_sess_hist_lock = threading.Lock()


def _t2m(t: str) -> int:
    """'HH:MM' → total minutes since midnight."""
    h, m = map(int, t.split(":"))
    return h * 60 + m


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


def _refresh_session_hist() -> None:
    """Fetch today's 15-min Kite bars (9:15 → now) for 2 rep symbols per sector.

    Updates _sess_hist (sector progressions) and _sess_opens (true 9:15 opens).
    Called at most once per 15 minutes during market hours.
    """
    global _sess_hist, _sess_opens, _sess_hist_date, _sess_hist_until
    from datetime import timedelta

    rep_map = {sector: syms[:2] for sector, syms in SECTOR_MAP.items() if syms}
    all_rep  = list({s for syms in rep_map.values() for s in syms})

    ist_now    = datetime.utcnow() + timedelta(hours=5, minutes=30)
    td_today   = ist_now.date()
    from_dt    = datetime(td_today.year, td_today.month, td_today.day, 9, 0)
    to_dt      = ist_now

    try:
        kite     = get_kite()
        ltp_resp = kite.ltp([f"NSE:{s}" for s in all_rep])
        tokens: dict[str, int] = {
            k.replace("NSE:", ""): int(v["instrument_token"])
            for k, v in ltp_resp.items()
        }

        sym_bars: dict[str, list] = {}
        for sym, tok in tokens.items():
            try:
                bars = kite.historical_data(tok, from_dt, to_dt, "3minute")
                if bars:
                    sym_bars[sym] = bars
            except Exception as exc:
                log.debug("session hist %s: %s", sym, exc)

        if not sym_bars:
            return

        opens = {sym: float(bars[0]["open"]) for sym, bars in sym_bars.items() if bars}
        prog: dict[str, list[dict]] = {}

        for sector, rep_syms in rep_map.items():
            avail = [s for s in rep_syms if s in sym_bars and s in opens]
            if not avail:
                continue
            pts: list[dict] = [{"time": "09:15", "return_pct": 0.0}]
            n = min(len(sym_bars[s]) for s in avail)
            for i in range(n):
                bar_end = sym_bars[avail[0]][i]["date"] + timedelta(minutes=3)
                rets = [
                    (float(sym_bars[s][i]["close"]) - opens[s]) / opens[s] * 100
                    for s in avail
                ]
                pts.append({
                    "time":       bar_end.strftime("%H:%M"),
                    "return_pct": round(float(np.mean(rets)), 3),
                })
            prog[sector] = pts

        # Caller (_get_session_hist) already holds _sess_hist_lock — write directly
        global _sess_hist, _sess_opens, _sess_hist_date, _sess_hist_until
        _sess_hist      = prog
        _sess_opens     = opens
        _sess_hist_date = td_today.isoformat()
        _sess_hist_until = ist_now.hour * 60 + ist_now.minute

        log.info("Session hist refreshed: %d sectors up to ~%s", len(prog), ist_now.strftime("%H:%M"))

    except Exception as exc:
        log.warning("_refresh_session_hist failed: %s", exc)


def _get_session_hist() -> tuple[dict[str, list[dict]], dict[str, float]]:
    """Return today's cached historical progression, refreshing every 15 min.

    Lock is held only around the double-check; _refresh_session_hist writes
    globals directly (no inner lock) to avoid reentrant-lock deadlock.
    """
    from datetime import timedelta
    ist_now  = datetime.utcnow() + timedelta(hours=5, minutes=30)
    today    = ist_now.date().isoformat()
    now_min  = ist_now.hour * 60 + ist_now.minute

    needs = _sess_hist_date != today or not _sess_hist or (now_min - _sess_hist_until) >= 3
    if needs:
        with _sess_hist_lock:
            if _sess_hist_date != today or not _sess_hist or (now_min - _sess_hist_until) >= 3:
                _refresh_session_hist()   # writes globals directly, no inner lock

    return _sess_hist, _sess_opens


def _get_all_sectors_live_progression() -> dict[str, list[dict]]:
    """Hybrid: historical 15-min bars (9:15 → last completed bar) stitched with
    live _iday ticks (recent minutes), both normalised to the true 9:15 open.

    This ensures that opening the page mid-session (e.g. 12:00 PM) immediately
    shows the full day from 9:15, then live ticks extend the chart in real time.
    Falls back to historical-only if _iday is not yet populated (server just started).
    """
    # ── 1. Historical backfill (always fetch first) ───────────────────────────
    hist_prog, sym_opens = _get_session_hist()

    # If _iday not yet populated (server just started), serve historical bars only
    if not _iday:
        return hist_prog

    # Find the latest time already covered by historical bars
    last_hist_min = _t2m("09:15")
    for pts in hist_prog.values():
        if pts:
            last_hist_min = max(last_hist_min, _t2m(pts[-1]["time"]))

    # ── 2. Open prices: prefer Kite historical open, fall back to _iday[0] ───
    open_prices: dict[str, float] = {}
    for sym in (s for syms in SECTOR_MAP.values() for s in syms):
        if sym in sym_opens:
            open_prices[sym] = sym_opens[sym]
        elif (buf := _iday.get(sym)) and buf:
            open_prices[sym] = buf[0][1]

    # ── 3. Live extension: one point per minute after last historical bar ────────
    # Build {sym → {minute → latest_ltp}} in one pass — no step downsampling,
    # so every new HH:MM tick extends the X-axis as soon as it arrives.
    sym_minute_ltp: dict[str, dict[str, float]] = {}
    for sym in (s for syms in SECTOR_MAP.values() for s in syms):
        buf = _iday.get(sym, [])
        if not buf:
            continue
        m: dict[str, float] = {}
        for t, ltp in buf:
            if _t2m(t) > last_hist_min:
                m[t] = ltp          # last write wins → latest LTP for that minute
        if m:
            sym_minute_ltp[sym] = m

    # Collect sorted unique minutes that appear in any symbol's live data
    live_minutes: list[str] = sorted(
        {t for m in sym_minute_ltp.values() for t in m},
        key=_t2m,
    )

    live_ext: dict[str, list[dict]] = {}
    for t in live_minutes:
        for sector, syms in SECTOR_MAP.items():
            pt_rets = [
                (sym_minute_ltp[sym][t] - open_prices[sym]) / open_prices[sym] * 100
                for sym in syms
                if sym in sym_minute_ltp and t in sym_minute_ltp[sym] and sym in open_prices
            ]
            if pt_rets:
                live_ext.setdefault(sector, []).append({
                    "time":       t,
                    "return_pct": round(float(np.mean(pt_rets)), 3),
                })

    # ── 4. Stitch: historical bars + live extension ───────────────────────────
    result: dict[str, list[dict]] = {}
    for sector in set(list(hist_prog.keys()) + list(live_ext.keys())):
        result[sector] = hist_prog.get(sector, []) + live_ext.get(sector, [])

    return result


def _get_all_sectors_3min_progression(universe: str = "nifty500") -> dict[str, list[dict]]:
    """Fetch 15-min Kite bars for 2 rep symbols per sector, normalised to 0% at 9:15 AM.

    Result is cached per (universe, trade_date) so Kite is only hit once per day per universe.
    """
    trade_date = _last_trade_date_str()
    if _all_prog_trade_date.get(universe) == trade_date and _all_prog_cache.get(universe):
        return _all_prog_cache[universe]

    with _all_prog_lock:
        if _all_prog_trade_date.get(universe) == trade_date and _all_prog_cache.get(universe):
            return _all_prog_cache[universe]

        data = _fetch_all_sectors_3min(trade_date)
        _all_prog_cache[universe] = data
        _all_prog_trade_date[universe] = trade_date

    return _all_prog_cache[universe]


def _fetch_all_sectors_3min(trade_date: str) -> dict[str, list[dict]]:
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
                bars = kite.historical_data(tok, from_dt, to_dt, "3minute")
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
                bar_end = sym_bars[avail[0]][i]["date"] + timedelta(minutes=3)
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
        log.warning("_fetch_all_sectors_3min failed: %s", exc)
        return {}


def get_sector_progressions(universe: str = "nifty500") -> dict:
    """Return progression time-series for all sectors (live or 15-min Kite)."""
    sector_map = _SECTOR_MAPS.get(universe, _SECTOR_MAPS["nifty500"])
    trade_date = _last_trade_date_str()

    if _market_is_open():
        prog = _get_all_sectors_live_progression()
        source = "live" if prog else "none"
    else:
        prog = _get_all_sectors_3min_progression(universe)
        source = "3min_kite" if prog else "none"

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
def get_sector_scatter(universe: str = "nifty500") -> dict:
    sector_map = _SECTOR_MAPS.get(universe, _SECTOR_MAPS["nifty500"])
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
    for sector, syms in sector_map.items():
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
def _get_sector_3min_data(syms: list[str]) -> tuple[list[dict], dict[str, list[dict]], dict[str, list[float]]]:
    """Fetch last trading session's 15-min OHLCV from Kite for sector symbols.
    Returns (sector_avg_progression, stock_progressions, sparklines, sym_base).
    Cached per (sector-symbol-set, trade_date) — Kite called at most once per day per sector.
    """
    from datetime import timedelta

    sector_hash = hashlib.md5(",".join(sorted(syms)).encode()).hexdigest()[:12]

    # Determine today's trade date up-front (needed for cache key)
    ist_now   = datetime.utcnow() + timedelta(hours=5, minutes=30)
    _td       = ist_now.date()
    _mins_ist = ist_now.hour * 60 + ist_now.minute
    if _td.weekday() >= 5 or _mins_ist < 555:
        _td -= timedelta(days=1)
    while _td.weekday() >= 5:
        _td -= timedelta(days=1)
    trade_date_str = _td.isoformat()

    # Cache hit — return immediately without any Kite call
    cached = _sector_3min_cache.get(sector_hash)
    if cached and cached[0] == trade_date_str:
        return cached[1]

    with _sector_3min_lock:
        cached = _sector_3min_cache.get(sector_hash)
        if cached and cached[0] == trade_date_str:
            return cached[1]

        result = _fetch_sector_3min_data(syms, _td)
        _sector_3min_cache[sector_hash] = (trade_date_str, result)
        return result


def _fetch_sector_3min_data(syms: list[str], trade_date) -> tuple:
    """Inner: calls Kite in parallel (8 workers). Called at most once per sector per trade date."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
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
            return [], {}, {}, {}

        from_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 9, 0)
        to_dt   = datetime(trade_date.year, trade_date.month, trade_date.day, 15, 35)

        def _fetch_one(sym: str, token: int) -> tuple[str, list]:
            try:
                bars = kite.historical_data(token, from_dt, to_dt, "3minute")
                return sym, bars or []
            except Exception as exc:
                log.debug("15-min fetch failed for %s: %s", sym, exc)
                return sym, []

        all_bars: dict[str, list] = {}
        with ThreadPoolExecutor(max_workers=8) as pool:
            futs = {pool.submit(_fetch_one, sym, tok): sym for sym, tok in tokens.items()}
            for fut in as_completed(futs):
                sym, bars = fut.result()
                if bars:
                    all_bars[sym] = bars

        if not all_bars:
            return [], {}, {}, {}

        sym_base: dict[str, float] = {
            sym: float(bars[0]["open"])
            for sym, bars in all_bars.items()
            if bars and bars[0].get("open")
        }

        ref_sym  = max(all_bars, key=lambda s: len(all_bars[s]))
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
            bar_end = ref_bar["date"] + timedelta(minutes=3)
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
        return sector_progression, stock_progressions, sparklines, sym_base

    except Exception as exc:
        log.warning("15-min sector data failed: %s", exc)
        return [], {}, {}, {}


def _get_sector_3min_progression(syms: list[str]) -> list[dict]:
    prog, _, _, _ = _get_sector_3min_data(syms)
    return prog


def _get_stock_3min_sparkline(sym: str) -> list[float]:
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

        bars = kite.historical_data(token, from_dt, to_dt, "3minute")
        if not bars:
            return []

        # Anchor at open of first 9:15 bar then append each bar's close
        return [float(bars[0]["open"])] + [float(b["close"]) for b in bars]

    except Exception as exc:
        log.debug("_get_stock_3min_sparkline %s: %s", sym, exc)
        return []


# ── Layer 2 — Sector Drill-Down ───────────────────────────────────────────────
def get_sector_detail(sector_name: str, universe: str = "nifty500") -> dict | None:
    sector_map = _SECTOR_MAPS.get(universe, _SECTOR_MAPS["nifty500"])
    syms = sector_map.get(sector_name)
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

    # ── Hybrid progressions: Kite historical bars (9:15→last bar) + live _iday ──
    hist_sector_prog, hist_stock_prog, hist_sparklines, sym_base = _get_sector_3min_data(syms)

    ref_sym = next((s for s in syms if s in _iday), None)
    stock_progressions: dict[str, list[dict]] = {}
    progression: list[dict] = []
    progression_source = "live" if _market_is_open() else "3min_kite"

    if _market_is_open() and ref_sym:
        ref_buf = _iday.get(ref_sym, [])
        step_l  = max(1, len(ref_buf) // 78)

        # Sector avg progression: hist bars + live _iday extension (one point per minute)
        last_sec_min = _t2m(hist_sector_prog[-1]["time"]) if hist_sector_prog else _t2m("09:14")
        sec_minute_ltp: dict[str, dict[str, float]] = {}
        for sym in syms:
            buf = _iday.get(sym, [])
            if not buf:
                continue
            for t, ltp in buf:
                if _t2m(t) > last_sec_min:
                    sec_minute_ltp.setdefault(t, {})[sym] = ltp
        live_sec: list[dict] = []
        for t in sorted(sec_minute_ltp, key=_t2m):
            pt_rets = [
                (sec_minute_ltp[t][sym] - sym_base[sym]) / sym_base[sym] * 100
                for sym in syms
                if sym in sec_minute_ltp[t] and sym in sym_base
            ]
            if pt_rets:
                live_sec.append({
                    "time":          t,
                    "sector_return": round(float(np.mean(pt_rets)), 2),
                    "nifty_return":  nifty_ret,
                })
        progression = hist_sector_prog + live_sec

        # Per-stock progression: hist bars + live _iday extension (one point per minute)
        for sym in syms:
            hist_pts     = hist_stock_prog.get(sym, [])
            last_stk_min = _t2m(hist_pts[-1]["time"]) if hist_pts else _t2m("09:14")
            op           = sym_base.get(sym)
            buf          = _iday.get(sym, [])
            live_pts: list[dict] = []
            if buf and op:
                minute_ltp: dict[str, float] = {}
                for t, ltp in buf:
                    if _t2m(t) > last_stk_min:
                        minute_ltp[t] = ltp     # latest LTP per minute
                for t in sorted(minute_ltp, key=_t2m):
                    live_pts.append({
                        "time":       t,
                        "return_pct": round((minute_ltp[t] - op) / op * 100, 3),
                    })
            combined = hist_pts + live_pts
            if combined:
                stock_progressions[sym] = combined

    else:
        # Market closed: serve historical bars only
        progression       = hist_sector_prog
        stock_progressions = hist_stock_prog

    # Mini charts — 3-min Kite historical bars from 9:15 (already fetched above) +
    # latest _iday live tick appended so the sparkline is current to the second.
    # hist_sparklines covers from market open (9:15) regardless of when the server started.
    mini_charts = []
    for c in constituents:
        sym = c["symbol"]
        sparkline = list(hist_sparklines.get(sym, []))
        # Extend with live tick so the right-most point reflects the current price
        if _market_is_open():
            buf = _iday.get(sym, [])
            if buf:
                sparkline.append(float(buf[-1][1]))
        if not sparkline:
            # Final fallback: EOD closes (most-recent-first → reverse to chronological)
            raw = hist.get(sym, {}).get("closes_60d", [])
            sparkline = list(reversed(raw[:20]))
        mini_charts.append({
            "symbol":     sym,
            "return_pct": c["return_pct"],
            "ltp":        c["ltp"],
            "direction":  c["direction"],
            "sparkline":  sparkline,
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
    if _market_is_open():
        pc = float(q.get("prev_close") or h.get("prev_close") or ltp)
    else:
        pc = float(h.get("yesterday_close") or q.get("prev_close") or h.get("prev_close") or ltp)
    ret = round((ltp - pc) / pc * 100, 2) if pc else 0.0
    vwap = q.get("vwap")

    sma20  = _r(h.get("sma20"))
    sma50  = _r(h.get("sma50"))
    sma200 = _r(h.get("sma200"))

    # Universe rank
    sym_rets: dict[str, float] = {}
    for s, qq in all_live.items():
        hh = hist.get(s, {})
        if _market_is_open():
            pc_s = float(qq.get("prev_close") or hh.get("prev_close") or 0)
        else:
            pc_s = float(hh.get("yesterday_close") or qq.get("prev_close") or hh.get("prev_close") or 0)
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
        "sparkline_intraday": _ltps(symbol, max_pts=120) if _market_is_open() else _get_stock_3min_sparkline(symbol),
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


def get_breakthrough_signals(universe: str = "nifty500") -> dict:
    sector_map = _SECTOR_MAPS.get(universe, _SECTOR_MAPS["nifty500"])
    universe_syms = {s for syms in sector_map.values() for s in syms}
    hist = _get_hist()
    live, data_mode = _get_quotes(hist)
    if data_mode == "live":
        _push_intraday(live)

    signals: list[dict] = []
    seen_ids: set[str] = set()

    for sym, q in live.items():
        if sym not in universe_syms:
            continue
        h = hist.get(sym)
        if not h:
            continue

        ltp    = float(q["ltp"])
        if _market_is_open():
            pc = float(q.get("prev_close") or h.get("prev_close") or 0)
        else:
            pc = float(h.get("yesterday_close") or q.get("prev_close") or h.get("prev_close") or 0)
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
    sym_sql = ", ".join(f"'{s}'" for s in get_universe())
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


# ── NFO instrument cache ──────────────────────────────────────────────────────
# Maps (name, expiry_str, strike, opt_type) → (instrument_token, tradingsymbol)
_nfo_cache: dict[tuple[str, str, float, str], tuple[int, str]] = {}
_nfo_cache_date: str = ""
_nfo_lock = threading.Lock()


def _ensure_nfo_cache() -> None:
    """Load NFO instruments from Kite (once per calendar day)."""
    global _nfo_cache, _nfo_cache_date
    today = date.today().isoformat()
    if _nfo_cache_date == today and _nfo_cache:
        return
    with _nfo_lock:
        if _nfo_cache_date == today and _nfo_cache:
            return
        try:
            kite = get_kite()
            instruments = kite.instruments("NFO")
            cache: dict[tuple[str, str, float, str], tuple[int, str]] = {}
            for inst in instruments:
                k = (
                    str(inst["name"]).upper(),
                    str(inst["expiry"]),           # datetime.date → "YYYY-MM-DD"
                    float(inst.get("strike") or 0),
                    str(inst["instrument_type"]).upper(),
                )
                cache[k] = (int(inst["instrument_token"]), str(inst["tradingsymbol"]))
            _nfo_cache = cache
            _nfo_cache_date = today
            log.info("NFO instruments loaded: %d entries", len(cache))
        except Exception as exc:
            log.warning("NFO instrument fetch failed: %s", exc)


def _get_nfo_instrument(symbol: str, expiry: str, strike: float, opt_type: str) -> tuple[int, str] | None:
    """Return (instrument_token, tradingsymbol) for an NFO contract.

    opt_type: "CE", "PE", or "FUT" (strike=0 for futures).
    expiry:   "YYYY-MM-DD" string as stored in DuckDB options_chain.
    """
    _ensure_nfo_cache()
    key = (symbol.upper(), expiry[:10], float(strike), opt_type.upper())
    return _nfo_cache.get(key)


def get_strike_chart_data(symbol: str, strike: float, expiry: str) -> dict:
    """1-min price + OI bars for futures, CE, and PE of a given strike.

    Uses Kite historical_data() with oi=True. Covers today's session from 9:15.
    Result is cached per minute — at most 3 Kite calls per minute per strike.
    """
    from datetime import timedelta

    cache_key  = f"{symbol}:{strike}:{expiry}"
    minute_key = datetime.now().strftime("%H%M")

    cached = _strike_chart_cache.get(cache_key)
    if cached and cached[0] == minute_key:
        return cached[1]

    with _strike_chart_lock:
        cached = _strike_chart_cache.get(cache_key)
        if cached and cached[0] == minute_key:
            return cached[1]

        result = _fetch_strike_chart_data(symbol, strike, expiry)
        _strike_chart_cache[cache_key] = (minute_key, result)
        return result


def _fetch_strike_chart_data(symbol: str, strike: float, expiry: str) -> dict:
    """Inner: actually call Kite for strike chart data."""
    from datetime import timedelta

    empty: list = []
    null_result = {
        "symbol": symbol, "strike": strike, "expiry": expiry,
        "futures": empty, "ce": empty, "pe": empty,
        "futures_oi": empty, "ce_oi": empty, "pe_oi": empty,
        "futures_oi_now": 0, "ce_oi_now": 0, "pe_oi_now": 0,
    }

    try:
        kite = get_kite()

        ist_now    = datetime.utcnow() + timedelta(hours=5, minutes=30)
        trade_date = ist_now.date()
        mins_ist   = ist_now.hour * 60 + ist_now.minute
        if trade_date.weekday() >= 5 or mins_ist < 555:
            trade_date -= timedelta(days=1)
        while trade_date.weekday() >= 5:
            trade_date -= timedelta(days=1)

        from_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 9, 0)
        to_dt   = datetime(trade_date.year, trade_date.month, trade_date.day, 15, 35)

        def _fetch(token: int) -> tuple[list[dict], list[dict], int]:
            """Return (price_bars, oi_series, latest_oi)."""
            raw = kite.historical_data(token, from_dt, to_dt, "minute", oi=True)
            price_bars: list[dict] = []
            oi_series:  list[dict] = []
            for b in raw:
                dt_obj = b["date"]
                t = dt_obj.strftime("%H:%M") if hasattr(dt_obj, "strftime") else str(dt_obj)[11:16]
                price_bars.append({"time": t, "close": round(float(b["close"]), 2)})
                oi_val = int(b.get("oi") or 0)
                if oi_val > 0:
                    oi_series.append({"time": t, "oi": oi_val})
            return price_bars, oi_series, (oi_series[-1]["oi"] if oi_series else 0)

        result = dict(null_result)

        fut_inst = _get_nfo_instrument(symbol, expiry, 0, "FUT")
        if fut_inst:
            result["futures"], result["futures_oi"], result["futures_oi_now"] = _fetch(fut_inst[0])
        else:
            log.debug("No futures instrument for %s expiry=%s", symbol, expiry)

        ce_inst = _get_nfo_instrument(symbol, expiry, strike, "CE")
        if ce_inst:
            result["ce"], result["ce_oi"], result["ce_oi_now"] = _fetch(ce_inst[0])
        else:
            log.debug("No CE instrument for %s strike=%s expiry=%s", symbol, strike, expiry)

        pe_inst = _get_nfo_instrument(symbol, expiry, strike, "PE")
        if pe_inst:
            result["pe"], result["pe_oi"], result["pe_oi_now"] = _fetch(pe_inst[0])
        else:
            log.debug("No PE instrument for %s strike=%s expiry=%s", symbol, strike, expiry)

        return result

    except Exception as exc:
        log.warning("get_strike_chart_data %s %s %s: %s", symbol, strike, expiry, exc)
        return null_result


# ── NSE F&O lot sizes (display only — updated quarterly by NSE) ───────────────
_LOT_SIZES: dict[str, int] = {
    "NIFTY": 50, "BANKNIFTY": 15, "FINNIFTY": 40, "MIDCPNIFTY": 75,
    "RELIANCE": 250, "HDFCBANK": 550, "ICICIBANK": 700, "INFY": 400,
    "TCS": 150, "WIPRO": 3000, "HDFC": 300, "SBIN": 1500, "AXISBANK": 1200,
    "KOTAKBANK": 400, "BHARTIARTL": 500, "ITC": 3200, "HINDUNILVR": 300,
    "BAJFINANCE": 125, "BAJAJFINSV": 125, "MARUTI": 100, "TATAMOTORS": 2800,
    "TATASTEEL": 5500, "M&M": 700, "SUNPHARMA": 700, "ADANIPORTS": 1250,
    "ULTRACEMCO": 100, "NESTLEIND": 50, "LT": 300, "NTPC": 10500,
    "POWERGRID": 4700, "ONGC": 7700, "COALINDIA": 4200, "BPCL": 4500,
    "DIVISLAB": 150, "DRREDDY": 125, "CIPLA": 650, "EICHERMOT": 200,
    "HEROMOTOCO": 300, "GRASIM": 475, "BRITANNIA": 100, "INDUSINDBK": 500,
    "TITAN": 375, "TECHM": 600, "HCLTECH": 700, "JSWSTEEL": 2700,
    "TATACONSUM": 1000, "APOLLOHOSP": 125, "ASIANPAINT": 400, "ADANIENT": 625,
}


def _lot_size(symbol: str) -> int:
    return _LOT_SIZES.get(symbol.upper(), 1)


# ── Options chain for StockSessionDrawer ──────────────────────────────────────
def get_stock_options(symbol: str) -> dict:
    """Options chain for left-panel drawer — sourced from DuckDB options_chain parquet.

    Returns is_fo=False when symbol has no F&O data (equity-only stocks).
    Cached by options_service — no extra DuckDB cost.
    """
    from app.services.options_service import get_oi_analysis

    symbol = symbol.upper()
    oi = get_oi_analysis(symbol)

    if oi is None:
        return {"symbol": symbol, "is_fo": False}

    # ── Live spot from Kite LTP (overrides stale parquet spot during market hours) ──
    spot: float = oi.spot
    try:
        kite     = get_kite()
        ltp_resp = kite.ltp([f"NSE:{symbol}"])
        inst     = ltp_resp.get(f"NSE:{symbol}")
        if inst:
            spot = round(float(inst["last_price"]), 2)
    except Exception as exc:
        log.debug("get_stock_options live spot failed for %s: %s", symbol, exc)

    # Snap to the closest available strike to determine live ATM
    all_strikes_sorted = sorted(oi.strikes, key=lambda s: s.strike)
    if all_strikes_sorted:
        atm = min(all_strikes_sorted, key=lambda s: abs(s.strike - spot)).strike
    else:
        atm = oi.atm_strike

    atm_data = next((s for s in oi.strikes if s.strike == atm), None)
    straddle: float = 0.0
    if atm_data:
        straddle = round((atm_data.ce_ltp or 0) + (atm_data.pe_ltp or 0), 2)

    upper_be = round(spot + straddle, 2)
    lower_be = round(spot - straddle, 2)

    # Gamma wall = strike with highest total (CE + PE) OI
    gamma_wall: float | None = None
    if oi.strikes:
        gamma_wall = max(oi.strikes, key=lambda s: s.ce_oi + s.pe_oi).strike

    # Keep only 3 below live ATM + ATM + 3 above live ATM (7 rows total)
    atm_idx = next((i for i, s in enumerate(all_strikes_sorted) if s.strike == atm), None)
    if atm_idx is not None:
        lo = max(0, atm_idx - 3)
        hi = min(len(all_strikes_sorted), atm_idx + 4)
        visible_strikes = all_strikes_sorted[lo:hi]
    else:
        visible_strikes = all_strikes_sorted

    # Refresh CE/PE LTPs from Kite live quotes if market is open
    live_option_prices: dict[tuple[float, str], float] = {}
    if _market_is_open():
        try:
            kite = get_kite()
            # Build {tradingsymbol → (strike, opt_type)} so we can reverse-map the quote response
            tsym_map: dict[str, tuple[float, str]] = {}
            quote_keys: list[str] = []
            for s in visible_strikes:
                for opt in ("CE", "PE"):
                    inst = _get_nfo_instrument(symbol, oi.expiry, s.strike, opt)
                    if inst:
                        _, tsym = inst
                        qk = f"NFO:{tsym}"
                        quote_keys.append(qk)
                        tsym_map[qk] = (s.strike, opt)
            if quote_keys:
                q_resp = kite.quote(quote_keys)
                for qk, val in q_resp.items():
                    mapping = tsym_map.get(qk)
                    if mapping:
                        live_option_prices[mapping] = round(float(val["last_price"]), 2)
        except Exception as exc:
            log.debug("Live option price refresh failed for %s: %s", symbol, exc)

    strikes_out = []
    for s in visible_strikes:
        oi_total = s.ce_oi + s.pe_oi
        ce_ltp = live_option_prices.get((s.strike, "CE"), s.ce_ltp)
        pe_ltp = live_option_prices.get((s.strike, "PE"), s.pe_ltp)
        strikes_out.append({
            "strike":   s.strike,
            "is_atm":  s.strike == atm,
            "ce_ltp":  ce_ltp,
            "ce_iv":   s.ce_iv,
            "ce_oi":   s.ce_oi,
            "pe_ltp":  pe_ltp,
            "pe_iv":   s.pe_iv,
            "pe_oi":   s.pe_oi,
            "pcr":     s.pcr,
            "oi_total": oi_total,
        })

    return {
        "symbol":      symbol,
        "is_fo":       True,
        "strikes":     strikes_out,
        "straddle":    straddle,
        "upper_be":    upper_be,
        "lower_be":    lower_be,
        "lot_size":    _lot_size(symbol),
        "expiry":      oi.expiry,
        "spot":        spot,
        "atm_strike":  atm,
        "total_pcr":   oi.pcr if oi.pcr else None,
        "gamma_wall":  gamma_wall,
    }


# ── Kite WebSocket ticker (stub — polling fallback used until WS is implemented) ─
def start_ticker() -> None:
    """No-op stub. Intraday data is currently sourced via REST polling every 5s."""
    log.info("start_ticker: WebSocket not yet implemented — using REST polling fallback")


# ── Market breadth (StockSessionDrawer — advance/decline strip) ───────────────
def get_market_breadth() -> dict:
    """Advance/decline counts across the live universe, polled every 30 seconds.

    Primary source: _iday accumulator (latest LTP vs prev_close from DuckDB hist).
    Fallback: Kite quote() when accumulator is empty (cold-start / pre-market).
    """
    hist   = _get_hist()
    advances = declines = unchanged = 0

    with _iday_lock:
        iday_snapshot = {sym: buf[-1][1] for sym, buf in _iday.items() if buf}

    if iday_snapshot:
        for sym, ltp in iday_snapshot.items():
            h = hist.get(sym)
            if not h or not h.get("prev_close"):
                continue
            pc = float(h["prev_close"])
            if ltp > pc:
                advances += 1
            elif ltp < pc:
                declines += 1
            else:
                unchanged += 1
    else:
        # Kite quote fallback — only when accumulator is empty
        try:
            live, _ = _get_quotes(hist)
            for sym, q in live.items():
                h = hist.get(sym)
                if not h or not h.get("prev_close"):
                    continue
                ltp = float(q["ltp"])
                pc  = float(h["prev_close"])
                if ltp > pc:
                    advances += 1
                elif ltp < pc:
                    declines += 1
                else:
                    unchanged += 1
        except Exception:
            pass

    total = advances + declines + unchanged
    return {
        "advances":      advances,
        "declines":      declines,
        "unchanged":     unchanged,
        "adv_dec_ratio": round(advances / declines, 2) if declines > 0 else None,
        "total":         total,
    }


# ── Intraday chart data (StockSessionDrawer — left panel) ─────────────────────
def _get_intraday_kite_base(
    symbol: str, token: int, trade_date, avg_vol20: float
) -> tuple[list[dict], float | None, float | None]:
    """Fetch today's 1-min OHLCV from Kite; cached by (symbol, minute).
    Returns (bars, vwap, volume_ratio). Calls Kite at most once per minute per symbol.
    """
    from datetime import timedelta
    date_str   = trade_date.isoformat()
    minute_key = datetime.now().strftime("%H%M")

    cached = _intra_kite_cache.get(symbol)
    if cached and cached[0] == date_str and cached[1] == minute_key:
        return cached[2], cached[3], cached[4]

    with _intra_kite_lock:
        cached = _intra_kite_cache.get(symbol)
        if cached and cached[0] == date_str and cached[1] == minute_key:
            return cached[2], cached[3], cached[4]

        try:
            kite    = get_kite()
            from_dt = datetime(trade_date.year, trade_date.month, trade_date.day, 9, 0)
            to_dt   = datetime.now()
            raw     = kite.historical_data(token, from_dt, to_dt, "minute")

            bars: list[dict] = []
            total_vol = 0
            vwap_num  = 0.0
            for b in raw:
                dt_obj   = b["date"]
                time_str = dt_obj.strftime("%H:%M") if hasattr(dt_obj, "strftime") else str(dt_obj)[11:16]
                vol = int(b.get("volume", 0) or 0)
                o   = round(float(b["open"]),  2)
                hi  = round(float(b["high"]),  2)
                lo  = round(float(b["low"]),   2)
                c   = round(float(b["close"]), 2)
                bars.append({"time": time_str, "open": o, "high": hi, "low": lo, "close": c, "volume": vol})
                total_vol += vol
                vwap_num  += (hi + lo + c) / 3 * vol

            vwap      = round(vwap_num / total_vol, 2) if total_vol > 0 else None
            vol_ratio = round(total_vol / avg_vol20, 2) if avg_vol20 > 0 and total_vol > 0 else None
            _intra_kite_cache[symbol] = (date_str, minute_key, bars, vwap, vol_ratio)
            return bars, vwap, vol_ratio

        except Exception as exc:
            log.debug("_get_intraday_kite_base %s: %s", symbol, exc)
            if cached:
                return cached[2], cached[3], cached[4]
            return [], None, None


def get_stock_intraday(symbol: str) -> dict | None:
    """Live intraday chart data, polled every 5 seconds by the frontend.

    Always shows from 9:15 AM by stitching Kite 1-min historical (base, cached per
    minute) with _iday live ticks (current partial minute). Falls back to _iday-only
    or EOD if Kite is unavailable.
    """
    from collections import defaultdict
    from datetime import timedelta

    symbol = symbol.upper()

    hist = _get_hist()
    h = hist.get(symbol)
    if not h:
        return None

    prev_close = float(h["prev_close"]) if h.get("prev_close") else None
    prev_high  = float(h["prev_high"])  if h.get("prev_high")  else None
    prev_low   = float(h["prev_low"])   if h.get("prev_low")   else None
    avg_vol20  = float(h["avg_vol20"])  if h.get("avg_vol20")  else 0.0
    high_52w   = float(h["high_52w"])   if h.get("high_52w")   else None

    bars: list[dict] = []
    ltp:  float | None = None
    vwap: float | None = None
    volume_ratio: float | None = None
    source = "eod"
    today_str = date.today().isoformat()

    # ── Step 1: Resolve trade date & instrument token ─────────────────────────
    ist_now    = datetime.utcnow() + timedelta(hours=5, minutes=30)
    trade_date = ist_now.date()
    mins_ist   = ist_now.hour * 60 + ist_now.minute
    if trade_date.weekday() >= 5 or mins_ist < 555:
        trade_date -= timedelta(days=1)
    while trade_date.weekday() >= 5:
        trade_date -= timedelta(days=1)

    token: int | None = None
    try:
        kite     = get_kite()
        ltp_resp = kite.ltp([f"NSE:{symbol}"])
        inst     = ltp_resp.get(f"NSE:{symbol}")
        if inst:
            token = int(inst["instrument_token"])
            ltp   = round(float(inst["last_price"]), 2)
    except Exception as exc:
        log.debug("get_stock_intraday ltp failed for %s: %s", symbol, exc)

    # ── Step 2: During market hours push fresh quote into _iday accumulator ───
    if _market_is_open():
        try:
            kite   = get_kite()
            q_resp = kite.quote([f"NSE:{symbol}"])
            inst_q = q_resp.get(f"NSE:{symbol}")
            if inst_q:
                fresh_ltp = round(float(inst_q["last_price"]), 2)
                _push_intraday({symbol: {"ltp": fresh_ltp}})
                ltp = fresh_ltp
                vwap_raw = inst_q.get("average_price")
                if vwap_raw:
                    vwap = round(float(vwap_raw), 2)
                vol_today = int(inst_q.get("volume_traded") or 0)
                if vol_today > 0 and avg_vol20 > 0:
                    volume_ratio = round(vol_today / avg_vol20, 2)
                source = "live"
        except Exception as exc:
            log.debug("get_stock_intraday quote failed for %s: %s", symbol, exc)

    # ── Step 3: Kite 1-min historical base (always from 9:15, cached/minute) ──
    if token is not None:
        kite_bars, kite_vwap, kite_vol = _get_intraday_kite_base(symbol, token, trade_date, avg_vol20)
        if kite_bars:
            bars = [dict(b) for b in kite_bars]  # mutable copy
            if vwap is None:
                vwap = kite_vwap
            if volume_ratio is None:
                volume_ratio = kite_vol
            if source == "eod":
                source = "1min_kite"

            # ── Step 4: Extend with _iday live ticks for current partial minute ─
            with _iday_lock:
                iday_for_today = (_iday_date == today_str)
                iday_buf = list(_iday.get(symbol, []))

            if iday_buf and iday_for_today and bars:
                last_kite_min = bars[-1]["time"]
                live_by_min: dict[str, list[float]] = defaultdict(list)
                for t, price in iday_buf:
                    if t >= last_kite_min:
                        live_by_min[t].append(price)

                # Update last completed bar with same-minute live ticks
                same_prices = live_by_min.get(last_kite_min, [])
                if same_prices:
                    bars[-1]["close"] = same_prices[-1]
                    bars[-1]["high"]  = max(bars[-1]["high"], max(same_prices))
                    bars[-1]["low"]   = min(bars[-1]["low"],  min(same_prices))

                # Append newer minutes as new bars
                for t in sorted(t for t in live_by_min if t > last_kite_min):
                    prices = live_by_min[t]
                    bars.append({
                        "time":   t,
                        "open":   prices[0],
                        "high":   max(prices),
                        "low":    min(prices),
                        "close":  prices[-1],
                        "volume": 0,
                    })

    # ── Step 5: _iday-only fallback (Kite token lookup failed) ───────────────
    if not bars:
        with _iday_lock:
            iday_for_today = (_iday_date == today_str)
            iday_buf = list(_iday.get(symbol, []))

        if iday_buf and iday_for_today:
            by_minute: dict[str, list[float]] = defaultdict(list)
            for t, price in iday_buf:
                by_minute[t].append(price)
            for t in sorted(by_minute.keys()):
                prices = by_minute[t]
                bars.append({"time": t, "open": prices[0], "high": max(prices),
                             "low": min(prices), "close": prices[-1], "volume": 0})
            if ltp is None:
                ltp = iday_buf[-1][1]
            source = "live"
        else:
            ltp = prev_close  # final EOD fallback

    pct_52w_high = None
    if ltp and high_52w and high_52w > 0:
        pct_52w_high = round((ltp - high_52w) / high_52w * 100, 2)

    return {
        "symbol":       symbol,
        "bars":         bars,
        "ltp":          ltp,
        "source":       source,
        "vwap":         vwap,
        "prev_high":    prev_high,
        "prev_low":     prev_low,
        "prev_close":   prev_close,
        "volume_ratio": volume_ratio,
        "pct_52w_high": pct_52w_high,
    }
