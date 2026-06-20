"""Randomness Intelligence Engine — Luck/Skill decomposition, Return Concentration,
and Fragility scoring for NSE equities.

All computation is pure NumPy on closes fetched from the equities_prices DuckDB view.
Results are cached in-memory by (symbol, date_key) — one computation per stock per day.
"""
import logging
from datetime import date as _date
from datetime import datetime

import numpy as np

from app.services.duckdb_client import get_connection
from app.models.randomness import (
    LuckSkillResult, ConcentrationResult, FragilityResult, RandomnessReport,
)

log = logging.getLogger(__name__)

_cache: dict[str, RandomnessReport] = {}


# ── Data fetch ────────────────────────────────────────────────────────────────

def _fetch(symbol: str) -> tuple[np.ndarray, list[str]]:
    con = get_connection()
    rows = con.execute("""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, close
        FROM equities_prices
        WHERE symbol = ?
        ORDER BY d
    """, [symbol]).fetchall()
    if not rows:
        raise ValueError(f"No data for {symbol}")
    dates = [r[0] for r in rows]
    closes = np.array([r[1] for r in rows], dtype=float)
    return closes, dates


# ── Module 1: Luck vs Skill ───────────────────────────────────────────────────

def _luck_skill(closes: np.ndarray, dates: list[str]) -> LuckSkillResult:
    n = len(closes)
    daily_rets = np.diff(closes) / closes[:-1]

    # 1.1 Consistency — % months with positive return
    monthly: dict[str, list[float]] = {}
    for i, d in enumerate(dates[1:]):
        monthly.setdefault(d[:7], []).append(daily_rets[i])
    monthly_rets = np.array([sum(v) for v in monthly.values()])
    consistency = float(np.mean(monthly_rets > 0)) if len(monthly_rets) else 0.5

    # 1.2 Rolling return CV across 1M / 3M / 6M / 12M windows
    cvs = []
    for w in [21, 63, 126, 252]:
        if n <= w + 5:
            continue
        roll = np.array([closes[i + w] / closes[i] - 1 for i in range(n - w)])
        m = np.mean(roll)
        if abs(m) > 1e-6:
            cvs.append(abs(np.std(roll) / m))
    avg_cv = float(np.mean(cvs)) if cvs else 1.0

    # 1.3 Outcome dispersion — 1000 random 2-year windows (deterministic seed)
    horizon = min(504, max(60, n // 2))
    if n > horizon + 20:
        rng = np.random.default_rng(42)
        starts = rng.integers(0, n - horizon, size=1000)
        terminal_rets = closes[starts + horizon] / closes[starts] - 1
        iqr = float(np.percentile(terminal_rets, 75) - np.percentile(terminal_rets, 25))
        pct_pos = float(np.mean(terminal_rets > 0))
    else:
        iqr = 0.5
        pct_pos = float(np.mean(daily_rets > 0))

    # Normalise components to [0, 1]
    sensitivity = min(1.0, iqr / 1.5)
    cv_norm = min(1.0, avg_cv / 3.0)

    luck_score = (sensitivity * 0.40 + cv_norm * 0.35 + (1.0 - consistency) * 0.25) * 100
    label = "Mostly Skill" if luck_score < 30 else ("Mixed" if luck_score < 60 else "Mostly Luck")

    return LuckSkillResult(
        luck_score=round(luck_score, 1),
        luck_label=label,
        consistency_score=round(consistency * 100, 1),
        outcome_dispersion=round(iqr * 100, 1),
        pct_positive_starts=round(pct_pos * 100, 1),
        rolling_cv=round(avg_cv * 100, 1),
    )


# ── Module 2: Return Concentration ───────────────────────────────────────────

def _concentration(closes: np.ndarray, dates: list[str]) -> ConcentrationResult:
    daily_rets = np.diff(closes) / closes[:-1]
    total_return = float(closes[-1] / closes[0] - 1)
    total_sum = float(np.sum(daily_rets))

    sorted_rets = np.sort(daily_rets)[::-1]

    def top_contribution(k: int) -> float:
        if total_sum == 0:
            return 0.0
        return round(float(np.sum(sorted_rets[:k]) / total_sum * 100), 1)

    def return_without(k: int) -> float:
        idx = np.argsort(daily_rets)[-k:]
        remaining = np.delete(daily_rets, idx)
        return round(float((np.prod(1 + remaining) - 1) * 100), 1)

    rcr = top_contribution(10)
    rcr_label = "Healthy" if rcr < 20 else ("Moderate" if rcr < 50 else "Fragile")

    # Concentration curve: cumulative % across top-50 days
    curve_len = min(50, len(sorted_rets))
    curve = [
        round(float(np.sum(sorted_rets[:i + 1]) / total_sum * 100), 1) if total_sum else 0.0
        for i in range(curve_len)
    ]

    # Top-20 contributor days
    top_20_idx = np.argsort(daily_rets)[-20:][::-1]
    top_days = [
        {"date": dates[i + 1], "return_pct": round(float(daily_rets[i]) * 100, 2)}
        for i in sorted(top_20_idx, reverse=True)
    ]

    return ConcentrationResult(
        total_return_pct=round(total_return * 100, 1),
        top_1_contribution=top_contribution(1),
        top_5_contribution=top_contribution(5),
        top_10_contribution=top_contribution(10),
        top_20_contribution=top_contribution(20),
        rcr=rcr,
        rcr_label=rcr_label,
        return_actual_pct=round(total_return * 100, 1),
        return_minus_best_1=return_without(1),
        return_minus_best_5=return_without(5),
        return_minus_best_10=return_without(10),
        return_minus_best_20=return_without(20),
        concentration_curve=curve,
        top_days=top_days,
    )


# ── Module 3: Fragility ───────────────────────────────────────────────────────

def _fragility(closes: np.ndarray, dates: list[str]) -> FragilityResult:
    n = len(closes)
    daily_rets = np.diff(closes) / closes[:-1]
    total_return = float(closes[-1] / closes[0] - 1)
    years = n / 252
    cagr = (1 + total_return) ** (1 / years) - 1 if years > 0 else 0.0

    # 3.1 Worst Period Dependence — max 252-day rolling return / total return
    w = min(252, max(60, n // 3))
    roll = np.array([closes[i + w] / closes[i] - 1 for i in range(n - w)])
    max_period = float(np.max(roll)) if len(roll) else total_return
    worst_dep = float(np.clip(max_period / total_return, 0, 1)) if total_return > 0 else 0.5

    # 3.2 Drawdown Recovery Dependence — % time price < running ATH
    peak = np.maximum.accumulate(closes)
    dd_recovery_dep = float(np.mean(closes < peak))

    # 3.3 Monte Carlo — 10,000 shuffles (vectorised)
    rng = np.random.default_rng(42)
    n_sims = 10_000
    nd = len(daily_rets)
    idx = rng.integers(0, nd, size=(n_sims, nd))
    shuffled = daily_rets[idx]
    terminal = np.prod(1 + shuffled, axis=1)
    cagr_sims = terminal ** (1 / years) - 1 if years > 0 else terminal - 1
    p10, p50, p90 = float(np.percentile(cagr_sims, 10)), float(np.percentile(cagr_sims, 50)), float(np.percentile(cagr_sims, 90))
    pct_pos = float(np.mean(cagr_sims > 0))
    path_iqr = float(np.percentile(cagr_sims, 75) - np.percentile(cagr_sims, 25))

    # Histogram for chart (30 bins)
    hist, edges = np.histogram(cagr_sims * 100, bins=30)
    mc_hist = [
        {"cagr_pct": round(float((edges[i] + edges[i + 1]) / 2), 1), "count": int(hist[i])}
        for i in range(len(hist))
    ]

    # 3.4 Regime Dependence — bull vs bear via SMA-200
    sma_window = min(200, n // 2)
    sma200 = np.convolve(closes, np.ones(sma_window) / sma_window, mode='valid')
    pad = n - len(sma200)
    bull_mask = np.concatenate([np.zeros(pad, dtype=bool), closes[pad:] > sma200])
    bull_rets = daily_rets[bull_mask[1:]]
    bear_rets = daily_rets[~bull_mask[1:]]
    bull_total = float((np.prod(1 + bull_rets) - 1) * 100) if len(bull_rets) else 0.0
    bear_total = float((np.prod(1 + bear_rets) - 1) * 100) if len(bear_rets) else 0.0
    denom = abs(bull_total) + abs(bear_total) + 1
    regime_var = float(np.clip(abs(bull_total - bear_total) / denom, 0, 1))

    # 3.5 Edge Persistence — % of rolling 252d periods with positive return
    if n > 252:
        roll_1y = np.array([closes[i + 252] / closes[i] - 1 for i in range(n - 252)])
        edge_persistence = float(np.mean(roll_1y > 0) * 100)
    else:
        edge_persistence = float(np.mean(daily_rets > 0) * 100)

    # 3.6 Fragility Score
    fragility = (
        worst_dep * 0.20
        + min(1.0, path_iqr * 2) * 0.20
        + regime_var * 0.20
        + dd_recovery_dep * 0.15
        + (1 - pct_pos) * 0.25
    ) * 100
    frag_label = "Robust" if fragility < 30 else ("Moderate Risk" if fragility < 60 else "Fragile")

    return FragilityResult(
        fragility_score=round(fragility, 1),
        fragility_label=frag_label,
        worst_period_dependence=round(worst_dep * 100, 1),
        dd_recovery_dependence=round(dd_recovery_dep * 100, 1),
        monte_carlo_p10_cagr=round(p10 * 100, 1),
        monte_carlo_p50_cagr=round(p50 * 100, 1),
        monte_carlo_p90_cagr=round(p90 * 100, 1),
        pct_shuffles_positive=round(pct_pos * 100, 1),
        path_iqr=round(path_iqr * 100, 1),
        edge_persistence=round(edge_persistence, 1),
        bull_regime_return=round(bull_total, 1),
        bear_regime_return=round(bear_total, 1),
        regime_dependence_score=round(regime_var * 100, 1),
        mc_histogram=mc_hist,
    )


# ── Verdict ───────────────────────────────────────────────────────────────────

def _verdict(ls: LuckSkillResult, c: ConcentrationResult, f: FragilityResult, cagr: float) -> tuple[str, str]:
    believability = "Highly Believable" if ls.luck_score < 30 and c.rcr < 30 else (
        "Moderately Believable" if ls.luck_score < 60 and c.rcr < 50 else "Luck-Driven"
    )
    verdict = f"This stock's {cagr:.1f}% CAGR is {believability}."

    risks = []
    if c.rcr > 50:
        risks.append(f"Return heavily concentrated — {c.rcr:.0f}% came from top 10 days")
    if f.fragility_score > 60:
        risks.append(f"High path sensitivity — shuffled returns span {f.path_iqr:.0f}% CAGR IQR")
    if ls.luck_score > 60:
        risks.append(f"High start-date sensitivity — outcomes vary widely by entry timing")
    if f.bear_regime_return < -30:
        risks.append(f"Extreme regime dependence — bear return was {f.bear_regime_return:.0f}%")
    key_risk = risks[0] if risks else "No dominant fragility factor identified."

    return verdict, key_risk


# ── Public API ─────────────────────────────────────────────────────────────────

def get_report(symbol: str) -> RandomnessReport:
    cache_key = f"{symbol}:{_date.today()}"
    if cache_key in _cache:
        return _cache[cache_key]

    log.info("randomness_service: computing %s", symbol)
    closes, dates = _fetch(symbol)

    if len(closes) < 252:
        raise ValueError(f"{symbol} has < 252 bars — need at least 1 year of data")

    years = len(closes) / 252
    total_return = float(closes[-1] / closes[0] - 1)
    cagr = ((1 + total_return) ** (1 / years) - 1) * 100

    ls = _luck_skill(closes, dates)
    c = _concentration(closes, dates)
    f = _fragility(closes, dates)
    verdict, key_risk = _verdict(ls, c, f, cagr)

    report = RandomnessReport(
        symbol=symbol,
        period_start=dates[0],
        period_end=dates[-1],
        years=round(years, 1),
        cagr=round(cagr, 1),
        luck_skill=ls,
        concentration=c,
        fragility=f,
        verdict=verdict,
        key_risk=key_risk,
        computed_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    _cache[cache_key] = report
    return report


def invalidate(symbol: str) -> None:
    key = f"{symbol}:{_date.today()}"
    _cache.pop(key, None)
