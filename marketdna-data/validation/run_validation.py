"""Phase 3 Validation Framework — Orchestrator.

Runs all validators in parallel where possible, then prints a consolidated
report and writes JSON to data_lake/derived/validation_report.json.

Usage:
    .venv\\Scripts\\python.exe -m validation.run_validation
    .venv\\Scripts\\python.exe -m validation.run_validation --skip-vbt
    .venv\\Scripts\\python.exe -m validation.run_validation --only quality
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

DERIVED_DIR = Path("data_lake/derived")


def _as_serializable(obj) -> object:
    """Recursively convert NamedTuples, sets, nans to JSON-safe types."""
    import math
    if hasattr(obj, "_asdict"):
        return _as_serializable(obj._asdict())
    if isinstance(obj, dict):
        return {k: _as_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_as_serializable(v) for v in obj]
    if isinstance(obj, set):
        return list(obj)
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


def main() -> None:
    parser = argparse.ArgumentParser(description="MarketDNA Phase 3 Validation")
    parser.add_argument("--skip-vbt", action="store_true", help="Skip VectorBT backtest")
    parser.add_argument("--only", choices=["quality", "ic", "stability", "oos", "markov", "vbt"],
                        default=None, help="Run only one validator")
    args = parser.parse_args()

    t_start = time.perf_counter()
    report: dict = {"sections": {}}

    # ── Step 1: feature quality (fully parallel, no data load needed) ─────────────
    if args.only in (None, "quality"):
        log.info("=" * 60)
        log.info("PHASE 3.1  Feature Quality Checks")
        log.info("=" * 60)
        from validation.validators.feature_quality import run_all as quality_run
        quality_results = quality_run()
        report["sections"]["feature_quality"] = _as_serializable(quality_results)

        passed = sum(r["passed"] for r in quality_results)
        total  = len(quality_results)
        log.info("Quality: %d/%d passed", passed, total)

    if args.only is not None and args.only != "quality":
        pass  # skip quality if running only something else, unless only="quality"

    # ── Step 2: Load joined dataset (needed by IC, stability, OOS) ───────────────
    df_joined = None
    needs_joined = args.only in (None, "ic", "stability", "oos")
    if needs_joined:
        log.info("=" * 60)
        log.info("PHASE 3.2  Loading joined dataset for IC / stability / OOS...")
        log.info("=" * 60)
        from validation.validators.forward_returns import _load_base
        t0 = time.perf_counter()
        df_joined = _load_base()
        log.info("Joined dataset: %d rows in %.1fs", len(df_joined), time.perf_counter() - t0)

    # ── Step 3: IC, stability, OOS in parallel ────────────────────────────────────
    ic_future = stab_future = oos_future = None

    with ThreadPoolExecutor(max_workers=3) as pool:
        if args.only in (None, "ic") and df_joined is not None:
            log.info("=" * 60)
            log.info("PHASE 3.3  Forward Return IC + Decile Analysis")
            log.info("=" * 60)
            from validation.validators.forward_returns import run_all as ic_run
            ic_future = pool.submit(ic_run)

        if args.only in (None, "stability") and df_joined is not None:
            log.info("=" * 60)
            log.info("PHASE 3.4  Rolling IC Stability")
            log.info("=" * 60)
            from validation.validators.stability import run_all as stab_run
            stab_future = pool.submit(stab_run, df_joined)

        if args.only in (None, "oos") and df_joined is not None:
            log.info("=" * 60)
            log.info("PHASE 3.5  Out-of-Sample Validation (IS: 2020-2023, OOS: 2024+)")
            log.info("=" * 60)
            from validation.validators.out_of_sample import run_all as oos_run
            oos_future = pool.submit(oos_run, df_joined)

        # Collect futures
        if ic_future:
            ic_results = ic_future.result()
            report["sections"]["forward_ic"] = _as_serializable(ic_results)

        if stab_future:
            stab_results = stab_future.result()
            report["sections"]["stability"] = _as_serializable(stab_results)

        if oos_future:
            oos_results = oos_future.result()
            report["sections"]["out_of_sample"] = _as_serializable(oos_results)

    # ── Step 4: Markov validation (independent) ───────────────────────────────────
    if args.only in (None, "markov"):
        log.info("=" * 60)
        log.info("PHASE 3.6  Markov Regime Validation")
        log.info("=" * 60)
        from validation.validators.markov_validator import run as markov_run
        markov_result = markov_run()
        report["sections"]["markov"] = _as_serializable(markov_result)

    # ── Step 5: VectorBT backtest ─────────────────────────────────────────────────
    if not args.skip_vbt and args.only in (None, "vbt"):
        log.info("=" * 60)
        log.info("PHASE 3.7  VectorBT L/S Backtest (stock_dna_score)")
        log.info("=" * 60)
        from validation.validators.vbt_backtest import run as vbt_run
        vbt_result = vbt_run()
        report["sections"]["vbt_backtest"] = _as_serializable(vbt_result)

    # ── Step 6: Save report ───────────────────────────────────────────────────────
    total_elapsed = time.perf_counter() - t_start
    report["meta"] = {
        "elapsed_s": round(total_elapsed, 1),
        "generated_at": __import__("datetime").date.today().isoformat(),
    }

    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    report_path = DERIVED_DIR / "validation_report.json"
    report_path.write_text(json.dumps(report, indent=2, default=str))

    # ── Step 7: Print summary ─────────────────────────────────────────────────────
    log.info("=" * 60)
    log.info("VALIDATION SUMMARY")
    log.info("=" * 60)

    # Feature quality summary
    if "feature_quality" in report["sections"]:
        results = report["sections"]["feature_quality"]
        passed = sum(r["passed"] for r in results)
        log.info("  Feature Quality:  %d/%d parquets PASS", passed, len(results))
        for r in results:
            status = "PASS" if r["passed"] else "FAIL"
            log.info("    %-28s %s  (%d rows)", r["feature"], status, r["rows"])

    # IC summary
    if "forward_ic" in report["sections"]:
        log.info("")
        log.info("  Forward Return IC (Spearman):")
        log.info("  %-22s  %6s  %6s  %6s  %6s", "Score", "IC_1d", "IC_5d", "IC_20d", "IC_63d")
        for sr in report["sections"]["forward_ic"]:
            ics = {h["horizon"]: h["ic"] for h in sr["horizons"]}
            log.info("  %-22s  %6.3f  %6.3f  %6.3f  %6.3f",
                     sr["score_col"],
                     ics.get("1d", float("nan")),
                     ics.get("5d", float("nan")),
                     ics.get("20d", float("nan")),
                     ics.get("63d", float("nan")))

    # OOS summary
    if "out_of_sample" in report["sections"]:
        log.info("")
        log.info("  OOS Validation (2024+ vs 2020-2023):")
        for r in report["sections"]["out_of_sample"]:
            status = "PASS" if r["passed"] else "WEAK"
            log.info("  %-22s fwd_%s  IS=%.3f  OOS=%.3f  %s",
                     r["score_col"], r["horizon"], r["is_ic"], r["oos_ic"], status)

    # VBT
    if "vbt_backtest" in report["sections"]:
        vbt = report["sections"]["vbt_backtest"]
        log.info("")
        log.info("  VectorBT L/S Backtest:")
        log.info("  Total return:  %.1f%%  (benchmark %.1f%%  alpha %.1f%%)",
                 vbt["total_return_pct"], vbt["benchmark_return_pct"], vbt["alpha_pct"])
        log.info("  Sharpe:        %.2f   MaxDD: %.1f%%   Calmar: %.2f   WinRate: %.0f%%",
                 vbt["sharpe_ratio"], vbt["max_drawdown_pct"],
                 vbt["calmar_ratio"], vbt["win_rate"] * 100)
        log.info("  Passed:        %s", "YES" if vbt["passed"] else "NO (Sharpe < 0.3)")

    log.info("")
    log.info("Report saved: %s", report_path)
    log.info("Total elapsed: %.1fs", total_elapsed)


if __name__ == "__main__":
    main()
