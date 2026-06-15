"""Pattern DNA Validation — Steps 2, 3, 4.

Methodology
───────────
Step 2  Out-of-Sample (OOS) split
        Split each stock's history at a 3yr / 2yr boundary.
        Compute IS DNA on the first 3 years.
        Run the same scanners on the OOS 2 years and compare success rates.
        Pass criterion: OOS success rate degrades < 20% relative to IS.

Step 3  Decile (quintile) analysis — Bull Flag & Bear Flag
        Rank stocks by their IS DNA score into 5 groups.
        Compute average OOS forward returns per group.
        Pass criterion: Q1 (best DNA) return > Q5 (worst DNA) by ≥2%, monotonic order.

Step 4  Confidence calibration
        For each historical detection, record how many volume conditions were met.
        Group into No-vol / Partial / Full and compute success rates per group.
        Pass criterion: success rate is monotonically increasing with volume confirmation,
        and the spread between Full and No-vol groups is ≥5 percentage points.

Result caching
        The full validation can take 60–180 seconds.
        Results are cached in memory after the first run.
        Call invalidate_cache() to force a re-run.
"""
import logging
import numpy as np
from datetime import datetime

from app.services.duckdb_client import get_connection
from app.services.pattern_service import (
    _fetch_data, _get_symbols, _load_all_data, _local_mins, _local_maxs,
    _vol_around, _vol_ratio, _slope_pct,
    _scan_double_bottom, _scan_double_top,
    _scan_bull_flag, _scan_bear_flag,
    BEARISH_PATTERNS,
)
from app.services.stock_metrics import get_universe as _get_universe
from app.models.validation import (
    OOSSplitResult, DecileRow, DecileResult,
    ConfBin, CalibrationResult,
    ValidationSummary, ValidationReport,
)

log = logging.getLogger(__name__)

# ─── Constants ─────────────────────────────────────────────────────────────────

IS_BARS       = 756   # in-sample period  (~3 trading years at 252/yr)
OOS_BARS      = 504   # out-of-sample     (~2 trading years)
MIN_HISTORY   = IS_BARS + OOS_BARS + 64  # 64 extra for final forward-return window
MIN_OCC       = 6     # minimum occurrences to compute IS DNA in decile analysis
                       # (lower than the production threshold of 12 — IS period is shorter)
N_QUINTILES   = 5
PRIMARY       = ["Double Bottom", "Double Top", "Bull Flag", "Bear Flag"]
DECILE_PATTERNS = ["Bull Flag", "Bear Flag"]

_cache: ValidationReport | None = None


def invalidate_cache() -> None:
    global _cache
    _cache = None


# ─── OOS scanner wrappers ─────────────────────────────────────────────────────
# These accept a slice of the full arrays, so the scanner naturally stays
# within the IS or OOS window.

def _oos_scan(pattern: str, closes, highs, lows, vols) -> list[tuple]:
    if pattern == "Double Bottom":
        return _scan_double_bottom(closes, lows, vols)
    if pattern == "Double Top":
        return _scan_double_top(closes, highs, vols)
    if pattern == "Bull Flag":
        return _scan_bull_flag(closes, vols)
    if pattern == "Bear Flag":
        return _scan_bear_flag(closes, vols)
    return []


def _success_rate(samples: list[tuple], pattern: str) -> float:
    valid = [s[0] for s in samples if not np.isnan(s[0])]
    if not valid:
        return float("nan")
    is_bearish = pattern in BEARISH_PATTERNS
    return float(np.mean([f < 0 for f in valid]) * 100) if is_bearish \
        else float(np.mean([f > 0 for f in valid]) * 100)


def _avg_ret(samples: list[tuple]) -> float:
    valid = [s[0] for s in samples if not np.isnan(s[0])]
    return float(np.mean(valid)) if valid else float("nan")


# ─── Calibration scanners ──────────────────────────────────────────────────────
# Each returns (vol_score, fwd_21d) for every price-valid occurrence,
# regardless of whether volume conditions passed.
# This lets us ask: "does volume confirmation correlate with outcome?"

def _cal_double_bottom(closes: np.ndarray, lows: np.ndarray, vols: np.ndarray) -> list[tuple[int, float]]:
    n = len(closes)
    out: list[tuple[int, float]] = []
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
            current = float(p[-1])
            if (neckline - current) / (neckline + 1e-10) > 0.08:
                continue
            v1 = _vol_around(v, m1i)
            v2 = _vol_around(v, m2i)
            vc1 = (v1 > 1) and (v2 <= v1 * 1.15)
            vc2 = _vol_ratio(v, m2i + 1, wl, 20) > 0.85 if m2i + 1 < wl - 1 else False
            vol_score = int(vc1) + int(vc2)
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            if not np.isnan(f21):
                out.append((vol_score, f21))
            break
    return out


def _cal_double_top(closes: np.ndarray, highs: np.ndarray, vols: np.ndarray) -> list[tuple[int, float]]:
    n = len(closes)
    out: list[tuple[int, float]] = []
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
            current = float(p[-1])
            if (current - neckline) / (neckline + 1e-10) > 0.08:
                continue
            v1 = _vol_around(v, m1i)
            v2 = _vol_around(v, m2i)
            vc1 = (v1 > 1) and (v2 <= v1 * 1.15)
            vc2 = _vol_ratio(v, m2i + 1, wl, 20) > 0.85 if m2i + 1 < wl - 1 else False
            vol_score = int(vc1) + int(vc2)
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            if not np.isnan(f21):
                out.append((vol_score, f21))
            break
    return out


def _cal_bull_flag(closes: np.ndarray, vols: np.ndarray) -> list[tuple[int, float]]:
    n = len(closes)
    out: list[tuple[int, float]] = []
    for end in range(30, n - 21, 5):
        for pole_w, cons_w in ((15, 8), (20, 10), (25, 12)):
            if end < pole_w + cons_w:
                continue
            pole_ret = (closes[end - cons_w] / closes[end - pole_w - cons_w] - 1) * 100
            if pole_ret < 12.0:
                continue
            flag = closes[end - cons_w:end]
            if (flag.max() - flag.min()) / (flag.min() + 1e-10) * 100 > pole_ret * 0.40:
                continue
            if _slope_pct(flag) > 1.5:
                continue
            pole_s = end - pole_w - cons_w
            pole_e = end - cons_w
            vc1 = _vol_ratio(vols, pole_s, pole_e, 20) > 1.25
            v_pole_m = float(vols[pole_s:pole_e].mean())
            v_flag_m = float(vols[end - cons_w:end].mean())
            vc2 = v_pole_m > 1 and v_flag_m < v_pole_m
            vc3 = _slope_pct(vols[end - cons_w:end]) < 0
            vol_score = int(vc1) + int(vc2) + int(vc3)
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            if not np.isnan(f21):
                out.append((vol_score, f21))
            break
    return out


def _cal_bear_flag(closes: np.ndarray, vols: np.ndarray) -> list[tuple[int, float]]:
    n = len(closes)
    out: list[tuple[int, float]] = []
    for end in range(30, n - 21, 5):
        for pole_w, cons_w in ((15, 8), (20, 10), (25, 12)):
            if end < pole_w + cons_w:
                continue
            pole_ret = (closes[end - cons_w] / closes[end - pole_w - cons_w] - 1) * 100
            if pole_ret > -12.0:
                continue
            flag = closes[end - cons_w:end]
            if (flag.max() - flag.min()) / (flag.min() + 1e-10) * 100 > abs(pole_ret) * 0.40:
                continue
            if _slope_pct(flag) < -1.5:
                continue
            pole_s = end - pole_w - cons_w
            pole_e = end - cons_w
            vc1 = _vol_ratio(vols, pole_s, pole_e, 20) > 1.25
            v_pole_m = float(vols[pole_s:pole_e].mean())
            v_flag_m = float(vols[end - cons_w:end].mean())
            vc2 = v_pole_m > 1 and v_flag_m < v_pole_m
            vc3 = _slope_pct(vols[end - cons_w:end]) < 0
            vol_score = int(vc1) + int(vc2) + int(vc3)
            f21 = float((closes[end + 21] / closes[end] - 1) * 100) if end + 21 < n else float("nan")
            if not np.isnan(f21):
                out.append((vol_score, f21))
            break
    return out


def _cal_scan(pattern: str, closes, highs, lows, vols) -> list[tuple[int, float]]:
    if pattern == "Double Bottom":
        return _cal_double_bottom(closes, lows, vols)
    if pattern == "Double Top":
        return _cal_double_top(closes, highs, vols)
    if pattern == "Bull Flag":
        return _cal_bull_flag(closes, vols)
    if pattern == "Bear Flag":
        return _cal_bear_flag(closes, vols)
    return []


# ─── Step 2: OOS split ─────────────────────────────────────────────────────────

def _step2_oos(symbol_data: list[tuple]) -> list[OOSSplitResult]:
    results = []
    for pattern in PRIMARY:
        is_samples: list[tuple[float, float]] = []
        oos_samples: list[tuple[float, float]] = []
        n_ok = 0

        for closes, highs, lows, vols in symbol_data:
            n = len(closes)
            if n < MIN_HISTORY:
                continue
            n_ok += 1

            is_c = closes[:IS_BARS]
            is_h = highs[:IS_BARS]
            is_l = lows[:IS_BARS]
            is_v = vols[:IS_BARS]

            oos_end = IS_BARS + OOS_BARS
            oos_c = closes[IS_BARS:oos_end]
            oos_h = highs[IS_BARS:oos_end]
            oos_l = lows[IS_BARS:oos_end]
            oos_v = vols[IS_BARS:oos_end]

            try:
                is_samples.extend(_oos_scan(pattern, is_c, is_h, is_l, is_v))
            except Exception as e:
                log.debug("IS scan error %s/%s: %s", pattern, "sym", e)
            try:
                oos_samples.extend(_oos_scan(pattern, oos_c, oos_h, oos_l, oos_v))
            except Exception as e:
                log.debug("OOS scan error %s/%s: %s", pattern, "sym", e)

        is_sr  = _success_rate(is_samples, pattern)
        oos_sr = _success_rate(oos_samples, pattern)
        is_ret  = _avg_ret(is_samples)
        oos_ret = _avg_ret(oos_samples)

        if np.isnan(is_sr) or is_sr < 1e-6:
            deg = float("nan")
            passes = False
        else:
            deg = (is_sr - oos_sr) / is_sr * 100
            passes = not np.isnan(deg) and deg < 20.0

        results.append(OOSSplitResult(
            pattern=pattern,
            n_symbols=n_ok,
            is_n=len([s for s in is_samples  if not np.isnan(s[0])]),
            oos_n=len([s for s in oos_samples if not np.isnan(s[0])]),
            is_success_rate=round(is_sr, 1) if not np.isnan(is_sr) else 0.0,
            oos_success_rate=round(oos_sr, 1) if not np.isnan(oos_sr) else 0.0,
            is_avg_ret_21d=round(is_ret, 2) if not np.isnan(is_ret) else 0.0,
            oos_avg_ret_21d=round(oos_ret, 2) if not np.isnan(oos_ret) else 0.0,
            degradation_pct=round(deg, 1) if not np.isnan(deg) else 999.0,
            passes=passes,
        ))
    return results


# ─── Step 3: Decile (quintile) analysis ────────────────────────────────────────

def _dna_score_from_samples(samples: list[tuple], pattern: str) -> float | None:
    valid = [s[0] for s in samples if not np.isnan(s[0])]
    if len(valid) < MIN_OCC:
        return None
    is_bearish = pattern in BEARISH_PATTERNS
    success = float(np.mean([f < 0 for f in valid]) * 100) if is_bearish \
        else float(np.mean([f > 0 for f in valid]) * 100)
    magnitude   = min(20.0, abs(float(np.mean(valid))) * 2)
    consistency = max(0.0, 10.0 - float(np.std(valid)) * 0.5)
    return min(100.0, max(0.0, success * 0.7 + magnitude + consistency))


def _step3_decile(symbol_data: list[tuple]) -> list[DecileResult]:
    results = []
    for pattern in DECILE_PATTERNS:
        # 1. Compute IS DNA score per stock
        scored: list[tuple[float, list[tuple[float, float]]]] = []  # (is_score, oos_samples)

        for closes, highs, lows, vols in symbol_data:
            n = len(closes)
            if n < MIN_HISTORY:
                continue

            is_c = closes[:IS_BARS]
            is_h = highs[:IS_BARS]
            is_l = lows[:IS_BARS]
            is_v = vols[:IS_BARS]

            oos_end = IS_BARS + OOS_BARS
            oos_c = closes[IS_BARS:oos_end]
            oos_h = highs[IS_BARS:oos_end]
            oos_l = lows[IS_BARS:oos_end]
            oos_v = vols[IS_BARS:oos_end]

            try:
                is_samp = _oos_scan(pattern, is_c, is_h, is_l, is_v)
                is_score = _dna_score_from_samples(is_samp, pattern)
                if is_score is None:
                    continue
                oos_samp = _oos_scan(pattern, oos_c, oos_h, oos_l, oos_v)
                scored.append((is_score, oos_samp))
            except Exception as e:
                log.debug("Decile scan error %s: %s", pattern, e)

        if len(scored) < N_QUINTILES:
            continue

        # 2. Sort by IS score descending, split into quintiles
        scored.sort(key=lambda x: x[0], reverse=True)
        q_size = len(scored) // N_QUINTILES
        if q_size == 0:
            continue

        rows: list[DecileRow] = []
        is_bearish = pattern in BEARISH_PATTERNS

        for qi in range(N_QUINTILES):
            start = qi * q_size
            end_i = start + q_size if qi < N_QUINTILES - 1 else len(scored)
            group = scored[start:end_i]

            avg_is_score = float(np.mean([s for s, _ in group]))
            all_oos = [s[0] for _, samp in group for s in samp if not np.isnan(s[0])]

            if all_oos:
                oos_avg_ret = float(np.mean(all_oos))
            else:
                oos_avg_ret = float("nan")

            label = f"Q{qi + 1} ({'Best' if qi == 0 else 'Worst' if qi == N_QUINTILES - 1 else f'Q{qi+1}'} DNA)"
            rows.append(DecileRow(
                rank=label,
                n_symbols=len(group),
                avg_dna_score=round(avg_is_score, 1),
                oos_avg_ret_21d=round(oos_avg_ret, 2) if not np.isnan(oos_avg_ret) else 0.0,
                n_detections=len(all_oos),
            ))

        # 3. Check monotonicity and spread
        rets = [r.oos_avg_ret_21d for r in rows]
        if is_bearish:
            # bearish: Q1 should have most negative returns
            monotonic = all(rets[i] <= rets[i + 1] for i in range(len(rets) - 1))
            spread = rets[-1] - rets[0]   # Q5 - Q1 (positive = Q1 more negative)
        else:
            monotonic = all(rets[i] >= rets[i + 1] for i in range(len(rets) - 1))
            spread = rets[0] - rets[-1]   # Q1 - Q5 (positive = Q1 outperforms)

        passes = monotonic and spread > 2.0

        results.append(DecileResult(
            pattern=pattern,
            rows=rows,
            spread_pct=round(spread, 2),
            monotonic=monotonic,
            passes=passes,
        ))
    return results


# ─── Step 4: Confidence calibration ───────────────────────────────────────────

def _step4_calibration(symbol_data: list[tuple]) -> list[CalibrationResult]:
    results = []
    for pattern in PRIMARY:
        all_cal: list[tuple[int, float]] = []

        for closes, highs, lows, vols in symbol_data:
            try:
                all_cal.extend(_cal_scan(pattern, closes, highs, lows, vols))
            except Exception as e:
                log.debug("Calibration scan error %s: %s", pattern, e)

        if not all_cal:
            continue

        is_flag = pattern in ("Bull Flag", "Bear Flag")
        is_bearish = pattern in BEARISH_PATTERNS

        # For flags: vol_score 0–3; group into "None (0)" / "Partial (1)" / "Full (2–3)"
        # For reversals: vol_score 0–2; "None (0)" / "Partial (1)" / "Full (2)"
        def _bin_label(score: int) -> str:
            if score == 0:
                return "None (0 vol)"
            if score == 1:
                return "Partial (1 vol)"
            return "Full (2+ vol)"

        groups: dict[str, list[float]] = {"None (0 vol)": [], "Partial (1 vol)": [], "Full (2+ vol)": []}
        for vol_score, f21 in all_cal:
            groups[_bin_label(vol_score)].append(f21)

        bins: list[ConfBin] = []
        for label in ["None (0 vol)", "Partial (1 vol)", "Full (2+ vol)"]:
            vals = groups[label]
            if not vals:
                bins.append(ConfBin(label=label, n=0, success_rate=0.0, avg_ret_21d=0.0))
                continue
            sr = float(np.mean([v < 0 for v in vals]) * 100) if is_bearish \
                else float(np.mean([v > 0 for v in vals]) * 100)
            bins.append(ConfBin(
                label=label,
                n=len(vals),
                success_rate=round(sr, 1),
                avg_ret_21d=round(float(np.mean(vals)), 2),
            ))

        srs = [b.success_rate for b in bins if b.n > 0]
        monotonic = len(srs) >= 2 and all(srs[i] <= srs[i + 1] for i in range(len(srs) - 1))
        spread = (srs[-1] - srs[0]) if len(srs) >= 2 else 0.0
        passes = monotonic and spread >= 5.0

        results.append(CalibrationResult(
            pattern=pattern,
            bins=bins,
            monotonic=monotonic,
            passes=passes,
        ))
    return results


# ─── Summary ──────────────────────────────────────────────────────────────────

def _make_summary(
    pattern: str,
    oos: list[OOSSplitResult],
    decile: list[DecileResult],
    cal: list[CalibrationResult],
) -> ValidationSummary:
    oos_r   = next((r for r in oos   if r.pattern == pattern), None)
    dec_r   = next((r for r in decile if r.pattern == pattern), None)
    cal_r   = next((r for r in cal   if r.pattern == pattern), None)

    s2 = oos_r.passes   if oos_r   else None
    s3 = dec_r.passes   if dec_r   else None
    s4 = cal_r.passes   if cal_r   else None

    votes  = [v for v in [s2, s3, s4] if v is not None]
    n_pass = sum(votes)

    if not votes:
        verdict = "INSUFFICIENT_DATA"
    elif n_pass == len(votes):
        verdict = "VALIDATED"
    elif n_pass >= 1:
        verdict = "PARTIAL"
    else:
        verdict = "UNVALIDATED"

    return ValidationSummary(
        pattern=pattern,
        step2_oos=s2,
        step3_decile=s3,
        step4_calibration=s4,
        verdict=verdict,
    )


# ─── Public entry point ────────────────────────────────────────────────────────

def run_full_validation() -> ValidationReport:
    """
    Run the full validation suite and cache the result.
    Expected runtime: 60–180 seconds on 48 NIFTY symbols.
    """
    global _cache
    if _cache is not None:
        return _cache

    log.info("Starting Pattern DNA validation run…")
    all_data = _load_all_data('daily')
    # Sort by data length descending so we get the most established stocks first,
    # then cap at 150 — pattern scanning is O(n×bars²) and validation is already 60-180s
    ranked = sorted(all_data.items(), key=lambda kv: len(kv[1][0]), reverse=True)[:150]
    symbol_data: list[tuple] = [(c, h, lo, v) for _, (c, h, lo, v, _) in ranked]

    sufficient = [(c, h, l, v) for c, h, l, v in symbol_data if len(c) >= MIN_HISTORY]
    log.info("Validation: %d symbols (capped at 150), %d with ≥5yr history", len(symbol_data), len(sufficient))

    oos     = _step2_oos(sufficient)
    decile  = _step3_decile(sufficient)
    cal     = _step4_calibration(sufficient)
    summary = [_make_summary(p, oos, decile, cal) for p in PRIMARY]

    _cache = ValidationReport(
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        is_bars=IS_BARS,
        oos_bars=OOS_BARS,
        min_occurrences=12,
        n_symbols_total=len(symbol_data),
        n_symbols_sufficient=len(sufficient),
        oos_results=oos,
        decile_results=decile,
        calibration_results=cal,
        summary=summary,
    )
    log.info("Validation complete.")
    return _cache
