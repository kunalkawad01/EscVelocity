"""Options OI Analysis service — DuckDB-backed, in-process cache."""
import logging
import math
from typing import Optional

import numpy as np

from app.services.duckdb_client import get_connection, ensure_fo_views
from app.models.options import (
    OIAnalysis, StrikeData, MaxPainPoint, OIBuildupItem, OIScannerResponse,
    ExpectedMovePoint, ExpectedMoveHistory,
    EMHistoryRow, EMScanRow, EMScanResponse,
)

log = logging.getLogger(__name__)

_symbol_cache: dict[str, OIAnalysis] = {}
_scanner_cache: Optional[OIScannerResponse] = None
_em_cache: dict[str, ExpectedMoveHistory] = {}  # keyed by symbol
_em_scan_cache: Optional[EMScanResponse] = None


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
    if not invalidate and symbol in _symbol_cache:
        return _symbol_cache[symbol]

    ensure_fo_views()
    con = get_connection()

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
            ivs = [v for v in (atm_data["ce_iv"], atm_data["pe_iv"]) if v is not None]
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
