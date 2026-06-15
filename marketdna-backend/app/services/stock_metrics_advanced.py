"""Advanced ML and statistical algorithm implementations.

All heavy computation is done in Python/numpy/scipy after a DuckDB pull.
DuckDB is only used for data retrieval and simple windowed features.
"""
import functools
import logging
from datetime import date as _date
from typing import Any

import numpy as np
from scipy import optimize
from app.services.duckdb_client import get_connection

# Day-level in-process cache — same pattern as stock_metrics.py
_cache: dict[tuple, Any] = {}


def _day_cached(fn: Any) -> Any:
    """Cache by (today, *args); evict yesterday's entries on each miss."""
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        today = str(_date.today())
        key = (fn.__name__, today) + args
        if key in _cache:
            return _cache[key]
        stale = [k for k in list(_cache) if k[1] != today]
        for k in stale:
            del _cache[k]
        result = fn(*args, **kwargs)
        _cache[key] = result
        return result
    return wrapper
from app.models.stock_advanced import (
    ZScorePoint, ZScoreZoneStats, ZScoreResponse,
    DualMomentumHistPoint, DualMomentumSignalPerf, DualMomentumResponse,
    ZScoreData, HurstData, DualMomentumData, CVaRData,
    StatisticalSignalsResponse,
    RVPoint, RealizedVolData, GARCHPoint, GARCHData,
    BetaPoint, RollingBetaData, QuantileRegressionData,
    VolatilityLabResponse,
    KMeansData, GMMData, HMMPoint, HMMData,
    RegimeClustersResponse,
    KNNData, DTWPattern, PatternMatchResponse,
    LeadLagPair, MarketDynamicsResponse,
)

log = logging.getLogger(__name__)


# ── Data helpers ─────────────────────────────────────────────────────────────

def _fetch_ohlcv(symbol: str, limit: int = 2000) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Returns (closes, highs, lows, dates)."""
    con = get_connection()
    rows = con.execute(f"""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close, high, low
        FROM equities_prices
        WHERE symbol = '{symbol}'
        ORDER BY date
        LIMIT {limit}
    """).fetchall()
    dates = [r[0] for r in rows]
    closes = np.array([r[1] for r in rows], dtype=float)
    highs  = np.array([r[2] for r in rows], dtype=float)
    lows   = np.array([r[3] for r in rows], dtype=float)
    return closes, highs, lows, dates


def _fetch_all_returns(exclude_symbol: str | None = None, limit: int = 500) -> dict[str, np.ndarray]:
    """Returns {symbol: array_of_daily_log_returns} for all symbols.

    The per-symbol row limit is applied in SQL via ROW_NUMBER to avoid pulling
    the full history (potentially millions of rows) and slicing in Python.
    """
    today = str(_date.today())
    cache_key = ('_fetch_all_returns', today, exclude_symbol, limit)
    if cache_key in _cache:
        return _cache[cache_key]

    exclude_clause = f"WHERE symbol != '{exclude_symbol}'" if exclude_symbol else ""
    con = get_connection()
    rows = con.execute(f"""
        WITH ranked AS (
            SELECT symbol, close,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM equities_prices
            {exclude_clause}
        )
        SELECT symbol, close
        FROM ranked
        WHERE rn <= {limit}
        ORDER BY symbol, rn DESC
    """).fetchall()

    from collections import defaultdict
    raw: dict[str, list] = defaultdict(list)
    for sym, close in rows:
        raw[sym].append(close)

    result = {}
    for sym, prices in raw.items():
        arr = np.array(prices, dtype=float)
        if len(arr) < 60:
            continue
        rets = np.diff(np.log(arr + 1e-10))
        result[sym] = rets

    stale = [k for k in list(_cache) if k[1] != today]
    for k in stale:
        del _cache[k]
    _cache[cache_key] = result
    return result


def _daily_returns(closes: np.ndarray) -> np.ndarray:
    return np.diff(np.log(closes + 1e-10))


def _minmax(x: np.ndarray) -> np.ndarray:
    lo, hi = x.min(), x.max()
    return np.zeros_like(x) if hi == lo else (x - lo) / (hi - lo)


# ── Hurst exponent ────────────────────────────────────────────────────────────

def _hurst(ts: np.ndarray) -> float:
    """Rescaled Range (R/S) Hurst exponent estimate."""
    ts = np.log(ts + 1e-10)
    lags = [8, 16, 32, 64, 128]
    rs_vals = []
    for n in lags:
        if len(ts) < n * 2:
            continue
        chunks = [ts[i:i + n] for i in range(0, len(ts) - n, n)]
        rs_chunk = []
        for c in chunks:
            if len(c) < n:
                continue
            mean_adj = c - c.mean()
            cum = np.cumsum(mean_adj)
            R = cum.max() - cum.min()
            S = c.std(ddof=1)
            if S > 0:
                rs_chunk.append(R / S)
        if rs_chunk:
            rs_vals.append(np.mean(rs_chunk))

    if len(rs_vals) < 3:
        return 0.5  # default to random walk if insufficient data

    valid_lags = [lags[i] for i in range(len(lags)) if i < len(rs_vals)][:len(rs_vals)]
    poly = np.polyfit(np.log(valid_lags), np.log(np.array(rs_vals) + 1e-10), 1)
    return float(np.clip(poly[0], 0.0, 1.0))


# ── GARCH(1,1) with numerical MLE ────────────────────────────────────────────

def _garch_fit(returns: np.ndarray) -> tuple[float, float, float, float]:
    """Fit GARCH(1,1) via MLE. Returns (omega, alpha, beta, last_sigma2)."""
    r = returns - returns.mean()
    var0 = r.var()

    def neg_loglik(params):
        omega, alpha, beta = params
        if omega <= 0 or alpha < 0 or beta < 0 or alpha + beta >= 0.9999:
            return 1e10
        n = len(r)
        sigma2 = np.empty(n)
        sigma2[0] = var0
        for t in range(1, n):
            sigma2[t] = omega + alpha * r[t - 1] ** 2 + beta * sigma2[t - 1]
        if np.any(sigma2 <= 0):
            return 1e10
        return 0.5 * (np.log(sigma2) + r ** 2 / sigma2).sum()

    result = optimize.minimize(
        neg_loglik,
        x0=[var0 * 0.05, 0.1, 0.85],
        method='Nelder-Mead',
        options={'maxiter': 2000, 'xatol': 1e-6, 'fatol': 1e-6},
    )
    omega, alpha, beta = result.x
    # Compute last sigma2 for forecast
    r_last = r[-1]
    # rebuild last sigma quickly
    sigma2 = var0
    for ri in r:
        sigma2 = omega + alpha * ri ** 2 + beta * sigma2
    return float(omega), float(alpha), float(beta), float(sigma2)


def _garch_series(returns: np.ndarray, omega: float, alpha: float, beta: float) -> np.ndarray:
    """Filtered conditional variance series from fitted params."""
    r = returns - returns.mean()
    sigma2 = np.empty(len(r))
    sigma2[0] = r.var()
    for t in range(1, len(r)):
        sigma2[t] = omega + alpha * r[t - 1] ** 2 + beta * sigma2[t - 1]
    return np.sqrt(np.maximum(sigma2, 1e-12)) * np.sqrt(252)  # annualised %


# ── Quantile regression (pinball loss) ───────────────────────────────────────

def _fit_quantile(X: np.ndarray, y: np.ndarray, q: float) -> np.ndarray:
    def loss(params: np.ndarray) -> float:
        resid = y - X @ params
        return float(np.where(resid >= 0, q * resid, (q - 1) * resid).sum())

    res = optimize.minimize(
        loss,
        x0=np.zeros(X.shape[1]),
        method='Nelder-Mead',
        options={'maxiter': 5000, 'xatol': 1e-5, 'fatol': 1e-5},
    )
    return res.x


# ── DTW ───────────────────────────────────────────────────────────────────────

def _dtw_distance(s1: np.ndarray, s2: np.ndarray) -> float:
    n, m = len(s1), len(s2)
    cost = np.abs(s1[:, None] - s2[None, :])
    dtw = np.full((n, m), np.inf)
    dtw[0, 0] = cost[0, 0]
    for i in range(1, n):
        dtw[i, 0] = dtw[i - 1, 0] + cost[i, 0]
    for j in range(1, m):
        dtw[0, j] = dtw[0, j - 1] + cost[0, j]
    for i in range(1, n):
        for j in range(1, m):
            dtw[i, j] = cost[i, j] + min(dtw[i - 1, j], dtw[i, j - 1], dtw[i - 1, j - 1])
    return float(dtw[n - 1, m - 1])


# ── K-Means (pure numpy, Lloyd's algorithm) ───────────────────────────────────

def _kmeans(X: np.ndarray, k: int = 4, max_iter: int = 300, seed: int = 42) -> np.ndarray:
    """Returns cluster assignment for each row."""
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(X), k, replace=False)
    centers = X[idx].copy()
    labels = np.zeros(len(X), dtype=int)
    for _ in range(max_iter):
        dists = np.linalg.norm(X[:, None, :] - centers[None, :, :], axis=2)
        new_labels = dists.argmin(axis=1)
        if np.all(new_labels == labels):
            break
        labels = new_labels
        for j in range(k):
            members = X[labels == j]
            if len(members):
                centers[j] = members.mean(axis=0)
    return labels, centers


# ═══════════════════════════════════════════════════════════════════════════════
# Public functions
# ═══════════════════════════════════════════════════════════════════════════════

@_day_cached
def get_statistical_signals(symbol: str) -> StatisticalSignalsResponse:
    closes, _, _, dates = _fetch_ohlcv(symbol)
    n = len(closes)
    returns_1d = _daily_returns(closes)

    # ── Z-Score (252-day rolling) ────────────────────────────────────────────
    window = 252
    zscore_series: list[ZScorePoint] = []
    for i in range(window, n):
        seg = closes[i - window:i]
        z = (closes[i] - seg.mean()) / (seg.std(ddof=1) + 1e-10)
        zscore_series.append(ZScorePoint(date=dates[i], zscore=round(float(z), 3)))

    current_z = zscore_series[-1].zscore if zscore_series else 0.0
    if current_z > 2.5:
        z_interp = "Significantly Overbought"
    elif current_z > 1.5:
        z_interp = "Overbought"
    elif current_z < -2.5:
        z_interp = "Significantly Oversold"
    elif current_z < -1.5:
        z_interp = "Oversold"
    else:
        z_interp = "Neutral"

    # ── Hurst Exponent ───────────────────────────────────────────────────────
    hurst_val = _hurst(closes)
    if hurst_val > 0.55:
        h_regime, h_interp = "Trending", "Price movements exhibit persistence — trends are more likely to continue than reverse"
    elif hurst_val < 0.45:
        h_regime, h_interp = "Mean-Reverting", "Price movements exhibit anti-persistence — large moves tend to be followed by reversals"
    else:
        h_regime, h_interp = "Random Walk", "Price movements have no detectable memory — neither trending nor mean-reverting strategies have statistical edge"

    # ── Dual Momentum ────────────────────────────────────────────────────────
    if n >= 252:
        abs_mom = float((closes[-1] / closes[-252] - 1) * 100)
    elif n >= 63:
        abs_mom = float((closes[-1] / closes[-63] - 1) * 100)
    else:
        abs_mom = 0.0

    # Index proxy: equal-weight of all symbols' 12M return
    try:
        all_rets = _fetch_all_returns(exclude_symbol=symbol, limit=260)
        index_12m_rets = []
        for sym_rets in all_rets.values():
            if len(sym_rets) >= 251:
                index_12m_rets.append(float((np.exp(sym_rets[-251:].sum()) - 1) * 100))
        index_12m = float(np.mean(index_12m_rets)) if index_12m_rets else 0.0
    except Exception:
        index_12m = 0.0

    rel_mom = abs_mom - index_12m

    if abs_mom > 0 and rel_mom > 0:
        dm_signal = "Strong Buy"
        dm_rationale = f"Both absolute (+{abs_mom:.1f}%) and relative (+{rel_mom:.1f}% vs index) momentum are positive"
    elif abs_mom > 0:
        dm_signal = "Buy"
        dm_rationale = f"Absolute momentum is positive (+{abs_mom:.1f}%) but stock is underperforming the index by {-rel_mom:.1f}%"
    elif rel_mom > 0:
        dm_signal = "Neutral"
        dm_rationale = f"Stock is outperforming the index but 12M absolute return is negative ({abs_mom:.1f}%)"
    else:
        dm_signal = "Avoid"
        dm_rationale = f"Both absolute ({abs_mom:.1f}%) and relative ({rel_mom:.1f}%) momentum are negative"

    # ── CVaR ─────────────────────────────────────────────────────────────────
    rolling_21d = []
    for i in range(21, n):
        ret_21d = float((closes[i] / closes[i - 21] - 1) * 100)
        rolling_21d.append(ret_21d)
    rolling_21d = np.array(rolling_21d)

    var_95 = float(np.percentile(rolling_21d, 5)) if len(rolling_21d) > 20 else 0.0
    tail = rolling_21d[rolling_21d <= var_95]
    cvar_95 = float(tail.mean()) if len(tail) > 0 else var_95
    daily_vol = float(returns_1d.std(ddof=1) * np.sqrt(252) * 100)

    if cvar_95 < -20:
        cvar_interp = "Severe tail risk — historically, worst 5% of periods saw average losses exceeding 20%"
    elif cvar_95 < -10:
        cvar_interp = "Elevated tail risk"
    else:
        cvar_interp = "Moderate tail risk"

    return StatisticalSignalsResponse(
        symbol=symbol,
        zscore=ZScoreData(current_zscore=round(current_z, 3), interpretation=z_interp),
        zscore_series=zscore_series[-252:],
        hurst=HurstData(hurst_exponent=round(hurst_val, 4), regime=h_regime, interpretation=h_interp),
        dual_momentum=DualMomentumData(
            abs_momentum_12m=round(abs_mom, 2),
            rel_momentum_vs_index=round(rel_mom, 2),
            signal=dm_signal,
            rationale=dm_rationale,
        ),
        cvar=CVaRData(
            var_95=round(var_95, 2),
            cvar_95=round(cvar_95, 2),
            daily_vol=round(daily_vol, 2),
            interpretation=cvar_interp,
        ),
    )


@_day_cached
def get_volatility_lab(symbol: str) -> VolatilityLabResponse:
    closes, highs, lows, dates = _fetch_ohlcv(symbol)
    n = len(closes)
    returns_1d = _daily_returns(closes)

    # ── Realized Volatility ──────────────────────────────────────────────────
    rv_series: list[RVPoint] = []
    for i in range(21, n):
        seg = returns_1d[i - 21:i]
        rv = float(seg.std(ddof=1) * np.sqrt(252) * 100)
        rv_series.append(RVPoint(date=dates[i], rv=round(rv, 3)))

    current_rv = rv_series[-1].rv if rv_series else 0.0
    rv_vals = np.array([p.rv for p in rv_series])
    rv_pct = float(np.sum(rv_vals < current_rv) / len(rv_vals) * 100) if len(rv_vals) else 50.0

    if rv_pct > 80:
        rv_interp = "Elevated — volatility is in the top 20% of its historical range"
    elif rv_pct < 20:
        rv_interp = "Compressed — volatility is historically low, often preceding breakout moves"
    else:
        rv_interp = "Normal"

    # ── GARCH(1,1) ──────────────────────────────────────────────────────────
    garch_series: list[GARCHPoint] = []
    try:
        r_pct = returns_1d * 100
        omega, alpha, beta, last_sigma2 = _garch_fit(r_pct)
        cond_vols = _garch_series(r_pct, omega, alpha, beta)
        for i, v in enumerate(cond_vols):
            if i + 1 < len(dates):
                garch_series.append(GARCHPoint(date=dates[i + 1], conditional_vol=round(float(v), 3)))

        current_garch = float(garch_series[-1].conditional_vol) if garch_series else current_rv
        forecast_1d = float(np.sqrt(omega + alpha * (r_pct[-1] ** 2) + beta * last_sigma2) * np.sqrt(252))

        # Trend: compare last 10 days vs prior 10 days
        if len(garch_series) >= 20:
            recent = np.mean([p.conditional_vol for p in garch_series[-10:]])
            prior  = np.mean([p.conditional_vol for p in garch_series[-20:-10]])
            vol_regime = "Expanding" if recent > prior * 1.1 else ("Contracting" if recent < prior * 0.9 else "Stable")
        else:
            vol_regime = "Stable"

    except Exception as exc:
        log.warning("GARCH fit failed: %s", exc)
        current_garch = current_rv
        forecast_1d = current_rv
        vol_regime = "Stable"

    # ── Rolling Beta ─────────────────────────────────────────────────────────
    beta_series: list[BetaPoint] = []
    try:
        all_syms = _fetch_all_returns(limit=n + 10)
        # Equal-weight index returns (align by min length)
        all_arrs = list(all_syms.values())
        min_len = min(len(a) for a in all_arrs)
        aligned = np.stack([a[-min_len:] for a in all_arrs], axis=0)
        index_rets = aligned.mean(axis=0)

        stock_rets = returns_1d[-min_len:]
        beta_window = 63
        betas_all: list[float] = []
        for i in range(beta_window, min_len):
            sr = stock_rets[i - beta_window:i]
            ir = index_rets[i - beta_window:i]
            cov = float(np.cov(sr, ir, ddof=1)[0, 1])
            var_i = float(np.var(ir, ddof=1))
            betas_all.append(cov / var_i if var_i > 1e-12 else 1.0)

        for i, b in enumerate(betas_all):
            idx_offset = min_len - len(betas_all) + i
            date_idx = n - min_len + idx_offset
            if 0 <= date_idx < len(dates):
                beta_series.append(BetaPoint(date=dates[date_idx], beta=round(float(b), 4)))

        current_beta = betas_all[-1] if betas_all else 1.0
        if len(betas_all) >= 21:
            recent_b = np.mean(betas_all[-10:])
            prior_b  = np.mean(betas_all[-21:-10])
            beta_trend = "Rising" if recent_b > prior_b + 0.1 else ("Falling" if recent_b < prior_b - 0.1 else "Stable")
        else:
            beta_trend = "Stable"

        if current_beta > 1.3:
            beta_interp = f"Aggressive — stock amplifies market moves (beta {current_beta:.2f})"
        elif current_beta < 0.7:
            beta_interp = f"Defensive — stock dampens market moves (beta {current_beta:.2f})"
        else:
            beta_interp = f"Market-like — moves broadly in line with the index (beta {current_beta:.2f})"

    except Exception as exc:
        log.warning("Beta calc failed: %s", exc)
        current_beta = 1.0
        beta_trend = "Stable"
        beta_interp = "Unable to compute (insufficient cross-symbol data)"

    # ── Quantile Regression ──────────────────────────────────────────────────
    qr_data = QuantileRegressionData(q10_expected_return=0.0, q50_expected_return=0.0,
                                      q90_expected_return=0.0, tail_asymmetry="Symmetric")
    try:
        if n >= 100:
            # Features: bias, ret_1m%, ret_3m%, drawdown%
            feat_dates: list[tuple[float, float, float, float, float]] = []
            peaks = np.maximum.accumulate(closes)
            for i in range(63, n - 21):
                ret_1m = float((closes[i] / closes[i - 21] - 1) * 100)
                ret_3m = float((closes[i] / closes[i - 63] - 1) * 100)
                dd     = float((closes[i] / peaks[i] - 1) * 100)
                fwd_21 = float((closes[i + 21] / closes[i] - 1) * 100)
                feat_dates.append((1.0, ret_1m, ret_3m, dd, fwd_21))

            if len(feat_dates) >= 40:
                arr = np.array(feat_dates)
                X_qr = arr[:, :4]
                y_qr = arr[:, 4]

                # Today's features
                ret_1m_now = float((closes[-1] / closes[-22] - 1) * 100) if n >= 22 else 0.0
                ret_3m_now = float((closes[-1] / closes[-64] - 1) * 100) if n >= 64 else 0.0
                dd_now     = float((closes[-1] / np.max(closes) - 1) * 100)
                x_today    = np.array([1.0, ret_1m_now, ret_3m_now, dd_now])

                q10_params = _fit_quantile(X_qr, y_qr, 0.10)
                q50_params = _fit_quantile(X_qr, y_qr, 0.50)
                q90_params = _fit_quantile(X_qr, y_qr, 0.90)

                q10 = float(x_today @ q10_params)
                q50 = float(x_today @ q50_params)
                q90 = float(x_today @ q90_params)

                upside = q90 - q50
                downside = q50 - q10
                if upside > downside * 1.3:
                    asymmetry = "Positive skew — upside scenarios outweigh downside"
                elif downside > upside * 1.3:
                    asymmetry = "Negative skew — downside scenarios outweigh upside"
                else:
                    asymmetry = "Symmetric distribution"

                qr_data = QuantileRegressionData(
                    q10_expected_return=round(q10, 2),
                    q50_expected_return=round(q50, 2),
                    q90_expected_return=round(q90, 2),
                    tail_asymmetry=asymmetry,
                )
    except Exception as exc:
        log.warning("Quantile regression failed: %s", exc)

    return VolatilityLabResponse(
        symbol=symbol,
        realized_vol=RealizedVolData(
            current_rv=round(current_rv, 2),
            rv_percentile=round(rv_pct, 1),
            interpretation=rv_interp,
        ),
        rv_series=rv_series[-252:],
        garch=GARCHData(
            current_conditional_vol=round(current_garch, 2),
            one_day_forecast=round(forecast_1d, 2),
            vol_regime=vol_regime,
        ),
        garch_series=garch_series[-252:],
        rolling_beta=RollingBetaData(
            current_beta=round(current_beta, 3),
            beta_trend=beta_trend,
            interpretation=beta_interp,
        ),
        beta_series=beta_series[-252:],
        quantile_regression=qr_data,
    )


@_day_cached
def get_regime_clusters(symbol: str) -> RegimeClustersResponse:
    closes, _, _, dates = _fetch_ohlcv(symbol)
    n = len(closes)

    # Build feature matrix: (ret_1m%, ret_3m%, drawdown%, atr_pct%)
    peaks = np.maximum.accumulate(closes)
    tr_list = []
    for i in range(1, n):
        tr = max(
            closes[i] - closes[i-1],
            abs(closes[i] - closes[i-1]),
        )
        tr_list.append(tr)
    tr_arr = np.array(tr_list + [tr_list[-1]])
    atr14 = np.array([tr_arr[max(0, i-14):i].mean() for i in range(1, n+1)])

    rows: list[tuple] = []
    for i in range(63, n):
        ret_1m = float((closes[i] / closes[i - 21] - 1) * 100)
        ret_3m = float((closes[i] / closes[i - 63] - 1) * 100)
        dd     = float((closes[i] / peaks[i] - 1) * 100)
        atr_p  = float(atr14[i] / closes[i] * 100)
        fwd_21 = float((closes[i + 21] / closes[i] - 1) * 100) if i + 21 < n else float('nan')
        rows.append((ret_1m, ret_3m, dd, atr_p, fwd_21))

    if len(rows) < 40:
        # Fallback empty response
        return RegimeClustersResponse(
            symbol=symbol,
            kmeans=KMeansData(current_cluster=0, cluster_label="Insufficient data",
                              cluster_description="", n_clusters=4, avg_fwd_return=0.0),
            gmm=GMMData(current_state=0, state_labels=["N/A"], state_probabilities=[1.0]),
            hmm=HMMData(current_state=0, state_label="N/A", state_probability=1.0,
                        state_labels=["N/A"], history=[]),
        )

    arr = np.array(rows)
    X_raw = arr[:, :4]
    fwd_returns = arr[:, 4]

    # Standardise
    X_mean = X_raw.mean(axis=0)
    X_std  = X_raw.std(axis=0) + 1e-10
    X = (X_raw - X_mean) / X_std

    # ── K-Means (k=4) ────────────────────────────────────────────────────────
    K = 4
    labels, centers = _kmeans(X, k=K)
    today_x = X[-1]
    today_cluster = int(labels[-1])

    # Label clusters by mean forward return (only non-nan)
    cluster_fwd = {}
    for c in range(K):
        mask = (labels == c) & (~np.isnan(fwd_returns))
        cluster_fwd[c] = float(np.mean(fwd_returns[mask])) if mask.sum() > 0 else 0.0

    sorted_by_fwd = sorted(cluster_fwd.items(), key=lambda x: x[1])
    label_map = {}
    cluster_names = ["Deep Bear", "Bear/Correction", "Neutral/Sideways", "Bull Trend"]
    for rank, (c, _) in enumerate(sorted_by_fwd):
        label_map[c] = cluster_names[rank]

    cluster_descs = {
        "Deep Bear":         "Historical avg 21d return is the worst: deep drawdown, negative momentum, elevated volatility",
        "Bear/Correction":   "Below-average returns: moderate drawdown with negative recent momentum",
        "Neutral/Sideways":  "Mixed conditions: low momentum, moderate drawdown, near-average volatility",
        "Bull Trend":        "Historical avg 21d return is the best: low drawdown, positive momentum, controlled volatility",
    }

    today_label = label_map.get(today_cluster, "Unknown")
    today_fwd   = cluster_fwd.get(today_cluster, 0.0)

    # ── GMM (3 components) ───────────────────────────────────────────────────
    try:
        from sklearn.mixture import GaussianMixture
        gmm_model = GaussianMixture(n_components=3, random_state=42, n_init=1)
        gmm_model.fit(X)
        probs_all = gmm_model.predict_proba(X)
        today_probs = probs_all[-1].tolist()

        # Label GMM states by mean return ascending
        state_means = []
        for s in range(3):
            mask = (gmm_model.predict(X) == s) & (~np.isnan(fwd_returns))
            state_means.append(float(np.mean(fwd_returns[mask])) if mask.sum() > 0 else 0.0)
        sorted_states = sorted(range(3), key=lambda i: state_means[i])
        gmm_names = {sorted_states[0]: "Bear", sorted_states[1]: "Neutral", sorted_states[2]: "Bull"}

        gmm_labels = [gmm_names.get(s, "Unknown") for s in range(3)]
        current_gmm_state = int(gmm_model.predict(X[-1:])[0])

    except Exception as exc:
        log.warning("GMM failed: %s", exc)
        today_probs    = [0.33, 0.33, 0.34]
        gmm_labels     = ["Bear", "Neutral", "Bull"]
        current_gmm_state = 1

    # ── HMM (3 states) ───────────────────────────────────────────────────────
    hmm_history: list[HMMPoint] = []
    hmm_state_labels = ["Bear", "Neutral", "Bull"]
    current_hmm_state = 1
    hmm_prob = 0.5
    try:
        from hmmlearn.hmm import GaussianHMM
        returns_hmm = np.diff(np.log(closes + 1e-10))
        rv5 = np.array([returns_hmm[max(0, i-5):i].std(ddof=0) for i in range(1, len(returns_hmm)+1)])
        hmm_features = np.column_stack([returns_hmm, rv5])

        model_hmm = GaussianHMM(n_components=3, covariance_type="diag", n_iter=50, random_state=42)
        model_hmm.fit(hmm_features)
        state_seq = model_hmm.predict(hmm_features)
        posteriors = model_hmm.predict_proba(hmm_features)

        # Label by mean return in each state
        state_ret_means = []
        for s in range(3):
            mask = state_seq == s
            state_ret_means.append(float(returns_hmm[mask].mean()) if mask.sum() > 0 else 0.0)
        sorted_hmm = sorted(range(3), key=lambda i: state_ret_means[i])
        hmm_label_map = {sorted_hmm[0]: "Bear", sorted_hmm[1]: "Neutral", sorted_hmm[2]: "Bull"}

        # Build history (last 252 days)
        offset = n - len(state_seq)
        for i, s in enumerate(state_seq[-252:]):
            di = offset + len(state_seq) - 252 + i
            if 0 <= di < len(dates):
                hmm_history.append(HMMPoint(date=dates[di], state=int(hmm_label_map.get(int(s), 1))))

        current_hmm_raw   = int(state_seq[-1])
        current_hmm_state = int({0: 0, 1: 1, 2: 2}.get(hmm_label_map.get(current_hmm_raw, 1), 1))
        hmm_prob          = float(posteriors[-1, current_hmm_raw])
        # Map state integer to labels consistently
        hmm_state_labels  = [hmm_label_map.get(sorted_hmm[i], "Unknown") for i in range(3)]

    except Exception as exc:
        log.warning("HMM failed: %s", exc)

    return RegimeClustersResponse(
        symbol=symbol,
        kmeans=KMeansData(
            current_cluster=today_cluster,
            cluster_label=today_label,
            cluster_description=cluster_descs.get(today_label, ""),
            n_clusters=K,
            avg_fwd_return=round(today_fwd, 2),
        ),
        gmm=GMMData(
            current_state=current_gmm_state,
            state_labels=gmm_labels,
            state_probabilities=[round(p, 3) for p in today_probs],
        ),
        hmm=HMMData(
            current_state=current_hmm_state,
            state_label=hmm_state_labels[min(current_hmm_state, len(hmm_state_labels)-1)],
            state_probability=round(hmm_prob, 3),
            state_labels=hmm_state_labels,
            history=hmm_history,
        ),
    )


@_day_cached
def get_pattern_match(symbol: str) -> PatternMatchResponse:
    closes, _, _, dates = _fetch_ohlcv(symbol)
    n = len(closes)
    returns_1d = _daily_returns(closes)  # length n-1

    # ── Build analog feature table for KNN ──────────────────────────────────
    peaks = np.maximum.accumulate(closes)
    tr_list = [max(closes[i] - closes[i-1], abs(closes[i] - closes[i-1])) for i in range(1, n)]
    tr_arr = np.array(tr_list + [tr_list[-1]])
    atr14 = np.array([tr_arr[max(0, i-14):i].mean() for i in range(1, n+1)])

    feat_rows = []  # (regime_n, ret_1m_n, ret_3m_n, dd_n, atr_n, fwd_1m, fwd_3m, date_idx)
    for i in range(200, n - 21):
        smas = [
            closes[i - 20:i].mean(),
            closes[i - 50:i].mean() if i >= 50 else None,
            closes[i - 100:i].mean() if i >= 100 else None,
            closes[i - 200:i].mean() if i >= 200 else None,
        ]
        regime = sum(1 for s in smas if s is not None and closes[i] > s)
        ret_1m = float((closes[i] / closes[i - 21] - 1) * 100)
        ret_3m = float((closes[i] / closes[i - 63] - 1) * 100) if i >= 63 else ret_1m
        dd     = float((closes[i] / peaks[i] - 1) * 100)
        atr    = float(atr14[i])
        fwd_1m = float((closes[i + 21] / closes[i] - 1) * 100)
        fwd_3m = float((closes[i + 63] / closes[i] - 1) * 100) if i + 63 < n else None
        feat_rows.append([float(regime), ret_1m, ret_3m, dd, atr, fwd_1m, fwd_3m, i])

    if len(feat_rows) < 20:
        return PatternMatchResponse(
            symbol=symbol,
            knn=KNNData(k=0, predicted_direction="Neutral", confidence=0.0, avg_fwd_1m=0.0, avg_fwd_3m=0.0),
            dtw_patterns=[],
            dtw_avg_fwd_1m=0.0, dtw_avg_fwd_3m=0.0, dtw_pct_positive_1m=0.0,
        )

    fa = np.array([[r[0], r[1], r[2], r[3], r[4]] for r in feat_rows], dtype=float)
    weights = np.array([0.25, 0.25, 0.15, 0.20, 0.15])

    # Normalize
    fa_min, fa_max = fa.min(axis=0), fa.max(axis=0)
    fa_range = np.where(fa_max == fa_min, 1.0, fa_max - fa_min)
    fa_norm = (fa - fa_min) / fa_range

    # ── KNN (k=10) ───────────────────────────────────────────────────────────
    today_raw = fa[-1]
    today_norm = (today_raw - fa_min) / fa_range
    dists_knn = (np.abs(fa_norm[:-1] - today_norm) * weights).sum(axis=1)
    k = min(10, len(dists_knn))
    nn_idx = np.argpartition(dists_knn, k)[:k]

    fwd_1m_knn = [feat_rows[i][5] for i in nn_idx if feat_rows[i][5] is not None]
    fwd_3m_knn = [feat_rows[i][6] for i in nn_idx if feat_rows[i][6] is not None]

    avg_fwd_1m_knn = float(np.mean(fwd_1m_knn)) if fwd_1m_knn else 0.0
    avg_fwd_3m_knn = float(np.mean(fwd_3m_knn)) if fwd_3m_knn else 0.0
    pct_bullish    = float(np.mean([1 if v > 0 else 0 for v in fwd_1m_knn])) * 100 if fwd_1m_knn else 50.0

    if pct_bullish > 65:
        knn_direction = "Bullish"
    elif pct_bullish < 35:
        knn_direction = "Bearish"
    else:
        knn_direction = "Neutral"

    # ── DTW (21-day pattern matching) ────────────────────────────────────────
    window = 21
    if len(returns_1d) < window * 2:
        dtw_patterns_out: list[DTWPattern] = []
        dtw_avg_1m = 0.0
        dtw_avg_3m = 0.0
        dtw_pct_pos = 50.0
    else:
        query = returns_1d[-window:]
        q_std = query.std(ddof=1)
        query_norm = (query - query.mean()) / (q_std + 1e-10)

        # Compute DTW distance for every historical window (with 21-day gap enforcement)
        candidates: list[tuple[float, int, float | None, float | None]] = []
        for i in range(window, len(returns_1d) - window - 1):
            seg = returns_1d[i - window:i]
            s_std = seg.std(ddof=1)
            seg_norm = (seg - seg.mean()) / (s_std + 1e-10)
            dist = _dtw_distance(query_norm, seg_norm)

            date_idx_close = i + 1  # index into closes[]
            fwd_1m_d = float((closes[date_idx_close + 21] / closes[date_idx_close] - 1) * 100) \
                if date_idx_close + 21 < n else None
            fwd_3m_d = float((closes[date_idx_close + 63] / closes[date_idx_close] - 1) * 100) \
                if date_idx_close + 63 < n else None
            candidates.append((dist, date_idx_close, fwd_1m_d, fwd_3m_d))

        candidates.sort(key=lambda x: x[0])

        # Select top 5 with 21-day gap
        selected: list[tuple[float, int, float | None, float | None]] = []
        for dist, di, f1, f3 in candidates:
            if all(abs(di - prev[1]) >= 21 for prev in selected):
                selected.append((dist, di, f1, f3))
            if len(selected) >= 5:
                break

        # Normalise distance to similarity score
        max_dist = max(s[0] for s in selected) if selected else 1.0
        dtw_patterns_out = []
        for dist, di, f1, f3 in selected:
            sim = float((1 - dist / (max_dist + 1e-10)) * 100)
            dtw_patterns_out.append(DTWPattern(
                date=dates[di],
                dtw_distance=round(dist, 4),
                pattern_similarity=round(sim, 1),
                fwd_1m=round(f1, 2) if f1 is not None else None,
                fwd_3m=round(f3, 2) if f3 is not None else None,
            ))

        fwd_1m_dtw = [p.fwd_1m for p in dtw_patterns_out if p.fwd_1m is not None]
        fwd_3m_dtw = [p.fwd_3m for p in dtw_patterns_out if p.fwd_3m is not None]
        dtw_avg_1m  = float(np.mean(fwd_1m_dtw)) if fwd_1m_dtw else 0.0
        dtw_avg_3m  = float(np.mean(fwd_3m_dtw)) if fwd_3m_dtw else 0.0
        dtw_pct_pos = float(np.mean([1 if v > 0 else 0 for v in fwd_1m_dtw]) * 100) if fwd_1m_dtw else 50.0

    return PatternMatchResponse(
        symbol=symbol,
        knn=KNNData(
            k=k,
            predicted_direction=knn_direction,
            confidence=round(max(pct_bullish, 100 - pct_bullish), 1),
            avg_fwd_1m=round(avg_fwd_1m_knn, 2),
            avg_fwd_3m=round(avg_fwd_3m_knn, 2),
        ),
        dtw_patterns=dtw_patterns_out,
        dtw_avg_fwd_1m=round(dtw_avg_1m, 2),
        dtw_avg_fwd_3m=round(dtw_avg_3m, 2),
        dtw_pct_positive_1m=round(dtw_pct_pos, 1),
    )


@_day_cached
def get_market_dynamics(symbol: str) -> MarketDynamicsResponse:
    """Lead-Lag analysis: which stocks lead/lag the target symbol."""
    closes, _, _, dates = _fetch_ohlcv(symbol)
    target_rets = _daily_returns(closes)

    all_syms = _fetch_all_returns(limit=len(target_rets) + 10)

    max_lag = 5
    pairs: list[LeadLagPair] = []

    for other_sym, other_rets in all_syms.items():
        if other_sym == symbol:
            continue
        # Align lengths
        n_common = min(len(target_rets), len(other_rets))
        if n_common < 60:
            continue
        t = target_rets[-n_common:]
        o = other_rets[-n_common:]

        # Cross-correlation at lags -max_lag..+max_lag
        best_lag, best_corr = 0, 0.0
        for lag in range(-max_lag, max_lag + 1):
            if lag > 0:
                # other leads target by lag days: other[:-lag] vs target[lag:]
                x, y = o[:-lag], t[lag:]
            elif lag < 0:
                # target leads other by -lag days: target[:-(-lag)] vs other[-lag:]
                x, y = o[-lag:], t[:lag]
            else:
                x, y = o, t
            if len(x) < 30:
                continue
            corr = float(np.corrcoef(x, y)[0, 1])
            if abs(corr) > abs(best_corr):
                best_corr = corr
                best_lag  = lag

        if abs(best_corr) < 0.1:
            continue  # weak relationship — skip

        if best_lag > 0:
            relationship = f"Leads {symbol} by {best_lag}d"
        elif best_lag < 0:
            relationship = f"Lags {symbol} by {abs(best_lag)}d"
        else:
            relationship = "Coincident"

        pairs.append(LeadLagPair(
            other_symbol=other_sym,
            peak_lag=best_lag,
            peak_correlation=round(best_corr, 4),
            relationship=relationship,
        ))

    pairs.sort(key=lambda p: abs(p.peak_correlation), reverse=True)
    top_pairs = pairs[:10]

    leaders  = [p for p in top_pairs if p.peak_lag > 0]
    laggers  = [p for p in top_pairs if p.peak_lag < 0]

    return MarketDynamicsResponse(
        symbol=symbol,
        lead_lag_pairs=top_pairs,
        strongest_leader=leaders[0].other_symbol if leaders else None,
        strongest_lagger=laggers[0].other_symbol if laggers else None,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Dedicated Z-Score endpoint
# ═══════════════════════════════════════════════════════════════════════════════

@_day_cached
def get_zscore(symbol: str) -> ZScoreResponse:
    """Z-Score mean reversion analysis with zone backtest."""
    closes, _, _, dates = _fetch_ohlcv(symbol)
    n = len(closes)

    window = 252
    if n < window + 21:
        return ZScoreResponse(
            symbol=symbol, current_zscore=0.0, interpretation="Insufficient data",
            price_mean_252d=float(closes[-1]) if n else 0.0,
            price_std_252d=0.0, series=[], zone_stats=[],
        )

    # Build rolling Z-score series
    series: list[ZScorePoint] = []
    raw_z: list[float] = []
    for i in range(window, n):
        seg = closes[i - window:i]
        mu  = seg.mean()
        std = seg.std(ddof=1)
        z   = float((closes[i] - mu) / (std + 1e-10))
        series.append(ZScorePoint(date=dates[i], zscore=round(z, 3)))
        raw_z.append(z)

    current_z = raw_z[-1]

    if current_z > 2.5:
        interpretation = "Significantly Overbought"
    elif current_z > 1.5:
        interpretation = "Overbought"
    elif current_z < -2.5:
        interpretation = "Significantly Oversold"
    elif current_z < -1.5:
        interpretation = "Oversold"
    else:
        interpretation = "Neutral"

    # Zone backtest: for each Z zone, what was the avg 21d forward return?
    zones = [
        ("Below -2σ",  lambda z: z < -2.0),
        ("-2σ to -1σ", lambda z: -2.0 <= z < -1.0),
        ("Neutral",    lambda z: -1.0 <= z <= 1.0),
        ("+1σ to +2σ", lambda z: 1.0 < z <= 2.0),
        ("Above +2σ",  lambda z: z > 2.0),
    ]
    zone_stats: list[ZScoreZoneStats] = []
    for zone_name, zone_fn in zones:
        fwd_returns: list[float] = []
        for i, z in enumerate(raw_z):
            fwd_idx = window + i + 21
            if zone_fn(z) and fwd_idx < n:
                fwd = float((closes[fwd_idx] / closes[window + i] - 1) * 100)
                fwd_returns.append(fwd)
        if fwd_returns:
            arr = np.array(fwd_returns)
            zone_stats.append(ZScoreZoneStats(
                zone=zone_name,
                count=len(arr),
                avg_fwd_21d=round(float(arr.mean()), 2),
                pct_positive_21d=round(float((arr > 0).mean() * 100), 1),
            ))
        else:
            zone_stats.append(ZScoreZoneStats(zone=zone_name, count=0, avg_fwd_21d=0.0, pct_positive_21d=0.0))

    # Current 252d stats
    seg_cur = closes[n - window:n]
    mean_cur = float(seg_cur.mean())
    std_cur  = float(seg_cur.std(ddof=1))

    return ZScoreResponse(
        symbol=symbol,
        current_zscore=round(current_z, 3),
        interpretation=interpretation,
        price_mean_252d=round(mean_cur, 2),
        price_std_252d=round(std_cur, 2),
        series=series[-252:],
        zone_stats=zone_stats,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Dedicated Dual Momentum endpoint
# ═══════════════════════════════════════════════════════════════════════════════

def _classify_dual_momentum(abs_mom: float, rel_mom: float) -> str:
    if abs_mom > 0 and rel_mom > 0:
        return "Strong Buy"
    if abs_mom > 0:
        return "Buy"
    if rel_mom > 0:
        return "Neutral"
    return "Avoid"


@_day_cached
def get_dual_momentum(symbol: str) -> DualMomentumResponse:
    """Dual Momentum (Antonacci) with rolling signal history and per-signal backtest."""
    closes, _, _, dates = _fetch_ohlcv(symbol)
    n = len(closes)

    # Build equal-weight index returns for comparison
    try:
        all_sym_rets = _fetch_all_returns(exclude_symbol=symbol, limit=n + 10)
        # Align all arrays to same length
        all_arrs = list(all_sym_rets.values())
        min_len = min(len(a) for a in all_arrs) if all_arrs else 0
        if min_len > 0:
            index_rets_arr = np.stack([a[-min_len:] for a in all_arrs]).mean(axis=0)
        else:
            index_rets_arr = np.zeros(n - 1)
    except Exception:
        index_rets_arr = np.zeros(n - 1)

    stock_rets = np.diff(np.log(closes + 1e-10))

    # Rolling 252-day signals
    lookback = 252
    history: list[DualMomentumHistPoint] = []
    history_signals: list[str] = []
    history_closes_idx: list[int] = []

    for i in range(lookback, n):
        # Stock 12M return
        abs_mom = float((closes[i] / closes[i - lookback] - 1) * 100)

        # Index 12M return aligned to same window
        idx_offset = len(stock_rets) - (n - 1)  # stock_rets[0] corresponds to closes[1]
        idx_start = max(0, i - lookback - 1)
        idx_end   = i - 1
        if idx_start < len(index_rets_arr) and idx_end < len(index_rets_arr):
            index_12m = float((np.exp(index_rets_arr[idx_start:idx_end].sum()) - 1) * 100)
        else:
            index_12m = 0.0

        rel_mom = abs_mom - index_12m
        signal  = _classify_dual_momentum(abs_mom, rel_mom)
        history.append(DualMomentumHistPoint(date=dates[i], signal=signal))
        history_signals.append(signal)
        history_closes_idx.append(i)

    # Current values
    if n >= lookback + 1:
        cur_abs_mom = float((closes[-1] / closes[-(lookback + 1)] - 1) * 100)
    elif n >= 63:
        cur_abs_mom = float((closes[-1] / closes[-64] - 1) * 100)
    else:
        cur_abs_mom = 0.0

    # Current index 12M
    if len(index_rets_arr) >= lookback:
        cur_index_12m = float((np.exp(index_rets_arr[-lookback:].sum()) - 1) * 100)
    else:
        cur_index_12m = 0.0

    cur_rel_mom     = cur_abs_mom - cur_index_12m
    cur_signal      = _classify_dual_momentum(cur_abs_mom, cur_rel_mom)
    abs_filter_pass = cur_abs_mom > 0
    rel_filter_pass = cur_rel_mom > 0

    if cur_signal == "Strong Buy":
        rationale = f"Both absolute (+{cur_abs_mom:.1f}%) and relative (+{cur_rel_mom:.1f}% vs index) momentum positive"
    elif cur_signal == "Buy":
        rationale = f"Absolute momentum positive (+{cur_abs_mom:.1f}%) but underperforming index by {-cur_rel_mom:.1f}%"
    elif cur_signal == "Neutral":
        rationale = f"Outperforming index but absolute 12M return is negative ({cur_abs_mom:.1f}%)"
    else:
        rationale = f"Both absolute ({cur_abs_mom:.1f}%) and relative ({cur_rel_mom:.1f}%) momentum negative — avoid"

    # Per-signal backtest: avg forward 21d and 63d returns
    signal_perf_map: dict[str, list[float]] = {"Strong Buy": [], "Buy": [], "Neutral": [], "Avoid": []}
    signal_perf_63: dict[str, list[float]] = {"Strong Buy": [], "Buy": [], "Neutral": [], "Avoid": []}

    for j, (sig, ci) in enumerate(zip(history_signals, history_closes_idx)):
        if ci + 21 < n:
            fwd21 = float((closes[ci + 21] / closes[ci] - 1) * 100)
            signal_perf_map[sig].append(fwd21)
        if ci + 63 < n:
            fwd63 = float((closes[ci + 63] / closes[ci] - 1) * 100)
            signal_perf_63[sig].append(fwd63)

    signal_performance: list[DualMomentumSignalPerf] = []
    for sig in ["Strong Buy", "Buy", "Neutral", "Avoid"]:
        r21 = np.array(signal_perf_map[sig])
        r63 = np.array(signal_perf_63[sig])
        signal_performance.append(DualMomentumSignalPerf(
            signal=sig,
            count=len(r21),
            avg_fwd_21d=round(float(r21.mean()), 2) if len(r21) > 0 else 0.0,
            avg_fwd_63d=round(float(r63.mean()), 2) if len(r63) > 0 else 0.0,
            pct_positive_21d=round(float((r21 > 0).mean() * 100), 1) if len(r21) > 0 else 0.0,
        ))

    return DualMomentumResponse(
        symbol=symbol,
        current_signal=cur_signal,
        abs_momentum_12m=round(cur_abs_mom, 2),
        rel_momentum_vs_index=round(cur_rel_mom, 2),
        index_12m_return=round(cur_index_12m, 2),
        abs_filter_pass=abs_filter_pass,
        rel_filter_pass=rel_filter_pass,
        rationale=rationale,
        history=history[-252:],
        signal_performance=signal_performance,
    )
