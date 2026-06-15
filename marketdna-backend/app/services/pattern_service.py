"""Pattern DNA Intelligence — production-grade chart pattern detection.

Detection Philosophy
────────────────────
Each detector works through an explicit checklist:

  • Mandatory price conditions — ALL must pass, or return None (no pattern forced).
  • Volume conditions          — Each scored independently; missing volume caps confidence.
  • Confidence                 = (conditions_passed / total) capped by volume tier.

Volume tiers:
  FULL    (all vol conditions met)  → confidence ceiling 90
  PARTIAL (some vol conditions met) → confidence ceiling 78
  NONE    (no vol confirmation)     → confidence ceiling 63  (research grade only)

Reference: Murphy "Technical Analysis of Financial Markets"; Bulkowski "Encyclopedia of Chart Patterns".
"""
import logging
import threading
import numpy as np
from datetime import date as _date
from datetime import datetime
from dataclasses import dataclass
from scipy.signal import argrelextrema

from collections import defaultdict

from app.services.duckdb_client import get_connection
from app.models.pattern import (
    PatternDetection, PatternDNAEntry, PatternDNAResponse,
    ScannerItem, PatternScannerResponse,
    ScreenerItem, PatternScreenerResponse,
    ConfirmedFormingItem, ConfirmedFormingResponse,
    PatternHistoryItem, PatternHistoryResponse,
    BreakoutTrackerItem, BreakoutTrackerResponse,
    HeatmapCell, PatternHeatmapResponse,
    RegimeBucket, RegimeDNAEntry, RegimeDNAResponse,
    PatternFailureItem, PatternFailureResponse,
)

log = logging.getLogger(__name__)

PATTERN_CATEGORIES: dict[str, str] = {
    "Double Bottom":           "Bullish Reversal",
    "Inverse Head & Shoulders":"Bullish Reversal",
    "Double Top":              "Bearish Reversal",
    "Head & Shoulders":        "Bearish Reversal",
    "Bull Flag":               "Bullish Continuation",
    "Ascending Triangle":      "Bullish Continuation",
    "Bear Flag":               "Bearish Continuation",
    "Descending Triangle":     "Bearish Continuation",
    "Rectangle":               "Neutral",
}

BEARISH_PATTERNS = {"Double Top", "Head & Shoulders", "Bear Flag", "Descending Triangle"}
ALL_PATTERNS = list(PATTERN_CATEGORIES.keys())


# ─── Timeframe configuration ──────────────────────────────────────────────────
# All bar-count thresholds live here so detectors stay timeframe-agnostic.

@dataclass(frozen=True)
class _TF:
    label: str
    ord: int              # argrelextrema order for standard pivots
    hs_ord: int           # argrelextrema order for H&S (larger = fewer pivots)
    db_lookback: int      # Double Bottom / Top max lookback
    db_sep_min: int       # min bars between the two troughs/peaks
    db_sep_max: int       # max bars between them
    db_recent: int        # 2nd trough/peak must be within this many bars of today
    hs_lookback: int      # H&S / Inv-H&S max lookback
    hs_rs_recent: int     # right shoulder must be within this many bars of today
    flag_poles: tuple     # candidate pole lengths (bars)
    flag_cons: tuple      # candidate consolidation lengths (bars)
    tri_lookback: int     # Triangle / Rectangle max lookback
    tri_min_bars: int     # minimum formation span (bars) for triangles
    rect_min_bars: int    # minimum formation span for rectangle


DAILY = _TF(
    label='daily',
    ord=5, hs_ord=8,
    db_lookback=150, db_sep_min=15, db_sep_max=80, db_recent=35,
    hs_lookback=220, hs_rs_recent=50,
    flag_poles=(15, 20, 25), flag_cons=(5, 8, 12, 16, 20),
    tri_lookback=100, tri_min_bars=20, rect_min_bars=15,
)

WEEKLY = _TF(
    label='weekly',
    ord=3, hs_ord=4,
    db_lookback=80,  db_sep_min=5,  db_sep_max=30, db_recent=12,
    hs_lookback=100, hs_rs_recent=20,
    flag_poles=(6, 8, 12), flag_cons=(2, 3, 5, 8),
    tri_lookback=60, tri_min_bars=8,  rect_min_bars=6,
)

TF_MAP: dict[str, _TF] = {'daily': DAILY, 'weekly': WEEKLY}


# ─── Data helpers ──────────────────────────────────────────────────────────────

def _fetch_data(
    symbol: str, timeframe: str = 'daily',
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Return (closes, highs, lows, volumes, dates). Resamples to weekly if requested."""
    con = get_connection()
    rows = con.execute(f"""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close, high, low, volume
        FROM equities_prices
        WHERE symbol = '{symbol}'
        ORDER BY date
        LIMIT 2000
    """).fetchall()
    dates  = [r[0] for r in rows]
    closes = np.array([r[1] for r in rows], dtype=float)
    highs  = np.array([r[2] for r in rows], dtype=float)
    lows   = np.array([r[3] for r in rows], dtype=float)
    vols   = np.array([r[4] for r in rows], dtype=float)

    if timeframe == 'weekly':
        closes, highs, lows, vols, dates = _resample_weekly(closes, highs, lows, vols, dates)

    return closes, highs, lows, vols, dates


def _resample_weekly(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Aggregate daily bars into ISO week bars (last trading day of each week)."""
    from collections import defaultdict
    week_idx: dict[str, list[int]] = defaultdict(list)
    for i, d in enumerate(dates):
        dt  = _date.fromisoformat(d)
        iso = dt.isocalendar()
        key = f"{iso[0]}-{iso[1]:02d}"
        week_idx[key].append(i)

    keys = sorted(week_idx.keys())
    w_closes = np.array([closes[week_idx[k][-1]] for k in keys], dtype=float)
    w_highs  = np.array([highs [np.array(week_idx[k])].max() for k in keys], dtype=float)
    w_lows   = np.array([lows  [np.array(week_idx[k])].min() for k in keys], dtype=float)
    w_vols   = np.array([vols  [np.array(week_idx[k])].sum() for k in keys], dtype=float)
    w_dates  = [dates[week_idx[k][-1]] for k in keys]
    return w_closes, w_highs, w_lows, w_vols, w_dates


def _get_symbols() -> list[str]:
    con = get_connection()
    rows = con.execute(
        "SELECT DISTINCT symbol FROM equities_prices ORDER BY symbol"
    ).fetchall()
    return [r[0] for r in rows]


# ─── Math helpers ──────────────────────────────────────────────────────────────

def _local_mins(prices: np.ndarray, order: int = 5) -> np.ndarray:
    return argrelextrema(prices, np.less, order=order)[0]


def _local_maxs(prices: np.ndarray, order: int = 5) -> np.ndarray:
    return argrelextrema(prices, np.greater, order=order)[0]


def _slope_pct(arr: np.ndarray) -> float:
    """Linear regression slope as % change per bar relative to array mean."""
    if len(arr) < 3:
        return 0.0
    x = np.arange(len(arr), dtype=float)
    slope = float(np.polyfit(x, arr, 1)[0])
    mean = float(arr.mean())
    return (slope / mean * 100) if mean > 1e-10 else 0.0


def _vol_around(vols: np.ndarray, idx: int, half_w: int = 3) -> float:
    """Mean volume in a ±half_w window centred on idx."""
    start = max(0, idx - half_w)
    end   = min(len(vols), idx + half_w + 1)
    return float(vols[start:end].mean())


def _vol_ratio(vols: np.ndarray, seg_start: int, seg_end: int, baseline: int = 20) -> float:
    """Mean volume in [seg_start:seg_end] divided by prior `baseline`-bar average."""
    pre_start = max(0, seg_start - baseline)
    if pre_start >= seg_start or seg_start >= seg_end:
        return 1.0
    base = float(vols[pre_start:seg_start].mean())
    if base < 1:
        return 1.0
    seg = vols[seg_start:seg_end]
    if len(seg) == 0:
        return 1.0
    return float(seg.mean()) / base


def _stage(current: float, breakout_level: float, bearish: bool = False) -> str:
    """Classify a pattern into its lifecycle stage."""
    if bearish:
        gap = (current - breakout_level) / (breakout_level + 1e-10)
        if gap < -0.01:
            return "Confirmed"
        if gap < 0.03:
            return "Breakout Watch"
        if gap < 0.10:
            return "Maturing"
        return "Forming"
    else:
        gap = (breakout_level - current) / (breakout_level + 1e-10)
        if gap < -0.01:
            return "Confirmed"
        if gap < 0.03:
            return "Breakout Watch"
        if gap < 0.10:
            return "Maturing"
        return "Forming"


def _rr(entry: float, stop: float, target: float) -> str:
    risk   = abs(entry - stop)
    reward = abs(target - entry)
    if risk < 0.001 * abs(entry):
        return "N/A"
    return f"1:{reward / risk:.1f}"


def _confidence(passed: int, total: int, vol_conditions_met: int, vol_total: int) -> int:
    """
    Confidence score with a ceiling determined by volume confirmation quality.

    Vol tier:
      FULL    (all vol)  → ceiling 90
      PARTIAL (some vol) → ceiling 78
      NONE    (no vol)   → ceiling 63
    """
    if vol_total == 0 or vol_conditions_met == vol_total:
        ceiling = 90
    elif vol_conditions_met > 0:
        ceiling = 78
    else:
        ceiling = 63
    raw = int(passed / total * 100) if total > 0 else 50
    return max(50, min(ceiling, raw))


# ─── Pattern Detectors ─────────────────────────────────────────────────────────
#
# Each detector:
#   1. Returns None immediately if any mandatory price condition fails.
#   2. Scores optional volume conditions separately.
#   3. Calls _confidence() to compute the final score.
#
# Mandatory conditions are written as explicit guards (fail → return None).
# Volume conditions are written as scored booleans.

def _detect_double_bottom(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Double Bottom (W pattern)

    Mandatory price conditions:
      P1. Two distinct troughs found within last 150 bars
      P2. Trough separation: 15–80 bars
      P3. Troughs within 3% of each other (alignment)
      P4. Neckline peak between troughs rises ≥5% above trough average (clear valley)
      P5. Second trough within last 35 bars (recently formed)
      P6. Current price within 8% below neckline (approaching breakout)

    Volume conditions (Murphy Vol. chap 6):
      V1. 2nd-trough volume ≤ 1.15× 1st-trough volume — selling exhaustion
      V2. Volume in rally from 2nd trough > 85% of prior 20-bar avg — accumulation
    """
    n = len(closes)
    if n < tf.db_sep_min * 2:
        return None

    w  = min(tf.db_lookback, n)
    p  = closes[-w:]
    lo = lows[-w:]
    v  = vols[-w:]
    wn = len(p)

    mins = _local_mins(lo, order=tf.ord)
    if len(mins) < 2:
        return None

    # Scan pairs, most recent second trough first
    for i in range(len(mins) - 1, 0, -1):
        m2i = int(mins[i])
        bars_since = (wn - 1) - m2i

        # P5: second trough must be recent
        if bars_since > tf.db_recent:
            break

        for j in range(i - 1, max(i - 6, -1), -1):
            m1i = int(mins[j])
            sep = m2i - m1i

            # P2: separation
            if sep < tf.db_sep_min:
                continue
            if sep > tf.db_sep_max:
                break

            m1v = lo[m1i]
            m2v = lo[m2i]

            # P3: trough alignment within 3%
            if abs(m1v - m2v) / (min(m1v, m2v) + 1e-10) > 0.03:
                continue

            # P4: neckline rises ≥5% above trough average
            neckline = float(p[m1i:m2i + 1].max())
            trough_avg = (m1v + m2v) / 2.0
            if neckline / (trough_avg + 1e-10) - 1.0 < 0.05:
                continue

            current = float(p[-1])

            # P6: current price within 8% below neckline (or slightly above = confirmed)
            to_neck = (neckline - current) / (neckline + 1e-10)
            if to_neck > 0.08 or to_neck < -0.05:
                continue

            # All 6 mandatory price conditions passed.
            # Score volume conditions.
            v1 = _vol_around(v, m1i)
            v2 = _vol_around(v, m2i)

            vol_c1 = (v1 > 1) and (v2 <= v1 * 1.15)   # V1: exhaustion
            vol_c2 = False
            rally_start = m2i + 1
            if rally_start < wn - 1:
                vol_c2 = _vol_ratio(v, rally_start, wn, baseline=20) > 0.85  # V2: accumulation

            vol_met = int(vol_c1) + int(vol_c2)
            conf = _confidence(
                passed=6 + vol_met, total=8,
                vol_conditions_met=vol_met, vol_total=2,
            )

            target = round(neckline + (neckline - trough_avg), 2)
            return PatternDetection(
                symbol=symbol,
                pattern="Double Bottom",
                category="Bullish Reversal",
                confidence=conf,
                stage=_stage(current, neckline),
                days_forming=sep + bars_since,
                breakout_level=round(neckline * 1.002, 2),
                support_level=round(float(lo[m2i]), 2),
                resistance_level=round(neckline, 2),
                risk_reward=_rr(current, float(lo[m2i]), target),
                detected_date=dates[-1],
            )

    return None


def _detect_double_top(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Double Top (M pattern)

    Mandatory price conditions:
      P1–P6 mirror Double Bottom but on highs.

    Volume conditions:
      V1. 2nd-peak volume ≤ 1.15× 1st-peak volume — buying exhaustion
      V2. Volume in decline from 2nd peak > 85% of prior avg — distribution
    """
    n = len(closes)
    if n < tf.db_sep_min * 2:
        return None

    w  = min(tf.db_lookback, n)
    p  = closes[-w:]
    hi = highs[-w:]
    v  = vols[-w:]
    wn = len(p)

    maxs = _local_maxs(hi, order=tf.ord)
    if len(maxs) < 2:
        return None

    for i in range(len(maxs) - 1, 0, -1):
        m2i = int(maxs[i])
        bars_since = (wn - 1) - m2i
        if bars_since > tf.db_recent:
            break

        for j in range(i - 1, max(i - 6, -1), -1):
            m1i = int(maxs[j])
            sep = m2i - m1i
            if sep < tf.db_sep_min:
                continue
            if sep > tf.db_sep_max:
                break

            m1v = hi[m1i]
            m2v = hi[m2i]

            if abs(m1v - m2v) / (min(m1v, m2v) + 1e-10) > 0.03:
                continue

            neckline = float(p[m1i:m2i + 1].min())
            peak_avg = (m1v + m2v) / 2.0
            if peak_avg / (neckline + 1e-10) - 1.0 < 0.05:
                continue

            current = float(p[-1])
            to_neck = (current - neckline) / (neckline + 1e-10)
            if to_neck > 0.08 or to_neck < -0.05:
                continue

            v1 = _vol_around(v, m1i)
            v2 = _vol_around(v, m2i)
            vol_c1 = (v1 > 1) and (v2 <= v1 * 1.15)

            decline_start = m2i + 1
            vol_c2 = False
            if decline_start < wn - 1:
                vol_c2 = _vol_ratio(v, decline_start, wn, baseline=20) > 0.85

            vol_met = int(vol_c1) + int(vol_c2)
            conf = _confidence(
                passed=6 + vol_met, total=8,
                vol_conditions_met=vol_met, vol_total=2,
            )

            target = round(neckline - (peak_avg - neckline), 2)
            return PatternDetection(
                symbol=symbol,
                pattern="Double Top",
                category="Bearish Reversal",
                confidence=conf,
                stage=_stage(current, neckline, bearish=True),
                days_forming=sep + bars_since,
                breakout_level=round(neckline * 0.998, 2),
                support_level=round(neckline, 2),
                resistance_level=round(float(hi[m2i]), 2),
                risk_reward=_rr(current, float(hi[m2i]), target),
                detected_date=dates[-1],
            )

    return None


def _detect_head_and_shoulders(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Head & Shoulders (bearish reversal)

    Mandatory price conditions:
      P1. Three clear peaks: left shoulder (LS), head (H), right shoulder (RS)
      P2. Head exceeds both shoulders by ≥3%
      P3. Shoulders within 6% of each other
      P4. Neckline troughs within 5% of each other (roughly level)
      P5. Right shoulder within last 50 bars
      P6. Current price within 8% of neckline

    Volume conditions (classic distribution signature):
      V1. Left-shoulder avg volume > right-shoulder avg volume
      V2. Head avg volume ≤ left-shoulder avg volume (momentum waning)
      V3. Volume after right shoulder > 20-bar prior avg (selling pressure)
    """
    n = len(closes)
    if n < tf.hs_ord * 3:
        return None

    w   = min(tf.hs_lookback, n)
    p   = closes[-w:]
    hi  = highs[-w:]
    lo  = lows[-w:]
    v   = vols[-w:]
    wn  = len(p)

    maxs = _local_maxs(hi, order=tf.hs_ord)
    if len(maxs) < 3:
        return None

    # Try triplets, most recent RS first
    for k in range(len(maxs) - 1, 1, -1):
        rs_i = int(maxs[k])
        if (wn - 1) - rs_i > tf.hs_rs_recent:  # P5
            break

        for j in range(k - 1, 0, -1):
            hd_i = int(maxs[j])
            for i in range(j - 1, -1, -1):
                ls_i = int(maxs[i])

                ls = hi[ls_i]
                hd = hi[hd_i]
                rs = hi[rs_i]

                # P2: head exceeds both shoulders by ≥3%
                if not (hd > ls * 1.03 and hd > rs * 1.03):
                    continue
                # P3: shoulders within 6%
                if abs(ls - rs) / (min(ls, rs) + 1e-10) > 0.06:
                    continue

                # Neckline: trough between LS-HD and trough between HD-RS
                t1 = float(lo[ls_i:hd_i + 1].min()) if hd_i > ls_i else float(lo[ls_i])
                t2 = float(lo[hd_i:rs_i + 1].min()) if rs_i > hd_i else float(lo[hd_i])

                # P4: neckline troughs within 5%
                if abs(t1 - t2) / (min(t1, t2) + 1e-10) > 0.05:
                    continue

                neckline = (t1 + t2) / 2.0
                current  = float(p[-1])

                # P6: price near neckline
                to_neck = (current - neckline) / (neckline + 1e-10)
                if to_neck > 0.08 or to_neck < -0.05:
                    continue

                # Volume scoring
                v_ls = _vol_around(v, ls_i, half_w=5)
                v_hd = _vol_around(v, hd_i, half_w=5)
                v_rs = _vol_around(v, rs_i, half_w=5)

                vol_c1 = v_ls > v_rs                        # V1: distribution
                vol_c2 = v_hd <= v_ls * 1.05               # V2: weakening momentum
                vol_c3 = _vol_ratio(v, rs_i + 1, wn, 20) > 0.90  # V3: selling pressure

                vol_met = int(vol_c1) + int(vol_c2) + int(vol_c3)
                conf = _confidence(
                    passed=6 + vol_met, total=9,
                    vol_conditions_met=vol_met, vol_total=3,
                )

                target = round(neckline - (float(hd) - neckline), 2)
                return PatternDetection(
                    symbol=symbol,
                    pattern="Head & Shoulders",
                    category="Bearish Reversal",
                    confidence=conf,
                    stage=_stage(current, neckline, bearish=True),
                    days_forming=(wn - 1) - ls_i,
                    breakout_level=round(neckline * 0.998, 2),
                    support_level=round(neckline, 2),
                    resistance_level=round(float(hd), 2),
                    risk_reward=_rr(current, float(hd), target),
                    detected_date=dates[-1],
                )

    return None


def _detect_inv_head_and_shoulders(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Inverse Head & Shoulders (bullish reversal)

    Mirror of H&S on lows. Three troughs where the middle (head) is deepest.

    Volume conditions (accumulation signature):
      V1. Right-shoulder avg volume > left-shoulder avg volume (increasing participation)
      V2. Head avg volume ≥ left-shoulder avg volume (climactic selling)
      V3. Volume in rally from right shoulder > prior 20-bar avg (demand)
    """
    n = len(closes)
    if n < 120:
        return None

    w   = min(tf.hs_lookback, n)
    p   = closes[-w:]
    lo  = lows[-w:]
    v   = vols[-w:]
    wn  = len(p)

    mins = _local_mins(lo, order=tf.hs_ord)
    if len(mins) < 3:
        return None

    for k in range(len(mins) - 1, 1, -1):
        rs_i = int(mins[k])
        if (wn - 1) - rs_i > tf.hs_rs_recent:
            break

        for j in range(k - 1, 0, -1):
            hd_i = int(mins[j])
            for i in range(j - 1, -1, -1):
                ls_i = int(mins[i])

                ls = lo[ls_i]
                hd = lo[hd_i]
                rs = lo[rs_i]

                # Head must be deepest (lowest)
                if not (hd < ls * 0.97 and hd < rs * 0.97):
                    continue
                if abs(ls - rs) / (min(ls, rs) + 1e-10) > 0.06:
                    continue

                # Neckline: peaks between shoulders
                pk1 = float(p[ls_i:hd_i + 1].max()) if hd_i > ls_i else float(p[ls_i])
                pk2 = float(p[hd_i:rs_i + 1].max()) if rs_i > hd_i else float(p[hd_i])

                if abs(pk1 - pk2) / (min(pk1, pk2) + 1e-10) > 0.05:
                    continue

                neckline = (pk1 + pk2) / 2.0
                current  = float(p[-1])
                to_neck  = (neckline - current) / (neckline + 1e-10)
                if to_neck > 0.08 or to_neck < -0.05:
                    continue

                v_ls = _vol_around(v, ls_i, half_w=5)
                v_hd = _vol_around(v, hd_i, half_w=5)
                v_rs = _vol_around(v, rs_i, half_w=5)

                vol_c1 = v_rs >= v_ls * 0.85               # V1: growing participation
                vol_c2 = v_hd >= v_ls * 0.95               # V2: climactic bottom
                vol_c3 = _vol_ratio(v, rs_i + 1, wn, 20) > 0.90  # V3: demand

                vol_met = int(vol_c1) + int(vol_c2) + int(vol_c3)
                conf = _confidence(
                    passed=6 + vol_met, total=9,
                    vol_conditions_met=vol_met, vol_total=3,
                )

                target = round(neckline + (neckline - float(hd)), 2)
                return PatternDetection(
                    symbol=symbol,
                    pattern="Inverse Head & Shoulders",
                    category="Bullish Reversal",
                    confidence=conf,
                    stage=_stage(current, neckline),
                    days_forming=(wn - 1) - ls_i,
                    breakout_level=round(neckline * 1.002, 2),
                    support_level=round(float(lo[rs_i]), 2),
                    resistance_level=round(neckline, 2),
                    risk_reward=_rr(current, float(lo[rs_i]), target),
                    detected_date=dates[-1],
                )

    return None


def _detect_bull_flag(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Bull Flag (bullish continuation)

    Mandatory price conditions:
      P1. Pole: ≥12% return in 10–25 bars (strong directional move)
      P2. Consolidation: 5–20 bars
      P3. Consolidation range: < 40% of pole height (tight flag, not a full reversal)
      P4. Flag slope: ≤ +1.5% per bar (not accelerating upward — that's a wedge)
      P5. Current price within flag channel (no premature breakout)

    Volume conditions (textbook flag signature):
      V1. Pole avg volume > 1.25× prior 20-bar avg (momentum surge)
      V2. Flag avg volume < pole avg volume (natural contraction)
      V3. Flag volume trend: declining (slope < 0 within flag)
    """
    n = len(closes)
    best: PatternDetection | None = None
    best_conf = 0

    for pole_w in tf.flag_poles:
        for cons_w in tf.flag_cons:
            needed = pole_w + cons_w + 5
            if n < needed:
                continue

            pole_start = -(pole_w + cons_w)
            pole_end   = -cons_w

            pole_ret = (closes[pole_end - 1] / closes[pole_start] - 1) * 100

            # P1: strong pole
            if pole_ret < 12.0:
                continue

            flag = closes[-cons_w:]
            flag_hi = highs[-cons_w:]
            flag_lo = lows[-cons_w:]

            flag_range_pct = (flag_hi.max() - flag_lo.min()) / (flag_lo.min() + 1e-10) * 100

            # P3: tight consolidation (< 40% of pole height)
            pole_height_pct = pole_ret
            if flag_range_pct > pole_height_pct * 0.40:
                continue

            # P4: flag slope not sharply upward
            if _slope_pct(flag) > 1.5:
                continue

            current   = float(closes[-1])
            flag_high = float(flag_hi.max())
            flag_low  = float(flag_lo.min())

            # P5: price still within or just above flag (confirmed = within 1%)
            if current > flag_high * 1.01:
                continue

            # Volume scoring
            pole_idx_start = n + pole_start
            pole_idx_end   = n + pole_end
            flag_idx_start = n - cons_w

            v_pole = _vol_ratio(vols, pole_idx_start, pole_idx_end, baseline=20)
            v_flag_mean = float(vols[flag_idx_start:].mean())
            v_pole_mean = float(vols[pole_idx_start:pole_idx_end].mean())

            vol_c1 = v_pole > 1.25                                 # V1: surge
            vol_c2 = v_pole_mean > 1 and v_flag_mean < v_pole_mean # V2: contraction
            vol_c3 = _slope_pct(vols[flag_idx_start:]) < 0         # V3: declining flag vol

            vol_met = int(vol_c1) + int(vol_c2) + int(vol_c3)
            conf = _confidence(
                passed=5 + vol_met, total=8,
                vol_conditions_met=vol_met, vol_total=3,
            )

            if conf > best_conf:
                best_conf = conf
                pole_high  = float(closes[pole_idx_end - 1])
                pole_low   = float(closes[pole_idx_start])
                target     = round(pole_high + (pole_high - pole_low), 2)
                stage = "Breakout Watch" if current >= flag_high * 0.98 else "Forming"

                best = PatternDetection(
                    symbol=symbol,
                    pattern="Bull Flag",
                    category="Bullish Continuation",
                    confidence=conf,
                    stage=stage,
                    days_forming=pole_w + cons_w,
                    breakout_level=round(flag_high * 1.005, 2),
                    support_level=round(flag_low, 2),
                    resistance_level=round(flag_high, 2),
                    risk_reward=_rr(current, flag_low, target),
                    detected_date=dates[-1],
                )

    return best


def _detect_bear_flag(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Bear Flag (bearish continuation)

    Mirror of Bull Flag. Mandatory conditions:
      P1. Pole: ≤ -12% return (sharp decline)
      P2–P5: mirror of Bull Flag.

    Volume conditions:
      V1. Pole avg volume > 1.25× prior avg (panic selling surge)
      V2. Flag avg volume < pole avg volume (dead-cat-bounce exhaustion)
      V3. Flag volume trend: declining or flat
    """
    n = len(closes)
    best: PatternDetection | None = None
    best_conf = 0

    for pole_w in tf.flag_poles:
        for cons_w in tf.flag_cons:
            needed = pole_w + cons_w + 5
            if n < needed:
                continue

            pole_start = -(pole_w + cons_w)
            pole_end   = -cons_w
            pole_ret   = (closes[pole_end - 1] / closes[pole_start] - 1) * 100

            if pole_ret > -12.0:
                continue

            flag    = closes[-cons_w:]
            flag_hi = highs[-cons_w:]
            flag_lo = lows[-cons_w:]
            flag_range_pct = (flag_hi.max() - flag_lo.min()) / (flag_lo.min() + 1e-10) * 100

            if flag_range_pct > abs(pole_ret) * 0.40:
                continue

            if _slope_pct(flag) < -1.5:
                continue

            current   = float(closes[-1])
            flag_high = float(flag_hi.max())
            flag_low  = float(flag_lo.min())

            if current < flag_low * 0.99:
                continue

            pole_idx_start = n + pole_start
            pole_idx_end   = n + pole_end
            flag_idx_start = n - cons_w

            v_pole     = _vol_ratio(vols, pole_idx_start, pole_idx_end, baseline=20)
            v_flag_mean = float(vols[flag_idx_start:].mean())
            v_pole_mean = float(vols[pole_idx_start:pole_idx_end].mean())

            vol_c1 = v_pole > 1.25
            vol_c2 = v_pole_mean > 1 and v_flag_mean < v_pole_mean
            vol_c3 = _slope_pct(vols[flag_idx_start:]) < 0

            vol_met = int(vol_c1) + int(vol_c2) + int(vol_c3)
            conf = _confidence(
                passed=5 + vol_met, total=8,
                vol_conditions_met=vol_met, vol_total=3,
            )

            if conf > best_conf:
                best_conf = conf
                pole_high = float(closes[pole_idx_end - 1])
                pole_low  = float(closes[pole_idx_start])
                target    = round(pole_high - (pole_low - pole_high), 2)
                stage = "Breakout Watch" if current <= flag_low * 1.02 else "Forming"

                best = PatternDetection(
                    symbol=symbol,
                    pattern="Bear Flag",
                    category="Bearish Continuation",
                    confidence=conf,
                    stage=stage,
                    days_forming=pole_w + cons_w,
                    breakout_level=round(flag_low * 0.995, 2),
                    support_level=round(flag_low, 2),
                    resistance_level=round(flag_high, 2),
                    risk_reward=_rr(current, flag_high, target),
                    detected_date=dates[-1],
                )

    return best


def _detect_ascending_triangle(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Ascending Triangle (bullish continuation)

    Mandatory price conditions:
      P1. At least 3 touches of flat resistance (coefficient of variation < 2%)
      P2. At least 3 higher lows (rising support)
      P3. Pattern spans at least 20 bars
      P4. Current price in upper 40% of triangle width

    Volume conditions:
      V1. Volume declines through the formation (contraction is bullish for triangles)
      V2. Volume on recent resistance touches > volume on recent troughs (buying pressure)
    """
    n = len(closes)
    if n < 60:
        return None

    w   = min(tf.tri_lookback, n)
    p   = closes[-w:]
    hi  = highs[-w:]
    lo  = lows[-w:]
    v   = vols[-w:]
    wn  = len(p)

    maxs = _local_maxs(hi, order=4)
    mins = _local_mins(lo, order=4)
    if len(maxs) < 3 or len(mins) < 3:
        return None

    recent_maxs = maxs[-5:] if len(maxs) >= 5 else maxs
    recent_mins = mins[-5:] if len(mins) >= 5 else mins

    top_vals = hi[recent_maxs]
    bot_vals = lo[recent_mins]

    # P1: flat resistance (CV < 2%)
    res_cv = top_vals.std() / (top_vals.mean() + 1e-10)
    if res_cv > 0.02:
        return None

    # P2: rising lows
    if not all(bot_vals[i] <= bot_vals[i + 1] for i in range(len(bot_vals) - 1)):
        return None

    # P3: pattern spans ≥ tri_min_bars
    formation_start = int(recent_maxs[0])
    if (wn - 1) - formation_start < tf.tri_min_bars:
        return None

    resistance = float(top_vals.mean())
    support    = float(bot_vals[-1])
    current    = float(p[-1])
    triangle_w = resistance - support

    # P4: price in upper 40% of triangle
    if triangle_w > 0 and (resistance - current) / triangle_w > 0.40:
        return None

    # Volume scoring
    vol_slope = _slope_pct(v[formation_start:])
    vol_c1 = vol_slope < 0  # V1: declining volume = coiling

    # V2: avg volume at resistance touches vs trough touches
    v_res = float(np.mean([_vol_around(v, int(idx)) for idx in recent_maxs]))
    v_sup = float(np.mean([_vol_around(v, int(idx)) for idx in recent_mins]))
    vol_c2 = v_res > v_sup * 0.90  # buying on resistance tests

    vol_met = int(vol_c1) + int(vol_c2)
    conf = _confidence(
        passed=4 + vol_met, total=6,
        vol_conditions_met=vol_met, vol_total=2,
    )

    breakout = round(resistance * 1.005, 2)
    target   = round(breakout + (resistance - float(bot_vals[0])), 2)
    return PatternDetection(
        symbol=symbol,
        pattern="Ascending Triangle",
        category="Bullish Continuation",
        confidence=conf,
        stage=_stage(current, breakout),
        days_forming=(wn - 1) - formation_start,
        breakout_level=breakout,
        support_level=round(support, 2),
        resistance_level=round(resistance, 2),
        risk_reward=_rr(current, support, target),
        detected_date=dates[-1],
    )


def _detect_descending_triangle(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Descending Triangle (bearish continuation)

    Mirror of Ascending Triangle.

    Mandatory:
      P1. At least 3 touches of flat support (CV < 2%)
      P2. At least 3 lower highs (declining resistance)
      P3. Pattern spans ≥20 bars
      P4. Current price in lower 40% of triangle width

    Volume conditions:
      V1. Volume declines through formation
      V2. Volume on support tests ≥ volume on resistance tests (selling pressure at support)
    """
    n = len(closes)
    if n < 60:
        return None

    w   = min(tf.tri_lookback, n)
    p   = closes[-w:]
    hi  = highs[-w:]
    lo  = lows[-w:]
    v   = vols[-w:]
    wn  = len(p)

    maxs = _local_maxs(hi, order=4)
    mins = _local_mins(lo, order=4)
    if len(maxs) < 3 or len(mins) < 3:
        return None

    recent_maxs = maxs[-5:] if len(maxs) >= 5 else maxs
    recent_mins = mins[-5:] if len(mins) >= 5 else mins

    top_vals = hi[recent_maxs]
    bot_vals = lo[recent_mins]

    # P1: flat support
    sup_cv = bot_vals.std() / (bot_vals.mean() + 1e-10)
    if sup_cv > 0.02:
        return None

    # P2: lower highs
    if not all(top_vals[i] >= top_vals[i + 1] for i in range(len(top_vals) - 1)):
        return None

    formation_start = int(recent_mins[0])
    if (wn - 1) - formation_start < tf.tri_min_bars:
        return None

    support    = float(bot_vals.mean())
    resistance = float(top_vals[-1])
    current    = float(p[-1])
    triangle_w = resistance - support

    if triangle_w > 0 and (current - support) / triangle_w > 0.40:
        return None

    vol_slope = _slope_pct(v[formation_start:])
    vol_c1 = vol_slope < 0

    v_res = float(np.mean([_vol_around(v, int(idx)) for idx in recent_maxs]))
    v_sup = float(np.mean([_vol_around(v, int(idx)) for idx in recent_mins]))
    vol_c2 = v_sup >= v_res * 0.90

    vol_met = int(vol_c1) + int(vol_c2)
    conf = _confidence(
        passed=4 + vol_met, total=6,
        vol_conditions_met=vol_met, vol_total=2,
    )

    breakdown = round(support * 0.995, 2)
    target    = round(breakdown - (resistance - support), 2)
    return PatternDetection(
        symbol=symbol,
        pattern="Descending Triangle",
        category="Bearish Continuation",
        confidence=conf,
        stage=_stage(current, breakdown, bearish=True),
        days_forming=(wn - 1) - formation_start,
        breakout_level=breakdown,
        support_level=round(support, 2),
        resistance_level=round(resistance, 2),
        risk_reward=_rr(current, resistance, target),
        detected_date=dates[-1],
    )


def _detect_rectangle(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF = DAILY,
) -> PatternDetection | None:
    """
    Rectangle / Trading Range (neutral)

    Mandatory price conditions:
      P1. At least 2 resistance touches within 3% of each other
      P2. At least 2 support touches within 3% of each other
      P3. Range height ≥6% (meaningful range, not noise)
      P4. At least 2 oscillations between support and resistance (price visited both sides)
      P5. Pattern spans ≥15 bars
      P6. Current price inside the range

    Volume conditions:
      V1. Volume does not strongly favour either direction (balanced range)
      V2. Volume rising near range boundaries (anticipation of breakout)
    """
    n = len(closes)
    if n < 60:
        return None

    w   = min(tf.tri_lookback, n)
    p   = closes[-w:]
    hi  = highs[-w:]
    lo  = lows[-w:]
    v   = vols[-w:]
    wn  = len(p)

    maxs = _local_maxs(hi, order=4)
    mins = _local_mins(lo, order=4)
    if len(maxs) < 2 or len(mins) < 2:
        return None

    recent_maxs = maxs[-4:] if len(maxs) >= 4 else maxs
    recent_mins = mins[-4:] if len(mins) >= 4 else mins

    top_vals = hi[recent_maxs]
    bot_vals = lo[recent_mins]

    # P1: resistance touches within 3%
    if top_vals.std() / (top_vals.mean() + 1e-10) > 0.03:
        return None

    # P2: support touches within 3%
    if bot_vals.std() / (bot_vals.mean() + 1e-10) > 0.03:
        return None

    resistance = float(top_vals.mean())
    support    = float(bot_vals.mean())
    range_pct  = (resistance - support) / (support + 1e-10)

    # P3: meaningful range
    if range_pct < 0.06:
        return None

    # P4: oscillations — interleaved pivots (alternating high/low)
    all_pivots = [(int(idx), 'H') for idx in recent_maxs] + [(int(idx), 'L') for idx in recent_mins]
    all_pivots.sort(key=lambda x: x[0])
    oscillations = sum(
        1 for i in range(1, len(all_pivots))
        if all_pivots[i][1] != all_pivots[i - 1][1]
    )
    if oscillations < 2:
        return None

    formation_start = min(int(recent_maxs[0]), int(recent_mins[0]))

    # P5: ≥ rect_min_bars
    if (wn - 1) - formation_start < tf.rect_min_bars:
        return None

    current = float(p[-1])

    # P6: inside range
    if current >= resistance * 1.02 or current <= support * 0.98:
        return None

    # Volume scoring
    v_first_half = float(v[formation_start:formation_start + (wn - formation_start) // 2].mean())
    v_second_half = float(v[formation_start + (wn - formation_start) // 2:].mean())
    vol_c1 = abs(v_first_half - v_second_half) / (v_first_half + 1e-10) < 0.30  # V1: balanced

    boundary_dist = min(
        (resistance - current) / (resistance + 1e-10),
        (current - support) / (support + 1e-10),
    )
    vol_c2 = boundary_dist < 0.05 and _vol_ratio(v, wn - 5, wn, 20) > 0.95  # V2: boundary vol

    vol_met = int(vol_c1) + int(vol_c2)
    conf = _confidence(
        passed=6 + vol_met, total=8,
        vol_conditions_met=vol_met, vol_total=2,
    )

    target_up   = round(resistance + (resistance - support), 2)
    target_down = round(support - (resistance - support), 2)
    closer_to_resistance = (resistance - current) < (current - support)
    target  = target_up if closer_to_resistance else target_down
    stop    = support if closer_to_resistance else resistance
    breakout = round(resistance * 1.005, 2) if closer_to_resistance else round(support * 0.995, 2)

    return PatternDetection(
        symbol=symbol,
        pattern="Rectangle",
        category="Neutral",
        confidence=conf,
        stage=_stage(current, breakout, bearish=not closer_to_resistance),
        days_forming=(wn - 1) - formation_start,
        breakout_level=breakout,
        support_level=round(support, 2),
        resistance_level=round(resistance, 2),
        risk_reward=_rr(current, stop, target),
        detected_date=dates[-1],
    )


# ─── Public: detect current patterns ──────────────────────────────────────────

def _run_detectors(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, dates: list[str], symbol: str, tf: _TF,
) -> list[PatternDetection]:
    """Run all 9 detectors on pre-loaded arrays — shared by scanner and single-symbol path."""
    detectors = [
        lambda: _detect_double_bottom(closes, highs, lows, vols, dates, symbol, tf),
        lambda: _detect_double_top(closes, highs, lows, vols, dates, symbol, tf),
        lambda: _detect_head_and_shoulders(closes, highs, lows, vols, dates, symbol, tf),
        lambda: _detect_inv_head_and_shoulders(closes, highs, lows, vols, dates, symbol, tf),
        lambda: _detect_bull_flag(closes, highs, lows, vols, dates, symbol, tf),
        lambda: _detect_bear_flag(closes, highs, lows, vols, dates, symbol, tf),
        lambda: _detect_ascending_triangle(closes, highs, lows, vols, dates, symbol, tf),
        lambda: _detect_descending_triangle(closes, highs, lows, vols, dates, symbol, tf),
        lambda: _detect_rectangle(closes, highs, lows, vols, dates, symbol, tf),
    ]
    results: list[PatternDetection] = []
    for fn in detectors:
        try:
            p = fn()
            if p is not None:
                results.append(p)
        except Exception as exc:
            log.debug("Detector error for %s: %s", symbol, exc)
    results.sort(key=lambda x: x.confidence, reverse=True)
    return results


def detect_current_patterns(symbol: str, timeframe: str = 'daily') -> list[PatternDetection]:
    """Run all detectors on the most recent price structure. Returns [] if nothing qualifies."""
    tf = TF_MAP.get(timeframe, DAILY)
    try:
        closes, highs, lows, vols, dates = _fetch_data(symbol, timeframe=timeframe)
    except Exception as exc:
        log.warning("Pattern fetch failed for %s: %s", symbol, exc)
        return []
    return _run_detectors(closes, highs, lows, vols, dates, symbol, tf)


# ─── Historical DNA scanners ──────────────────────────────────────────────────
#
# Each scanner slides through the full price history and records forward returns
# wherever the pattern's mandatory price criteria were met.
# Volume is checked as a condition but not required (to preserve sample size).

def _scan_double_bottom(closes: np.ndarray, lows: np.ndarray, vols: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float, int]] = []
    for end in range(80, n - 64, 5):
        lo = lows[max(0, end - 150):end]
        p  = closes[max(0, end - 150):end]
        v  = vols[max(0, end - 150):end]
        wl = len(lo)
        mins = _local_mins(lo, order=5)
        if len(mins) < 2:
            continue
        m2i = int(mins[-1])
        if wl - 1 - m2i > 35:
            continue
        for ji in range(len(mins) - 2, -1, -1):
            m1i = int(mins[ji])
            sep = m2i - m1i
            if sep < 15 or sep > 80:
                continue
            m1v, m2v = lo[m1i], lo[m2i]
            if abs(m1v - m2v) / (min(m1v, m2v) + 1e-10) > 0.03:
                continue
            neckline = float(p[m1i:m2i + 1].max())
            trough_avg = (m1v + m2v) / 2.0
            if neckline / (trough_avg + 1e-10) - 1.0 < 0.05:
                continue
            v1a = _vol_around(v, m1i)
            v2a = _vol_around(v, m2i)
            vol_c1 = v1a > 1 and v2a <= v1a * 1.15
            if not vol_c1:
                break
            rally_start = m2i + 1
            vol_c2 = _vol_ratio(v, rally_start, wl, 20) > 0.85 if rally_start < wl - 1 else False
            conf = _confidence(6 + 1 + int(vol_c2), 8, 1 + int(vol_c2), 2)
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
            out.append((f21, f63, conf))
            break
    return out


def _scan_double_top(closes: np.ndarray, highs: np.ndarray, vols: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float, int]] = []
    for end in range(80, n - 64, 5):
        hi = highs[max(0, end - 150):end]
        p  = closes[max(0, end - 150):end]
        v  = vols[max(0, end - 150):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=5)
        if len(maxs) < 2:
            continue
        m2i = int(maxs[-1])
        if wl - 1 - m2i > 35:
            continue
        for ji in range(len(maxs) - 2, -1, -1):
            m1i = int(maxs[ji])
            sep = m2i - m1i
            if sep < 15 or sep > 80:
                continue
            m1v, m2v = hi[m1i], hi[m2i]
            if abs(m1v - m2v) / (min(m1v, m2v) + 1e-10) > 0.03:
                continue
            neckline = float(p[m1i:m2i + 1].min())
            peak_avg = (m1v + m2v) / 2.0
            if peak_avg / (neckline + 1e-10) - 1.0 < 0.05:
                continue
            v1a = _vol_around(v, m1i)
            v2a = _vol_around(v, m2i)
            if not (v1a > 1 and v2a <= v1a * 1.15):
                break
            decline_start = m2i + 1
            vol_c2 = _vol_ratio(v, decline_start, wl, 20) > 0.85 if decline_start < wl - 1 else False
            conf = _confidence(6 + 1 + int(vol_c2), 8, 1 + int(vol_c2), 2)
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
            out.append((f21, f63, conf))
            break
    return out


def _scan_bull_flag(closes: np.ndarray, vols: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float, int]] = []
    for end in range(30, n - 64, 5):
        for pole_w, cons_w in ((15, 8), (20, 10), (25, 12)):
            if end < pole_w + cons_w:
                continue
            pole_ret = (closes[end - cons_w] / closes[end - pole_w - cons_w] - 1) * 100
            if pole_ret < 12.0:
                continue
            flag = closes[end - cons_w:end]
            flag_range = (flag.max() - flag.min()) / (flag.min() + 1e-10) * 100
            if flag_range > pole_ret * 0.40:
                continue
            pole_start = end - pole_w - cons_w
            pole_end_i = end - cons_w
            v_pole = _vol_ratio(vols, pole_start, pole_end_i, 20)
            v_flag_mean = float(vols[end - cons_w:end].mean())
            v_pole_mean = float(vols[pole_start:pole_end_i].mean())
            if not (v_pole > 1.25 and v_pole_mean > 1 and v_flag_mean < v_pole_mean):
                continue
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
            out.append((f21, f63, 90))
            break
    return out


def _scan_bear_flag(closes: np.ndarray, vols: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float, int]] = []
    for end in range(30, n - 64, 5):
        for pole_w, cons_w in ((15, 8), (20, 10), (25, 12)):
            if end < pole_w + cons_w:
                continue
            pole_ret = (closes[end - cons_w] / closes[end - pole_w - cons_w] - 1) * 100
            if pole_ret > -12.0:
                continue
            flag = closes[end - cons_w:end]
            flag_range = (flag.max() - flag.min()) / (flag.min() + 1e-10) * 100
            if flag_range > abs(pole_ret) * 0.40:
                continue
            pole_start = end - pole_w - cons_w
            pole_end_i = end - cons_w
            v_pole = _vol_ratio(vols, pole_start, pole_end_i, 20)
            v_flag_mean = float(vols[end - cons_w:end].mean())
            v_pole_mean = float(vols[pole_start:pole_end_i].mean())
            if not (v_pole > 1.25 and v_pole_mean > 1 and v_flag_mean < v_pole_mean):
                continue
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
            out.append((f21, f63, 90))
            break
    return out


def _scan_head_shoulders(closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float, int]] = []
    for end in range(120, n - 64, 5):
        hi = highs[max(0, end - 220):end]
        lo = lows[max(0, end - 220):end]
        p  = closes[max(0, end - 220):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=8)
        if len(maxs) < 3:
            continue
        rs_i = int(maxs[-1])
        if wl - 1 - rs_i > 50:
            continue
        hd_i = int(maxs[-2])
        ls_i = int(maxs[-3])
        ls, hd, rs = hi[ls_i], hi[hd_i], hi[rs_i]
        if not (hd > ls * 1.03 and hd > rs * 1.03):
            continue
        if abs(ls - rs) / (min(ls, rs) + 1e-10) > 0.06:
            continue
        t1 = float(lo[ls_i:hd_i + 1].min()) if hd_i > ls_i else float(lo[ls_i])
        t2 = float(lo[hd_i:rs_i + 1].min()) if rs_i > hd_i else float(lo[hd_i])
        if abs(t1 - t2) / (min(t1, t2) + 1e-10) > 0.05:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((f21, f63, 90))
    return out


def _scan_inv_head_shoulders(closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float, int]] = []
    for end in range(120, n - 64, 5):
        hi = highs[max(0, end - 220):end]
        lo = lows[max(0, end - 220):end]
        p  = closes[max(0, end - 220):end]
        wl = len(lo)
        mins = _local_mins(lo, order=8)
        if len(mins) < 3:
            continue
        rs_i = int(mins[-1])
        if wl - 1 - rs_i > 50:
            continue
        hd_i = int(mins[-2])
        ls_i = int(mins[-3])
        ls, hd, rs = lo[ls_i], lo[hd_i], lo[rs_i]
        if not (hd < ls * 0.97 and hd < rs * 0.97):
            continue
        if abs(ls - rs) / (min(ls, rs) + 1e-10) > 0.06:
            continue
        pk1 = float(p[ls_i:hd_i + 1].max()) if hd_i > ls_i else float(p[ls_i])
        pk2 = float(p[hd_i:rs_i + 1].max()) if rs_i > hd_i else float(p[hd_i])
        if abs(pk1 - pk2) / (min(pk1, pk2) + 1e-10) > 0.05:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((f21, f63, 90))
    return out


def _scan_ascending_triangle(closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float, int]] = []
    for end in range(60, n - 64, 5):
        hi = highs[max(0, end - 100):end]
        lo = lows[max(0, end - 100):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=4)
        mins = _local_mins(lo, order=4)
        if len(maxs) < 3 or len(mins) < 3:
            continue
        top = hi[maxs[-4:]] if len(maxs) >= 4 else hi[maxs]
        bot = lo[mins[-4:]] if len(mins) >= 4 else lo[mins]
        if top.std() / (top.mean() + 1e-10) > 0.02:
            continue
        if not all(bot[i] <= bot[i + 1] for i in range(len(bot) - 1)):
            continue
        if wl - 1 - int(maxs[0]) < 20:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((f21, f63, 90))
    return out


def _scan_descending_triangle(closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float, int]] = []
    for end in range(60, n - 64, 5):
        hi = highs[max(0, end - 100):end]
        lo = lows[max(0, end - 100):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=4)
        mins = _local_mins(lo, order=4)
        if len(maxs) < 3 or len(mins) < 3:
            continue
        top = hi[maxs[-4:]] if len(maxs) >= 4 else hi[maxs]
        bot = lo[mins[-4:]] if len(mins) >= 4 else lo[mins]
        if bot.std() / (bot.mean() + 1e-10) > 0.02:
            continue
        if not all(top[i] >= top[i + 1] for i in range(len(top) - 1)):
            continue
        if wl - 1 - int(mins[0]) < 20:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((f21, f63, 90))
    return out


def _scan_rectangle(closes: np.ndarray, highs: np.ndarray, lows: np.ndarray) -> list[tuple[float, float, int]]:
    n = len(closes)
    out: list[tuple[float, float]] = []
    for end in range(60, n - 64, 5):
        hi = highs[max(0, end - 100):end]
        lo = lows[max(0, end - 100):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=4)
        mins = _local_mins(lo, order=4)
        if len(maxs) < 2 or len(mins) < 2:
            continue
        top = hi[maxs[-4:]] if len(maxs) >= 4 else hi[maxs]
        bot = lo[mins[-4:]] if len(mins) >= 4 else lo[mins]
        if top.std() / (top.mean() + 1e-10) > 0.03:
            continue
        if bot.std() / (bot.mean() + 1e-10) > 0.03:
            continue
        range_pct = (top.mean() - bot.mean()) / (bot.mean() + 1e-10)
        if range_pct < 0.06:
            continue
        formation_start = min(int(maxs[0]), int(mins[0]))
        if wl - 1 - formation_start < 15:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((f21, f63, 90))
    return out


# ─── DNA aggregation ───────────────────────────────────────────────────────────

def _aggregate(samples: list[tuple[float, float, int]], pattern: str) -> PatternDNAEntry | None:
    valid = [(f21, f63, conf) for f21, f63, conf in samples if not (np.isnan(f21) or np.isnan(f63))]
    if len(valid) < 12:
        return None

    is_bearish = pattern in BEARISH_PATTERNS
    f21s = np.array([x[0] for x in valid])
    f63s = np.array([x[1] for x in valid])

    avg_21 = float(f21s.mean())
    avg_63 = float(f63s.mean())
    success = float(np.mean(f21s < 0) * 100) if is_bearish else float(np.mean(f21s > 0) * 100)

    magnitude   = min(20.0, abs(avg_21) * 2)
    consistency = max(0.0, 10.0 - float(np.std(f21s)) * 0.5)
    dna_score   = int(min(100, max(0, success * 0.7 + magnitude + consistency)))
    avg_conf    = round(float(np.mean([x[2] for x in valid])), 1)

    return PatternDNAEntry(
        pattern=pattern,
        category=PATTERN_CATEGORIES.get(pattern, "Unknown"),
        occurrences=len(valid),
        success_rate=round(success, 1),
        avg_fwd_21d=round(avg_21, 2),
        avg_fwd_63d=round(avg_63, 2),
        dna_score=dna_score,
        avg_confidence=avg_conf,
    )


# ─── Public API ────────────────────────────────────────────────────────────────

def get_pattern_dna(symbol: str) -> PatternDNAResponse:
    """Compute historical Pattern DNA for a stock (per-symbol daily cache)."""
    dna_key = f"{_date.today().isoformat()}:{symbol}"
    if dna_key in _dna_sym_cache:
        return _dna_sym_cache[dna_key]

    try:
        closes, highs, lows, vols, _ = _fetch_data(symbol)
    except Exception as exc:
        log.warning("DNA fetch failed for %s: %s", symbol, exc)
        return PatternDNAResponse(symbol=symbol, dna=[], best_pattern=None, best_score=0)

    result = _compute_dna_from_arrays(closes, highs, lows, vols, symbol)
    _dna_sym_cache[dna_key] = result
    return result


# ─── Shared batch data loader ──────────────────────────────────────────────────

_all_data_cache: dict[str, dict[str, tuple]] = {}


def _load_all_data(timeframe: str = 'daily') -> dict[str, tuple]:
    """Batch-fetch all symbols in one DuckDB query. Cached per trading day per timeframe.

    Returns dict[symbol -> (closes, highs, lows, vols, dates)].
    All per-symbol scan functions call this instead of _fetch_data in a loop.
    """
    cache_key = f"{_date.today().isoformat()}:{timeframe}"
    if cache_key in _all_data_cache:
        return _all_data_cache[cache_key]

    con = get_connection()
    rows = con.execute("""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close, high, low, volume
        FROM (
            SELECT symbol, date, close, high, low, volume,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date ASC) AS rn
            FROM equities_prices
        ) t
        WHERE rn <= 2000
        ORDER BY symbol, date ASC
    """).fetchall()

    sym_rows: dict[str, list] = defaultdict(list)
    for r in rows:
        sym_rows[r[0]].append(r[1:])

    result: dict[str, tuple] = {}
    for sym, data in sym_rows.items():
        dates  = [r[0] for r in data]
        closes = np.array([r[1] for r in data], dtype=float)
        highs  = np.array([r[2] for r in data], dtype=float)
        lows   = np.array([r[3] for r in data], dtype=float)
        vols   = np.array([r[4] for r in data], dtype=float)
        if timeframe == 'weekly':
            closes, highs, lows, vols, dates = _resample_weekly(closes, highs, lows, vols, dates)
        result[sym] = (closes, highs, lows, vols, dates)

    _all_data_cache[cache_key] = result
    log.info("pattern: batch-loaded %d symbols (timeframe=%s)", len(result), timeframe)
    return result


def _compute_dna_from_arrays(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray,
    vols: np.ndarray, symbol: str, max_bars: int | None = None,
) -> PatternDNAResponse:
    """Compute historical DNA from pre-loaded arrays — no DuckDB call.

    max_bars: if set, trim the series to the most-recent N bars before scanning.
    Used by confirmed-forming to keep response times under ~12s for 20 symbols.
    """
    if max_bars is not None and len(closes) > max_bars:
        closes = closes[-max_bars:]
        highs  = highs[-max_bars:]
        lows   = lows[-max_bars:]
        vols   = vols[-max_bars:]
    scanners = [
        ("Double Bottom",            lambda: _scan_double_bottom(closes, lows, vols)),
        ("Double Top",               lambda: _scan_double_top(closes, highs, vols)),
        ("Bull Flag",                lambda: _scan_bull_flag(closes, vols)),
        ("Bear Flag",                lambda: _scan_bear_flag(closes, vols)),
        ("Head & Shoulders",         lambda: _scan_head_shoulders(closes, highs, lows)),
        ("Inverse Head & Shoulders", lambda: _scan_inv_head_shoulders(closes, highs, lows)),
        ("Ascending Triangle",       lambda: _scan_ascending_triangle(closes, highs, lows)),
        ("Descending Triangle",      lambda: _scan_descending_triangle(closes, highs, lows)),
        ("Rectangle",                lambda: _scan_rectangle(closes, highs, lows)),
    ]
    entries: list[PatternDNAEntry] = []
    for name, fn in scanners:
        try:
            entry = _aggregate(fn(), name)
            if entry:
                entries.append(entry)
        except Exception as exc:
            log.debug("DNA scan failed %s/%s: %s", symbol, name, exc)
    entries.sort(key=lambda x: x.dna_score, reverse=True)
    best = entries[0] if entries else None
    return PatternDNAResponse(
        symbol=symbol, dna=entries,
        best_pattern=best.pattern if best else None,
        best_score=best.dna_score if best else 0,
    )


# ─── Per-endpoint result caches ───────────────────────────────────────────────

_scanner_cache:   dict[str, PatternScannerResponse]         = {}
_heatmap_cache:   dict[str, PatternHeatmapResponse]         = {}
_screener_cache:  dict[str, PatternScreenerResponse]        = {}
_breakout_cache:  dict[str, BreakoutTrackerResponse]        = {}
_cforming_cache:  dict[str, ConfirmedFormingResponse]       = {}
# Shared per-symbol detection results (keyed date:tf → {symbol → patterns})
# Scanner populates this; confirmed-forming and heatmap reuse it.
_detect_cache: dict[str, dict[str, list[PatternDetection]]] = {}

# Per-symbol DNA cache (keyed date:symbol — stable within a trading day)
_dna_sym_cache: dict[str, 'PatternDNAResponse'] = {}


def get_scanner(timeframe: str = 'daily') -> PatternScannerResponse:
    """Scan all symbols for currently active chart patterns (batch DuckDB fetch, cached daily)."""
    cache_key = f"{_date.today().isoformat()}:{timeframe}"
    if cache_key in _scanner_cache:
        return _scanner_cache[cache_key]

    tf = TF_MAP.get(timeframe, DAILY)
    all_data = _load_all_data(timeframe)
    items: list[ScannerItem] = []
    sym_detections: dict[str, list[PatternDetection]] = {}

    today = _date.today().isoformat()
    for sym, (closes, highs, lows, vols, dates) in all_data.items():
        try:
            patterns = _run_detectors(closes, highs, lows, vols, dates, sym, tf)
            sym_detections[sym] = patterns
            for p in patterns[:2]:
                items.append(ScannerItem(
                    symbol=sym,
                    pattern=p.pattern,
                    category=p.category,
                    confidence=p.confidence,
                    stage=p.stage,
                    days_forming=p.days_forming,
                    breakout_level=p.breakout_level,
                ))
        except Exception as exc:
            log.warning("Scanner failed for %s: %s", sym, exc)
            sym_detections[sym] = []

    # Share detections so confirmed-forming / heatmap don't re-scan
    _detect_cache[cache_key] = sym_detections

    items.sort(key=lambda x: x.confidence, reverse=True)
    result = PatternScannerResponse(
        items=items[:30],
        scanned_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    _scanner_cache[cache_key] = result
    return result


def _launch_dna_precompute(
    today: str,
    sym_detections: dict[str, list],
    all_data: dict[str, tuple],
) -> None:
    """Background thread: compute DNA for symbols with active detections.
    Yields between symbols so foreground requests aren't starved."""
    import time

    def _worker():
        count = 0
        for sym, patterns in sym_detections.items():
            if not patterns:
                continue
            dna_key = f"{today}:{sym}"
            if dna_key in _dna_sym_cache:
                continue
            try:
                closes, highs, lows, vols, _ = all_data[sym]
                # 600-bar limit: ~576ms per symbol instead of 2200ms
                _dna_sym_cache[dna_key] = _compute_dna_from_arrays(
                    closes, highs, lows, vols, sym, max_bars=600
                )
                count += 1
            except Exception as exc:
                log.debug("BG DNA failed %s: %s", sym, exc)
            # Yield GIL so foreground requests are not starved
            time.sleep(0.05)
        log.info("Background DNA precompute done: %d symbols", count)

    threading.Thread(target=_worker, daemon=True).start()


def get_screener(pattern_name: str) -> PatternScreenerResponse:
    """Rank stocks by historical DNA score for a given pattern (batch data, cached daily)."""
    cache_key = f"{_date.today().isoformat()}:{pattern_name}"
    if cache_key in _screener_cache:
        return _screener_cache[cache_key]

    all_data = _load_all_data('daily')
    results: list[ScreenerItem] = []

    for sym, (closes, highs, lows, vols, _) in all_data.items():
        try:
            scanner_map = {
                "Double Bottom":            lambda c=closes, lo=lows, v=vols: _scan_double_bottom(c, lo, v),
                "Double Top":               lambda c=closes, h=highs, v=vols: _scan_double_top(c, h, v),
                "Bull Flag":                lambda c=closes, v=vols: _scan_bull_flag(c, v),
                "Bear Flag":                lambda c=closes, v=vols: _scan_bear_flag(c, v),
                "Head & Shoulders":         lambda c=closes, h=highs, lo=lows: _scan_head_shoulders(c, h, lo),
                "Inverse Head & Shoulders": lambda c=closes, h=highs, lo=lows: _scan_inv_head_shoulders(c, h, lo),
                "Ascending Triangle":       lambda c=closes, h=highs, lo=lows: _scan_ascending_triangle(c, h, lo),
                "Descending Triangle":      lambda c=closes, h=highs, lo=lows: _scan_descending_triangle(c, h, lo),
                "Rectangle":                lambda c=closes, h=highs, lo=lows: _scan_rectangle(c, h, lo),
            }
            fn = scanner_map.get(pattern_name)
            if fn is None:
                continue
            entry = _aggregate(fn(), pattern_name)  # type: ignore[operator]
            if entry:
                results.append(ScreenerItem(
                    symbol=sym,
                    dna_score=entry.dna_score,
                    success_rate=entry.success_rate,
                    avg_fwd_21d=entry.avg_fwd_21d,
                    avg_fwd_63d=entry.avg_fwd_63d,
                    occurrences=entry.occurrences,
                    avg_confidence=entry.avg_confidence,
                ))
        except Exception as exc:
            log.debug("Screener scan failed %s/%s: %s", sym, pattern_name, exc)

    results.sort(key=lambda x: x.dna_score, reverse=True)
    result = PatternScreenerResponse(pattern=pattern_name, items=results)
    _screener_cache[cache_key] = result
    return result


def get_confirmed_forming(timeframe: str = 'daily') -> ConfirmedFormingResponse:
    """Stocks where a currently forming pattern matches their best historical pattern."""
    cache_key = f"{_date.today().isoformat()}:{timeframe}:cforming"
    if cache_key in _cforming_cache:
        return _cforming_cache[cache_key]

    tf = TF_MAP.get(timeframe, DAILY)
    all_data = _load_all_data(timeframe)
    detect_key = f"{_date.today().isoformat()}:{timeframe}"
    today_str = _date.today().isoformat()
    cached_detections = _detect_cache.get(detect_key, {})
    items: list[ConfirmedFormingItem] = []

    # Collect all symbols with active patterns, sorted by best pattern confidence.
    # Limit DNA computation to top 20 by confidence — each _compute_dna_from_arrays
    # call takes ~576ms (600-bar limit), so 20 symbols = ~12s worst-case.
    active_by_sym: list[tuple[float, str, tuple]] = []
    for sym, arrays in all_data.items():
        active = cached_detections.get(sym)
        if active is None:
            closes, highs, lows, vols, dates = arrays
            active = _run_detectors(closes, highs, lows, vols, dates, sym, tf)
        if active:
            active_by_sym.append((active[0].confidence, sym, arrays))
    active_by_sym.sort(key=lambda x: x[0], reverse=True)

    for _, sym, (closes, highs, lows, vols, dates) in active_by_sym[:20]:
        active = cached_detections.get(sym) or []
        if not active:
            active = _run_detectors(closes, highs, lows, vols, dates, sym, tf)
        try:
            if not active:
                continue
            # Per-symbol DNA cache — stable within a trading day
            dna_key = f"{today_str}:{sym}"
            if dna_key in _dna_sym_cache:
                dna = _dna_sym_cache[dna_key]
            else:
                # Use 600-bar limit to keep response time under 12s for 20 symbols
                dna = _compute_dna_from_arrays(closes, highs, lows, vols, sym, max_bars=600)
                _dna_sym_cache[dna_key] = dna
            if not dna.best_pattern:
                continue
            for p in active:
                if p.pattern != dna.best_pattern:
                    continue
                best_entry = next((e for e in dna.dna if e.pattern == dna.best_pattern), None)
                if best_entry is None:
                    continue
                items.append(ConfirmedFormingItem(
                    symbol=sym,
                    pattern=p.pattern,
                    category=p.category,
                    confidence=p.confidence,
                    stage=p.stage,
                    days_forming=p.days_forming,
                    breakout_level=p.breakout_level,
                    support_level=p.support_level,
                    risk_reward=p.risk_reward,
                    dna_score=best_entry.dna_score,
                    success_rate=best_entry.success_rate,
                    avg_fwd_21d=best_entry.avg_fwd_21d,
                    avg_fwd_63d=best_entry.avg_fwd_63d,
                    occurrences=best_entry.occurrences,
                ))
                break
        except Exception as exc:
            log.warning("Confirmed-forming failed for %s: %s", sym, exc)

    items.sort(key=lambda x: (x.dna_score, x.confidence), reverse=True)
    result = ConfirmedFormingResponse(
        items=items,
        scanned_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        total_scanned=len(all_data),
    )
    _cforming_cache[cache_key] = result
    return result


# ─── Dated scanners (Feature 1 / 2 / 4) ──────────────────────────────────────
#
# These are new wrappers that also capture the detection date.
# They return list[tuple[str, float, float]] = (date, f21, f63).
# They do NOT modify the existing _scan_* functions.

def _scan_dated_double_bottom(
    closes: np.ndarray, lows: np.ndarray, vols: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(80, n - 21, 5):
        lo = lows[max(0, end - 150):end]
        p  = closes[max(0, end - 150):end]
        v  = vols[max(0, end - 150):end]
        wl = len(lo)
        mins = _local_mins(lo, order=5)
        if len(mins) < 2:
            continue
        m2i = int(mins[-1])
        if wl - 1 - m2i > 35:
            continue
        for ji in range(len(mins) - 2, -1, -1):
            m1i = int(mins[ji])
            sep = m2i - m1i
            if sep < 15 or sep > 80:
                continue
            m1v, m2v = lo[m1i], lo[m2i]
            if abs(m1v - m2v) / (min(m1v, m2v) + 1e-10) > 0.03:
                continue
            neckline = float(p[m1i:m2i + 1].max())
            trough_avg = (m1v + m2v) / 2.0
            if neckline / (trough_avg + 1e-10) - 1.0 < 0.05:
                continue
            v1 = _vol_around(v, m1i)
            v2 = _vol_around(v, m2i)
            if not (v1 > 1 and v2 <= v1 * 1.15):
                break
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
            out.append((dates[end], f21, f63))
            break
    return out


def _scan_dated_double_top(
    closes: np.ndarray, highs: np.ndarray, vols: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(80, n - 21, 5):
        hi = highs[max(0, end - 150):end]
        p  = closes[max(0, end - 150):end]
        v  = vols[max(0, end - 150):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=5)
        if len(maxs) < 2:
            continue
        m2i = int(maxs[-1])
        if wl - 1 - m2i > 35:
            continue
        for ji in range(len(maxs) - 2, -1, -1):
            m1i = int(maxs[ji])
            sep = m2i - m1i
            if sep < 15 or sep > 80:
                continue
            m1v, m2v = hi[m1i], hi[m2i]
            if abs(m1v - m2v) / (min(m1v, m2v) + 1e-10) > 0.03:
                continue
            neckline = float(p[m1i:m2i + 1].min())
            peak_avg = (m1v + m2v) / 2.0
            if peak_avg / (neckline + 1e-10) - 1.0 < 0.05:
                continue
            v1 = _vol_around(v, m1i)
            v2 = _vol_around(v, m2i)
            if not (v1 > 1 and v2 <= v1 * 1.15):
                break
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
            out.append((dates[end], f21, f63))
            break
    return out


def _scan_dated_bull_flag(
    closes: np.ndarray, vols: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(30, n - 21, 5):
        for pole_w, cons_w in ((15, 8), (20, 10), (25, 12)):
            if end < pole_w + cons_w:
                continue
            pole_ret = (closes[end - cons_w] / closes[end - pole_w - cons_w] - 1) * 100
            if pole_ret < 12.0:
                continue
            flag = closes[end - cons_w:end]
            flag_range = (flag.max() - flag.min()) / (flag.min() + 1e-10) * 100
            if flag_range > pole_ret * 0.40:
                continue
            pole_start = end - pole_w - cons_w
            pole_end_i = end - cons_w
            v_pole = _vol_ratio(vols, pole_start, pole_end_i, 20)
            v_flag_mean = float(vols[end - cons_w:end].mean())
            v_pole_mean = float(vols[pole_start:pole_end_i].mean())
            if not (v_pole > 1.25 and v_pole_mean > 1 and v_flag_mean < v_pole_mean):
                continue
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
            out.append((dates[end], f21, f63))
            break
    return out


def _scan_dated_bear_flag(
    closes: np.ndarray, vols: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(30, n - 21, 5):
        for pole_w, cons_w in ((15, 8), (20, 10), (25, 12)):
            if end < pole_w + cons_w:
                continue
            pole_ret = (closes[end - cons_w] / closes[end - pole_w - cons_w] - 1) * 100
            if pole_ret > -12.0:
                continue
            flag = closes[end - cons_w:end]
            flag_range = (flag.max() - flag.min()) / (flag.min() + 1e-10) * 100
            if flag_range > abs(pole_ret) * 0.40:
                continue
            pole_start = end - pole_w - cons_w
            pole_end_i = end - cons_w
            v_pole = _vol_ratio(vols, pole_start, pole_end_i, 20)
            v_flag_mean = float(vols[end - cons_w:end].mean())
            v_pole_mean = float(vols[pole_start:pole_end_i].mean())
            if not (v_pole > 1.25 and v_pole_mean > 1 and v_flag_mean < v_pole_mean):
                continue
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
            out.append((dates[end], f21, f63))
            break
    return out


def _scan_dated_head_shoulders(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(120, n - 21, 5):
        hi = highs[max(0, end - 220):end]
        lo = lows[max(0, end - 220):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=8)
        if len(maxs) < 3:
            continue
        rs_i = int(maxs[-1])
        if wl - 1 - rs_i > 50:
            continue
        hd_i = int(maxs[-2])
        ls_i = int(maxs[-3])
        ls, hd, rs = hi[ls_i], hi[hd_i], hi[rs_i]
        if not (hd > ls * 1.03 and hd > rs * 1.03):
            continue
        if abs(ls - rs) / (min(ls, rs) + 1e-10) > 0.06:
            continue
        t1 = float(lo[ls_i:hd_i + 1].min()) if hd_i > ls_i else float(lo[ls_i])
        t2 = float(lo[hd_i:rs_i + 1].min()) if rs_i > hd_i else float(lo[hd_i])
        if abs(t1 - t2) / (min(t1, t2) + 1e-10) > 0.05:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((dates[end], f21, f63))
    return out


def _scan_dated_inv_head_shoulders(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(120, n - 21, 5):
        lo = lows[max(0, end - 220):end]
        p  = closes[max(0, end - 220):end]
        wl = len(lo)
        mins = _local_mins(lo, order=8)
        if len(mins) < 3:
            continue
        rs_i = int(mins[-1])
        if wl - 1 - rs_i > 50:
            continue
        hd_i = int(mins[-2])
        ls_i = int(mins[-3])
        ls, hd, rs = lo[ls_i], lo[hd_i], lo[rs_i]
        if not (hd < ls * 0.97 and hd < rs * 0.97):
            continue
        if abs(ls - rs) / (min(ls, rs) + 1e-10) > 0.06:
            continue
        pk1 = float(p[ls_i:hd_i + 1].max()) if hd_i > ls_i else float(p[ls_i])
        pk2 = float(p[hd_i:rs_i + 1].max()) if rs_i > hd_i else float(p[hd_i])
        if abs(pk1 - pk2) / (min(pk1, pk2) + 1e-10) > 0.05:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((dates[end], f21, f63))
    return out


def _scan_dated_ascending_triangle(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(60, n - 21, 5):
        hi = highs[max(0, end - 100):end]
        lo = lows[max(0, end - 100):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=4)
        mins = _local_mins(lo, order=4)
        if len(maxs) < 3 or len(mins) < 3:
            continue
        top = hi[maxs[-4:]] if len(maxs) >= 4 else hi[maxs]
        bot = lo[mins[-4:]] if len(mins) >= 4 else lo[mins]
        if top.std() / (top.mean() + 1e-10) > 0.02:
            continue
        if not all(bot[i] <= bot[i + 1] for i in range(len(bot) - 1)):
            continue
        if wl - 1 - int(maxs[0]) < 20:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((dates[end], f21, f63))
    return out


def _scan_dated_descending_triangle(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(60, n - 21, 5):
        hi = highs[max(0, end - 100):end]
        lo = lows[max(0, end - 100):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=4)
        mins = _local_mins(lo, order=4)
        if len(maxs) < 3 or len(mins) < 3:
            continue
        top = hi[maxs[-4:]] if len(maxs) >= 4 else hi[maxs]
        bot = lo[mins[-4:]] if len(mins) >= 4 else lo[mins]
        if bot.std() / (bot.mean() + 1e-10) > 0.02:
            continue
        if not all(top[i] >= top[i + 1] for i in range(len(top) - 1)):
            continue
        if wl - 1 - int(mins[0]) < 20:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((dates[end], f21, f63))
    return out


def _scan_dated_rectangle(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray, dates: list[str],
) -> list[tuple[str, float, float]]:
    n = len(closes)
    out: list[tuple[str, float, float]] = []
    for end in range(60, n - 21, 5):
        hi = highs[max(0, end - 100):end]
        lo = lows[max(0, end - 100):end]
        wl = len(hi)
        maxs = _local_maxs(hi, order=4)
        mins = _local_mins(lo, order=4)
        if len(maxs) < 2 or len(mins) < 2:
            continue
        top = hi[maxs[-4:]] if len(maxs) >= 4 else hi[maxs]
        bot = lo[mins[-4:]] if len(mins) >= 4 else lo[mins]
        if top.std() / (top.mean() + 1e-10) > 0.03:
            continue
        if bot.std() / (bot.mean() + 1e-10) > 0.03:
            continue
        range_pct = (top.mean() - bot.mean()) / (bot.mean() + 1e-10)
        if range_pct < 0.06:
            continue
        formation_start = min(int(maxs[0]), int(mins[0]))
        if wl - 1 - formation_start < 15:
            continue
        f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
        f63 = float((closes[end + 63] / closes[end] - 1) * 100) if end + 63 < n else float("nan")
        out.append((dates[end], f21, f63))
    return out


def _get_dated_samples(
    closes: np.ndarray, highs: np.ndarray, lows: np.ndarray, vols: np.ndarray, dates: list[str],
) -> list[tuple[str, str, str, float, float]]:
    """Run all dated scanners and return (date, pattern, category, f21, f63) tuples."""
    DATED_SCANNERS: list[tuple[str, object]] = [
        ("Double Bottom",            lambda: _scan_dated_double_bottom(closes, lows, vols, dates)),
        ("Double Top",               lambda: _scan_dated_double_top(closes, highs, vols, dates)),
        ("Bull Flag",                lambda: _scan_dated_bull_flag(closes, vols, dates)),
        ("Bear Flag",                lambda: _scan_dated_bear_flag(closes, vols, dates)),
        ("Head & Shoulders",         lambda: _scan_dated_head_shoulders(closes, highs, lows, dates)),
        ("Inverse Head & Shoulders", lambda: _scan_dated_inv_head_shoulders(closes, highs, lows, dates)),
        ("Ascending Triangle",       lambda: _scan_dated_ascending_triangle(closes, highs, lows, dates)),
        ("Descending Triangle",      lambda: _scan_dated_descending_triangle(closes, highs, lows, dates)),
        ("Rectangle",                lambda: _scan_dated_rectangle(closes, highs, lows, dates)),
    ]
    results: list[tuple[str, str, str, float, float]] = []
    for name, fn in DATED_SCANNERS:
        try:
            category = PATTERN_CATEGORIES.get(name, "Unknown")
            for dt, f21, f63 in fn():  # type: ignore[misc]
                results.append((dt, name, category, f21, f63))
        except Exception as exc:
            log.debug("Dated scanner failed %s: %s", name, exc)
    return results


# ─── Feature 1: Pattern History Timeline ──────────────────────────────────────

def get_pattern_history(symbol: str, timeframe: str = 'daily') -> PatternHistoryResponse:
    """Return every historical pattern detection with its actual forward-return outcome."""
    try:
        closes, highs, lows, vols, dates = _fetch_data(symbol, timeframe=timeframe)
    except Exception as exc:
        log.warning("History fetch failed for %s: %s", symbol, exc)
        return PatternHistoryResponse(symbol=symbol, timeframe=timeframe, items=[])

    all_detections = _get_dated_samples(closes, highs, lows, vols, dates)

    items: list[PatternHistoryItem] = []
    for dt, pattern, category, f21, f63 in all_detections:
        if np.isnan(f21):
            outcome = "Pending"
            fwd_21d = None
        else:
            outcome = "Win" if f21 > 0 else "Loss"
            fwd_21d = round(f21, 2)
        fwd_63d: float | None = None if np.isnan(f63) else round(f63, 2)
        items.append(PatternHistoryItem(
            date=dt,
            pattern=pattern,
            category=category,
            fwd_21d=fwd_21d,
            fwd_63d=fwd_63d,
            outcome=outcome,
        ))

    # Sort by date descending, limit 200
    items.sort(key=lambda x: x.date, reverse=True)
    return PatternHistoryResponse(symbol=symbol, timeframe=timeframe, items=items[:200])


# ─── Feature 2: Pattern Breakout Tracker ──────────────────────────────────────

def get_breakout_tracker(days_back: int = 60) -> BreakoutTrackerResponse:
    """Patterns detected in the last days_back bars — track Confirmed / Failed / Forming status."""
    cache_key = f"{_date.today().isoformat()}:{days_back}:breakout"
    if cache_key in _breakout_cache:
        return _breakout_cache[cache_key]

    all_data = _load_all_data('daily')
    items: list[BreakoutTrackerItem] = []
    today_str = datetime.now().strftime("%Y-%m-%d")

    for sym, (closes, highs, lows, vols, dates) in all_data.items():
        try:
            n = len(closes)
            if n < days_back + 20:
                continue

            current_price = float(closes[-1])
            # Determine the cutoff date (approximate: days_back bars from end)
            cutoff_idx = max(0, n - days_back - 20)
            cutoff_date = dates[n - days_back] if n > days_back else dates[0]

            # For each detection step (every 10 bars) in the window
            detections_by_pattern: dict[str, dict] = {}  # pattern -> best detection info
            for i in range(max(30, n - days_back - 20), n - 10, 10):
                c_sl = closes[:i]
                h_sl = highs[:i]
                lo_sl = lows[:i]
                v_sl = vols[:i]
                d_sl = dates[:i]
                if len(c_sl) < 30:
                    continue

                tf = DAILY
                det_fns = [
                    ("Double Bottom",            lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_double_bottom(c, h, lo, v, d, sym, tf)),
                    ("Double Top",               lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_double_top(c, h, lo, v, d, sym, tf)),
                    ("Head & Shoulders",         lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_head_and_shoulders(c, h, lo, v, d, sym, tf)),
                    ("Inverse Head & Shoulders", lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_inv_head_and_shoulders(c, h, lo, v, d, sym, tf)),
                    ("Bull Flag",                lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_bull_flag(c, h, lo, v, d, sym, tf)),
                    ("Bear Flag",                lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_bear_flag(c, h, lo, v, d, sym, tf)),
                    ("Ascending Triangle",       lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_ascending_triangle(c, h, lo, v, d, sym, tf)),
                    ("Descending Triangle",      lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_descending_triangle(c, h, lo, v, d, sym, tf)),
                    ("Rectangle",                lambda c=c_sl, h=h_sl, lo=lo_sl, v=v_sl, d=d_sl: _detect_rectangle(c, h, lo, v, d, sym, tf)),
                ]
                for p_name, fn in det_fns:
                    if p_name in detections_by_pattern:
                        continue  # keep oldest detection for this pattern in the window
                    try:
                        det = fn()
                        if det is not None and det.detected_date >= cutoff_date:
                            detections_by_pattern[p_name] = {
                                "detection": det,
                                "entry_price": float(c_sl[-1]),
                                "detected_date": det.detected_date,
                                "bar_idx": i,
                            }
                    except Exception:
                        pass

            for p_name, info in detections_by_pattern.items():
                det: PatternDetection = info["detection"]
                entry_price: float = info["entry_price"]
                detected_date_str: str = info["detected_date"]
                is_bearish = p_name in BEARISH_PATTERNS

                # Compute days_since
                try:
                    from datetime import date as _date_cls
                    d1 = _date_cls.fromisoformat(detected_date_str)
                    d2 = _date_cls.fromisoformat(today_str)
                    days_since = (d2 - d1).days
                except Exception:
                    days_since = 0

                change_pct = round((current_price / entry_price - 1) * 100, 2) if entry_price > 0 else 0.0

                # Determine status
                bl = det.breakout_level
                sl = det.support_level
                rl = det.resistance_level

                if is_bearish:
                    if bl is not None and current_price < bl:
                        status = "Confirmed"
                    elif sl is not None and current_price > sl:
                        status = "Failed"
                    else:
                        status = "Forming"
                else:
                    if bl is not None and current_price > bl:
                        status = "Confirmed"
                    elif sl is not None and current_price < sl:
                        status = "Failed"
                    else:
                        status = "Forming"

                items.append(BreakoutTrackerItem(
                    symbol=sym,
                    pattern=p_name,
                    category=det.category,
                    detected_date=detected_date_str,
                    days_since=max(0, days_since),
                    breakout_level=bl,
                    support_level=sl,
                    entry_price=round(entry_price, 2),
                    current_price=round(current_price, 2),
                    change_pct=change_pct,
                    status=status,
                ))
        except Exception as exc:
            log.warning("Breakout tracker failed for %s: %s", sym, exc)

    # Sort: Confirmed first, then Forming, then Failed
    status_order = {"Confirmed": 0, "Forming": 1, "Failed": 2}
    items.sort(key=lambda x: (status_order.get(x.status, 3), -abs(x.change_pct)))

    result = BreakoutTrackerResponse(
        items=items,
        scanned_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        days_back=days_back,
    )
    _breakout_cache[cache_key] = result
    return result


# ─── Feature 3: Market Pattern Heatmap ────────────────────────────────────────

def get_pattern_heatmap(timeframe: str = 'daily') -> PatternHeatmapResponse:
    """Which patterns are clustering across the market right now (batch data, cached daily)."""
    cache_key = f"{_date.today().isoformat()}:{timeframe}:heatmap"
    if cache_key in _heatmap_cache:
        return _heatmap_cache[cache_key]

    tf = TF_MAP.get(timeframe, DAILY)
    all_data = _load_all_data(timeframe)
    pattern_map: dict[str, dict] = {}

    for sym, (closes, highs, lows, vols, dates) in all_data.items():
        try:
            detections = _run_detectors(closes, highs, lows, vols, dates, sym, tf)
            for det in detections:
                if det.pattern not in pattern_map:
                    pattern_map[det.pattern] = {
                        "count": 0, "conf_sum": 0.0,
                        "symbols": [], "category": det.category,
                    }
                pattern_map[det.pattern]["count"] += 1
                pattern_map[det.pattern]["conf_sum"] += det.confidence
                pattern_map[det.pattern]["symbols"].append(sym)
        except Exception as exc:
            log.warning("Heatmap scan failed for %s: %s", sym, exc)

    cells: list[HeatmapCell] = []
    for pattern, info in pattern_map.items():
        cnt = info["count"]
        cells.append(HeatmapCell(
            pattern=pattern,
            category=info["category"],
            count=cnt,
            avg_confidence=round(info["conf_sum"] / cnt, 1) if cnt > 0 else 0.0,
            symbols=info["symbols"],
        ))
    cells.sort(key=lambda x: x.count, reverse=True)

    result = PatternHeatmapResponse(
        cells=cells,
        total_symbols=len(all_data),
        patterns_active=len(cells),
        scanned_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    _heatmap_cache[cache_key] = result
    return result


# ─── Feature 4: Regime-Conditioned DNA ────────────────────────────────────────

def _classify_regime(closes: np.ndarray, bar_idx: int) -> str:
    """Bull / Sideways / Bear regime at a given bar index."""
    c = float(closes[bar_idx])
    sma50_start = max(0, bar_idx - 50)
    sma200_start = max(0, bar_idx - 200)
    sma50 = float(closes[sma50_start:bar_idx].mean()) if bar_idx > sma50_start else c
    sma200 = float(closes[sma200_start:bar_idx].mean()) if bar_idx > sma200_start else c
    if c > sma200:
        return "Bull"
    if c < sma50:
        return "Bear"
    return "Sideways"


def get_regime_dna(symbol: str) -> RegimeDNAResponse:
    """Split historical pattern DNA by market regime at the time of each detection."""
    try:
        closes, highs, lows, vols, dates = _fetch_data(symbol)
    except Exception as exc:
        log.warning("Regime DNA fetch failed for %s: %s", symbol, exc)
        return RegimeDNAResponse(symbol=symbol, entries=[])

    n = len(closes)
    # Build a date-to-index map for fast regime lookup
    date_to_idx: dict[str, int] = {d: i for i, d in enumerate(dates)}

    all_detections = _get_dated_samples(closes, highs, lows, vols, dates)

    # Bucket: pattern -> regime -> list of f21
    is_bearish_map = {name: (name in BEARISH_PATTERNS) for name in PATTERN_CATEGORIES}
    buckets: dict[str, dict[str, list[float]]] = {}

    for dt, pattern, category, f21, f63 in all_detections:
        if np.isnan(f21):
            continue
        bar_idx = date_to_idx.get(dt)
        if bar_idx is None:
            continue
        regime = _classify_regime(closes, bar_idx)
        if pattern not in buckets:
            buckets[pattern] = {"Bull": [], "Sideways": [], "Bear": []}
        buckets[pattern][regime].append(f21)

    entries: list[RegimeDNAEntry] = []

    def _make_bucket(vals: list[float], bearish: bool) -> RegimeBucket:
        if not vals:
            return RegimeBucket(n=0, success_rate=0.0, avg_ret_21d=0.0)
        arr = np.array(vals)
        sr = float(np.mean(arr < 0) * 100) if bearish else float(np.mean(arr > 0) * 100)
        return RegimeBucket(n=len(vals), success_rate=round(sr, 1), avg_ret_21d=round(float(arr.mean()), 2))

    for pattern, regime_data in buckets.items():
        is_bearish = is_bearish_map.get(pattern, False)
        bull_bkt = _make_bucket(regime_data["Bull"], is_bearish)
        side_bkt = _make_bucket(regime_data["Sideways"], is_bearish)
        bear_bkt = _make_bucket(regime_data["Bear"], is_bearish)

        # Skip if no regime has at least 3 detections
        if max(bull_bkt.n, side_bkt.n, bear_bkt.n) < 3:
            continue

        best_regime = max(
            [("Bull", bull_bkt), ("Sideways", side_bkt), ("Bear", bear_bkt)],
            key=lambda x: x[1].success_rate if x[1].n >= 3 else -1.0,
        )[0]

        entries.append(RegimeDNAEntry(
            pattern=pattern,
            category=PATTERN_CATEGORIES.get(pattern, "Unknown"),
            bull=bull_bkt,
            sideways=side_bkt,
            bear=bear_bkt,
            best_regime=best_regime,
        ))

    entries.sort(key=lambda x: max(x.bull.success_rate, x.sideways.success_rate, x.bear.success_rate), reverse=True)
    return RegimeDNAResponse(symbol=symbol, entries=entries)


# ─── Feature 5: Pattern Failure Analysis ──────────────────────────────────────

_failures_cache: dict[str, PatternFailureResponse] = {}


def get_pattern_failures(pattern_name: str) -> PatternFailureResponse:
    """Which stocks consistently fail each pattern (batch data, cached daily)."""
    cache_key = f"{_date.today().isoformat()}:{pattern_name}:failures"
    if cache_key in _failures_cache:
        return _failures_cache[cache_key]

    all_data = _load_all_data('daily')
    is_bearish = pattern_name in BEARISH_PATTERNS
    results: list[PatternFailureItem] = []
    # 1500 bars ≈ 6yr history → enough occurrences for _aggregate (needs ≥12).
    # Profiling: 56ms/sym at 2000 bars → ~42ms/sym at 1500 bars → 500 syms ≈ 21s
    _MB = 1500

    for sym, (closes, highs, lows, vols, _) in all_data.items():
        try:
            c  = closes[-_MB:] if len(closes) > _MB else closes
            h  = highs[-_MB:]  if len(highs)  > _MB else highs
            lo = lows[-_MB:]   if len(lows)   > _MB else lows
            v  = vols[-_MB:]   if len(vols)   > _MB else vols
            scanner_map = {
                "Double Bottom":            lambda c=c, lo=lo, v=v: _scan_double_bottom(c, lo, v),
                "Double Top":               lambda c=c, h=h, v=v: _scan_double_top(c, h, v),
                "Bull Flag":                lambda c=c, v=v: _scan_bull_flag(c, v),
                "Bear Flag":                lambda c=c, v=v: _scan_bear_flag(c, v),
                "Head & Shoulders":         lambda c=c, h=h, lo=lo: _scan_head_shoulders(c, h, lo),
                "Inverse Head & Shoulders": lambda c=c, h=h, lo=lo: _scan_inv_head_shoulders(c, h, lo),
                "Ascending Triangle":       lambda c=c, h=h, lo=lo: _scan_ascending_triangle(c, h, lo),
                "Descending Triangle":      lambda c=c, h=h, lo=lo: _scan_descending_triangle(c, h, lo),
                "Rectangle":               lambda c=c, h=h, lo=lo: _scan_rectangle(c, h, lo),
            }
            fn = scanner_map.get(pattern_name)
            if fn is None:
                continue
            samples = fn()
            # samples = [(fwd_21d, fwd_63d, confidence), ...]
            valid_f21 = [f21 for f21, _f63, _conf in samples if not np.isnan(f21)]
            if len(valid_f21) < 6:
                continue
            f21s = np.array(valid_f21)
            success = float(np.mean(f21s < 0) * 100) if is_bearish \
                      else float(np.mean(f21s > 0) * 100)
            failure_rate = round(1.0 - success / 100.0, 3)
            avg_fwd_21d  = round(float(f21s.mean()), 2)
            losses = [f for f in valid_f21 if (f > 0 if is_bearish else f < 0)]
            avg_loss = round(float(np.mean(losses)), 2) if losses else 0.0
            magnitude    = min(20.0, abs(avg_fwd_21d) * 2)
            consistency  = max(0.0, 10.0 - float(np.std(f21s)) * 0.5)
            dna_score    = int(min(100, max(0, success * 0.7 + magnitude + consistency)))
            results.append(PatternFailureItem(
                symbol=sym,
                failure_rate=failure_rate,
                occurrences=len(valid_f21),
                avg_fwd_21d=avg_fwd_21d,
                avg_loss=avg_loss,
                dna_score=dna_score,
            ))
        except Exception as exc:
            log.debug("Failure scan failed %s/%s: %s", sym, pattern_name, exc)

    results.sort(key=lambda x: x.failure_rate, reverse=True)
    result = PatternFailureResponse(pattern=pattern_name, items=results[:20])
    _failures_cache[cache_key] = result
    return result
