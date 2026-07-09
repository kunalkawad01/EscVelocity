"""Sector Heatmap service — computes per-sector, per-stock returns across 7 timeframes.

Data source: equities_prices DuckDB view (hive-partitioned parquet).
All computation is pure NumPy after a single bulk DuckDB fetch per request.
Results are cached in-process by (universe, date_str) — refreshes once per day.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta
from typing import Any

import numpy as np

from app.services.duckdb_client import get_connection
from app.services.kite_client import get_kite
from app.models.heatmap import (
    SectorHeatmapResponse, SectorHeatmapEntry, StockHeatmapEntry, Week52,
)

log = logging.getLogger(__name__)

TFS = ["1d", "5d", "1m", "3m", "6m", "1y", "2y"]

# Bars needed for the return calculation (how far back to look)
TF_RETURN_BARS: dict[str, int] = {
    "1d": 2, "5d": 5, "1m": 22, "3m": 66, "6m": 130, "1y": 252, "2y": 504,
}

# Bars to include in the sparkline series (>=5 for visual interest on 1D)
TF_SERIES_BARS: dict[str, int] = {
    "1d": 5, "5d": 5, "1m": 22, "3m": 66, "6m": 130, "1y": 252, "2y": 504,
}

# Target points after downsampling
TF_POINTS: dict[str, int] = {
    "1d": 5, "5d": 5, "1m": 22, "3m": 40, "6m": 60, "1y": 90, "2y": 140,
}

MOMENTUM_WEIGHTS: dict[str, float] = {
    "1d": 0.05, "5d": 0.08, "1m": 0.12,
    "3m": 0.15, "6m": 0.18, "1y": 0.20, "2y": 0.22,
}


# ─── Kite 1-min sparkline helpers ─────────────────────────────────────────────

def _trade_date_str() -> str:
    """Last completed NSE trading day as YYYY-MM-DD (IST-aware)."""
    ist_now = datetime.utcnow() + timedelta(hours=5, minutes=30)
    d = ist_now.date()
    mins = ist_now.hour * 60 + ist_now.minute
    if d.weekday() >= 5 or mins < 555:   # before 9:15 or weekend
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def _1min_slot() -> str:
    """Current IST time floored to nearest 1 minute — used as sparkline cache key."""
    ist_now = datetime.utcnow() + timedelta(hours=5, minutes=30)
    mins = ist_now.hour * 60 + ist_now.minute
    return f"{mins // 60:02d}:{mins % 60:02d}"


def _fetch_1min_closes(symbols: list[str]) -> dict[str, list[float]]:
    """Fetch today's 1-min Kite bars for all symbols sequentially.

    Returns {symbol: [open_of_first_bar, close_bar1, close_bar2, ...]} so the
    sparkline anchors at the 9:15 open and traces each bar's close.
    Sequential to respect Kite's 3 req/sec historical-data rate limit and avoid
    race conditions on the shared KiteConnect session.
    Falls back to {} on any Kite error so callers degrade gracefully.
    """
    try:
        kite = get_kite()

        # Single ltp() call to resolve all instrument tokens at once
        ltp_resp = kite.ltp([f"NSE:{s}" for s in symbols])
        tokens: dict[str, int] = {
            k.replace("NSE:", ""): int(v["instrument_token"])
            for k, v in ltp_resp.items()
        }
        if not tokens:
            log.warning("_fetch_1min_closes: ltp() returned no tokens for %d symbols", len(symbols))
            return {}

        trade_date_s = _trade_date_str()
        y, mo, d = (int(x) for x in trade_date_s.split("-"))
        from_dt = datetime(y, mo, d, 9, 0)
        to_dt   = datetime(y, mo, d, 15, 35)

        result: dict[str, list[float]] = {}
        missing: list[str] = []
        for sym in symbols:
            tok = tokens.get(sym)
            if not tok:
                missing.append(sym)
                continue
            try:
                bars = kite.historical_data(tok, from_dt, to_dt, "minute")
                if bars:
                    result[sym] = [float(bars[0]["open"])] + [float(b["close"]) for b in bars]
                else:
                    log.warning("1min empty bars: %s", sym)
            except Exception as exc:
                log.warning("1min fetch failed: %s — %s", sym, exc)

        if missing:
            log.warning("1min: no token from ltp() for %d symbols: %s", len(missing), missing[:10])
        log.info("sector-heatmap 1min sparklines: %d/%d symbols, trade_date=%s",
                 len(result), len(symbols), trade_date_s)
        return result

    except Exception as exc:
        log.warning("_fetch_1min_closes failed: %s", exc)
        return {}


# ─── Universe map ─────────────────────────────────────────────────────────────

_S = True  # isFnO=True shorthand
_N = False

_N50: dict[str, dict[str, Any]] = {
    "Banking & Finance": {
        "color": "#378ADD",
        "stocks": [
            {"symbol": "HDFCBANK",  "name": "HDFC Bank",           "isFnO": _S},
            {"symbol": "ICICIBANK", "name": "ICICI Bank",           "isFnO": _S},
            {"symbol": "KOTAKBANK", "name": "Kotak Mahindra Bank",  "isFnO": _S},
            {"symbol": "AXISBANK",  "name": "Axis Bank",            "isFnO": _S},
        ],
    },
    "Information Tech": {
        "color": "#1D9E75",
        "stocks": [
            {"symbol": "TCS",     "name": "Tata Consultancy Services", "isFnO": _S},
            {"symbol": "INFY",    "name": "Infosys",                   "isFnO": _S},
            {"symbol": "HCLTECH", "name": "HCL Technologies",          "isFnO": _S},
            {"symbol": "WIPRO",   "name": "Wipro",                     "isFnO": _S},
        ],
    },
    "Pharma & Health": {
        "color": "#7F77DD",
        "stocks": [
            {"symbol": "SUNPHARMA", "name": "Sun Pharmaceutical",      "isFnO": _S},
            {"symbol": "CIPLA",     "name": "Cipla",                   "isFnO": _S},
            {"symbol": "DRREDDY",   "name": "Dr Reddy's Laboratories", "isFnO": _S},
        ],
    },
    "FMCG": {
        "color": "#D85A30",
        "stocks": [
            {"symbol": "HINDUNILVR", "name": "Hindustan Unilever", "isFnO": _S},
            {"symbol": "ITC",        "name": "ITC",                "isFnO": _S},
            {"symbol": "NESTLEIND",  "name": "Nestle India",       "isFnO": _S},
        ],
    },
    "Auto & Ancillaries": {
        "color": "#BA7517",
        "stocks": [
            {"symbol": "MARUTI",     "name": "Maruti Suzuki",       "isFnO": _S},
            {"symbol": "TATAMOTORS", "name": "Tata Motors",         "isFnO": _S},
            {"symbol": "M&M",        "name": "Mahindra & Mahindra", "isFnO": _S},
            {"symbol": "BAJAJ-AUTO", "name": "Bajaj Auto",          "isFnO": _S},
        ],
    },
    "Metals & Mining": {
        "color": "#D4537E",
        "stocks": [
            {"symbol": "TATASTEEL", "name": "Tata Steel",          "isFnO": _S},
            {"symbol": "JSWSTEEL",  "name": "JSW Steel",           "isFnO": _S},
            {"symbol": "HINDALCO",  "name": "Hindalco Industries", "isFnO": _S},
        ],
    },
    "Energy & Oil": {
        "color": "#888780",
        "stocks": [
            {"symbol": "RELIANCE",  "name": "Reliance Industries",    "isFnO": _S},
            {"symbol": "ONGC",      "name": "Oil & Natural Gas Corp", "isFnO": _S},
            {"symbol": "POWERGRID", "name": "Power Grid Corporation", "isFnO": _S},
        ],
    },
    "Capital Goods": {
        "color": "#639922",
        "stocks": [
            {"symbol": "LT",      "name": "Larsen & Toubro", "isFnO": _S},
            {"symbol": "SIEMENS", "name": "Siemens",         "isFnO": _S},
        ],
    },
}

_N200_ADDS: dict[str, dict[str, Any]] = {
    "Banking & Finance": {
        "color": "#378ADD",
        "stocks": [
            {"symbol": "SBIN",       "name": "State Bank of India", "isFnO": _S},
            {"symbol": "INDUSINDBK", "name": "IndusInd Bank",       "isFnO": _S},
            {"symbol": "BANKBARODA", "name": "Bank of Baroda",      "isFnO": _S},
        ],
    },
    "Information Tech": {
        "color": "#1D9E75",
        "stocks": [
            {"symbol": "TECHM",      "name": "Tech Mahindra",      "isFnO": _S},
            {"symbol": "MPHASIS",    "name": "Mphasis",            "isFnO": _S},
            {"symbol": "PERSISTENT", "name": "Persistent Systems", "isFnO": _S},
        ],
    },
    "Pharma & Health": {
        "color": "#7F77DD",
        "stocks": [
            {"symbol": "DIVISLAB",   "name": "Divi's Laboratories", "isFnO": _S},
            {"symbol": "AUROPHARMA", "name": "Aurobindo Pharma",    "isFnO": _S},
            {"symbol": "BIOCON",     "name": "Biocon",              "isFnO": _S},
        ],
    },
    "FMCG": {
        "color": "#D85A30",
        "stocks": [
            {"symbol": "BRITANNIA", "name": "Britannia Industries", "isFnO": _S},
            {"symbol": "DABUR",     "name": "Dabur India",         "isFnO": _S},
            {"symbol": "MARICO",    "name": "Marico",              "isFnO": _S},
        ],
    },
    "Auto & Ancillaries": {
        "color": "#BA7517",
        "stocks": [
            {"symbol": "HEROMOTOCO", "name": "Hero MotoCorp",         "isFnO": _S},
            {"symbol": "EICHERMOT",  "name": "Eicher Motors",         "isFnO": _S},
            {"symbol": "BALKRISIND", "name": "Balkrishna Industries", "isFnO": _S},
            {"symbol": "MOTHERSON",  "name": "Samvardhana Motherson", "isFnO": _S},
        ],
    },
    "Metals & Mining": {
        "color": "#D4537E",
        "stocks": [
            {"symbol": "COALINDIA", "name": "Coal India",               "isFnO": _S},
            {"symbol": "SAIL",      "name": "Steel Authority of India", "isFnO": _S},
            {"symbol": "NMDC",      "name": "NMDC",                     "isFnO": _S},
        ],
    },
    "Energy & Oil": {
        "color": "#888780",
        "stocks": [
            {"symbol": "BPCL", "name": "Bharat Petroleum",      "isFnO": _S},
            {"symbol": "IOC",  "name": "Indian Oil Corporation", "isFnO": _S},
            {"symbol": "GAIL", "name": "GAIL India",             "isFnO": _S},
        ],
    },
    "Capital Goods": {
        "color": "#639922",
        "stocks": [
            {"symbol": "ABB",        "name": "ABB India",                "isFnO": _S},
            {"symbol": "BHEL",       "name": "Bharat Heavy Electricals", "isFnO": _S},
            {"symbol": "CUMMINSIND", "name": "Cummins India",            "isFnO": _S},
        ],
    },
    "Telecom": {
        "color": "#5DCAA5",
        "stocks": [
            {"symbol": "BHARTIARTL", "name": "Bharti Airtel", "isFnO": _S},
            {"symbol": "IDEA",       "name": "Vodafone Idea", "isFnO": _N},
        ],
    },
    "Real Estate": {
        "color": "#F0997B",
        "stocks": [
            {"symbol": "DLF",        "name": "DLF",                "isFnO": _S},
            {"symbol": "GODREJPROP", "name": "Godrej Properties",  "isFnO": _S},
            {"symbol": "OBEROIRLTY", "name": "Oberoi Realty",      "isFnO": _S},
        ],
    },
    "Consumer Durables": {
        "color": "#D4537E",
        "stocks": [
            {"symbol": "TITAN",    "name": "Titan Company",             "isFnO": _S},
            {"symbol": "HAVELLS",  "name": "Havells India",             "isFnO": _S},
            {"symbol": "VOLTAS",   "name": "Voltas",                    "isFnO": _S},
            {"symbol": "CROMPTON", "name": "Crompton Greaves Consumer", "isFnO": _S},
        ],
    },
}

_N500_ADDS: dict[str, dict[str, Any]] = {
    "Banking & Finance": {
        "color": "#378ADD",
        "stocks": [
            {"symbol": "IDFCFIRSTB", "name": "IDFC First Bank",      "isFnO": _S},
            {"symbol": "FEDERALBNK", "name": "Federal Bank",         "isFnO": _S},
            {"symbol": "RBLBANK",    "name": "RBL Bank",             "isFnO": _S},
            {"symbol": "CANBK",      "name": "Canara Bank",          "isFnO": _S},
            {"symbol": "PNB",        "name": "Punjab National Bank", "isFnO": _S},
        ],
    },
    "Information Tech": {
        "color": "#1D9E75",
        "stocks": [
            {"symbol": "LTIM",     "name": "LTIMindtree",               "isFnO": _S},
            {"symbol": "COFORGE",  "name": "Coforge",                   "isFnO": _S},
            {"symbol": "KPITTECH", "name": "KPIT Technologies",         "isFnO": _S},
            {"symbol": "OFSS",     "name": "Oracle Financial Services", "isFnO": _N},
            {"symbol": "MASTEK",   "name": "Mastek",                    "isFnO": _N},
        ],
    },
    "Pharma & Health": {
        "color": "#7F77DD",
        "stocks": [
            {"symbol": "TORNTPHARM", "name": "Torrent Pharmaceuticals",  "isFnO": _S},
            {"symbol": "ALKEM",      "name": "Alkem Laboratories",       "isFnO": _S},
            {"symbol": "LUPIN",      "name": "Lupin",                    "isFnO": _S},
            {"symbol": "GLENMARK",   "name": "Glenmark Pharmaceuticals", "isFnO": _S},
            {"symbol": "IPCALAB",    "name": "IPCA Laboratories",        "isFnO": _S},
        ],
    },
    "Chemicals": {
        "color": "#AFA9EC",
        "stocks": [
            {"symbol": "PIDILITIND", "name": "Pidilite Industries", "isFnO": _S},
            {"symbol": "SRF",        "name": "SRF",                 "isFnO": _S},
            {"symbol": "DEEPAKNTR",  "name": "Deepak Nitrite",      "isFnO": _S},
            {"symbol": "AARTIIND",   "name": "Aarti Industries",    "isFnO": _S},
            {"symbol": "NAVINFLUOR", "name": "Navin Fluorine",      "isFnO": _S},
        ],
    },
    "Logistics & Transport": {
        "color": "#97C459",
        "stocks": [
            {"symbol": "IRCTC",    "name": "Indian Railway Catering", "isFnO": _S},
            {"symbol": "BLUEDART", "name": "Blue Dart Express",       "isFnO": _N},
            {"symbol": "CONCOR",   "name": "Container Corporation",   "isFnO": _S},
            {"symbol": "MAHLOG",   "name": "Mahindra Logistics",      "isFnO": _N},
        ],
    },
    "Media & Entertainment": {
        "color": "#FAC775",
        "stocks": [
            {"symbol": "ZEEL",    "name": "Zee Entertainment", "isFnO": _S},
            {"symbol": "PVRINOX", "name": "PVR Inox",          "isFnO": _S},
            {"symbol": "SUNTV",   "name": "Sun TV Network",    "isFnO": _S},
        ],
    },
    "Agriculture & Food": {
        "color": "#9FE1CB",
        "stocks": [
            {"symbol": "UBL",        "name": "United Breweries", "isFnO": _S},
            {"symbol": "MCDOWELL-N", "name": "United Spirits",   "isFnO": _S},
            {"symbol": "KRBL",       "name": "KRBL",             "isFnO": _N},
            {"symbol": "AVANTIFEED", "name": "Avanti Feeds",     "isFnO": _N},
        ],
    },
    "Textiles": {
        "color": "#B4B2A9",
        "stocks": [
            {"symbol": "PAGEIND", "name": "Page Industries", "isFnO": _S},
            {"symbol": "RAYMOND", "name": "Raymond",         "isFnO": _S},
            {"symbol": "TRIDENT", "name": "Trident",         "isFnO": _N},
        ],
    },
}


def _build_sector_list(universe: str) -> list[dict[str, Any]]:
    """Merge universe layers and return a flat list of sector dicts."""
    merged: dict[str, dict[str, Any]] = {}

    def _merge(source: dict[str, dict[str, Any]]) -> None:
        for sname, sdata in source.items():
            if sname not in merged:
                merged[sname] = {"name": sname, "color": sdata["color"], "stocks": []}
            merged[sname]["stocks"].extend(sdata["stocks"])

    if universe in ("nifty50", "fno"):
        _merge(_N50)
    elif universe == "nifty200":
        _merge(_N50)
        _merge(_N200_ADDS)
    else:
        _merge(_N50)
        _merge(_N200_ADDS)
        _merge(_N500_ADDS)

    result = list(merged.values())

    if universe == "fno":
        for sec in result:
            sec["stocks"] = [s for s in sec["stocks"] if s["isFnO"]]
        result = [s for s in result if s["stocks"]]

    return result


# ─── DuckDB helpers ────────────────────────────────────────────────────────────

def _fetch_closes_bulk(symbols: list[str]) -> dict[str, list[float]]:
    """Bulk-fetch all daily closes for the given symbols, sorted oldest-first."""
    if not symbols:
        return {}
    cursor = get_connection()
    placeholders = ",".join(["?" for _ in symbols])
    rows = cursor.execute(
        f"""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, close
        FROM equities_prices
        WHERE symbol IN ({placeholders})
        ORDER BY symbol, d
        """,
        symbols,
    ).fetchall()

    result: dict[str, list[float]] = {}
    for sym, _d, close in rows:
        result.setdefault(sym, []).append(float(close))
    return result


# ─── Computation helpers ───────────────────────────────────────────────────────

def _downsample(arr: list[float], n: int) -> list[float]:
    if len(arr) <= n:
        return arr
    idx = np.round(np.linspace(0, len(arr) - 1, n)).astype(int)
    return [arr[i] for i in idx]


def _pct_return(closes: list[float], n_bars: int) -> float:
    """Return from n_bars ago to today (%)."""
    if len(closes) < 2:
        return 0.0
    window = closes[-n_bars:] if len(closes) >= n_bars else closes
    first = window[0]
    if first == 0:
        return 0.0
    return round((window[-1] - first) / first * 100, 2)


def _series_for_tf(closes: list[float], tf: str) -> list[float]:
    n_series = TF_SERIES_BARS[tf]
    n_pts = TF_POINTS[tf]
    window = closes[-n_series:] if len(closes) >= n_series else closes
    return _downsample(window, n_pts)


def _momentum_score(returns: dict[str, float]) -> float:
    return round(sum(MOMENTUM_WEIGHTS[tf] * returns.get(tf, 0.0) for tf in TFS), 2)


# ─── Core builders ─────────────────────────────────────────────────────────────

def _build_stock(
    stock_def: dict[str, Any],
    closes: list[float],
    nifty_rets: dict[str, float],
    sparklines_1d: dict[str, list[float]] | None = None,
) -> StockHeatmapEntry:
    stock_rets = {tf: _pct_return(closes, TF_RETURN_BARS[tf]) for tf in TFS}
    stock_series = {tf: _series_for_tf(closes, tf) for tf in TFS}

    # Override 1D series + return with live Kite 1-min bars if available.
    # closes[-1] is yesterday's daily close during market hours (today's row
    # doesn't land in the daily parquet until EOD ingestion), so the plain
    # close-to-close _pct_return would be stale by a day. Kite's intraday
    # series is [today_open, bar1_close, bar2_close, ...] — use today's open
    # as the 1D baseline so the number matches live session performance.
    kite_1d = (sparklines_1d or {}).get(stock_def["symbol"])
    if kite_1d:
        stock_series["1d"] = kite_1d
        today_open = kite_1d[0]
        if today_open:
            stock_rets["1d"] = round((kite_1d[-1] - today_open) / today_open * 100, 2)

    last_252 = closes[-252:] if len(closes) >= 252 else closes
    if last_252:
        week52 = Week52(
            low=round(float(np.min(last_252)), 2),
            high=round(float(np.max(last_252)), 2),
            current=round(closes[-1], 2) if closes else 0.0,
        )
    else:
        week52 = Week52(low=0.0, high=0.0, current=0.0)

    rs_1m = round(stock_rets.get("1m", 0.0) - nifty_rets.get("1m", 0.0), 2)

    return StockHeatmapEntry(
        symbol=stock_def["symbol"],
        name=stock_def["name"],
        is_fno=stock_def["isFnO"],
        returns=stock_rets,
        series=stock_series,
        week52=week52,
        rs_vs_nifty={"1m": rs_1m},
    )


def _build_sector(
    sec_def: dict[str, Any],
    closes_map: dict[str, list[float]],
    nifty_rets: dict[str, float],
    sparklines_1d: dict[str, list[float]] | None = None,
) -> SectorHeatmapEntry:
    stocks_out: list[StockHeatmapEntry] = []
    all_stock_rets: list[dict[str, float]] = []

    for stock_def in sec_def["stocks"]:
        closes = closes_map.get(stock_def["symbol"], [])
        stock = _build_stock(stock_def, closes, nifty_rets, sparklines_1d)
        stocks_out.append(stock)
        all_stock_rets.append(stock.returns)

    # Sector returns = equal-weight avg of stocks
    sec_rets: dict[str, float] = {}
    for tf in TFS:
        vals = [r[tf] for r in all_stock_rets]
        sec_rets[tf] = round(float(np.mean(vals)), 2) if vals else 0.0

    # Breadth = fraction of stocks positive on that timeframe
    breadth: dict[str, float] = {}
    for tf in ("1d", "1m"):
        pos = sum(1 for r in all_stock_rets if r.get(tf, 0.0) > 0)
        breadth[tf] = round(pos / max(len(all_stock_rets), 1), 2)

    # Sector sparkline series = point-wise mean of index-100-normalised stock series
    sec_series: dict[str, list[float]] = {}
    for tf in TFS:
        norm_list: list[list[float]] = []
        for stock in stocks_out:
            s = stock.series[tf]
            if s and s[0]:
                norm_list.append([round(v / s[0] * 100, 4) for v in s])
        if norm_list:
            min_len = min(len(s) for s in norm_list)
            sec_series[tf] = [
                round(float(np.mean([s[i] for s in norm_list])), 4)
                for i in range(min_len)
            ]
        else:
            sec_series[tf] = []

    return SectorHeatmapEntry(
        name=sec_def["name"],
        color=sec_def["color"],
        momentum_score=_momentum_score(sec_rets),
        breadth=breadth,
        returns=sec_rets,
        series=sec_series,
        stocks=stocks_out,
    )


# ─── Cache + public API ────────────────────────────────────────────────────────

_cache: dict[str, SectorHeatmapResponse] = {}
_lock = threading.Lock()


def _compute(universe: str) -> SectorHeatmapResponse:
    sectors_def = _build_sector_list(universe)

    all_symbols: list[str] = list({
        s["symbol"] for sec in sectors_def for s in sec["stocks"]
    })

    # Add N50 symbols for Nifty proxy (needed even in filtered universes)
    n50_symbols: list[str] = list({
        s["symbol"] for sec in _build_sector_list("nifty50") for s in sec["stocks"]
    })
    fetch_symbols = list(set(all_symbols) | set(n50_symbols))

    log.info("sector-heatmap: fetching %d symbols for universe=%s", len(fetch_symbols), universe)
    closes_map = _fetch_closes_bulk(fetch_symbols)

    # Nifty proxy = equal-weight avg daily return across N50 symbols
    nifty_rets: dict[str, float] = {}
    for tf in TFS:
        vals = [_pct_return(closes_map.get(sym, []), TF_RETURN_BARS[tf]) for sym in n50_symbols]
        nifty_rets[tf] = round(float(np.mean(vals)), 2) if vals else 0.0

    # 1D sparklines from Kite 1-min bars (falls back to {} if Kite unavailable)
    sparklines_1d = _fetch_1min_closes(all_symbols)

    sectors_out = [_build_sector(sec, closes_map, nifty_rets, sparklines_1d) for sec in sectors_def]

    return SectorHeatmapResponse(
        universe=universe,
        as_of=datetime.now().isoformat(),
        nifty_returns=nifty_rets,
        sectors=sectors_out,
    )


def get_heatmap(universe: str = "nifty500") -> SectorHeatmapResponse:
    today = datetime.now().strftime("%Y-%m-%d")
    cache_key = f"{universe}:{today}:{_1min_slot()}"

    cached = _cache.get(cache_key)
    if cached:
        return cached

    with _lock:
        cached = _cache.get(cache_key)
        if cached:
            return cached
        result = _compute(universe)
        # Evict stale keys for this universe before storing
        for k in list(_cache.keys()):
            if k.startswith(f"{universe}:"):
                del _cache[k]
        _cache[cache_key] = result
        return result


def invalidate(universe: str | None = None) -> None:
    with _lock:
        if universe:
            for k in list(_cache.keys()):
                if k.startswith(f"{universe}:"):
                    del _cache[k]
        else:
            _cache.clear()
