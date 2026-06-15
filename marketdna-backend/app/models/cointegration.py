"""Pydantic models for the Cointegration Pairs module."""
from typing import Optional
from pydantic import BaseModel


class SpreadSignalStats(BaseModel):
    occurrences: int
    avg_1w: float                   # avg spread return % over 5 bars
    avg_1m: float                   # avg spread return % over 21 bars
    win_rate: float                 # % of times spread converged within 21 bars
    expected_value: float           # direction-adjusted EV
    max_adverse: float              # avg max divergence % before 21 bars
    distribution: dict[str, int]   # spread return buckets
    # Market regime conditional (avg NIFTY regime at signal time)
    mkt_regime_high_win_rate: Optional[float] = None
    mkt_regime_low_win_rate:  Optional[float] = None
    mkt_regime_high_ev:       Optional[float] = None
    mkt_regime_low_ev:        Optional[float] = None
    mkt_regime_high_occurrences: int = 0
    mkt_regime_low_occurrences:  int = 0


class PairResult(BaseModel):
    symbol_y: str           # dependent (y = α + β·x + ε)
    symbol_x: str           # independent
    p_value: float          # Engle-Granger ADF p-value on residuals
    hedge_ratio: float      # OLS β coefficient
    half_life: float        # mean-reversion half-life (calendar days)
    correlation: float      # Pearson r of log prices
    spread_mean: float      # full-history spread mean
    spread_std: float       # full-history spread std
    current_zscore: float   # latest rolling Z-score
    grade: str              # A+/A/B/C
    long_stats:  Optional[SpreadSignalStats] = None   # Z < -2 signal stats
    short_stats: Optional[SpreadSignalStats] = None   # Z > +2 signal stats
    zscore_history: list[float]   # last 252 valid Z-score values
    dates: list[str]              # aligned dates for zscore_history
    computed_at: str


class CointegrationScanResult(BaseModel):
    pairs: list[PairResult]
    total_pairs_universe: int      # C(50,2) = 1225
    total_correlation_passed: int  # after |r| >= threshold
    total_cointegrated: int        # after p-value < threshold
    correlation_threshold: float
    pvalue_threshold: float
    computed_at: str
