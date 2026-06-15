"""Regime Score and Market Breadth Score computation engine.

Regime Score (0–100)
────────────────────
Measures the structural trend quality of a single stock across three
orthogonal dimensions:

  Component 1 — Price Position (max 40 pts)
    price > SMA200 → +10
    price > SMA100 → +10
    price > SMA50  → +10
    price > SMA20  → +10

  Component 2 — SMA Alignment (max 30 pts)
    The "bull stack": each shorter SMA above the next longer one.
    SMA20 > SMA50   → +10
    SMA50 > SMA100  → +10
    SMA100 > SMA200 → +10

  Component 3 — SMA Slope (max 30 pts)
    SMAs must be trending in the predicted direction (rising for bullish).
    SMA20  rising over 5 bars  → +10
    SMA50  rising over 10 bars → +10
    SMA200 rising over 20 bars → +10

Labels:  80–100 Strong Bull | 60–79 Moderate Bull | 40–59 Neutral
         20–39 Moderate Bear | 0–19 Strong Bear

Market Breadth Score (0–100)
─────────────────────────────
Measures how broadly the market is participating in a move.
Computed across all available NIFTY 50 symbols each day.

  breadth_score = pct_above_sma20  × 0.30
               + pct_above_sma50  × 0.40
               + pct_above_sma200 × 0.30

SMA50 carries the highest weight because it is the canonical medium-term
trend filter; SMA200 captures structural participation; SMA20 captures
near-term momentum.

Labels:  ≥70 Broad Participation | 50–69 Moderate Breadth
         30–49 Narrow Breadth    | <30  Poor Breadth

Caching
───────
Both results are cached by date string (refreshes once per calendar day).
"""
import logging
from datetime import datetime

import numpy as np

from app.services.duckdb_client import get_connection
from app.services.indicators_service import _sma
from app.services.stock_metrics import get_universe as _fetch_universe
from app.models.regime import (
    RegimeComponents, SMASummary, SlopeInfo,
    RegimeHistoryPoint, RegimeScoreResult,
    BreadthHistoryPoint, BreadthScoreResult,
    StockRegimeSummary, MarketRegimeSnapshot,
)

log = logging.getLogger(__name__)

# ─── Universe ─────────────────────────────────────────────────────────────────

def get_universe() -> list[str]:
    """Return NSE 500 universe from DuckDB (day-cached via stock_metrics)."""
    return _fetch_universe()

# ─── Module-level caches (keyed by date string) ────────────────────────────────

_regime_cache:        dict[tuple[str, str], RegimeScoreResult]  = {}
_breadth_cache:       dict[str, BreadthScoreResult]             = {}
_snapshot_cache:      dict[str, MarketRegimeSnapshot]           = {}
_mkt_regime_cache:    dict[str, dict[str, float]]               = {}  # today -> {date: avg_score}

_HISTORY_BARS = 252   # ~1 trading year for charts
_SLOPE_20     = 5     # SMA20 slope lookback (bars)
_SLOPE_50     = 10    # SMA50 slope lookback
_SLOPE_200    = 20    # SMA200 slope lookback


# ─── Labels ───────────────────────────────────────────────────────────────────

def _regime_label(score: float) -> str:
    if score >= 80: return "Strong Bull"
    if score >= 60: return "Moderate Bull"
    if score >= 40: return "Neutral"
    if score >= 20: return "Moderate Bear"
    return "Strong Bear"


def _breadth_label(score: float) -> str:
    if score >= 70: return "Broad Participation"
    if score >= 50: return "Moderate Breadth"
    if score >= 30: return "Narrow Breadth"
    return "Poor Breadth"


# ─── Core computation ─────────────────────────────────────────────────────────

def _compute_regime_arrays(
    closes: np.ndarray,
    sma20:  np.ndarray,
    sma50:  np.ndarray,
    sma100: np.ndarray,
    sma200: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Vectorized regime score computation over an entire price series.

    Returns (total_score, price_score, align_score, slope_score).
    Bars where SMA200 is NaN are set to NaN in the output.
    """
    n = len(closes)

    # Component 1: price position (0–40)
    price_score = (
        np.where(~np.isnan(sma200) & (closes > sma200), 10.0, 0.0) +
        np.where(~np.isnan(sma100) & (closes > sma100), 10.0, 0.0) +
        np.where(~np.isnan(sma50)  & (closes > sma50),  10.0, 0.0) +
        np.where(~np.isnan(sma20)  & (closes > sma20),  10.0, 0.0)
    )

    # Component 2: SMA alignment / bull stack (0–30)
    align_score = (
        np.where(~np.isnan(sma20)  & ~np.isnan(sma50)  & (sma20  > sma50),  10.0, 0.0) +
        np.where(~np.isnan(sma50)  & ~np.isnan(sma100) & (sma50  > sma100), 10.0, 0.0) +
        np.where(~np.isnan(sma100) & ~np.isnan(sma200) & (sma100 > sma200), 10.0, 0.0)
    )

    # Component 3: SMA slope — rising over lookback window (0–30)
    slope_score = np.zeros(n)
    if n > _SLOPE_20:
        slope_score[_SLOPE_20:] += np.where(
            ~np.isnan(sma20[_SLOPE_20:]) & ~np.isnan(sma20[:-_SLOPE_20]) &
            (sma20[_SLOPE_20:] > sma20[:-_SLOPE_20]),
            10.0, 0.0,
        )
    if n > _SLOPE_50:
        slope_score[_SLOPE_50:] += np.where(
            ~np.isnan(sma50[_SLOPE_50:]) & ~np.isnan(sma50[:-_SLOPE_50]) &
            (sma50[_SLOPE_50:] > sma50[:-_SLOPE_50]),
            10.0, 0.0,
        )
    if n > _SLOPE_200:
        slope_score[_SLOPE_200:] += np.where(
            ~np.isnan(sma200[_SLOPE_200:]) & ~np.isnan(sma200[:-_SLOPE_200]) &
            (sma200[_SLOPE_200:] > sma200[:-_SLOPE_200]),
            10.0, 0.0,
        )

    total = price_score + align_score + slope_score
    # Bars with no SMA200 yet produce an unreliable score — mask them
    total[np.isnan(sma200)] = np.nan
    return total, price_score, align_score, slope_score


def _slope_pct(arr: np.ndarray, lookback: int, idx: int) -> float:
    """Percentage change of arr[idx] vs arr[idx - lookback]. 0.0 if unavailable."""
    if idx < lookback or np.isnan(arr[idx]) or np.isnan(arr[idx - lookback]):
        return 0.0
    base = arr[idx - lookback]
    if base == 0:
        return 0.0
    return float((arr[idx] - base) / base * 100)


# ─── Public API ───────────────────────────────────────────────────────────────

def get_regime_score(symbol: str) -> RegimeScoreResult:
    """Compute the Regime Score for a single stock.

    Result is cached per (symbol, date); subsequent calls within the same
    calendar day are instant.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    key = (symbol, today)
    if key in _regime_cache:
        return _regime_cache[key]

    con = get_connection()
    rows = con.execute(
        """
        SELECT date, close
        FROM equities_prices
        WHERE symbol = ?
        ORDER BY date
        """,
        [symbol],
    ).fetchall()

    if len(rows) < 200:
        raise ValueError(f"{symbol}: insufficient history ({len(rows)} bars, need ≥200)")

    dates  = [str(r[0])[:10] for r in rows]
    closes = np.array([float(r[1]) for r in rows])

    sma20  = _sma(closes, 20)
    sma50  = _sma(closes, 50)
    sma100 = _sma(closes, 100)
    sma200 = _sma(closes, 200)

    scores, price_arr, align_arr, slope_arr = _compute_regime_arrays(
        closes, sma20, sma50, sma100, sma200
    )

    last = len(closes) - 1
    cur_score  = float(scores[last])
    cur_price  = float(closes[last])
    cur_sma20  = float(sma20[last])
    cur_sma50  = float(sma50[last])
    cur_sma100 = float(sma100[last])
    cur_sma200 = float(sma200[last])

    # Build history (last _HISTORY_BARS valid bars)
    valid_idx = [i for i in range(len(closes)) if not np.isnan(scores[i])]
    history_idx = valid_idx[-_HISTORY_BARS:]
    history = [
        RegimeHistoryPoint(
            date=dates[i],
            close=round(float(closes[i]), 2),
            regime_score=round(float(scores[i]), 1),
        )
        for i in history_idx
    ]

    result = RegimeScoreResult(
        symbol=symbol,
        date=dates[last],
        close=round(cur_price, 2),
        regime_score=round(cur_score, 1),
        regime_label=_regime_label(cur_score),
        components=RegimeComponents(
            price_score=round(float(price_arr[last]), 1),
            alignment_score=round(float(align_arr[last]), 1),
            slope_score=round(float(slope_arr[last]), 1),
        ),
        sma=SMASummary(
            sma20=round(cur_sma20, 2),
            sma50=round(cur_sma50, 2),
            sma100=round(cur_sma100, 2),
            sma200=round(cur_sma200, 2),
            above_sma20=bool(cur_price > cur_sma20),
            above_sma50=bool(cur_price > cur_sma50),
            above_sma100=bool(cur_price > cur_sma100),
            above_sma200=bool(cur_price > cur_sma200),
        ),
        slope=SlopeInfo(
            sma20_slope=round(_slope_pct(sma20, _SLOPE_20, last), 3),
            sma50_slope=round(_slope_pct(sma50, _SLOPE_50, last), 3),
            sma200_slope=round(_slope_pct(sma200, _SLOPE_200, last), 3),
            sma20_rising=bool(sma20[last] > sma20[last - _SLOPE_20]) if last >= _SLOPE_20 else False,
            sma50_rising=bool(sma50[last] > sma50[last - _SLOPE_50]) if last >= _SLOPE_50 else False,
            sma200_rising=bool(sma200[last] > sma200[last - _SLOPE_200]) if last >= _SLOPE_200 else False,
        ),
        sma_fully_aligned=bool(
            cur_sma20 > cur_sma50 > cur_sma100 > cur_sma200
        ),
        history=history,
        computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )

    _regime_cache[key] = result
    return result


def get_breadth_score() -> BreadthScoreResult:
    """Compute Market Breadth Score across all NIFTY 50 stocks.

    For each symbol, checks whether today's close is above its SMA20,
    SMA50, and SMA200. Breadth score is a weighted average of the three
    participation percentages.

    Also returns 252 bars of breadth history for trend visualisation.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    if today in _breadth_cache:
        return _breadth_cache[today]

    symbols_sql = ", ".join(f"'{s}'" for s in get_universe())
    con = get_connection()

    # One query: all symbols × all dates, compute SMAs via window functions
    rows = con.execute(
        f"""
        WITH sma_data AS (
            SELECT
                symbol,
                date,
                close,
                AVG(close) OVER (
                    PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                ) AS sma20,
                AVG(close) OVER (
                    PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
                ) AS sma50,
                AVG(close) OVER (
                    PARTITION BY symbol ORDER BY date
                    ROWS BETWEEN 199 PRECEDING AND CURRENT ROW
                ) AS sma200,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date) AS rn
            FROM equities_prices
            WHERE symbol IN ({symbols_sql})
        ),
        valid AS (
            SELECT * FROM sma_data WHERE rn >= 200
        ),
        daily_breadth AS (
            SELECT
                date,
                COUNT(*) AS n,
                SUM(CASE WHEN close > sma20  THEN 1 ELSE 0 END) AS above20,
                SUM(CASE WHEN close > sma50  THEN 1 ELSE 0 END) AS above50,
                SUM(CASE WHEN close > sma200 THEN 1 ELSE 0 END) AS above200
            FROM valid
            GROUP BY date
            HAVING COUNT(*) >= 40
        )
        SELECT date, n, above20, above50, above200
        FROM daily_breadth
        ORDER BY date DESC
        LIMIT {_HISTORY_BARS}
        """
    ).fetchall()

    if not rows:
        raise ValueError("Insufficient data to compute breadth score")

    # rows are DESC — reverse for chronological history
    rows = list(reversed(rows))

    history: list[BreadthHistoryPoint] = []
    for r in rows:
        n = int(r[1])
        a20  = int(r[2]) / n * 100
        a50  = int(r[3]) / n * 100
        a200 = int(r[4]) / n * 100
        bs   = round(a20 * 0.30 + a50 * 0.40 + a200 * 0.30, 1)
        history.append(BreadthHistoryPoint(
            date=str(r[0])[:10],
            breadth_score=bs,
            pct_above_sma20=round(a20, 1),
            pct_above_sma50=round(a50, 1),
            pct_above_sma200=round(a200, 1),
        ))

    latest = history[-1]
    total  = int(rows[-1][1])

    result = BreadthScoreResult(
        date=latest.date,
        pct_above_sma20=latest.pct_above_sma20,
        pct_above_sma50=latest.pct_above_sma50,
        pct_above_sma200=latest.pct_above_sma200,
        count_above_sma20=round(latest.pct_above_sma20 / 100 * total),
        count_above_sma50=round(latest.pct_above_sma50 / 100 * total),
        count_above_sma200=round(latest.pct_above_sma200 / 100 * total),
        total_symbols=total,
        breadth_score=latest.breadth_score,
        breadth_label=_breadth_label(latest.breadth_score),
        history=history,
        computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )

    _breadth_cache[today] = result
    return result


def get_snapshot() -> MarketRegimeSnapshot:
    """Compute regime score for every stock in the universe, combined with breadth.

    Uses a single batch DuckDB query (not one query per symbol) so it scales
    to NSE 500 without timeout. Result is cached for the calendar day.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    if today in _snapshot_cache:
        return _snapshot_cache[today]

    breadth = get_breadth_score()

    con = get_connection()
    symbols_sql = ", ".join(f"'{s}'" for s in get_universe())

    rows = con.execute(
        f"""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close
        FROM equities_prices
        WHERE symbol IN ({symbols_sql})
        ORDER BY symbol, date
        """
    ).fetchall()

    from collections import defaultdict
    sym_dates:  dict[str, list[str]]   = defaultdict(list)
    sym_closes: dict[str, list[float]] = defaultdict(list)
    for sym, d, c in rows:
        sym_dates[sym].append(d)
        sym_closes[sym].append(float(c))

    import time as _time
    stocks: list[StockRegimeSummary] = []
    for i, sym in enumerate(sorted(sym_dates.keys())):
        c_arr = np.array(sym_closes[sym], dtype=float)
        if len(c_arr) < 200:
            continue
        try:
            s20  = _sma(c_arr, 20)
            s50  = _sma(c_arr, 50)
            s100 = _sma(c_arr, 100)
            s200 = _sma(c_arr, 200)
            scores_arr, price_arr, align_arr, slope_arr = _compute_regime_arrays(
                c_arr, s20, s50, s100, s200
            )
            last = len(c_arr) - 1
            score = float(scores_arr[last])
            if np.isnan(score):
                continue
            fully_aligned = bool(s20[last] > s50[last] > s100[last] > s200[last])
            stocks.append(StockRegimeSummary(
                symbol=sym,
                regime_score=round(score, 1),
                regime_label=_regime_label(score),
                close=round(float(c_arr[last]), 2),
                above_sma200=bool(c_arr[last] > s200[last]),
                sma_fully_aligned=fully_aligned,
                price_score=round(float(price_arr[last]), 1),
                alignment_score=round(float(align_arr[last]), 1),
                slope_score=round(float(slope_arr[last]), 1),
            ))
        except Exception as exc:
            log.warning("regime_service.get_snapshot: skipping %s — %s", sym, exc)
        if i % 50 == 49:
            _time.sleep(0)  # yield GIL every 50 symbols

    score_vals = [s.regime_score for s in stocks]
    avg = round(float(np.mean(score_vals)), 1) if score_vals else 0.0

    result = MarketRegimeSnapshot(
        date=today,
        breadth=breadth,
        stocks=sorted(stocks, key=lambda s: s.regime_score, reverse=True),
        avg_regime_score=avg,
        strong_bull_count=sum(1 for s in stocks if s.regime_score >= 80),
        bull_count=sum(1 for s in stocks if 60 <= s.regime_score < 80),
        neutral_count=sum(1 for s in stocks if 40 <= s.regime_score < 60),
        bear_count=sum(1 for s in stocks if 20 <= s.regime_score < 40),
        strong_bear_count=sum(1 for s in stocks if s.regime_score < 20),
        computed_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
    )

    _snapshot_cache[today] = result
    log.info("regime_service.get_snapshot: %d stocks computed", len(stocks))
    return result


# backward-compat alias
get_market_snapshot = get_snapshot


def get_market_regime_series() -> dict[str, float]:
    """Return {date_str: avg_regime_score} across all NIFTY 50 stocks.

    For each trading date, computes the average regime score of every stock
    that has ≥200 bars of history by that date.  Used by the indicator edge
    service to split signal occurrences into high/low *market* regime buckets.

    Result is cached for the calendar day — computed once, reused for every
    subsequent edge-report call in the same session.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    if today in _mkt_regime_cache:
        return _mkt_regime_cache[today]

    # Cap at 200 symbols with the most history — the market regime average is
    # statistically stable at this sample size and keeps the query under 300k rows.
    con = get_connection()
    top_syms = [
        r[0] for r in con.execute(
            "SELECT symbol, COUNT(*) AS n FROM equities_prices GROUP BY symbol ORDER BY n DESC LIMIT 200"
        ).fetchall()
    ]
    symbols_sql = ", ".join(f"'{s}'" for s in top_syms)

    rows = con.execute(
        f"""
        SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)), close
        FROM equities_prices
        WHERE symbol IN ({symbols_sql})
        ORDER BY symbol, date
        """
    ).fetchall()

    from collections import defaultdict
    sym_dates:  dict[str, list[str]]   = defaultdict(list)
    sym_closes: dict[str, list[float]] = defaultdict(list)
    for sym, d, c in rows:
        sym_dates[sym].append(d)
        sym_closes[sym].append(float(c))

    import time as _t
    # Accumulate per-date regime scores
    date_scores: dict[str, list[float]] = defaultdict(list)
    for _i, sym in enumerate(sym_dates):
        d_list = sym_dates[sym]
        c_arr  = np.array(sym_closes[sym], dtype=float)
        if len(c_arr) < 200:
            continue
        s20  = _sma(c_arr, 20)
        s50  = _sma(c_arr, 50)
        s100 = _sma(c_arr, 100)
        s200 = _sma(c_arr, 200)
        regime_arr, _, _, _ = _compute_regime_arrays(c_arr, s20, s50, s100, s200)
        for i, d in enumerate(d_list):
            v = regime_arr[i]
            if not np.isnan(v):
                date_scores[d].append(float(v))
        if _i % 50 == 49:
            _t.sleep(0)  # yield GIL every 50 symbols

    result = {d: round(float(np.mean(scores)), 1) for d, scores in date_scores.items()}
    _mkt_regime_cache[today] = result
    log.info("market_regime_series: computed %d dates across %d symbols", len(result), len(sym_dates))
    return result


def get_market_regime_series_if_ready() -> dict[str, float]:
    """Return cached regime series without triggering computation.

    Callers that can degrade gracefully (e.g. delivery/short) use this so
    they don't block for 11s on cold start. Returns empty dict if not cached.
    """
    today = datetime.utcnow().strftime("%Y-%m-%d")
    return _mkt_regime_cache.get(today, {})


def invalidate_cache() -> None:
    """Clear all regime caches (called after data refresh)."""
    _regime_cache.clear()
    _breadth_cache.clear()
    _snapshot_cache.clear()
    _mkt_regime_cache.clear()
