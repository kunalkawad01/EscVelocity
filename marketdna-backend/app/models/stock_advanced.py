"""Pydantic models for advanced ML/statistical algorithm endpoints."""
from pydantic import BaseModel


# ── Z-Score (dedicated) ──────────────────────────────────────────────────────

class ZScorePoint(BaseModel):
    date: str
    zscore: float

class ZScoreZoneStats(BaseModel):
    zone: str          # e.g. "Below -2σ"
    count: int
    avg_fwd_21d: float
    pct_positive_21d: float

class ZScoreResponse(BaseModel):
    symbol: str
    current_zscore: float
    interpretation: str
    price_mean_252d: float
    price_std_252d: float
    series: list[ZScorePoint]        # last 252 days
    zone_stats: list[ZScoreZoneStats]  # backtest by zone


# ── Dual Momentum (dedicated) ─────────────────────────────────────────────────

class DualMomentumHistPoint(BaseModel):
    date: str
    signal: str  # "Strong Buy" / "Buy" / "Neutral" / "Avoid"

class DualMomentumSignalPerf(BaseModel):
    signal: str
    count: int
    avg_fwd_21d: float
    avg_fwd_63d: float
    pct_positive_21d: float

class DualMomentumResponse(BaseModel):
    symbol: str
    current_signal: str
    abs_momentum_12m: float
    rel_momentum_vs_index: float
    index_12m_return: float
    abs_filter_pass: bool
    rel_filter_pass: bool
    rationale: str
    history: list[DualMomentumHistPoint]  # last 252 days of signal
    signal_performance: list[DualMomentumSignalPerf]  # backtest per signal


# ── Statistical Signals (grouped, internal) ───────────────────────────────────

class ZScoreData(BaseModel):
    current_zscore: float
    interpretation: str  # "Significantly Overbought" / "Overbought" / "Neutral" / "Oversold" / "Significantly Oversold"

class HurstData(BaseModel):
    hurst_exponent: float
    regime: str       # "Trending" / "Random Walk" / "Mean-Reverting"
    interpretation: str

class DualMomentumData(BaseModel):
    abs_momentum_12m: float       # 12-month return in %
    rel_momentum_vs_index: float  # stock 12M - index 12M
    signal: str                   # "Strong Buy" / "Buy" / "Neutral" / "Avoid"
    rationale: str

class CVaRData(BaseModel):
    var_95: float    # 21d VaR at 95% confidence (negative number = loss)
    cvar_95: float   # Expected Shortfall
    daily_vol: float # annualised daily vol in %
    interpretation: str

class StatisticalSignalsResponse(BaseModel):
    symbol: str
    zscore: ZScoreData
    zscore_series: list[ZScorePoint]
    hurst: HurstData
    dual_momentum: DualMomentumData
    cvar: CVaRData


# ── Volatility Lab ───────────────────────────────────────────────────────────

class RVPoint(BaseModel):
    date: str
    rv: float  # 21d realized vol, annualized %

class RealizedVolData(BaseModel):
    current_rv: float
    rv_percentile: float
    interpretation: str

class GARCHPoint(BaseModel):
    date: str
    conditional_vol: float  # annualized %

class GARCHData(BaseModel):
    current_conditional_vol: float  # annualized %
    one_day_forecast: float         # annualized %
    vol_regime: str                 # "Expanding" / "Contracting" / "Stable"

class BetaPoint(BaseModel):
    date: str
    beta: float

class RollingBetaData(BaseModel):
    current_beta: float
    beta_trend: str        # "Rising" / "Falling" / "Stable"
    interpretation: str

class QuantileRegressionData(BaseModel):
    q10_expected_return: float  # pessimistic 21d scenario
    q50_expected_return: float  # median
    q90_expected_return: float  # optimistic
    tail_asymmetry: str         # "Positive skew" / "Negative skew" / "Symmetric"

class VolatilityLabResponse(BaseModel):
    symbol: str
    realized_vol: RealizedVolData
    rv_series: list[RVPoint]
    garch: GARCHData
    garch_series: list[GARCHPoint]
    rolling_beta: RollingBetaData
    beta_series: list[BetaPoint]
    quantile_regression: QuantileRegressionData


# ── Regime Clusters ──────────────────────────────────────────────────────────

class KMeansData(BaseModel):
    current_cluster: int
    cluster_label: str
    cluster_description: str
    n_clusters: int
    avg_fwd_return: float  # historical avg 21d return for this cluster

class GMMData(BaseModel):
    current_state: int
    state_labels: list[str]
    state_probabilities: list[float]

class HMMPoint(BaseModel):
    date: str
    state: int

class HMMData(BaseModel):
    current_state: int
    state_label: str
    state_probability: float
    state_labels: list[str]
    history: list[HMMPoint]

class RegimeClustersResponse(BaseModel):
    symbol: str
    kmeans: KMeansData
    gmm: GMMData
    hmm: HMMData


# ── Pattern Match ────────────────────────────────────────────────────────────

class KNNData(BaseModel):
    k: int
    predicted_direction: str  # "Bullish" / "Bearish" / "Neutral"
    confidence: float         # % of neighbors agreeing
    avg_fwd_1m: float
    avg_fwd_3m: float

class DTWPattern(BaseModel):
    date: str
    dtw_distance: float
    pattern_similarity: float  # 0–100
    fwd_1m: float | None
    fwd_3m: float | None

class PatternMatchResponse(BaseModel):
    symbol: str
    knn: KNNData
    dtw_patterns: list[DTWPattern]
    dtw_avg_fwd_1m: float
    dtw_avg_fwd_3m: float
    dtw_pct_positive_1m: float


# ── Market Dynamics ──────────────────────────────────────────────────────────

class LeadLagPair(BaseModel):
    other_symbol: str
    peak_lag: int        # positive = other symbol leads target; negative = lags
    peak_correlation: float
    relationship: str    # "Leads this stock" / "Lags this stock" / "Coincident"

class MarketDynamicsResponse(BaseModel):
    symbol: str
    lead_lag_pairs: list[LeadLagPair]
    strongest_leader: str | None   # symbol that leads target most strongly
    strongest_lagger: str | None   # symbol that lags target most strongly
