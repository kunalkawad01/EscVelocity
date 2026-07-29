"""Research Copilot — deterministic tool implementations (Phase 1).

Every tool here is pure computation over the DuckDB `equities_prices` view.
The LLM never computes; it calls these. All results are deterministic and
cached by (tool, canonical-input, data_version) so identical inputs return
identical bytes — the reproducibility contract in RESEARCH_COPILOT_SPEC.md §6.

No FastAPI imports, no HTTP logic (service purity rule from CLAUDE.md).
"""
from __future__ import annotations

import functools
import hashlib
import json
import math
from typing import Any, Optional

import numpy as np

from app.services.duckdb_client import get_connection

try:  # TA-Lib is in requirements; fall back to pure-numpy for core indicators.
    import talib  # type: ignore
    _HAS_TALIB = True
except Exception:  # pragma: no cover
    _HAS_TALIB = False

# ── Universe helpers ──────────────────────────────────────────────────────────

# A pragmatic NIFTY-50 proxy list (subset used elsewhere in the codebase as the
# equal-weighted benchmark). Universe is otherwise pulled live from DuckDB.
_NIFTY50 = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "HINDUNILVR", "ITC",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE", "ASIANPAINT",
    "MARUTI", "HCLTECH", "SUNPHARMA", "TITAN", "ULTRACEMCO", "WIPRO", "NESTLEIND",
    "ONGC", "NTPC", "POWERGRID", "TATAMOTORS", "TATASTEEL", "M&M", "TECHM",
    "ADANIENT", "ADANIPORTS", "COALINDIA", "BAJAJFINSV", "GRASIM", "HDFCLIFE",
    "SBILIFE", "DRREDDY", "CIPLA", "BRITANNIA", "EICHERMOT", "HEROMOTOCO",
    "DIVISLAB", "BPCL", "HINDALCO", "JSWSTEEL", "TATACONSUM", "APOLLOHOSP",
    "BAJAJ-AUTO", "INDUSINDBK", "UPL", "LTIM",
]


def data_version() -> str:
    """Short hash of the current data snapshot (row count + latest bar).

    Cheap fingerprint that changes whenever ingestion adds a bar, so cache keys
    invalidate automatically once per day. Used as the manifest data_version.
    """
    con = get_connection()
    row = con.execute(
        "SELECT COUNT(*), MAX(CAST(date AS DATE)) FROM equities_prices"
    ).fetchone()
    return hashlib.sha256(f"{row[0]}|{row[1]}".encode()).hexdigest()[:16]


# ── Deterministic cache ───────────────────────────────────────────────────────

_cache: dict[str, Any] = {}


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, default=str)


def _cache_key(tool: str, payload: dict[str, Any]) -> str:
    return f"{tool}|{_canonical(payload)}|{data_version()}"


def invalidate() -> None:
    _cache.clear()


def _hash_result(result: Any) -> str:
    return hashlib.sha256(_canonical(result).encode()).hexdigest()[:16]


# ── Indicator primitives (numpy; TA-Lib when available) ───────────────────────

def _sma(c: np.ndarray, n: int) -> np.ndarray:
    if _HAS_TALIB:
        return talib.SMA(c, timeperiod=n)
    out = np.full_like(c, np.nan, dtype=float)
    if len(c) >= n:
        csum = np.cumsum(np.insert(c, 0, 0.0))
        out[n - 1:] = (csum[n:] - csum[:-n]) / n
    return out


def _ema(c: np.ndarray, n: int) -> np.ndarray:
    if _HAS_TALIB:
        return talib.EMA(c, timeperiod=n)
    out = np.full_like(c, np.nan, dtype=float)
    if len(c) < n:
        return out
    k = 2.0 / (n + 1.0)
    out[n - 1] = c[:n].mean()
    for i in range(n, len(c)):
        out[i] = c[i] * k + out[i - 1] * (1 - k)
    return out


def _wilder(vals: np.ndarray, n: int) -> np.ndarray:
    """Wilder's smoothing (RMA) — used by RSI/ATR when TA-Lib is absent."""
    out = np.full_like(vals, np.nan, dtype=float)
    if len(vals) < n:
        return out
    out[n - 1] = np.nanmean(vals[:n])
    for i in range(n, len(vals)):
        out[i] = (out[i - 1] * (n - 1) + vals[i]) / n
    return out


def _rsi(c: np.ndarray, n: int = 14) -> np.ndarray:
    if _HAS_TALIB:
        return talib.RSI(c, timeperiod=n)
    delta = np.diff(c, prepend=c[0])
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = _wilder(gain, n)
    avg_loss = _wilder(loss, n)
    rs = np.divide(avg_gain, avg_loss, out=np.full_like(c, np.nan), where=avg_loss != 0)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    rsi[avg_loss == 0] = 100.0
    return rsi


def _atr(h: np.ndarray, l: np.ndarray, c: np.ndarray, n: int = 14) -> np.ndarray:
    if _HAS_TALIB:
        return talib.ATR(h, l, c, timeperiod=n)
    prev_c = np.roll(c, 1)
    prev_c[0] = c[0]
    tr = np.maximum.reduce([h - l, np.abs(h - prev_c), np.abs(l - prev_c)])
    return _wilder(tr, n)


def _daily_returns(c: np.ndarray) -> np.ndarray:
    r = np.full_like(c, np.nan, dtype=float)
    r[1:] = c[1:] / c[:-1] - 1.0
    return r


def _last_valid(a: np.ndarray) -> Optional[float]:
    idx = np.where(~np.isnan(a))[0]
    if len(idx) == 0:
        return None
    v = float(a[idx[-1]])
    return v if math.isfinite(v) else None


# ── Data access ───────────────────────────────────────────────────────────────

def _resolve_universe(universe: str) -> list[str]:
    con = get_connection()
    if universe == "nifty50":
        syms = con.execute(
            "SELECT DISTINCT symbol FROM equities_prices WHERE symbol IN "
            f"({','.join(['?'] * len(_NIFTY50))})", _NIFTY50
        ).fetchall()
        return sorted(r[0] for r in syms)
    rows = con.execute(
        "SELECT DISTINCT symbol FROM equities_prices ORDER BY symbol"
    ).fetchall()
    return [r[0] for r in rows]


def _load_symbol(symbol: str, lookback: int = 800, as_of: Optional[str] = None
                 ) -> Optional[dict[str, np.ndarray]]:
    con = get_connection()
    date_clause = "AND CAST(date AS DATE) <= ?" if as_of else ""
    params: list[Any] = [symbol]
    if as_of:
        params.append(as_of)
    rows = con.execute(
        f"""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d,
               open, high, low, close, volume
        FROM equities_prices
        WHERE symbol = ? {date_clause}
        ORDER BY date
        """,
        params,
    ).fetchall()
    if not rows:
        return None
    rows = rows[-lookback:]
    dates = np.array([r[0] for r in rows])
    o = np.array([float(r[1]) for r in rows])
    h = np.array([float(r[2]) for r in rows])
    l = np.array([float(r[3]) for r in rows])
    c = np.array([float(r[4]) for r in rows])
    v = np.array([float(r[5]) for r in rows])
    return {"date": dates, "open": o, "high": h, "low": l, "close": c, "volume": v}


def _load_universe_frames(symbols: list[str], lookback: int, as_of: Optional[str]
                          ) -> dict[str, dict[str, np.ndarray]]:
    """Bulk-load OHLCV for many symbols in ONE query, grouped in Python.

    Follows the bulk-load pattern from CLAUDE.md — never one query per symbol.
    """
    con = get_connection()
    date_clause = "AND CAST(date AS DATE) <= ?" if as_of else ""
    placeholders = ",".join(["?"] * len(symbols))
    params: list[Any] = list(symbols)
    if as_of:
        params.append(as_of)
    rows = con.execute(
        f"""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d,
               open, high, low, close, volume
        FROM equities_prices
        WHERE symbol IN ({placeholders}) {date_clause}
        ORDER BY symbol, date
        """,
        params,
    ).fetchall()
    grouped: dict[str, list] = {}
    for r in rows:
        grouped.setdefault(r[0], []).append(r)
    frames: dict[str, dict[str, np.ndarray]] = {}
    for sym, srows in grouped.items():
        srows = srows[-lookback:]
        frames[sym] = {
            "date": np.array([r[1] for r in srows]),
            "open": np.array([float(r[2]) for r in srows]),
            "high": np.array([float(r[3]) for r in srows]),
            "low": np.array([float(r[4]) for r in srows]),
            "close": np.array([float(r[5]) for r in srows]),
            "volume": np.array([float(r[6]) for r in srows]),
        }
    return frames


# ── Field resolver (for screen) ───────────────────────────────────────────────

def _parse_field(field: str) -> tuple[str, Optional[int]]:
    parts = field.lower().rsplit("_", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return parts[0], int(parts[1])
    return field.lower(), None


def _field_value(field: str, f: dict[str, np.ndarray]) -> Optional[float]:
    base, n = _parse_field(field)
    c, h, l, v = f["close"], f["high"], f["low"], f["volume"]
    if base in ("close", "open", "high", "low", "volume"):
        return _last_valid(f[base])
    if base == "rsi":
        return _last_valid(_rsi(c, n or 14))
    if base == "sma":
        return _last_valid(_sma(c, n or 50))
    if base == "ema":
        return _last_valid(_ema(c, n or 20))
    if base == "atr":
        return _last_valid(_atr(h, l, c, n or 14))
    if base in ("ret", "return"):  # n-day % return
        n = n or 20
        if len(c) <= n:
            return None
        return float((c[-1] / c[-1 - n] - 1.0) * 100.0)
    if base in ("vol", "volatility"):  # annualized rolling vol %
        n = n or 20
        r = _daily_returns(c)
        if np.sum(~np.isnan(r)) < n:
            return None
        return float(np.nanstd(r[-n:]) * math.sqrt(252) * 100.0)
    if base in ("volume_ratio", "vol_ratio"):
        n = n or 20
        if len(v) <= n:
            return None
        avg = np.mean(v[-n - 1:-1])
        return float(v[-1] / avg) if avg > 0 else None
    if base == "atr_percentile":
        n = n or 252
        atr = _atr(h, l, c, 14)
        atr = atr[~np.isnan(atr)]
        if len(atr) < 20:
            return None
        window = atr[-n:]
        return float((window < window[-1]).mean() * 100.0)
    if base == "above_sma":
        n = n or 200
        s = _last_valid(_sma(c, n))
        cl = _last_valid(c)
        if s is None or cl is None:
            return None
        return 1.0 if cl > s else 0.0
    if base in ("dist_52w_high", "from_52w_high"):
        window = c[-252:] if len(c) >= 252 else c
        hi = float(np.max(window))
        return float((c[-1] / hi - 1.0) * 100.0)
    if base in ("dist_52w_low", "from_52w_low"):
        window = c[-252:] if len(c) >= 252 else c
        lo = float(np.min(window))
        return float((c[-1] / lo - 1.0) * 100.0)
    return None


def _lookback_for_fields(fields: list[str]) -> int:
    need = 260
    for fld in fields:
        _, n = _parse_field(fld)
        if n:
            need = max(need, n + 30)
    return max(need, 300)


# ── TOOL: query_data ──────────────────────────────────────────────────────────

def query_data(symbols: Optional[list[str]] = None, start: Optional[str] = None,
               end: Optional[str] = None, columns: Optional[list[str]] = None,
               universe: str = "nse500", limit: int = 500) -> dict[str, Any]:
    key = _cache_key("query_data", {"s": symbols, "start": start, "end": end,
                                    "c": columns, "u": universe, "l": limit})
    if key in _cache:
        return _cache[key]
    con = get_connection()
    cols = columns or ["date", "open", "high", "low", "close", "volume"]
    safe = [c for c in cols if c in ("date", "open", "high", "low", "close", "volume")]
    sel = ", ".join(
        f"STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date" if c == "date" else c
        for c in safe
    )
    clauses, params = [], []
    if symbols:
        clauses.append(f"symbol IN ({','.join(['?'] * len(symbols))})")
        params += symbols
    if start:
        clauses.append("CAST(date AS DATE) >= ?"); params.append(start)
    if end:
        clauses.append("CAST(date AS DATE) <= ?"); params.append(end)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = con.execute(
        f"SELECT symbol, {sel} FROM equities_prices {where} "
        f"ORDER BY symbol, date LIMIT {int(limit)}", params
    ).fetchall()
    cols_out = ["symbol"] + safe
    records = [dict(zip(cols_out, r)) for r in rows]
    result = {"columns": cols_out, "rows": records, "count": len(records)}
    _cache[key] = result
    return result


# ── TOOL: load_prices ─────────────────────────────────────────────────────────

def load_prices(symbols: list[str], start: Optional[str] = None,
                end: Optional[str] = None, timeframe: str = "daily") -> dict[str, Any]:
    out = {}
    for sym in symbols:
        f = _load_symbol(sym, lookback=2000, as_of=end)
        if f is None:
            out[sym] = {"available": False}
            continue
        out[sym] = {
            "available": True,
            "bars": len(f["date"]),
            "first_date": str(f["date"][0]),
            "last_date": str(f["date"][-1]),
            "last_close": _last_valid(f["close"]),
        }
    return {"symbols": out, "data_version": data_version()}


# ── TOOL: compute_indicators ──────────────────────────────────────────────────

def compute_indicators(symbol: str, specs: list[dict[str, Any]],
                       as_of: Optional[str] = None) -> dict[str, Any]:
    key = _cache_key("compute_indicators", {"sym": symbol, "specs": specs, "as_of": as_of})
    if key in _cache:
        return _cache[key]
    f = _load_symbol(symbol, lookback=1200, as_of=as_of)
    if f is None:
        return {"error": f"No data for {symbol}"}
    c, h, l = f["close"], f["high"], f["low"]
    values: dict[str, Any] = {}
    for spec in specs:
        name = str(spec.get("name", "")).upper()
        p = spec.get("params", {}) or {}
        n = int(p.get("timeperiod", p.get("period", 14)))
        try:
            if name == "RSI":
                values[f"RSI_{n}"] = _last_valid(_rsi(c, n))
            elif name == "SMA":
                values[f"SMA_{n}"] = _last_valid(_sma(c, n))
            elif name == "EMA":
                values[f"EMA_{n}"] = _last_valid(_ema(c, n))
            elif name == "ATR":
                values[f"ATR_{n}"] = _last_valid(_atr(h, l, c, n))
            elif name == "MACD" and _HAS_TALIB:
                macd, sig, hist = talib.MACD(c)
                values["MACD"] = {"macd": _last_valid(macd), "signal": _last_valid(sig),
                                  "hist": _last_valid(hist)}
            elif name == "ADX" and _HAS_TALIB:
                values[f"ADX_{n}"] = _last_valid(talib.ADX(h, l, c, timeperiod=n))
            elif name == "BBANDS" and _HAS_TALIB:
                up, mid, low = talib.BBANDS(c, timeperiod=n)
                values["BBANDS"] = {"upper": _last_valid(up), "mid": _last_valid(mid),
                                    "lower": _last_valid(low)}
            elif name in ("CCI", "MFI", "WILLR", "OBV", "STOCH") and _HAS_TALIB:
                fn = getattr(talib, name)
                if name == "OBV":
                    values[name] = _last_valid(fn(c, f["volume"]))
                elif name == "MFI":
                    values[name] = _last_valid(fn(h, l, c, f["volume"], timeperiod=n))
                elif name == "STOCH":
                    k, d = talib.STOCH(h, l, c)
                    values["STOCH"] = {"k": _last_valid(k), "d": _last_valid(d)}
                else:
                    values[name] = _last_valid(fn(h, l, c, timeperiod=n))
            else:
                values[name] = {"error": "unsupported without TA-Lib"} if not _HAS_TALIB else None
        except Exception as exc:  # pragma: no cover
            values[name] = {"error": str(exc)}
    result = {"symbol": symbol, "as_of": str(f["date"][-1]), "values": values,
              "talib": _HAS_TALIB}
    _cache[key] = result
    return result


# ── TOOL: compute_stats ───────────────────────────────────────────────────────

def compute_stats(symbol: str, ops: list[str], window: Optional[int] = None,
                  benchmark: Optional[str] = None, start: Optional[str] = None,
                  end: Optional[str] = None) -> dict[str, Any]:
    key = _cache_key("compute_stats", {"sym": symbol, "ops": ops, "w": window,
                                       "b": benchmark, "start": start, "end": end})
    if key in _cache:
        return _cache[key]
    f = _load_symbol(symbol, lookback=1500, as_of=end)
    if f is None:
        return {"error": f"No data for {symbol}"}
    c = f["close"]
    r = _daily_returns(c)
    rv = r[~np.isnan(r)]
    w = window or 20
    out: dict[str, Any] = {}

    def series_tail(a: np.ndarray, k: int = 120) -> list[float]:
        a = a[~np.isnan(a)]
        return [round(float(x), 6) for x in a[-k:]]

    for op in ops:
        try:
            if op == "returns":
                out["returns"] = {"last": round(float(rv[-1] * 100), 4),
                                  "series": series_tail(r * 100)}
            elif op == "log_returns":
                lr = np.log(c[1:] / c[:-1])
                out["log_returns"] = {"last": round(float(lr[-1]), 6),
                                      "series": series_tail(lr)}
            elif op == "rolling_return":
                if len(c) > w:
                    rr = c[w:] / c[:-w] - 1.0
                    out["rolling_return"] = {"window": w, "last_pct": round(float(rr[-1] * 100), 4),
                                             "series": series_tail(rr * 100)}
            elif op == "cumulative_return":
                out["cumulative_return_pct"] = round(float((c[-1] / c[0] - 1.0) * 100), 4)
            elif op in ("volatility", "std_deviation"):
                roll = np.array([np.std(r[max(1, i - w + 1):i + 1])
                                 for i in range(1, len(r))])
                ann = float(np.nanstd(rv[-w:]) * math.sqrt(252) * 100)
                out[op] = {"window": w, "annualized_pct": round(ann, 4),
                           "series": series_tail(roll * math.sqrt(252) * 100)}
            elif op == "zscore":
                mu, sd = np.nanmean(rv[-252:]), np.nanstd(rv[-252:])
                out["zscore"] = round(float((rv[-1] - mu) / sd), 4) if sd else None
            elif op == "percentile":
                out["percentile_1y_close"] = round(
                    float((c[-252:] < c[-1]).mean() * 100), 2)
            elif op == "mean":
                out["mean_daily_ret_pct"] = round(float(np.nanmean(rv) * 100), 4)
            elif op == "median":
                out["median_daily_ret_pct"] = round(float(np.nanmedian(rv) * 100), 4)
            elif op == "skewness":
                out["skewness"] = round(float(_skew(rv)), 4)
            elif op == "kurtosis":
                out["kurtosis"] = round(float(_kurt(rv)), 4)
            elif op == "quantiles":
                qs = np.nanpercentile(rv * 100, [5, 25, 50, 75, 95])
                out["quantiles_pct"] = {q: round(float(v), 4) for q, v in
                                        zip(["p5", "p25", "p50", "p75", "p95"], qs)}
            elif op == "autocorrelation":
                out["autocorr_lag1"] = round(float(np.corrcoef(rv[:-1], rv[1:])[0, 1]), 4)
            elif op == "drawdown":
                peak = np.maximum.accumulate(c)
                dd = (c / peak - 1.0) * 100
                out["drawdown"] = {"current_pct": round(float(dd[-1]), 3),
                                   "max_pct": round(float(dd.min()), 3),
                                   "series": series_tail(dd)}
            elif op in ("correlation", "rolling_correlation", "covariance", "rolling_beta"):
                bench = _benchmark_returns(benchmark, len(c), end)
                if bench is not None:
                    m = min(len(rv), len(bench))
                    a, b = rv[-m:], bench[-m:]
                    if op == "correlation":
                        out["correlation"] = round(float(np.corrcoef(a, b)[0, 1]), 4)
                    elif op == "covariance":
                        out["covariance"] = round(float(np.cov(a, b)[0, 1]), 8)
                    elif op == "rolling_beta":
                        var = np.var(b[-w:])
                        beta = float(np.cov(a[-w:], b[-w:])[0, 1] / var) if var else None
                        out["rolling_beta"] = round(beta, 4) if beta is not None else None
                    else:  # rolling_correlation
                        rc = [float(np.corrcoef(a[i - w:i], b[i - w:i])[0, 1])
                              for i in range(w, m)]
                        out["rolling_correlation"] = {"window": w, "last": round(rc[-1], 4) if rc else None,
                                                      "series": [round(x, 4) for x in rc[-120:]]}
        except Exception as exc:  # pragma: no cover
            out[op] = {"error": str(exc)}
    result = {"symbol": symbol, "benchmark": benchmark or "NIFTY(proxy)",
              "as_of": str(f["date"][-1]), "stats": out}
    _cache[key] = result
    return result


def _skew(x: np.ndarray) -> float:
    m = x.mean(); s = x.std()
    return float(np.mean(((x - m) / s) ** 3)) if s else 0.0


def _kurt(x: np.ndarray) -> float:
    m = x.mean(); s = x.std()
    return float(np.mean(((x - m) / s) ** 4) - 3.0) if s else 0.0


_bench_cache: dict[str, np.ndarray] = {}


def _benchmark_returns(benchmark: Optional[str], n: int, end: Optional[str]) -> Optional[np.ndarray]:
    """Equal-weighted index proxy (AVG close across universe) — daily returns.

    Documented proxy per CLAUDE.md when true index data is unavailable.
    If `benchmark` is a real symbol, use that symbol's returns instead.
    """
    if benchmark and benchmark.upper() not in ("NIFTY", "NIFTY50", "MARKET"):
        f = _load_symbol(benchmark.upper(), lookback=1500, as_of=end)
        return _daily_returns(f["close"]) [~np.isnan(_daily_returns(f["close"]))] if f else None
    ck = f"bench|{end}|{data_version()}"
    if ck in _bench_cache:
        idx = _bench_cache[ck]
    else:
        con = get_connection()
        clause = "WHERE CAST(date AS DATE) <= ?" if end else ""
        params = [end] if end else []
        rows = con.execute(
            f"SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) d, AVG(close) "
            f"FROM equities_prices {clause} GROUP BY d ORDER BY d", params
        ).fetchall()
        idx = np.array([float(r[1]) for r in rows])
        _bench_cache[ck] = idx
    r = _daily_returns(idx)
    return r[~np.isnan(r)]


# ── TOOL: screen ──────────────────────────────────────────────────────────────

def screen(criteria: list[dict[str, Any]], universe: str = "nse500",
           as_of: Optional[str] = None, sort_by: Optional[str] = None,
           limit: int = 50) -> dict[str, Any]:
    key = _cache_key("screen", {"crit": criteria, "u": universe, "as_of": as_of,
                                "sort": sort_by, "limit": limit})
    if key in _cache:
        return _cache[key]

    fields = [c["field"] for c in criteria]
    # value may itself reference another field (e.g. ema_20 > ema_50)
    for c in criteria:
        if isinstance(c.get("value"), str):
            fields.append(c["value"])
    if sort_by:
        fields.append(sort_by)
    lookback = _lookback_for_fields(fields)

    symbols = _resolve_universe(universe)
    frames = _load_universe_frames(symbols, lookback, as_of)

    matches: list[dict[str, Any]] = []
    for sym, f in frames.items():
        if len(f["close"]) < 30:
            continue
        row_vals: dict[str, Optional[float]] = {}
        ok = True
        for crit in criteria:
            fld, op, val = crit["field"], crit["op"], crit["value"]
            x = _field_value(fld, f)
            row_vals[fld] = None if x is None else round(x, 4)
            if isinstance(val, str):  # reference to another field
                val_resolved = _field_value(val, f)
                row_vals[val] = None if val_resolved is None else round(val_resolved, 4)
            else:
                val_resolved = val
            if not _passes(op, x, val_resolved):
                ok = False
                break
        if not ok:
            continue
        if sort_by and sort_by not in row_vals:
            sv = _field_value(sort_by, f)
            row_vals[sort_by] = None if sv is None else round(sv, 4)
        row_vals["symbol"] = sym
        row_vals["close"] = _last_valid(f["close"])
        matches.append(row_vals)

    sort_key = sort_by or (fields[0] if fields else "symbol")
    matches.sort(key=lambda r: (r.get(sort_key) is None, r.get(sort_key, 0)),
                 reverse=bool(sort_by))
    matches = matches[:limit]

    result = {
        "universe": universe,
        "as_of": as_of or "latest",
        "criteria": criteria,
        "match_count": len(matches),
        "matches": matches,
        "data_version": data_version(),
    }
    result["result_hash"] = _hash_result(result["matches"])
    _cache[key] = result
    return result


def _passes(op: str, x: Optional[float], value: Any) -> bool:
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return False
    if value is None:
        return False
    try:
        if op == "<":
            return x < value
        if op == "<=":
            return x <= value
        if op == ">":
            return x > value
        if op == ">=":
            return x >= value
        if op == "==":
            return x == value
        if op == "between":
            return value[0] <= x <= value[1]
    except Exception:
        return False
    return False


# ── TOOL: eda_profile ─────────────────────────────────────────────────────────

def eda_profile(target: str, benchmark: str = "NIFTY",
                lookback_days: int = 504) -> dict[str, Any]:
    key = _cache_key("eda_profile", {"t": target, "b": benchmark, "lb": lookback_days})
    if key in _cache:
        return _cache[key]
    f = _load_symbol(target.upper(), lookback=max(lookback_days + 260, 800))
    if f is None:
        return {"error": f"No data for {target}"}
    c = f["close"]
    r = _daily_returns(c)[-lookback_days:]
    rv = r[~np.isnan(r)] * 100

    # return distribution histogram
    hist, edges = np.histogram(rv, bins=30)
    dist = [{"bin": round(float((edges[i] + edges[i + 1]) / 2), 3),
             "count": int(hist[i])} for i in range(len(hist))]

    # rolling vol (20d, annualized)
    roll_vol = np.array([np.std(_daily_returns(c)[max(1, i - 19):i + 1])
                         for i in range(1, len(c))]) * math.sqrt(252) * 100
    roll_vol = roll_vol[-lookback_days:]

    # drawdown
    peak = np.maximum.accumulate(c)
    dd = (c / peak - 1.0) * 100

    # rolling correlation to benchmark
    bench = _benchmark_returns(benchmark, len(c), None)
    roll_corr_series: list[float] = []
    corr_val = None
    if bench is not None:
        m = min(len(rv), len(bench))
        a = (_daily_returns(c)[~np.isnan(_daily_returns(c))])[-m:]
        b = bench[-m:]
        if m > 60:
            corr_val = round(float(np.corrcoef(a, b)[0, 1]), 4)
            roll_corr_series = [round(float(np.corrcoef(a[i - 60:i], b[i - 60:i])[0, 1]), 4)
                                for i in range(60, m)][-120:]

    result = {
        "target": target.upper(),
        "benchmark": benchmark,
        "as_of": str(f["date"][-1]),
        "lookback_days": lookback_days,
        "return_distribution": dist,
        "moments": {
            "mean_pct": round(float(np.mean(rv)), 4),
            "median_pct": round(float(np.median(rv)), 4),
            "std_pct": round(float(np.std(rv)), 4),
            "skewness": round(_skew(rv), 4),
            "kurtosis": round(_kurt(rv), 4),
            "annualized_vol_pct": round(float(np.std(rv) * math.sqrt(252)), 2),
        },
        "rolling_vol": {"window": 20, "series": [round(float(x), 3) for x in roll_vol[-120:]]},
        "drawdown": {"current_pct": round(float(dd[-1]), 3),
                     "max_pct": round(float(dd.min()), 3),
                     "series": [round(float(x), 3) for x in dd[-120:]]},
        "rolling_correlation": {"window": 60, "current": corr_val, "series": roll_corr_series},
        "data_version": data_version(),
    }
    _cache[key] = result
    return result


# ── TOOL: make_chart ──────────────────────────────────────────────────────────

def make_chart(kind: str, data_ref: Any, options: Optional[dict[str, Any]] = None
               ) -> dict[str, Any]:
    """Echo a chart spec for the frontend to render. No computation here."""
    return {"kind": kind, "data": data_ref, "options": options or {}}
