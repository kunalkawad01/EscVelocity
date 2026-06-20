from pydantic import BaseModel


class LuckSkillResult(BaseModel):
    luck_score: float
    luck_label: str
    consistency_score: float          # % positive months
    outcome_dispersion: float         # IQR of 1000 random start returns (%)
    pct_positive_starts: float        # % of random starts with positive outcome
    rolling_cv: float                 # avg coefficient of variation across windows (%)


class ConcentrationResult(BaseModel):
    total_return_pct: float
    top_1_contribution: float
    top_5_contribution: float
    top_10_contribution: float
    top_20_contribution: float
    rcr: float                        # Return Concentration Ratio (top-10 / total, %)
    rcr_label: str
    return_actual_pct: float
    return_minus_best_1: float
    return_minus_best_5: float
    return_minus_best_10: float
    return_minus_best_20: float
    concentration_curve: list[float]  # cumulative % contribution, sorted best-day first
    top_days: list[dict]              # [{date, return_pct}] for top 20 days


class FragilityResult(BaseModel):
    fragility_score: float
    fragility_label: str
    worst_period_dependence: float    # max 1y period / total return (%)
    dd_recovery_dependence: float     # % time spent in drawdown
    monte_carlo_p10_cagr: float
    monte_carlo_p50_cagr: float
    monte_carlo_p90_cagr: float
    pct_shuffles_positive: float
    path_iqr: float                   # IQR of shuffled CAGRs (%)
    edge_persistence: float           # % of rolling 252d periods with positive return
    bull_regime_return: float
    bear_regime_return: float
    regime_dependence_score: float
    mc_histogram: list[dict]          # [{cagr_pct, count}] for distribution chart


class RandomnessReport(BaseModel):
    symbol: str
    period_start: str
    period_end: str
    years: float
    cagr: float
    luck_skill: LuckSkillResult
    concentration: ConcentrationResult
    fragility: FragilityResult
    verdict: str
    key_risk: str
    computed_at: str
