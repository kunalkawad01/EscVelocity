"""Options OI Analysis service — DuckDB-backed, in-process cache."""
import logging
import math
import threading
from collections import defaultdict
from typing import Optional

import numpy as np

from app.config import settings
from app.services.duckdb_client import get_connection, ensure_fo_views
from app.models.options import (
    OIAnalysis, StrikeData, MaxPainPoint, OIBuildupItem, OIScannerResponse,
    ExpectedMovePoint, ExpectedMoveHistory,
    EMHistoryRow, EMScanRow, EMScanResponse,
    IVSmileStrike, IVSmileResponse, IVHistoryPoint,
)

log = logging.getLogger(__name__)

_symbol_cache: dict[str, OIAnalysis] = {}
_scanner_cache: Optional[OIScannerResponse] = None
_em_cache: dict[str, ExpectedMoveHistory] = {}  # keyed by symbol
_em_scan_cache: Optional[EMScanResponse] = None
_iv_smile_cache: dict[str, IVSmileResponse] = {}  # keyed by symbol

# Serializes the expensive full-view scans (get_scanner / get_em_scan) so a burst
# of concurrent cold-cache requests computes once, not N times (CLAUDE.md lesson).
_scan_lock = threading.Lock()

# Latest options data-date the caches were built for. When ingestion adds a newer
# date, _refresh_if_new_day() clears every cache so pages pick up fresh prices
# without needing an explicit /invalidate call.
_data_date: Optional[str] = None

# Plausible IV band (annualised %). NSE feed carries garbage IV (>100, up to ~500)
# on deep-OTM / illiquid strikes; anything outside this band is treated as missing.
_IV_MIN, _IV_MAX = 1.0, 150.0
_RISK_FREE = 0.065  # India risk-free proxy for Black-Scholes greeks


def _clean_iv(iv) -> Optional[float]:
    """Return IV only if within the plausible band, else None (drops feed garbage)."""
    if iv is None:
        return None
    try:
        v = float(iv)
    except (TypeError, ValueError):
        return None
    return v if _IV_MIN <= v <= _IV_MAX else None


def _latest_options_date(con) -> Optional[str]:
    try:
        row = con.execute("SELECT MAX(date) FROM options_chain").fetchone()
        return str(row[0]) if row and row[0] else None
    except Exception:
        return None


def _refresh_if_new_day(con) -> None:
    """Clear all caches when a newer options data-date appears (post-ingestion)."""
    global _data_date, _symbol_cache, _scanner_cache, _em_cache, _em_scan_cache, _iv_smile_cache
    ld = _latest_options_date(con)
    if ld is not None and ld != _data_date:
        _data_date = ld
        _symbol_cache = {}
        _scanner_cache = None
        _em_cache = {}
        _em_scan_cache = None
        _iv_smile_cache = {}


# ── Black-Scholes greeks (deterministic; no scipy) ────────────────────────────

def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _bs_greeks(spot: float, strike: float, iv_pct: Optional[float],
               dte_days: int, opt_type: str, r: float = _RISK_FREE) -> Optional[dict]:
    """Black-Scholes greeks. `iv_pct` is annualised vol in percent (e.g. 22.5).

    Returns {delta, gamma, vega, theta} (theta/vega per-day / per-1-vol-point),
    or None when inputs are unusable. Deterministic — safe for the Feature Store.
    """
    try:
        iv = _clean_iv(iv_pct)
        if iv is None:
            return None
        iv /= 100.0
        T = max(int(dte_days), 1) / 365.0
        if spot <= 0 or strike <= 0 or iv <= 0 or T <= 0:
            return None
        sqrtT = math.sqrt(T)
        d1 = (math.log(spot / strike) + (r + 0.5 * iv * iv) * T) / (iv * sqrtT)
        d2 = d1 - iv * sqrtT
        pdf = _norm_pdf(d1)
        gamma = pdf / (spot * iv * sqrtT)
        vega = spot * pdf * sqrtT / 100.0                     # per 1 vol point
        if opt_type == "CE":
            delta = _norm_cdf(d1)
            theta = (-(spot * pdf * iv) / (2 * sqrtT)
                     - r * strike * math.exp(-r * T) * _norm_cdf(d2)) / 365.0
        else:
            delta = _norm_cdf(d1) - 1.0
            theta = (-(spot * pdf * iv) / (2 * sqrtT)
                     + r * strike * math.exp(-r * T) * _norm_cdf(-d2)) / 365.0
        return {"delta": round(delta, 4), "gamma": round(gamma, 6),
                "vega": round(vega, 4), "theta": round(theta, 4)}
    except Exception:
        return None


# ── IV-Rank history (persisted daily ATM-IV series) ───────────────────────────
#
# We persist one ATM-IV value per (symbol, date) to a derived parquet, rebuilt
# from the whole options_chain each time a new options date appears. As history
# accumulates (currently ~15 days) this unlocks IV-Rank / IV-percentile, which
# is the missing "is vol rich or cheap" signal the Strategy Lens needs.

_IV_RANK_LOOKBACK = 252          # ~1 trading year
_IV_RANK_MIN_DAYS = 20           # below this, rank is not yet meaningful

_iv_hist_lock = threading.Lock()
_iv_hist: Optional[dict[str, list[tuple[str, float]]]] = None  # symbol -> [(date, atm_iv), ...] asc
_iv_hist_date: Optional[str] = None                            # options data-date the series was built for


def _iv_history_path():
    return settings.data_path / "data_lake" / "derived" / "iv_history" / "atm_iv.parquet"


def _rebuild_iv_history(con) -> None:
    """Recompute ATM-IV for every (symbol, date) from options_chain and write parquet.

    ATM IV = mean cleaned IV of CE+PE at the strike nearest spot, per symbol per date.
    Idempotent — always derivable from the immutable raw options parquet.
    """
    path = _iv_history_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    out = str(path).replace("\\", "/")
    con.execute(f"""
        COPY (
            WITH spots AS (
                SELECT STRFTIME('%Y-%m-%d', date) AS d, symbol, MAX(underlying_price) AS spot
                FROM options_chain
                GROUP BY 1, 2
            ),
            atm AS (
                SELECT d, symbol, strike FROM (
                    SELECT s.d, s.symbol, o.strike,
                           ROW_NUMBER() OVER (PARTITION BY s.d, s.symbol ORDER BY ABS(o.strike - s.spot)) AS rn
                    FROM options_chain o
                    JOIN spots s ON STRFTIME('%Y-%m-%d', o.date) = s.d AND o.symbol = s.symbol
                    GROUP BY s.d, s.symbol, o.strike, s.spot
                ) WHERE rn = 1
            )
            SELECT a.d AS date, a.symbol, ROUND(AVG(o.iv), 2) AS atm_iv
            FROM atm a
            JOIN options_chain o
                ON STRFTIME('%Y-%m-%d', o.date) = a.d AND o.symbol = a.symbol AND o.strike = a.strike
            WHERE o.iv BETWEEN {_IV_MIN} AND {_IV_MAX}
            GROUP BY a.d, a.symbol
            ORDER BY a.symbol, a.d
        ) TO '{out}' (FORMAT PARQUET)
    """)
    log.info("iv_history: rebuilt %s", out)


def _ensure_iv_history(con) -> None:
    """Load the ATM-IV series into memory, rebuilding the parquet if a new date appeared."""
    global _iv_hist, _iv_hist_date
    latest = _latest_options_date(con)
    if _iv_hist is not None and _iv_hist_date == latest:
        return
    with _iv_hist_lock:
        if _iv_hist is not None and _iv_hist_date == latest:
            return
        path = _iv_history_path()
        out = str(path).replace("\\", "/")
        need_rebuild = True
        if path.exists():
            try:
                mx = con.execute(f"SELECT MAX(date) FROM read_parquet('{out}')").fetchone()[0]
                need_rebuild = str(mx) != str(latest)
            except Exception:
                need_rebuild = True
        if need_rebuild:
            try:
                _rebuild_iv_history(con)
            except Exception as e:
                log.error("iv_history rebuild failed: %s", e, exc_info=True)
                _iv_hist, _iv_hist_date = {}, latest
                return
        hist: dict[str, list[tuple[str, float]]] = defaultdict(list)
        try:
            for sym, dt, iv in con.execute(
                f"SELECT symbol, date, atm_iv FROM read_parquet('{out}') ORDER BY symbol, date"
            ).fetchall():
                hist[sym].append((str(dt), float(iv)))
        except Exception as e:
            log.error("iv_history load failed: %s", e, exc_info=True)
        _iv_hist, _iv_hist_date = dict(hist), latest


def warm_iv_history() -> None:
    """Startup/prewarm entry point — builds + loads the ATM-IV series."""
    ensure_fo_views()
    try:
        _ensure_iv_history(get_connection())
    except Exception as e:
        log.warning("warm_iv_history: %s", e)


def invalidate_iv_history() -> None:
    """Force the ATM-IV series to rebuild + reload on next access (post-ingestion)."""
    global _iv_hist, _iv_hist_date
    _iv_hist, _iv_hist_date = None, None
    warm_iv_history()


def _iv_rank_for(symbol: str, current_iv: Optional[float]) -> tuple[Optional[float], Optional[float], int]:
    """Return (iv_rank, iv_percentile, n_days) over trailing history for a symbol.

    Rank/percentile are None until at least _IV_RANK_MIN_DAYS of history exist.
    """
    if _iv_hist is None or current_iv is None:
        return None, None, 0
    series = _iv_hist.get(symbol, [])
    ivs = [iv for _, iv in series][-_IV_RANK_LOOKBACK:]
    n = len(ivs)
    if n < _IV_RANK_MIN_DAYS:
        return None, None, n
    mn, mx = min(ivs), max(ivs)
    rank = 0.0 if mx == mn else (current_iv - mn) / (mx - mn) * 100.0
    pct = sum(1 for v in ivs if v < current_iv) / n * 100.0
    return round(max(0.0, min(100.0, rank)), 1), round(pct, 1), n


def _iv_history_series(symbol: str, tail: int = 90) -> list[IVHistoryPoint]:
    if _iv_hist is None:
        return []
    return [IVHistoryPoint(date=d, atm_iv=v) for d, v in _iv_hist.get(symbol, [])[-tail:]]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _compute_max_pain(strikes: list[StrikeData]) -> tuple[float, list[MaxPainPoint]]:
    """Return (max_pain_strike, curve_points).

    Max pain = the strike that minimises total option-buyer payout.
    For each candidate expiry price P:
      total = sum_CE max(0, P - K) * CE_OI  +  sum_PE max(0, K - P) * PE_OI
    """
    curve: list[MaxPainPoint] = []
    min_pain = float("inf")
    max_pain_strike = strikes[0].strike if strikes else 0.0

    for candidate in strikes:
        P = candidate.strike
        pain = 0.0
        for s in strikes:
            K = s.strike
            pain += max(0.0, P - K) * s.ce_oi
            pain += max(0.0, K - P) * s.pe_oi
        curve.append(MaxPainPoint(strike=P, total_pain=round(pain, 0)))
        if pain < min_pain:
            min_pain = pain
            max_pain_strike = P

    return max_pain_strike, curve


def _nearest_strike(strikes: list[float], spot: float) -> float:
    return min(strikes, key=lambda k: abs(k - spot))


def _build_signal(
    ce_zone_change: Optional[int],
    pe_zone_change: Optional[int],
    pcr: float,
    price_up: Optional[bool] = None,   # True = futures rose, False = fell, None = stable/unknown
) -> tuple[str, str]:
    """7-way OI buildup signal — Indian seller-market framework.

    CE OI ↑ = call writers adding resistance (bearish)
    PE OI ↑ = put writers adding support (bullish)

    | CE OI | PE OI | Futures      | Signal                |
    |-------|-------|--------------|-----------------------|
    |  ↓    |  ↑    | ↑ or stable  | Bullish Build-up      |
    |  ↑    |  ↓    | ↓ or stable  | Bearish Build-up      |
    |  ↓    |  ↓    | ↑            | Short Covering        |
    |  ↓    |  ↓    | ↓            | Long Unwinding        |
    |  ↑    |  ↑    | ↑            | Aggressive Long Build |
    |  ↑    |  ↑    | ↓            | Aggressive Short Build|
    | mixed | mixed | flat         | Neutral               |
    """
    if ce_zone_change is not None and pe_zone_change is not None \
            and (ce_zone_change != 0 or pe_zone_change != 0):
        ce_up = ce_zone_change > 0
        pe_up = pe_zone_change > 0

        # CE↓ + PE↑ → Bullish Build-up (resistance easing, support building)
        if not ce_up and pe_up:
            return "Bullish Build-up", "#22c55e"

        # CE↑ + PE↓ → Bearish Build-up (resistance loading, support removed)
        if ce_up and not pe_up:
            return "Bearish Build-up", "#ef4444"

        # CE↑ + PE↑ → both sides adding; price direction determines who is winning
        if ce_up and pe_up:
            if price_up is True:
                return "Aggressive Long Build", "#10b981"   # new longs + OI growing + price rising
            if price_up is False:
                return "Aggressive Short Build", "#f97316"  # new shorts + OI growing + price falling
            # Stable / unknown price — no clear edge
            return "Neutral", "#94a3b8"

        # CE↓ + PE↓ → both sides unwinding; price direction shows who is exiting
        if price_up is True:
            return "Short Covering", "#60a5fa"    # bears buying back into a rally
        if price_up is False:
            return "Long Unwinding", "#f59e0b"    # bulls selling into a fall
        return "Neutral", "#94a3b8"               # stable price + both OI declining = no edge

    # No OI change data (first ingestion day) — PCR heuristic fallback
    if pcr > 1.3:
        return "Bullish Build-up", "#22c55e"
    if pcr < 0.7:
        return "Bearish Build-up", "#ef4444"
    return "Neutral", "#94a3b8"


# ── Per-symbol OI Analysis ────────────────────────────────────────────────────

def get_oi_analysis(symbol: str, invalidate: bool = False) -> Optional[OIAnalysis]:
    ensure_fo_views()
    con = get_connection()
    _refresh_if_new_day(con)

    if not invalidate and symbol in _symbol_cache:
        return _symbol_cache[symbol]

    # Check view exists
    try:
        con.execute("SELECT 1 FROM options_chain LIMIT 0")
    except Exception:
        log.warning("options_chain view not available")
        return None

    try:
        # Latest date for symbol
        row = con.execute(
            "SELECT MAX(date) FROM options_chain WHERE symbol = ?", [symbol]
        ).fetchone()
        if not row or not row[0]:
            return None
        latest_date = str(row[0])

        # Pull all rows for this symbol on latest date
        rows = con.execute("""
            SELECT strike, option_type, oi, oi_change, volume, iv, ltp, underlying_price, expiry
            FROM options_chain
            WHERE symbol = ? AND date = ?
            ORDER BY strike
        """, [symbol, latest_date]).fetchall()

        if not rows:
            return None

        # Group by strike
        strike_map: dict[float, dict] = {}
        spot = 0.0
        expiry = ""
        for strike, opt_type, oi, oi_change, volume, iv, ltp, underlying_price, exp in rows:
            spot = underlying_price or spot
            expiry = str(exp)
            if strike not in strike_map:
                strike_map[strike] = {
                    "ce_oi": 0, "pe_oi": 0,
                    "ce_oi_change": None, "pe_oi_change": None,
                    "ce_volume": 0, "pe_volume": 0,
                    "ce_iv": None, "pe_iv": None,
                    "ce_ltp": 0.0, "pe_ltp": 0.0,
                }
            d = strike_map[strike]
            if opt_type == "CE":
                d["ce_oi"] = int(oi or 0)
                d["ce_oi_change"] = int(oi_change) if oi_change is not None else None
                d["ce_volume"] = int(volume or 0)
                d["ce_iv"] = float(iv) if iv is not None else None
                d["ce_ltp"] = float(ltp or 0)
            else:
                d["pe_oi"] = int(oi or 0)
                d["pe_oi_change"] = int(oi_change) if oi_change is not None else None
                d["pe_volume"] = int(volume or 0)
                d["pe_iv"] = float(iv) if iv is not None else None
                d["pe_ltp"] = float(ltp or 0)

        sorted_strikes = sorted(strike_map.keys())
        strike_list: list[StrikeData] = []
        for k in sorted_strikes:
            d = strike_map[k]
            ce_oi = d["ce_oi"]
            pe_oi = d["pe_oi"]
            pcr_val = round(pe_oi / ce_oi, 3) if ce_oi > 0 else None
            strike_list.append(StrikeData(
                strike=k,
                ce_oi=ce_oi,
                pe_oi=pe_oi,
                ce_oi_change=d["ce_oi_change"],
                pe_oi_change=d["pe_oi_change"],
                ce_volume=d["ce_volume"],
                pe_volume=d["pe_volume"],
                ce_iv=d["ce_iv"],
                pe_iv=d["pe_iv"],
                ce_ltp=d["ce_ltp"],
                pe_ltp=d["pe_ltp"],
                pcr=pcr_val,
            ))

        if not strike_list:
            return None

        total_ce_oi = sum(s.ce_oi for s in strike_list)
        total_pe_oi = sum(s.pe_oi for s in strike_list)
        pcr = round(total_pe_oi / total_ce_oi, 3) if total_ce_oi > 0 else 0.0

        ce_wall = max(strike_list, key=lambda s: s.ce_oi).strike
        pe_wall = max(strike_list, key=lambda s: s.pe_oi).strike

        atm_strike = _nearest_strike(sorted_strikes, spot)
        atm_data = strike_map.get(atm_strike)
        atm_iv: Optional[float] = None
        if atm_data:
            ivs = [c for v in (atm_data["ce_iv"], atm_data["pe_iv"])
                   if (c := _clean_iv(v)) is not None]
            atm_iv = round(sum(ivs) / len(ivs), 2) if ivs else None

        max_pain_strike, pain_curve = _compute_max_pain(strike_list)

        # Futures data (optional)
        futures_ltp: Optional[float] = None
        basis_pct: Optional[float] = None
        try:
            con.execute("SELECT 1 FROM futures_chain LIMIT 0")
            fut_row = con.execute("""
                SELECT ltp, basis_pct FROM futures_chain
                WHERE symbol = ? AND date = ?
                LIMIT 1
            """, [symbol, latest_date]).fetchone()
            if fut_row:
                futures_ltp = float(fut_row[0]) if fut_row[0] is not None else None
                basis_pct = float(fut_row[1]) if fut_row[1] is not None else None
        except Exception:
            pass

        result = OIAnalysis(
            symbol=symbol,
            date=latest_date,
            expiry=expiry,
            spot=spot,
            atm_strike=atm_strike,
            ce_wall=ce_wall,
            pe_wall=pe_wall,
            max_pain=max_pain_strike,
            pcr=pcr,
            total_ce_oi=total_ce_oi,
            total_pe_oi=total_pe_oi,
            atm_iv=atm_iv,
            strikes=strike_list,
            max_pain_curve=pain_curve,
            futures_ltp=futures_ltp,
            basis_pct=basis_pct,
        )
        _symbol_cache[symbol] = result
        return result

    except Exception as e:
        log.error("options_service.get_oi_analysis(%s): %s", symbol, e, exc_info=True)
        return None


def invalidate_symbol(symbol: str) -> None:
    _symbol_cache.pop(symbol, None)


# ── Scanner ───────────────────────────────────────────────────────────────────

def get_scanner(invalidate: bool = False) -> Optional[OIScannerResponse]:
    """Day-keyed, locked wrapper — one compute even under concurrent cold hits."""
    ensure_fo_views()
    _refresh_if_new_day(get_connection())
    if not invalidate and _scanner_cache is not None:
        return _scanner_cache
    with _scan_lock:
        if not invalidate and _scanner_cache is not None:
            return _scanner_cache
        return _build_scanner(invalidate)


def _build_scanner(invalidate: bool = False) -> Optional[OIScannerResponse]:
    global _scanner_cache
    if not invalidate and _scanner_cache is not None:
        return _scanner_cache

    ensure_fo_views()
    con = get_connection()

    try:
        con.execute("SELECT 1 FROM options_chain LIMIT 0")
    except Exception:
        log.warning("options_chain view not available for scanner")
        return None

    try:
        # Latest date across all symbols
        row = con.execute("SELECT MAX(date) FROM options_chain").fetchone()
        if not row or not row[0]:
            return None
        latest_date = str(row[0])

        # One CTE query: totals + walls + zone OI change sums in a single pass.
        #
        # CE zone: all CE strikes from 0 up to the CE Wall (max-CE-OI strike).
        # PE zone: all PE strikes from 0 up to the PE Wall (max-PE-OI strike).
        # Summing the zone — not just the wall strike — gives a more stable signal.
        combined_rows = con.execute("""
            WITH walls AS (
                -- CE Wall and PE Wall per symbol (strike with highest OI per side)
                SELECT symbol, option_type,
                       strike AS wall_strike,
                       oi     AS wall_oi
                FROM (
                    SELECT symbol, option_type, strike, oi,
                           ROW_NUMBER() OVER (PARTITION BY symbol, option_type ORDER BY oi DESC) AS rn
                    FROM options_chain WHERE date = ?
                ) WHERE rn = 1
            ),
            ce_walls AS (SELECT symbol, wall_strike AS ce_wall FROM walls WHERE option_type = 'CE'),
            pe_walls AS (SELECT symbol, wall_strike AS pe_wall FROM walls WHERE option_type = 'PE')
            SELECT
                o.symbol,
                MAX(o.underlying_price)                                             AS spot,
                MAX(o.expiry)                                                       AS expiry,
                SUM(CASE WHEN o.option_type = 'CE' THEN o.oi ELSE 0 END)           AS total_ce_oi,
                SUM(CASE WHEN o.option_type = 'PE' THEN o.oi ELSE 0 END)           AS total_pe_oi,
                MAX(cw.ce_wall)                                                     AS ce_wall,
                MAX(pw.pe_wall)                                                     AS pe_wall,
                -- Zone OI change: CE strikes (0, ce_wall], PE strikes (0, pe_wall]
                SUM(CASE WHEN o.option_type = 'CE' AND o.strike <= cw.ce_wall
                         THEN o.oi_change END)                                      AS ce_zone_change,
                SUM(CASE WHEN o.option_type = 'PE' AND o.strike <= pw.pe_wall
                         THEN o.oi_change END)                                      AS pe_zone_change
            FROM options_chain o
            JOIN ce_walls cw ON o.symbol = cw.symbol
            JOIN pe_walls pw ON o.symbol = pw.symbol
            WHERE o.date = ?
            GROUP BY o.symbol
            ORDER BY o.symbol
        """, [latest_date, latest_date]).fetchall()

        # ATM IV from options near the spot
        atm_iv_rows = con.execute("""
            WITH spot_cte AS (
                SELECT symbol, MAX(underlying_price) AS spot
                FROM options_chain WHERE date = ?
                GROUP BY symbol
            ),
            ranked AS (
                SELECT o.symbol, o.option_type, o.iv,
                       ABS(o.strike - s.spot) AS dist,
                       ROW_NUMBER() OVER (PARTITION BY o.symbol, o.option_type ORDER BY ABS(o.strike - s.spot)) AS rn
                FROM options_chain o
                JOIN spot_cte s ON o.symbol = s.symbol
                WHERE o.date = ? AND o.iv IS NOT NULL
                  AND o.iv BETWEEN 1 AND 150   -- drop feed-garbage IV
            )
            SELECT symbol, AVG(iv) AS atm_iv
            FROM ranked WHERE rn = 1
            GROUP BY symbol
        """, [latest_date, latest_date]).fetchall()
        atm_iv_map = {sym: float(iv) if iv is not None else None for sym, iv in atm_iv_rows}

        # Futures: today's LTP, basis, and yesterday's LTP (for price direction)
        fut_map: dict[str, dict] = {}
        try:
            con.execute("SELECT 1 FROM futures_chain LIMIT 0")
            fut_rows = con.execute("""
                WITH ordered AS (
                    SELECT symbol, ltp, basis_pct,
                           LAG(ltp) OVER (PARTITION BY symbol ORDER BY CAST(date AS DATE)) AS prev_ltp
                    FROM futures_chain
                )
                SELECT symbol, ltp, basis_pct, prev_ltp
                FROM ordered
                WHERE CAST(date AS VARCHAR) = ?
            """, [latest_date]).fetchall()
            for sym, ltp, bp, prev_ltp in fut_rows:
                today_ltp  = float(ltp)      if ltp      is not None else None
                yest_ltp   = float(prev_ltp) if prev_ltp is not None else None
                chg_pct    = round((today_ltp - yest_ltp) / yest_ltp * 100, 2) \
                             if today_ltp and yest_ltp else None
                price_up   = (today_ltp > yest_ltp) if (today_ltp is not None and yest_ltp is not None) else None
                fut_map[sym] = {
                    "ltp":       today_ltp,
                    "basis_pct": float(bp) if bp is not None else None,
                    "chg_pct":   chg_pct,
                    "price_up":  price_up,
                }
        except Exception:
            pass

        items: list[OIBuildupItem] = []
        for sym, spot, expiry, total_ce, total_pe, ce_wall, pe_wall, ce_zone_chg, pe_zone_chg in combined_rows:
            total_ce = int(total_ce or 0)
            total_pe = int(total_pe or 0)
            spot     = float(spot or 0)
            ce_wall  = float(ce_wall or 0)
            pe_wall  = float(pe_wall or 0)
            pcr      = round(total_pe / total_ce, 3) if total_ce > 0 else 0.0

            # Zone OI change: sum of all OI changes from (0, ce_wall] and (0, pe_wall]
            ce_zone_change = int(ce_zone_chg) if ce_zone_chg is not None else None
            pe_zone_change = int(pe_zone_chg) if pe_zone_chg is not None else None

            fut      = fut_map.get(sym, {})
            price_up = fut.get("price_up")          # True/False/None
            signal, color = _build_signal(ce_zone_change, pe_zone_change, pcr, price_up)

            items.append(OIBuildupItem(
                symbol=sym,
                spot=spot,
                expiry=str(expiry),
                pcr=pcr,
                max_pain=None,
                max_pain_distance_pct=None,
                ce_wall=ce_wall,
                pe_wall=pe_wall,
                total_ce_oi=total_ce,
                total_pe_oi=total_pe,
                ce_wall_oi_change=ce_zone_change,
                pe_wall_oi_change=pe_zone_change,
                signal=signal,
                signal_color=color,
                atm_iv=atm_iv_map.get(sym),
                basis_pct=fut.get("basis_pct"),
                futures_ltp=fut.get("ltp"),
                futures_chg_pct=fut.get("chg_pct"),
            ))

        result = OIScannerResponse(date=latest_date, symbols=items)
        _scanner_cache = result
        return result

    except Exception as e:
        log.error("options_service.get_scanner: %s", e, exc_info=True)
        return None


def invalidate_scanner() -> None:
    global _scanner_cache
    _scanner_cache = None


# ── Expected Move Engine ──────────────────────────────────────────────────────

def get_expected_move_history(symbol: str, invalidate: bool = False) -> Optional[ExpectedMoveHistory]:
    """Daily Expected Move using ATM straddle premium scaled by DTE.

    Formula:
      Monthly EM = ATM_CE_LTP + ATM_PE_LTP          (full straddle = expiry expected move)
      Weekly  EM = Monthly_EM × sqrt(5  / DTE)
      Daily   EM = Monthly_EM × sqrt(1  / DTE)

    DTE = business days from the observation date to the expiry date.
    """
    if not invalidate and symbol in _em_cache:
        return _em_cache[symbol]

    ensure_fo_views()
    try:
        con = get_connection()

        rows = con.execute("""
            WITH daily_spot AS (
                -- One row per (date, symbol): spot + expiry
                SELECT
                    STRFTIME('%Y-%m-%d', date) AS d,
                    symbol,
                    expiry,
                    MAX(underlying_price) AS spot
                FROM options_chain
                WHERE symbol = ?
                GROUP BY STRFTIME('%Y-%m-%d', date), symbol, expiry
            ),
            atm_ranked AS (
                -- Rank each strike by closeness to spot, separately per date
                SELECT
                    ds.d,
                    ds.symbol,
                    ds.expiry,
                    ds.spot,
                    o.strike,
                    ROW_NUMBER() OVER (
                        PARTITION BY ds.d, ds.symbol
                        ORDER BY ABS(o.strike - ds.spot)
                    ) AS rn
                FROM daily_spot ds
                JOIN options_chain o
                    ON STRFTIME('%Y-%m-%d', o.date) = ds.d
                    AND o.symbol = ds.symbol
                GROUP BY ds.d, ds.symbol, ds.expiry, ds.spot, o.strike
            ),
            atm_strike AS (
                SELECT d, symbol, expiry, spot, strike AS atm_strike
                FROM atm_ranked
                WHERE rn = 1
            ),
            straddle AS (
                -- ATM CE + PE LTP at the closest-to-spot strike
                SELECT
                    a.d          AS date,
                    a.symbol,
                    a.spot,
                    a.expiry,
                    a.atm_strike,
                    MAX(CASE WHEN o.option_type = 'CE' THEN o.ltp END) AS ce_ltp,
                    MAX(CASE WHEN o.option_type = 'PE' THEN o.ltp END) AS pe_ltp
                FROM atm_strike a
                JOIN options_chain o
                    ON STRFTIME('%Y-%m-%d', o.date) = a.d
                    AND o.symbol = a.symbol
                    AND o.strike = a.atm_strike
                GROUP BY a.d, a.symbol, a.spot, a.expiry, a.atm_strike
            )
            SELECT date, spot, atm_strike, expiry,
                   COALESCE(ce_ltp, 0) AS ce_ltp,
                   COALESCE(pe_ltp, 0) AS pe_ltp,
                   COALESCE(ce_ltp, 0) + COALESCE(pe_ltp, 0) AS straddle
            FROM straddle
            ORDER BY date
        """, [symbol]).fetchall()

    except Exception as e:
        log.error("expected_move_history(%s): %s", symbol, e, exc_info=True)
        return None

    if not rows:
        return None

    points: list[ExpectedMovePoint] = []
    for date_str, spot, atm_strike, expiry_str, ce_ltp, pe_ltp, straddle in rows:
        if spot <= 0 or straddle <= 0:
            continue

        # Business days from observation date to expiry (numpy)
        try:
            dte = int(np.busday_count(date_str, expiry_str))
        except Exception:
            dte = 1
        dte = max(dte, 1)

        monthly_em = straddle
        weekly_em  = straddle * math.sqrt(5  / dte)
        daily_em   = straddle * math.sqrt(1  / dte)

        points.append(ExpectedMovePoint(
            date=date_str,
            spot=round(spot, 2),
            atm_strike=float(atm_strike),
            expiry=expiry_str,
            dte=dte,
            straddle_premium=round(straddle, 2),
            ce_ltp=round(ce_ltp, 2),
            pe_ltp=round(pe_ltp, 2),
            daily_em=round(daily_em, 2),
            weekly_em=round(weekly_em, 2),
            monthly_em=round(monthly_em, 2),
            daily_em_pct=round(daily_em / spot * 100, 3),
            weekly_em_pct=round(weekly_em / spot * 100, 3),
            monthly_em_pct=round(monthly_em / spot * 100, 3),
        ))

    if not points:
        return None

    result = ExpectedMoveHistory(symbol=symbol, history=points)
    _em_cache[symbol] = result
    return result


def invalidate_em(symbol: str) -> None:
    _em_cache.pop(symbol, None)


# ── Expected Move Scan (all symbols × all dates) ──────────────────────────────

def _oi_dir(change: Optional[int]) -> str:
    if change is None:  return "—"
    if change > 0:      return "↑"
    if change < 0:      return "↓"
    return "—"


def _fut_dir(chg_pct: Optional[float]) -> str:
    if chg_pct is None: return "—"
    if chg_pct > 0:     return "↑"
    if chg_pct < 0:     return "↓"
    return "—"


def get_em_scan(invalidate: bool = False) -> Optional[EMScanResponse]:
    """Day-keyed, locked wrapper — one compute even under concurrent cold hits."""
    ensure_fo_views()
    _refresh_if_new_day(get_connection())
    if not invalidate and _em_scan_cache is not None:
        return _em_scan_cache
    with _scan_lock:
        if not invalidate and _em_scan_cache is not None:
            return _em_scan_cache
        return _build_em_scan(invalidate)


def _build_em_scan(invalidate: bool = False) -> Optional[EMScanResponse]:
    """Return Expected Move scan for all symbols — all historical dates embedded per symbol.

    Main row = latest date. history[] = previous dates, newest first.
    """
    global _em_scan_cache
    if not invalidate and _em_scan_cache is not None:
        return _em_scan_cache

    ensure_fo_views()
    try:
        con = get_connection()

        # ── 1. ATM straddle for every date × symbol ─────────────────────────
        # Rules:
        #  - Use only the nearest (front-month) expiry per symbol×date.
        #  - Select only the ATM strike where BOTH CE and PE have oi > 0.
        #  - Use mid-price (bid+ask)/2 when LTP is outside the spread (stale
        #    last trade). Fall back to LTP only when bid/ask are unavailable.
        straddle_rows = con.execute("""
            WITH all_spots AS (
                SELECT
                    STRFTIME('%Y-%m-%d', date) AS d,
                    symbol,
                    MIN(expiry)           AS expiry,
                    MAX(underlying_price) AS spot
                FROM options_chain
                GROUP BY STRFTIME('%Y-%m-%d', date), symbol
            ),
            liquid_strikes AS (
                -- strikes where BOTH CE and PE have open interest > 0
                SELECT
                    STRFTIME('%Y-%m-%d', o.date) AS d,
                    o.symbol, o.expiry, o.strike
                FROM options_chain o
                JOIN all_spots s
                    ON STRFTIME('%Y-%m-%d', o.date) = s.d
                    AND o.symbol = s.symbol
                    AND o.expiry = s.expiry
                WHERE o.oi > 0
                GROUP BY STRFTIME('%Y-%m-%d', o.date), o.symbol, o.expiry, o.strike
                HAVING COUNT(DISTINCT o.option_type) = 2
            ),
            atm_ranked AS (
                SELECT
                    s.d, s.symbol, s.expiry, s.spot, ls.strike,
                    ROW_NUMBER() OVER (
                        PARTITION BY s.d, s.symbol
                        ORDER BY ABS(ls.strike - s.spot)
                    ) AS rn
                FROM all_spots s
                JOIN liquid_strikes ls
                    ON ls.d = s.d AND ls.symbol = s.symbol AND ls.expiry = s.expiry
            ),
            atm AS (
                SELECT d, symbol, expiry, spot, strike AS atm_strike
                FROM atm_ranked WHERE rn = 1
            )
            SELECT
                a.d         AS date,
                a.symbol,
                a.spot,
                a.expiry,
                a.atm_strike,
                MAX(CASE WHEN o.option_type = 'CE' THEN
                    CASE
                        WHEN o.bid > 0 AND o.ask > 0 AND o.ltp BETWEEN o.bid AND o.ask THEN o.ltp
                        WHEN o.bid > 0 AND o.ask > 0 THEN LEAST(o.bid, o.ask)
                        ELSE o.ltp
                    END
                END) AS ce_ltp,
                MAX(CASE WHEN o.option_type = 'PE' THEN
                    CASE
                        WHEN o.bid > 0 AND o.ask > 0 AND o.ltp BETWEEN o.bid AND o.ask THEN o.ltp
                        WHEN o.bid > 0 AND o.ask > 0 THEN LEAST(o.bid, o.ask)
                        ELSE o.ltp
                    END
                END) AS pe_ltp
            FROM atm a
            JOIN options_chain o
                ON STRFTIME('%Y-%m-%d', o.date) = a.d
                AND o.symbol = a.symbol
                AND o.strike = a.atm_strike
                AND o.expiry = a.expiry
                AND o.oi > 0
            GROUP BY a.d, a.symbol, a.spot, a.expiry, a.atm_strike
            ORDER BY a.symbol, a.d
        """).fetchall()

        # ── 2. Zone OI changes for every date × symbol ──────────────────────
        zone_rows = con.execute("""
            WITH walls AS (
                SELECT
                    STRFTIME('%Y-%m-%d', date) AS d, symbol, option_type,
                    strike AS wall_strike,
                    ROW_NUMBER() OVER (
                        PARTITION BY STRFTIME('%Y-%m-%d', date), symbol, option_type
                        ORDER BY oi DESC
                    ) AS rn
                FROM options_chain
            ),
            ce_walls AS (SELECT d, symbol, wall_strike AS ce_wall FROM walls WHERE rn=1 AND option_type='CE'),
            pe_walls AS (SELECT d, symbol, wall_strike AS pe_wall FROM walls WHERE rn=1 AND option_type='PE')
            SELECT
                STRFTIME('%Y-%m-%d', o.date) AS d,
                o.symbol,
                MAX(cw.ce_wall)                                                                AS ce_wall,
                MAX(pw.pe_wall)                                                                AS pe_wall,
                SUM(CASE WHEN o.option_type='CE' AND o.strike <= cw.ce_wall THEN o.oi_change END) AS ce_zone_change,
                SUM(CASE WHEN o.option_type='PE' AND o.strike <= pw.pe_wall THEN o.oi_change END) AS pe_zone_change
            FROM options_chain o
            JOIN ce_walls cw ON STRFTIME('%Y-%m-%d', o.date) = cw.d AND o.symbol = cw.symbol
            JOIN pe_walls pw ON STRFTIME('%Y-%m-%d', o.date) = pw.d AND o.symbol = pw.symbol
            GROUP BY STRFTIME('%Y-%m-%d', o.date), o.symbol
        """).fetchall()

        # ── 3. Futures: LTP + LAG-based price change ─────────────────────────
        fut_rows: list = []
        try:
            fut_rows = con.execute("""
                WITH ordered AS (
                    SELECT
                        symbol,
                        STRFTIME('%Y-%m-%d', date) AS d,
                        ltp,
                        LAG(ltp) OVER (PARTITION BY symbol ORDER BY CAST(date AS DATE)) AS prev_ltp
                    FROM futures_chain
                )
                SELECT symbol, d, ltp,
                       CASE WHEN prev_ltp IS NOT NULL AND prev_ltp > 0
                            THEN (ltp - prev_ltp) / prev_ltp * 100
                       END AS chg_pct
                FROM ordered
            """).fetchall()
        except Exception:
            pass  # futures view absent

    except Exception as e:
        log.error("get_em_scan query: %s", e, exc_info=True)
        return None

    # ── Index into dicts for O(1) lookup ─────────────────────────────────────
    # zone: (symbol, date) → (ce_wall, pe_wall, ce_zone_change, pe_zone_change)
    zone_map: dict[tuple, tuple] = {}
    for d, sym, ce_wall, pe_wall, ce_chg, pe_chg in zone_rows:
        zone_map[(sym, d)] = (
            float(ce_wall) if ce_wall is not None else 0.0,
            float(pe_wall) if pe_wall is not None else 0.0,
            int(ce_chg) if ce_chg is not None else None,
            int(pe_chg) if pe_chg is not None else None,
        )

    # fut: (symbol, date) → (ltp, chg_pct)
    fut_map: dict[tuple, tuple] = {}
    for sym, d, ltp, chg_pct in fut_rows:
        fut_map[(sym, d)] = (
            float(ltp) if ltp is not None else None,
            float(chg_pct) if chg_pct is not None else None,
        )

    # ── Build per-symbol history lists ───────────────────────────────────────
    # sym_rows: symbol → [rows sorted by date ascending]
    from collections import defaultdict
    sym_rows: dict[str, list] = defaultdict(list)
    for date_str, sym, spot, expiry_str, atm_strike, ce_ltp, pe_ltp in straddle_rows:
        sym_rows[sym].append((date_str, float(spot or 0), expiry_str, float(atm_strike or 0),
                              float(ce_ltp or 0), float(pe_ltp or 0)))

    if not sym_rows:
        return None

    latest_date = max(
        rows[-1][0] for rows in sym_rows.values() if rows
    )

    result_rows: list[EMScanRow] = []
    for sym, date_entries in sorted(sym_rows.items()):
        # date_entries sorted ascending by SQL ORDER BY
        all_points: list[dict] = []
        for date_str, spot, expiry_str, atm_strike, ce_ltp, pe_ltp in date_entries:
            straddle = ce_ltp + pe_ltp
            if spot <= 0 or straddle <= 0:
                continue

            try:
                dte = max(int(np.busday_count(date_str, expiry_str)), 1)
            except Exception:
                dte = 1

            monthly_em = straddle

            ce_wall, pe_wall, ce_chg, pe_chg = zone_map.get(
                (sym, date_str), (0.0, 0.0, None, None)
            )
            fut_ltp, fut_chg_pct = fut_map.get((sym, date_str), (None, None))

            price_up: Optional[bool] = None
            if fut_chg_pct is not None:
                if fut_chg_pct > 0:   price_up = True
                elif fut_chg_pct < 0: price_up = False

            pcr = 1.0  # fallback; full PCR not needed for EM scan
            signal, signal_color = _build_signal(ce_chg, pe_chg, pcr, price_up)

            lower_bound = round(spot - monthly_em, 2)
            upper_bound = round(spot + monthly_em, 2)

            all_points.append({
                "date": date_str,
                "spot": round(spot, 2),
                "atm_strike": atm_strike,
                "expiry": expiry_str,
                "dte": dte,
                "ce_ltp": round(ce_ltp, 2),
                "pe_ltp": round(pe_ltp, 2),
                "straddle": round(straddle, 2),
                "monthly_em": round(monthly_em, 2),
                "lower_bound": lower_bound,
                "upper_bound": upper_bound,
                "ce_wall": ce_wall,
                "pe_wall": pe_wall,
                "lower_above_pe_wall": spot > pe_wall if pe_wall > 0 else False,
                "upper_above_ce_wall": spot > ce_wall if ce_wall > 0 else False,
                "ce_direction": _oi_dir(ce_chg),
                "pe_direction": _oi_dir(pe_chg),
                "futures_direction": _fut_dir(fut_chg_pct),
                "futures_ltp": round(fut_ltp, 2) if fut_ltp else None,
                "futures_chg_pct": round(fut_chg_pct, 3) if fut_chg_pct is not None else None,
                "signal": signal,
                "signal_color": signal_color,
            })

        if not all_points:
            continue

        # Latest point → main row; remainder → history (newest first)
        latest = all_points[-1]
        history_points = list(reversed(all_points[:-1]))

        days_in_series = len(all_points)

        history = [
            EMHistoryRow(
                date=p["date"],
                spot=p["spot"],
                atm_strike=p["atm_strike"],
                expiry=p["expiry"],
                dte=p["dte"],
                ce_ltp=p["ce_ltp"],
                pe_ltp=p["pe_ltp"],
                futures_ltp=p["futures_ltp"],
                futures_chg_pct=p["futures_chg_pct"],
                straddle_premium=p["straddle"],
                monthly_em=p["monthly_em"],
                lower_bound=p["lower_bound"],
                upper_bound=p["upper_bound"],
                ce_wall=p["ce_wall"],
                pe_wall=p["pe_wall"],
                lower_above_pe_wall=p["lower_above_pe_wall"],
                upper_above_ce_wall=p["upper_above_ce_wall"],
                ce_direction=p["ce_direction"],
                pe_direction=p["pe_direction"],
                futures_direction=p["futures_direction"],
                signal=p["signal"],
                signal_color=p["signal_color"],
            )
            for p in history_points
        ]

        result_rows.append(EMScanRow(
            symbol=sym,
            spot=latest["spot"],
            futures_ltp=latest["futures_ltp"],
            futures_chg_pct=latest["futures_chg_pct"],
            straddle_premium=latest["straddle"],
            ce_ltp=latest["ce_ltp"],
            pe_ltp=latest["pe_ltp"],
            monthly_em=latest["monthly_em"],
            lower_bound=latest["lower_bound"],
            upper_bound=latest["upper_bound"],
            ce_wall=latest["ce_wall"],
            pe_wall=latest["pe_wall"],
            lower_above_pe_wall=latest["lower_above_pe_wall"],
            upper_above_ce_wall=latest["upper_above_ce_wall"],
            ce_direction=latest["ce_direction"],
            pe_direction=latest["pe_direction"],
            futures_direction=latest["futures_direction"],
            signal=latest["signal"],
            signal_color=latest["signal_color"],
            atm_strike=latest["atm_strike"],
            expiry=latest["expiry"],
            dte=latest["dte"],
            days_in_series=days_in_series,
            history=history,
        ))

    # Default sort: monthly EM% descending (most volatile first)
    result_rows.sort(key=lambda r: r.monthly_em / r.spot if r.spot > 0 else 0, reverse=True)

    response = EMScanResponse(date=latest_date, rows=result_rows)
    _em_scan_cache = response
    return response


def invalidate_em_scan() -> None:
    global _em_scan_cache
    _em_scan_cache = None


# ── IV Smile / Skew Engine ────────────────────────────────────────────────────

def get_iv_smile(symbol: str, invalidate: bool = False) -> Optional[IVSmileResponse]:
    """Per-strike volatility smile + Black-Scholes greeks for the front expiry.

    For each strike we take the OTM-side IV (puts below spot, calls above spot —
    the standard smile convention), compute greeks from that IV, and derive skew
    metrics: 25-delta risk reversal, OLS skew slope, and put/call wing IVs.
    """
    ensure_fo_views()
    con = get_connection()

    try:
        con.execute("SELECT 1 FROM options_chain LIMIT 0")
    except Exception:
        log.warning("options_chain view not available for iv-smile")
        return None

    _refresh_if_new_day(con)
    if not invalidate and symbol in _iv_smile_cache:
        return _iv_smile_cache[symbol]

    try:
        row = con.execute(
            "SELECT MAX(date) FROM options_chain WHERE symbol = ?", [symbol]
        ).fetchone()
        if not row or not row[0]:
            return None
        latest_date = str(row[0])

        # Front (nearest) expiry only — the liquid smile
        exp_row = con.execute(
            "SELECT MIN(expiry) FROM options_chain WHERE symbol = ? AND date = ?",
            [symbol, latest_date],
        ).fetchone()
        if not exp_row or not exp_row[0]:
            return None
        expiry = str(exp_row[0])

        rows = con.execute("""
            SELECT strike, option_type, iv, oi, underlying_price
            FROM options_chain
            WHERE symbol = ? AND date = ? AND expiry = ?
            ORDER BY strike
        """, [symbol, latest_date, expiry]).fetchall()
    except Exception as e:
        log.error("options_service.get_iv_smile(%s): %s", symbol, e, exc_info=True)
        return None

    if not rows:
        return None

    # Group by strike, cleaning IV
    strike_map: dict[float, dict] = {}
    spot = 0.0
    for strike, opt_type, iv, oi, underlying_price in rows:
        spot = underlying_price or spot
        d = strike_map.setdefault(strike, {"ce_iv": None, "pe_iv": None, "ce_oi": 0, "pe_oi": 0})
        if opt_type == "CE":
            d["ce_iv"] = _clean_iv(iv)
            d["ce_oi"] = int(oi or 0)
        else:
            d["pe_iv"] = _clean_iv(iv)
            d["pe_oi"] = int(oi or 0)

    if spot <= 0:
        return None

    try:
        dte = max(int(np.busday_count(latest_date, expiry)), 1)
    except Exception:
        dte = 1

    sorted_strikes = sorted(strike_map.keys())
    atm_strike = _nearest_strike(sorted_strikes, spot)

    smile: list[IVSmileStrike] = []
    for k in sorted_strikes:
        d = strike_map[k]
        moneyness = (k - spot) / spot * 100.0
        ce_g = _bs_greeks(spot, k, d["ce_iv"], dte, "CE")
        pe_g = _bs_greeks(spot, k, d["pe_iv"], dte, "PE")

        # OTM-side IV: puts below spot, calls above spot, blend at ATM
        if k < spot:
            smile_iv = d["pe_iv"] if d["pe_iv"] is not None else d["ce_iv"]
        elif k > spot:
            smile_iv = d["ce_iv"] if d["ce_iv"] is not None else d["pe_iv"]
        else:
            both = [v for v in (d["ce_iv"], d["pe_iv"]) if v is not None]
            smile_iv = round(sum(both) / len(both), 2) if both else None

        smile.append(IVSmileStrike(
            strike=k,
            moneyness=round(moneyness, 2),
            ce_iv=d["ce_iv"],
            pe_iv=d["pe_iv"],
            smile_iv=round(smile_iv, 2) if smile_iv is not None else None,
            ce_delta=ce_g["delta"] if ce_g else None,
            pe_delta=pe_g["delta"] if pe_g else None,
            gamma=(ce_g or pe_g or {}).get("gamma"),
            vega=(ce_g or pe_g or {}).get("vega"),
            ce_theta=ce_g["theta"] if ce_g else None,
            pe_theta=pe_g["theta"] if pe_g else None,
            ce_oi=d["ce_oi"],
            pe_oi=d["pe_oi"],
        ))

    # ATM IV — cleaned avg of ATM CE + PE
    atm_d = strike_map.get(atm_strike, {})
    atm_ivs = [v for v in (atm_d.get("ce_iv"), atm_d.get("pe_iv")) if v is not None]
    atm_iv = round(sum(atm_ivs) / len(atm_ivs), 2) if atm_ivs else None

    # Skew slope: OLS of smile_iv vs moneyness (IV points per +1% OTM)
    xs = np.array([s.moneyness for s in smile if s.smile_iv is not None], dtype=float)
    ys = np.array([s.smile_iv for s in smile if s.smile_iv is not None], dtype=float)
    skew_slope = round(float(np.polyfit(xs, ys, 1)[0]), 4) if len(xs) >= 3 else None

    # 25-delta risk reversal = IV(25Δ put) - IV(25Δ call)  (+ = put skew)
    call_25 = min((s for s in smile if s.ce_delta is not None and s.ce_iv is not None),
                  key=lambda s: abs(s.ce_delta - 0.25), default=None)
    put_25 = min((s for s in smile if s.pe_delta is not None and s.pe_iv is not None),
                 key=lambda s: abs(s.pe_delta + 0.25), default=None)
    rr_25d = round(put_25.pe_iv - call_25.ce_iv, 2) if (call_25 and put_25) else None

    # Wing IVs: average smile_iv within the 8-12% OTM band on each side
    put_wing = [s.smile_iv for s in smile if s.smile_iv is not None and -12.0 <= s.moneyness <= -8.0]
    call_wing = [s.smile_iv for s in smile if s.smile_iv is not None and 8.0 <= s.moneyness <= 12.0]
    put_wing_iv = round(sum(put_wing) / len(put_wing), 2) if put_wing else None
    call_wing_iv = round(sum(call_wing) / len(call_wing), 2) if call_wing else None

    # IV-Rank / percentile over the persisted ATM-IV history
    _ensure_iv_history(con)
    iv_rank, iv_pct, iv_days = _iv_rank_for(symbol, atm_iv)

    result = IVSmileResponse(
        symbol=symbol,
        date=latest_date,
        expiry=expiry,
        dte=dte,
        spot=round(spot, 2),
        atm_strike=atm_strike,
        atm_iv=atm_iv,
        rr_25d=rr_25d,
        skew_slope=skew_slope,
        put_wing_iv=put_wing_iv,
        call_wing_iv=call_wing_iv,
        iv_rank=iv_rank,
        iv_percentile=iv_pct,
        iv_history_days=iv_days,
        atm_iv_history=_iv_history_series(symbol),
        strikes=smile,
        note=(f"Front expiry {expiry} ({dte} business days). Smile uses OTM-side IV "
              f"(puts below spot, calls above); greeks are Black-Scholes at r={_RISK_FREE:.1%}. "
              f"IV outside {_IV_MIN:.0f}-{_IV_MAX:.0f}% filtered as feed garbage."),
    )
    _iv_smile_cache[symbol] = result
    return result


def invalidate_iv_smile(symbol: str) -> None:
    _iv_smile_cache.pop(symbol, None)
