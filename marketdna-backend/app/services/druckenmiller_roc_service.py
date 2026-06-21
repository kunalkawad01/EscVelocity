"""Druckenmiller ROC² (Rate of Change Squared) Signal Engine.

Stan Druckenmiller: "Because it used second derivative rate of change, these
things will often bottom a year to a year and a half before the fundamentals."

ROC  = (price[t] / price[t-n]) - 1          → 1st derivative (momentum)
ROC² = roc[t] - roc[t-n]                    → 2nd derivative (acceleration)

The leading signal is ROC² turning positive while ROC is still negative — the
rate of decline is decelerating before the actual trend reverses.

Three timeframes:
  Short        : roc_n=21d,  roc2_n=5d
  Intermediate : roc_n=63d,  roc2_n=21d   ← primary for phase classification
  Long         : roc_n=126d, roc2_n=42d

Phases (based on intermediate ROC and ROC²):
  strong_uptrend   : roc > 0, roc2 > 0   — momentum accelerating up
  top_inflection   : roc > 0, roc2 < 0   — uptrend decelerating (caution)
  early_bottom     : roc < 0, roc2 > 0   — decline decelerating (THE SIGNAL)
  strong_downtrend : roc < 0, roc2 < 0   — momentum accelerating down
  neutral          : |roc| < 0.02        — no clear trend
"""
import logging
from datetime import datetime

import numpy as np

from app.services.duckdb_client import get_connection
from app.services.stock_metrics import get_universe as _fetch_universe
from app.models.druckenmiller_roc import (
    ROC2HistoryPoint, ROC2StockResult, ROC2ScanItem, ROC2ScanResult,
)

log = logging.getLogger(__name__)

# ─── Timeframes ───────────────────────────────────────────────────────────────

_SHORT_ROC_N    = 21
_SHORT_ROC2_N   = 5
_INT_ROC_N      = 63
_INT_ROC2_N     = 21
_LONG_ROC_N     = 126
_LONG_ROC2_N    = 42
_VOL_ROC_N      = 63
_VOL_ROC2_N     = 21
_HISTORY_BARS   = 252

# ─── Cache ───────────────────────────────────────────────────────────────────

_symbol_cache: dict[tuple[str, str], ROC2StockResult] = {}
_scan_cache:   tuple[str, ROC2ScanResult] | None = None


# ─── Core math ────────────────────────────────────────────────────────────────

def _roc(series: np.ndarray, n: int) -> np.ndarray:
    """Rate of Change: (series[t] / series[t-n]) - 1. NaN for first n bars."""
    out = np.full(len(series), np.nan)
    valid = series[:-n] != 0
    out[n:][valid] = (series[n:][valid] / series[:-n][valid]) - 1.0
    return out


def _roc2(roc_series: np.ndarray, n: int) -> np.ndarray:
    """Second derivative: difference of ROC over n bars.

    Using difference (not ratio) so the sign stays meaningful when ROC crosses zero.
    ROC² > 0 means momentum is improving; ROC² < 0 means momentum is deteriorating.
    """
    out = np.full(len(roc_series), np.nan)
    current = roc_series[n:]
    lagged  = roc_series[:-n]
    valid   = ~np.isnan(current) & ~np.isnan(lagged)
    out[n:] = np.where(valid, current - lagged, np.nan)
    return out


def _get_phase(roc_val: float, roc2_val: float) -> str:
    if np.isnan(roc_val) or np.isnan(roc2_val):
        return "neutral"
    if abs(roc_val) < 0.02:
        return "neutral"
    if roc_val > 0 and roc2_val > 0:
        return "strong_uptrend"
    if roc_val > 0 and roc2_val < 0:
        return "top_inflection"
    if roc_val < 0 and roc2_val > 0:
        return "early_bottom"
    if roc_val < 0 and roc2_val < 0:
        return "strong_downtrend"
    return "neutral"


def _composite_score(
    roc2_short: float | None,
    roc2_int: float | None,
    roc2_long: float | None,
) -> float:
    """Weighted composite ROC² score in [-100, +100].

    Uses tanh to squash extreme values: tanh(roc2 * 5) maps [-0.4, +0.4] → [-1, +1].
    Weights: short=0.25, intermediate=0.40, long=0.35.
    """
    parts = []
    weights = []
    if roc2_short is not None and not np.isnan(roc2_short):
        parts.append(float(np.tanh(roc2_short * 5)) * 0.25)
        weights.append(0.25)
    if roc2_int is not None and not np.isnan(roc2_int):
        parts.append(float(np.tanh(roc2_int * 5)) * 0.40)
        weights.append(0.40)
    if roc2_long is not None and not np.isnan(roc2_long):
        parts.append(float(np.tanh(roc2_long * 5)) * 0.35)
        weights.append(0.35)
    if not parts:
        return 0.0
    total_w = sum(weights)
    raw = sum(parts) / total_w
    return round(raw * 100, 2)


def _safe(val: float) -> float | None:
    return None if np.isnan(val) else round(float(val), 6)


# ─── Per-symbol computation ───────────────────────────────────────────────────

def _compute_stock(symbol: str, closes: np.ndarray, volumes: np.ndarray, dates: list[str]) -> ROC2StockResult:
    n = len(closes)

    # ROC arrays
    roc_s   = _roc(closes, _SHORT_ROC_N)
    roc_i   = _roc(closes, _INT_ROC_N)
    roc_l   = _roc(closes, _LONG_ROC_N)

    # ROC² arrays
    roc2_s  = _roc2(roc_s, _SHORT_ROC2_N)
    roc2_i  = _roc2(roc_i, _INT_ROC2_N)
    roc2_l  = _roc2(roc_l, _LONG_ROC2_N)

    # Volume ROC²
    vol_roc = _roc(volumes, _VOL_ROC_N)
    vol_roc2_arr = _roc2(vol_roc, _VOL_ROC2_N)

    # Current values (last bar)
    cur_roc_s   = _safe(roc_s[-1])
    cur_roc_i   = _safe(roc_i[-1])
    cur_roc_l   = _safe(roc_l[-1])
    cur_roc2_s  = _safe(roc2_s[-1])
    cur_roc2_i  = _safe(roc2_i[-1])
    cur_roc2_l  = _safe(roc2_l[-1])
    cur_vol_roc2 = _safe(vol_roc2_arr[-1])

    # Phase (based on intermediate ROC / ROC²)
    phase = _get_phase(
        roc_i[-1] if not np.isnan(roc_i[-1]) else float("nan"),
        roc2_i[-1] if not np.isnan(roc2_i[-1]) else float("nan"),
    )

    # Lead count: timeframes where ROC² > 0
    lead_count = sum(
        1 for v in [cur_roc2_s, cur_roc2_i, cur_roc2_l]
        if v is not None and v > 0
    )

    composite = _composite_score(cur_roc2_s, cur_roc2_i, cur_roc2_l)

    # History for chart (last _HISTORY_BARS bars)
    start = max(0, n - _HISTORY_BARS)
    history: list[ROC2HistoryPoint] = []
    for i in range(start, n):
        h_phase = _get_phase(
            roc_i[i] if not np.isnan(roc_i[i]) else float("nan"),
            roc2_i[i] if not np.isnan(roc2_i[i]) else float("nan"),
        )
        history.append(ROC2HistoryPoint(
            date=dates[i], close=round(float(closes[i]), 2),
            roc=_safe(roc_i[i]),   roc2=_safe(roc2_i[i]),
            roc_short=_safe(roc_s[i]),  roc2_short=_safe(roc2_s[i]),
            roc_long=_safe(roc_l[i]),   roc2_long=_safe(roc2_l[i]),
            vol_roc2=_safe(vol_roc2_arr[i]),
            phase=h_phase,
        ))

    return ROC2StockResult(
        symbol=symbol,
        date=dates[-1],
        close=round(float(closes[-1]), 2),
        roc_short=cur_roc_s,
        roc_intermediate=cur_roc_i,
        roc_long=cur_roc_l,
        roc2_short=cur_roc2_s,
        roc2_intermediate=cur_roc2_i,
        roc2_long=cur_roc2_l,
        vol_roc2=cur_vol_roc2,
        phase=phase,
        lead_count=lead_count,
        composite=composite,
        history=history,
        computed_at=datetime.now().isoformat(),
    )


# ─── Public API ───────────────────────────────────────────────────────────────

def get_stock_signal(symbol: str) -> ROC2StockResult:
    """ROC² analysis for a single symbol — cached by (symbol, date)."""
    today = datetime.now().strftime("%Y-%m-%d")
    key = (symbol, today)
    if key in _symbol_cache:
        return _symbol_cache[key]

    con = get_connection()
    rows = con.execute("""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d,
               close, volume
        FROM equities_prices
        WHERE symbol = ?
        ORDER BY date
    """, [symbol]).fetchall()

    if len(rows) < _LONG_ROC_N + _LONG_ROC2_N + 10:
        raise ValueError(f"{symbol}: insufficient history ({len(rows)} bars)")

    dates   = [r[0] for r in rows]
    closes  = np.array([r[1] for r in rows], dtype=float)
    volumes = np.array([r[2] if r[2] else 0 for r in rows], dtype=float)

    result = _compute_stock(symbol, closes, volumes, dates)
    _symbol_cache[key] = result
    return result


def get_scan() -> ROC2ScanResult:
    """Full universe ROC² scan — cached daily."""
    global _scan_cache
    today = datetime.now().strftime("%Y-%m-%d")
    if _scan_cache and _scan_cache[0] == today:
        return _scan_cache[1]

    universe = _fetch_universe()
    if not universe:
        raise ValueError("No symbols found in equities_prices")

    con = get_connection()
    rows = con.execute(f"""
        SELECT symbol,
               STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d,
               close, volume
        FROM equities_prices
        WHERE symbol IN ({','.join('?' * len(universe))})
        ORDER BY symbol, date
    """, universe).fetchall()

    # Group by symbol
    from collections import defaultdict
    sym_rows: dict[str, list] = defaultdict(list)
    for r in rows:
        sym_rows[r[0]].append(r)

    stocks: list[ROC2ScanItem] = []
    min_bars = _LONG_ROC_N + _LONG_ROC2_N + 10

    for sym, sym_data in sym_rows.items():
        if len(sym_data) < min_bars:
            continue
        try:
            dates   = [r[1] for r in sym_data]
            closes  = np.array([r[2] for r in sym_data], dtype=float)
            volumes = np.array([r[3] if r[3] else 0 for r in sym_data], dtype=float)

            roc_i    = _roc(closes, _INT_ROC_N)
            roc2_s   = _roc2(_roc(closes, _SHORT_ROC_N), _SHORT_ROC2_N)
            roc2_i   = _roc2(roc_i, _INT_ROC2_N)
            roc2_l   = _roc2(_roc(closes, _LONG_ROC_N), _LONG_ROC2_N)
            vol_roc2_arr = _roc2(_roc(volumes, _VOL_ROC_N), _VOL_ROC2_N)

            phase = _get_phase(
                float(roc_i[-1]) if not np.isnan(roc_i[-1]) else float("nan"),
                float(roc2_i[-1]) if not np.isnan(roc2_i[-1]) else float("nan"),
            )
            lead_count = sum(
                1 for v in [roc2_s[-1], roc2_i[-1], roc2_l[-1]]
                if not np.isnan(v) and v > 0
            )
            composite = _composite_score(
                float(roc2_s[-1]) if not np.isnan(roc2_s[-1]) else None,
                float(roc2_i[-1]) if not np.isnan(roc2_i[-1]) else None,
                float(roc2_l[-1]) if not np.isnan(roc2_l[-1]) else None,
            )

            sparkline = [round(float(v), 2) for v in closes[-30:]]
            stocks.append(ROC2ScanItem(
                symbol=sym,
                close=round(float(closes[-1]), 2),
                roc_intermediate=_safe(roc_i[-1]),
                roc2_intermediate=_safe(roc2_i[-1]),
                vol_roc2=_safe(vol_roc2_arr[-1]),
                phase=phase,
                lead_count=lead_count,
                composite=composite,
                sparkline=sparkline,
            ))
        except Exception as exc:
            log.debug("roc2 scan skip %s: %s", sym, exc)

    stocks.sort(key=lambda s: s.composite, reverse=True)

    result = ROC2ScanResult(
        date=today,
        total=len(stocks),
        early_bottom_count=sum(1 for s in stocks if s.phase == "early_bottom"),
        strong_uptrend_count=sum(1 for s in stocks if s.phase == "strong_uptrend"),
        top_inflection_count=sum(1 for s in stocks if s.phase == "top_inflection"),
        strong_downtrend_count=sum(1 for s in stocks if s.phase == "strong_downtrend"),
        stocks=stocks,
        computed_at=datetime.now().isoformat(),
    )

    _scan_cache = (today, result)
    return result


def invalidate_cache() -> None:
    global _scan_cache
    _symbol_cache.clear()
    _scan_cache = None
