"""Feature engine orchestrator.

Usage (from marketdna-data/ with venv active):
    .venv\\Scripts\\python.exe -m feature_engine.compute_all
    .venv\\Scripts\\python.exe -m feature_engine.compute_all --incremental
    .venv\\Scripts\\python.exe -m feature_engine.compute_all --only sma_regime
    .venv\\Scripts\\python.exe -m feature_engine.compute_all --only markov_regimes
"""
import argparse
import logging
import sys
import time

import polars as pl

from feature_engine.features import (
    sma_regime, drawdown_recovery, relative_strength,
    returns_vol, technical_indicators, zscore, returns, std_deviation,
    breadth, markov_regimes, stock_dna,
    markov_forecast, market_dna,
)
from feature_engine.writers.feature_writer import write_feature
from warehouse.register_views import get_connection, register_feature_views

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# Build tiers (strict dependency order)
TIERS: list[list[str]] = [
    # Tier 1 — all read from raw equities_prices, fully independent
    ["sma_regime", "drawdown_recovery", "relative_strength",
     "returns_vol", "technical_indicators", "zscore", "returns", "std_deviation"],
    # Tier 2 — read from Tier 1 parquets
    ["breadth", "markov_regimes", "stock_dna"],
    # Tier 3 — read from Tier 2 parquets
    ["markov_forecast", "market_dna"],
]

MODULES = {
    "sma_regime":           sma_regime,
    "drawdown_recovery":    drawdown_recovery,
    "relative_strength":    relative_strength,
    "returns_vol":          returns_vol,
    "technical_indicators": technical_indicators,
    "zscore":               zscore,
    "returns":              returns,
    "std_deviation":        std_deviation,
    "breadth":              breadth,
    "markov_regimes":       markov_regimes,
    "stock_dna":            stock_dna,
    "markov_forecast":      markov_forecast,
    "market_dna":           market_dna,
}

ALL_FEATURES = [f for tier in TIERS for f in tier]


def _run_one(name: str, incremental: bool, idx: int, total: int) -> int:
    """Run one feature module, write parquet, return row count."""
    mod = MODULES[name]
    t0 = time.perf_counter()
    df: pl.DataFrame = mod.compute(incremental=incremental)
    rows = write_feature(name, df)
    elapsed = time.perf_counter() - t0
    log.info("[%d/%d] %-26s %8d rows  %.1fs", idx, total, name, rows, elapsed)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="MarketDNA Feature Engine")
    parser.add_argument("--incremental", action="store_true",
                        help="Only compute rows after the current max date in each feature")
    parser.add_argument("--only", type=str, default=None,
                        help="Run a single named feature (e.g. sma_regime)")
    args = parser.parse_args()

    t_start = time.perf_counter()

    if args.only:
        if args.only not in MODULES:
            log.error("Unknown feature: %s. Valid names: %s", args.only, list(MODULES))
            sys.exit(1)
        log.info("Running single feature: %s (incremental=%s)", args.only, args.incremental)
        _run_one(args.only, args.incremental, 1, 1)
    else:
        mode = "incremental" if args.incremental else "cold (full history)"
        log.info("Feature engine starting — mode: %s", mode)
        log.info("=" * 60)

        total = len(ALL_FEATURES)
        idx = 0
        for tier_num, tier in enumerate(TIERS, 1):
            log.info("--- Tier %d ---", tier_num)
            for name in tier:
                idx += 1
                _run_one(name, args.incremental, idx, total)

        elapsed = time.perf_counter() - t_start
        log.info("=" * 60)
        log.info("Total elapsed: %.1fs", elapsed)

    log.info("Registering DuckDB feature views...")
    con = get_connection()
    register_feature_views(con)
    log.info("Done.")


if __name__ == "__main__":
    main()
