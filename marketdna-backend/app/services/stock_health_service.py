"""Stock Health Service — 20-metric behavioral profile of return quality.

Startup:  load parquet (instant) → scanner ready in <1s.
Refresh:  batch warmup (4 bulk DuckDB queries) runs in background when parquet is stale.
Per-symbol analytics: pure NumPy via _analytics() — no DuckDB I/O.
Results cached per (symbol, calendar_date).
"""
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

from app.config import settings
from app.services.duckdb_client import get_connection
from app.services.regime_service import get_market_regime_series_if_ready
from app.models.stock_health import (
    StockHealthReport, ArchetypeSummary, CoreReturns, Resilience, TrendQuality,
    Behavioral, CompositeScores, CrashResistance, RegimePerformance,
    AlphaHalfLife, DrawdownPoint,
)
from app.services.stock_metrics import get_universe as _get_all_symbols

log = logging.getLogger(__name__)

# ── Module state ──────────────────────────────────────────────────────────────
_cache: dict[tuple[str, str], StockHealthReport] = {}
_scan_results: list[ArchetypeSummary] = []   # populated from parquet or batch
_scan_ready   = False                         # True when today's data is complete
_scan_lock    = threading.Lock()

_PARQUET_PATH = settings.data_path / "data_lake" / "derived" / "stock_health" / "scan.parquet"

_CRASHES = [
    ('covid_2020',      '2020-02-17', '2020-03-23'),
    ('correction_2022', '2022-01-01', '2022-06-17'),
    ('selloff_2024',    '2024-09-27', '2024-11-01'),
]


# ── Normaliser ────────────────────────────────────────────────────────────────

def _norm(v: float, lo: float, hi: float, invert: bool = False) -> float:
    if hi <= lo:
        return 0.0
    s = max(0.0, min(100.0, (v - lo) / (hi - lo) * 100.0))
    return 100.0 - s if invert else s


# ── Momentum persistence ──────────────────────────────────────────────────────

def _momentum_persistence(closes: np.ndarray, streak: int) -> float:
    up = (np.diff(closes) > 0).astype(np.int8)
    n = len(up)
    if n < streak + 1:
        return 0.5
    count, wins = 0, 0
    for i in range(streak - 1, n - 1):
        if int(up[i - streak + 1: i + 1].sum()) == streak:
            count += 1
            wins += int(up[i + 1])
    return wins / count if count > 0 else 0.5


# ── Drawdown recovery scan ────────────────────────────────────────────────────

def _recovery_stats(closes: np.ndarray) -> tuple[Optional[float], int]:
    n = len(closes)
    running_max = np.maximum.accumulate(closes)
    dd_pct = (closes - running_max) / running_max
    recoveries: list[int] = []
    in_dd = False
    start_i = 0
    peak_at_start = 0.0
    for i in range(n):
        if not in_dd and dd_pct[i] <= -0.10:
            in_dd = True
            start_i = i
            peak_at_start = running_max[i]
        elif in_dd and closes[i] >= peak_at_start:
            recoveries.append(i - start_i)
            in_dd = False
    avg = float(np.mean(recoveries)) if recoveries else None
    freq = len(recoveries) + (1 if in_dd else 0)
    return avg, freq


# ── Monthly returns from daily closes (no DuckDB) ────────────────────────────

def _monthly_returns(dates: list[str], closes: np.ndarray) -> np.ndarray:
    """Equivalent to DuckDB LAST(close)/FIRST(close)-1 GROUP BY month, no I/O."""
    months: dict[str, list[float]] = {}
    for d, c in zip(dates, closes):
        ym = d[:7]
        if ym not in months:
            months[ym] = []
        months[ym].append(float(c))
    rets = []
    for ym in sorted(months):
        prices = months[ym]
        if len(prices) >= 2:
            rets.append(prices[-1] / prices[0] - 1.0)
    return np.array(rets, dtype=np.float64)


# ── Pure-NumPy analytics (no DuckDB) ─────────────────────────────────────────

def _analytics(
    symbol: str,
    closes: np.ndarray,
    dates: list[str],
    monthly_arr: np.ndarray,
    cr: CrashResistance,
    mkt: dict,
) -> StockHealthReport:
    n       = len(closes)
    returns = np.diff(closes) / closes[:-1]
    years   = n / 252.0

    consistency   = float(np.mean(monthly_arr > 0)) if len(monthly_arr) > 0 else 0.5

    total_ret = float(np.prod(1 + returns) - 1)
    if len(returns) >= 5 and abs(total_ret) > 1e-9:
        top5_idx      = np.argpartition(returns, -5)[-5:]
        top5_ret      = float(np.prod(1 + returns[top5_idx]) - 1)
        concentration = float(np.clip(top5_ret / total_ret, 0.0, 1.0))
    else:
        concentration = 0.5

    avg_recovery_days, drawdown_freq = _recovery_stats(closes)

    net_change     = abs(float(closes[-1] - closes[0]))
    total_movement = float(np.sum(np.abs(np.diff(closes))))
    trend_eff      = net_change / total_movement if total_movement > 0 else 0.0

    running_max    = np.maximum.accumulate(closes)
    dd_series      = (closes - running_max) / running_max
    total_pain     = float(np.sum(np.abs(dd_series)))
    total_gain_pct = (float(closes[-1]) / float(closes[0]) - 1) * 100
    pain_to_gain   = total_pain / total_gain_pct if total_gain_pct > 0 else 999.0

    log_p  = np.log(closes)
    x      = np.arange(n, dtype=np.float64)
    xm, ym = x.mean(), log_p.mean()
    ss_xx  = float(np.dot(x - xm, x - xm))
    ss_xy  = float(np.dot(x - xm, log_p - ym))
    ss_yy  = float(np.dot(log_p - ym, log_p - ym))
    r2     = (ss_xy ** 2) / (ss_xx * ss_yy) if ss_xx * ss_yy > 1e-12 else 0.0

    time_uw = float(np.mean(closes < running_max))

    mp3 = _momentum_persistence(closes, 3)
    mp5 = _momentum_persistence(closes, 5)
    mp7 = _momentum_persistence(closes, 7)

    conviction = (
        _norm(consistency, 0.4, 1.0)               * 0.30 +
        _norm(r2, 0.0, 1.0)                        * 0.25 +
        _norm(trend_eff, 0.0, 1.0)                 * 0.20 +
        _norm(time_uw, 0.0, 1.0, invert=True)      * 0.15 +
        _norm(pain_to_gain, 0.0, 5.0, invert=True) * 0.10
    )

    window = 63
    anti_fragility = 0.0
    if len(returns) >= window * 2 + 10:
        try:
            shape        = (len(returns) - window + 1, window)
            strides      = (returns.strides[0], returns.strides[0])
            win_arr      = np.lib.stride_tricks.as_strided(returns, shape=shape, strides=strides)
            vol          = win_arr.std(axis=1) * np.sqrt(252)
            fwd_ret      = closes[window * 2:] / closes[window:-window] - 1
            min_len      = min(len(vol), len(fwd_ret))
            if min_len > 10:
                anti_fragility = float(np.corrcoef(vol[:min_len], fwd_ret[:min_len])[0, 1])
                if not np.isfinite(anti_fragility):
                    anti_fragility = 0.0
        except Exception:
            anti_fragility = 0.0

    daily_vol = float(returns.std() * np.sqrt(252))
    swan = (
        _norm(consistency, 0.4, 1.0)                         * 0.25 +
        _norm(time_uw, 0.0, 0.7, invert=True)                * 0.25 +
        _norm(avg_recovery_days or 200, 0, 200, invert=True) * 0.20 +
        _norm(trend_eff, 0.0, 1.0)                           * 0.15 +
        _norm(daily_vol, 0.0, 0.6, invert=True)              * 0.15
    )

    cagr_frac           = (float(closes[-1]) / float(closes[0])) ** (1.0 / years) - 1
    recovery_factor     = 1.0 / (1.0 + (avg_recovery_days or 0) / 252.0)
    compounding_quality = (
        _norm(cagr_frac * 100, 0, 30)            * 0.35 +
        _norm(r2, 0.0, 1.0)                      * 0.35 +
        _norm(recovery_factor, 0.0, 1.0)         * 0.15 +
        _norm(drawdown_freq, 0, 10, invert=True) * 0.15
    )

    if n >= 252:
        ratio    = closes[252:] / closes[:-252]
        opp_cost = float(np.mean((ratio > 0.95) & (ratio < 1.05)))
    else:
        opp_cost = 0.0

    bull_r, bear_r, side_r = [], [], []
    bull_days = bear_days = side_days = 0
    for i, d in enumerate(dates[1:]):
        score = mkt.get(d)
        if score is None:
            continue
        r = returns[i]
        if score >= 60:
            bull_r.append(r); bull_days += 1
        elif score <= 40:
            bear_r.append(r); bear_days += 1
        else:
            side_r.append(r); side_days += 1

    def _cumret(arr: list) -> Optional[float]:
        return float(np.prod(1 + np.array(arr)) - 1) if arr else None

    regime_perf = RegimePerformance(
        bull=_cumret(bull_r), bear=_cumret(bear_r), sideways=_cumret(side_r),
        bull_days=bull_days, bear_days=bear_days, sideways_days=side_days,
    )

    def _annualise(r: float, nb: int) -> float:
        return (1 + r) ** (252.0 / nb) - 1 if nb > 0 else 0.0

    nb          = len(returns)
    sorted_idx  = np.argsort(returns)
    ex1_r       = float(np.prod(1 + returns[sorted_idx[:-1]])  - 1)
    ex5_r       = float(np.prod(1 + returns[sorted_idx[:-5]])  - 1) if nb > 5  else ex1_r
    ex10_r      = float(np.prod(1 + returns[sorted_idx[:-10]]) - 1) if nb > 10 else ex1_r
    cagr_ex1    = _annualise(ex1_r,  nb) * 100
    cagr_ex5    = _annualise(ex5_r,  nb) * 100
    cagr_ex10   = _annualise(ex10_r, nb) * 100
    skill_ratio = cagr_ex10 / (cagr_frac * 100) if abs(cagr_frac * 100) > 1e-6 else 0.0

    max_dd_frac = float(np.min(dd_series))
    cap_eff     = cagr_frac / abs(max_dd_frac) if abs(max_dd_frac) > 1e-6 else 0.0

    ahl: dict[str, Optional[float]] = {'m1': None, 'm3': None, 'm6': None, 'm12': None}
    if len(monthly_arr) >= 15:
        threshold = float(np.percentile(monthly_arr, 75))
        strong_up = monthly_arr > threshold
        for lag, key in [(1, 'm1'), (3, 'm3'), (6, 'm6'), (12, 'm12')]:
            if len(monthly_arr) > lag + 5:
                mask = strong_up[:-lag]
                fwd  = monthly_arr[lag:]
                ml   = min(len(mask), len(fwd))
                sub  = fwd[:ml][mask[:ml]]
                ahl[key] = float(sub.mean()) if len(sub) > 0 else None

    def _classify() -> str:
        if conviction >= 80 and compounding_quality >= 75:
            return "Elite Compounder"
        if conviction >= 70 and swan >= 70:
            return "Steady Grinder"
        if skill_ratio < 0.4:
            return "Lucky Speculator"
        if anti_fragility > 0.2:
            return "Anti-Fragile Growth"
        if conviction >= 60 and compounding_quality < 50:
            return "Volatile Performer"
        if time_uw > 0.6:
            return "Capital Trap"
        return "Mean Reverter"

    dd_pct_series = dd_series * 100
    dd_pts = [
        DrawdownPoint(date=dates[i], drawdown=round(float(dd_pct_series[i]), 2))
        for i in range(n)
    ]

    return StockHealthReport(
        symbol=symbol,
        data_start=dates[0],
        data_end=dates[-1],
        years=round(years, 1),
        archetype=_classify(),
        core_returns=CoreReturns(
            cagr=round(cagr_frac * 100, 2),
            consistency_score=round(consistency, 3),
            return_concentration=round(concentration, 3),
            capital_efficiency=round(cap_eff, 2),
        ),
        resilience=Resilience(
            max_drawdown=round(max_dd_frac * 100, 2),
            drawdown_frequency=drawdown_freq,
            avg_recovery_days=round(avg_recovery_days, 1) if avg_recovery_days else None,
            time_under_water=round(time_uw, 3),
        ),
        trend_quality=TrendQuality(
            trend_efficiency=round(trend_eff, 3),
            wealth_smoothness_r2=round(r2, 3),
            skill_ratio=round(skill_ratio, 3),
            cagr_ex_top1=round(cagr_ex1, 2),
            cagr_ex_top5=round(cagr_ex5, 2),
            cagr_ex_top10=round(cagr_ex10, 2),
        ),
        behavioral=Behavioral(
            pain_to_gain=round(pain_to_gain, 3),
            anti_fragility=round(anti_fragility, 3),
            opportunity_cost=round(opp_cost, 3),
            momentum_persistence_3d=round(mp3, 3),
            momentum_persistence_5d=round(mp5, 3),
            momentum_persistence_7d=round(mp7, 3),
        ),
        composite_scores=CompositeScores(
            conviction=round(conviction, 1),
            swan=round(swan, 1),
            compounding_quality=round(compounding_quality, 1),
        ),
        crash_resistance=cr,
        regime_performance=regime_perf,
        alpha_half_life=AlphaHalfLife(**ahl),
        drawdown_series=dd_pts,
        computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )


# ── Parquet persistence ───────────────────────────────────────────────────────

def _save_scan_to_parquet(items: list[ArchetypeSummary]) -> None:
    """Write scan summaries to parquet so the next startup is instant."""
    try:
        import polars as pl
        today = datetime.utcnow().strftime("%Y-%m-%d")
        df = pl.DataFrame({
            'symbol':              [i.symbol for i in items],
            'archetype':           [i.archetype for i in items],
            'conviction':          [i.conviction for i in items],
            'swan':                [i.swan for i in items],
            'compounding_quality': [i.compounding_quality for i in items],
            'cagr':                [i.cagr for i in items],
            'max_drawdown':        [i.max_drawdown for i in items],
            'years':               [i.years for i in items],
            'computed_date':       [today] * len(items),
        })
        _PARQUET_PATH.parent.mkdir(parents=True, exist_ok=True)
        df.write_parquet(str(_PARQUET_PATH))
        log.info("stock_health: saved %d rows to parquet → %s", len(items), _PARQUET_PATH)
    except Exception as exc:
        log.warning("stock_health: parquet save failed — %s", exc)


def _load_scan_from_parquet() -> bool:
    """Load parquet into _scan_results. Returns True if data is today's."""
    global _scan_results, _scan_ready
    if not _PARQUET_PATH.exists():
        log.info("stock_health: no parquet found at %s", _PARQUET_PATH)
        return False
    try:
        import polars as pl
        df = pl.read_parquet(str(_PARQUET_PATH))
        today    = datetime.utcnow().strftime("%Y-%m-%d")
        is_fresh = df.filter(pl.col('computed_date') == today).height > 0
        items = [
            ArchetypeSummary(
                symbol=row['symbol'],
                archetype=row['archetype'],
                conviction=float(row['conviction']),
                swan=float(row['swan']),
                compounding_quality=float(row['compounding_quality']),
                cagr=float(row['cagr']),
                max_drawdown=float(row['max_drawdown']),
                years=float(row['years']),
            )
            for row in df.iter_rows(named=True)
        ]
        _scan_results = items
        if is_fresh:
            _scan_ready = True
            log.info("stock_health: loaded fresh scan from parquet (%d symbols)", len(items))
        else:
            log.info("stock_health: loaded stale scan from parquet (%d symbols) — will refresh", len(items))
        return is_fresh
    except Exception as exc:
        log.warning("stock_health: parquet load failed — %s", exc)
        return False


# ── Single-symbol compute (on-demand via get_report) ─────────────────────────

def _compute(symbol: str) -> StockHealthReport:
    con = get_connection()
    rows = con.execute(
        "SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)), open, high, low, close, volume "
        "FROM equities_prices WHERE symbol = ? ORDER BY date ASC",
        [symbol]
    ).fetchall()
    if len(rows) < 252:
        raise ValueError(f"Insufficient data for {symbol}: need ≥252 bars, got {len(rows)}")

    dates  = [r[0] for r in rows]
    closes = np.array([r[4] for r in rows], dtype=np.float64)

    monthly_arr = _monthly_returns(dates, closes)

    def crash_ret(start: str, end: str) -> Optional[float]:
        row = con.execute("""
            SELECT LAST(close ORDER BY date) / FIRST(close ORDER BY date) - 1
            FROM equities_prices
            WHERE symbol = ? AND STRFTIME('%Y-%m-%d', CAST(date AS DATE)) BETWEEN ? AND ?
        """, [symbol, start, end]).fetchone()
        return float(row[0]) if row and row[0] is not None else None

    cr = CrashResistance(
        covid_2020      = crash_ret('2020-02-17', '2020-03-23'),
        correction_2022 = crash_ret('2022-01-01', '2022-06-17'),
        selloff_2024    = crash_ret('2024-09-27', '2024-11-01'),
    )
    mkt = get_market_regime_series_if_ready()
    return _analytics(symbol, closes, dates, monthly_arr, cr, mkt)


# ── Batch warmup — 4 bulk DuckDB queries for all 500 symbols ─────────────────

def _batch_warmup_all() -> None:
    """4 bulk queries + pure-NumPy per symbol.

    Replaces 2,500 serial DuckDB queries with:
      1 × bulk OHLCV + 3 × crash-period GROUP BY symbol
    Monthly returns derived from daily closes in Python — no extra query.
    Target: 60–90 s total (was ~30 min).
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    con   = get_connection()

    log.info("stock_health batch: loading OHLCV...")
    t0   = datetime.utcnow()
    rows = con.execute("""
        SELECT symbol,
               STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d,
               close
        FROM equities_prices
        ORDER BY symbol, date
    """).fetchall()
    log.info("stock_health batch: OHLCV loaded (%d rows) in %.1fs",
             len(rows), (datetime.utcnow() - t0).total_seconds())

    symbol_dates:  dict[str, list[str]]   = {}
    symbol_closes: dict[str, list[float]] = {}
    for sym, d, c in rows:
        if sym not in symbol_dates:
            symbol_dates[sym]  = []
            symbol_closes[sym] = []
        symbol_dates[sym].append(d)
        symbol_closes[sym].append(float(c))

    crash_data: dict[str, dict[str, Optional[float]]] = {}
    for name, start, end in _CRASHES:
        log.info("stock_health batch: crash %s (%s → %s)...", name, start, end)
        crash_rows = con.execute("""
            SELECT symbol,
                   LAST(close ORDER BY date) / FIRST(close ORDER BY date) - 1
            FROM equities_prices
            WHERE STRFTIME('%Y-%m-%d', CAST(date AS DATE)) BETWEEN ? AND ?
            GROUP BY symbol
        """, [start, end]).fetchall()
        for sym, val in crash_rows:
            if sym not in crash_data:
                crash_data[sym] = {}
            crash_data[sym][name] = float(val) if val is not None else None

    mkt     = get_market_regime_series_if_ready()
    universe = list(symbol_dates.keys())
    skipped  = already = 0
    log.info("stock_health batch: computing analytics for %d symbols...", len(universe))

    for sym in universe:
        if (sym, today) in _cache:
            already += 1
            continue
        dates  = symbol_dates[sym]
        closes = np.array(symbol_closes[sym], dtype=np.float64)
        if len(closes) < 252:
            skipped += 1
            continue
        monthly_arr = _monthly_returns(dates, closes)
        cr = CrashResistance(
            covid_2020      = crash_data.get(sym, {}).get('covid_2020'),
            correction_2022 = crash_data.get(sym, {}).get('correction_2022'),
            selloff_2024    = crash_data.get(sym, {}).get('selloff_2024'),
        )
        try:
            report = _analytics(sym, closes, dates, monthly_arr, cr, mkt)
            _cache[(sym, today)] = report
        except Exception as exc:
            log.warning("stock_health batch: error for %s — %s", sym, exc)
            skipped += 1

    computed = len(universe) - skipped - already
    log.info("stock_health batch: done — %d computed, %d already cached, %d skipped",
             computed, already, skipped)


# ── Public API ────────────────────────────────────────────────────────────────

def get_report(symbol: str) -> StockHealthReport:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    key   = (symbol, today)
    if key in _cache:
        return _cache[key]
    log.info("stock_health: computing report for %s", symbol)
    result      = _compute(symbol)
    _cache[key] = result
    return result


def invalidate(symbol: str) -> None:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    _cache.pop((symbol, today), None)


def invalidate_scan() -> None:
    """Clear scan state and trigger a fresh batch recompute.

    Deletes the parquet file so the next start_scan_warmup() re-runs the batch.
    Typically called after end-of-day data ingestion.
    """
    global _scan_results, _scan_ready
    _scan_results = []
    _scan_ready   = False
    _cache.clear()
    if _PARQUET_PATH.exists():
        try:
            _PARQUET_PATH.unlink()
            log.info("stock_health: parquet invalidated — will recompute on next warmup")
        except Exception as exc:
            log.warning("stock_health: could not delete parquet — %s", exc)
    start_scan_warmup()


def _make_summary(r: StockHealthReport) -> ArchetypeSummary:
    return ArchetypeSummary(
        symbol=r.symbol,
        archetype=r.archetype,
        conviction=r.composite_scores.conviction,
        swan=r.composite_scores.swan,
        compounding_quality=r.composite_scores.compounding_quality,
        cagr=r.core_returns.cagr,
        max_drawdown=r.resilience.max_drawdown,
        years=r.years,
    )


def get_cached_scan() -> tuple[list[ArchetypeSummary], bool]:
    """Return (scan results, ready flag). Never blocks.

    Priority:
      1. _scan_results (loaded from parquet or after batch completes) — full 500
      2. _cache (partial results building up during batch) — growing list
    """
    if _scan_results:
        return _scan_results, _scan_ready
    today   = datetime.utcnow().strftime("%Y-%m-%d")
    partial = [
        _make_summary(report)
        for (sym, date), report in _cache.items()
        if date == today
    ]
    return partial, _scan_ready


def start_scan_warmup() -> None:
    """Start the scan in a background thread.

    Flow:
      1. Load parquet — if today's data: set _scan_ready=True and return.
      2. If stale/missing: serve stale data immediately (scanner instant),
         run _batch_warmup_all() in background, then save fresh parquet.
    """
    def _run() -> None:
        global _scan_results, _scan_ready
        with _scan_lock:
            if _scan_ready:
                return
            is_fresh = _load_scan_from_parquet()
            if is_fresh:
                return  # parquet is today's — nothing to do

            # Stale or missing — recompute
            t0 = datetime.utcnow()
            log.info("stock_health: batch warmup starting (parquet stale/missing)...")
            try:
                _batch_warmup_all()
            except Exception as exc:
                log.error("stock_health: batch warmup failed — %s", exc, exc_info=True)
                return

            # Build summary list and save
            today   = datetime.utcnow().strftime("%Y-%m-%d")
            items   = [
                _make_summary(r)
                for (sym, date), r in _cache.items()
                if date == today
            ]
            _scan_results = items
            _scan_ready   = True
            elapsed       = (datetime.utcnow() - t0).total_seconds()
            log.info("stock_health: batch warmup complete in %.1fs (%d symbols)", elapsed, len(items))
            _save_scan_to_parquet(items)

    threading.Thread(target=_run, daemon=True, name="health-scan-warmup").start()
