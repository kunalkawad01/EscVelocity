"""DuckDB / Feature Store EDA.

Prints a structured report covering:
  1. Raw OHLCV inventory (symbol count, date ranges, row counts, gap detection)
  2. Feature catalog (date range, how calculated, score distributions)
  3. Cross-feature Spearman correlation matrix
  4. Regime label distribution
  5. Symbols with data gaps > 5 trading days

Saves: data_lake/derived/eda_report.json
Usage:
    .venv\\Scripts\\python.exe -m eda.run_eda
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import polars as pl

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

FEATURES_DIR = Path("data_lake/features")
DERIVED_DIR  = Path("data_lake/derived")
RAW_GLOB     = "data_lake/raw/equities/**/*.parquet"

# ── Feature metadata: how each metric is calculated ──────────────────────────
FEATURE_META: dict[str, dict] = {
    "sma_regime": {
        "label": "SMA Regime Score",
        "score_cols": ["regime_score"],
        "date_col": "date",
        "key_cols": ["symbol", "date"],
        "formula": (
            "regime_score = price_score(0-40) + alignment_score(0-30) + slope_score(0-30). "
            "price_score: 10pts each for close > SMA20/50/100/200. "
            "alignment_score: 10pts each for SMA20>SMA50, SMA50>SMA100, SMA100>SMA200. "
            "slope_score: 10pts each for SMA20 rising over 5 bars, SMA50 over 10 bars, SMA200 over 20 bars."
        ),
        "warmup_bars": 200,
        "lookback": "200 trading days (SMA200)",
        "recompute": "incremental (daily)",
    },
    "drawdown_recovery": {
        "label": "Drawdown & Recovery Score",
        "score_cols": ["recovery_score", "drawdown_pct"],
        "date_col": "date",
        "key_cols": ["symbol", "date"],
        "formula": (
            "rolling_peak_2y = MAX(close) over trailing 503 bars (2 calendar years). "
            "drawdown_pct = (close - rolling_peak_2y) / rolling_peak_2y * 100 (always <= 0). "
            "recovery_score = GREATEST(0, 100 + drawdown_pct * 2). "
            "Anchors: 0% drawdown = 100, -25% = 50, -50% = 0 (floor)."
        ),
        "warmup_bars": 503,
        "lookback": "503 trading days (2-year rolling peak)",
        "recompute": "incremental (daily)",
    },
    "relative_strength": {
        "label": "Relative Strength Score",
        "score_cols": ["rs_score"],
        "date_col": "date",
        "key_cols": ["symbol", "date"],
        "formula": (
            "return_20d = (close - close[t-20]) / close[t-20] * 100. "
            "rs_rank = RANK() over all symbols on that date, ordered by return_20d DESC. "
            "rs_score = (1 - (rs_rank - 1) / (total_symbols - 1)) * 100. "
            "100 = top performer on that day, 0 = worst."
        ),
        "warmup_bars": 20,
        "lookback": "20 trading days (20d return window)",
        "recompute": "incremental (daily)",
    },
    "returns_vol": {
        "label": "Multi-Horizon Returns + Volatility",
        "score_cols": [],
        "date_col": "date",
        "key_cols": ["symbol", "date"],
        "formula": (
            "return_Nd = (close - close[t-N]) / close[t-N] * 100 for N=1,5,20,63,252. "
            "vol_21d = STDDEV(return_1d) over 21 days * SQRT(252) * 100 (annualised %). "
            "atr_14 = Wilder 14-period smoothed True Range (HL + gap). "
            "atr_pct = atr_14 / close * 100."
        ),
        "warmup_bars": 252,
        "lookback": "252 trading days (1-year return)",
        "recompute": "incremental (daily)",
    },
    "technical_indicators": {
        "label": "Technical Indicators",
        "score_cols": ["rsi_14"],
        "date_col": "date",
        "key_cols": ["symbol", "date"],
        "formula": (
            "RSI(14): Wilder smoothed avg gain / avg loss, 0-100. "
            "EMA(20/50): exponential moving average with SMA seed. "
            "MACD(12,26,9): EMA12 - EMA26; signal = EMA9(MACD). "
            "Bollinger(20,2): SMA20 +/- 2*STDDEV; %B = (close-lower)/(upper-lower). "
            "Stochastic(14,3,3): %K = (close - 14d_low)/(14d_high - 14d_low); %D = SMA3(%K). "
            "ADX(14): Wilder smoothed DX; +DI/-DI directional indicators. "
            "OBV: cumulative volume signed by daily return direction."
        ),
        "warmup_bars": 50,
        "lookback": "50 trading days (EMA50 seed)",
        "recompute": "incremental (daily)",
    },
    "zscore": {
        "label": "252d Z-Score + Absolute Momentum",
        "score_cols": [],
        "date_col": "date",
        "key_cols": ["symbol", "date"],
        "formula": (
            "mean_252d = AVG(close) over trailing 252 bars. "
            "std_252d = STDDEV_SAMP(close) over trailing 252 bars. "
            "zscore_252d = (close - mean_252d) / std_252d. "
            "abs_mom_252d = (close - close[t-252]) / close[t-252] * 100 (1-year return %)."
        ),
        "warmup_bars": 252,
        "lookback": "252 trading days (1-year window)",
        "recompute": "incremental (daily)",
    },
    "breadth": {
        "label": "Market Breadth Score",
        "score_cols": ["breadth_score", "nifty50_breadth_score"],
        "date_col": "date",
        "key_cols": ["date"],
        "formula": (
            "Reads SMA values from sma_regime.parquet (no recomputation). "
            "NSE500 breadth_score = pct_above_sma20*0.30 + pct_above_sma50*0.40 + pct_above_sma200*0.30. "
            "nifty50_breadth_score: same formula restricted to 50 NIFTY50 symbols. "
            "Labels: >=70 Broad Participation, 50-69 Moderate, 30-49 Narrow, <30 Poor."
        ),
        "warmup_bars": 200,
        "lookback": "200 trading days (via sma_regime dependency)",
        "recompute": "incremental (daily)",
    },
    "markov_regimes": {
        "label": "Monthly 6-Regime Markov Classification",
        "score_cols": [],
        "date_col": "month",
        "key_cols": ["symbol", "month"],
        "formula": (
            "Monthly resampling: last trading day of each calendar month. "
            "ADX(14): Wilder smoothed directional index. "
            "RSI(14): Wilder smoothed relative strength index. "
            "SMA50: 50-day simple moving average. "
            "HV20: 20-day annualised log-return volatility * SQRT(252) * 100. "
            "hv_ratio = hv20 / median_hv (median across ALL months for that symbol). "
            "6 regimes via rule-based classifier: "
            "Bull signals = RSI>=55 + price>SMA50+1.5% + monthly_ret>1% (need 2-of-3). "
            "Bear signals = RSI<=45 + price<SMA50-1.5% + monthly_ret<-1% (need 2-of-3). "
            "High vol = hv_ratio >= 1.20. "
            "Regimes: Strong Uptrend, Volatile Bull, Sideways Quiet, Sideways Volatile, Steady Bear, Volatile Bear."
        ),
        "warmup_bars": 50,
        "lookback": "50 trading days minimum; full history for median_hv",
        "recompute": "full (monthly — median_hv shifts when new month added)",
    },
    "markov_forecast": {
        "label": "Per-Symbol Next-Regime Forecast + Options Strategy",
        "score_cols": ["dominant_prob"],
        "date_col": None,
        "key_cols": ["symbol"],
        "formula": (
            "Reads markov_regimes.parquet for each symbol's full regime history. "
            "Builds 6x6 transition count matrix from consecutive monthly regime pairs. "
            "Bayesian blend: blended = 0.80 * observed + 0.20 * prior. "
            "Prior = [0.20, 0.08, 0.25, 0.10, 0.25, 0.12] (NSE long-run base rates). "
            "next_probs = one_hot(current_regime) @ blended_matrix. "
            "dominant_regime = argmax(next_probs). "
            "tail_risk_regime = 2nd highest if prob >= 0.15. "
            "Strategy map: Strong Uptrend -> Bull Call Spread (Sell IV), etc."
        ),
        "warmup_bars": 6,
        "lookback": "Minimum 6 months of regime history per symbol",
        "recompute": "daily (snapshot of current state)",
    },
    "stock_dna": {
        "label": "Stock DNA Composite Score",
        "score_cols": ["stock_dna_score", "regime_score", "rs_score", "recovery_score", "efficiency_score"],
        "date_col": "date",
        "key_cols": ["symbol", "date"],
        "formula": (
            "JOIN of sma_regime + drawdown_recovery + relative_strength + returns_vol. "
            "efficiency_score = GREATEST(0, LEAST(100, 50 + (return_20d / vol_21d) * 10)). "
            "Centred at 50 (neutral Sharpe-like ratio, normalised to 0-100). "
            "stock_dna_score = regime_score*0.35 + rs_score*0.25 + recovery_score*0.20 "
            "+ drawdown_score*0.10 + efficiency_score*0.10. "
            "Labels: >=80 Tier 1, >=60 Tier 2, >=40 Tier 3, <40 Avoid."
        ),
        "warmup_bars": 503,
        "lookback": "503 trading days (via drawdown_recovery dependency)",
        "recompute": "full (joins 4 parquets; incremental possible but not yet implemented)",
    },
    "market_dna": {
        "label": "Market DNA Composite Score",
        "score_cols": ["market_dna_score", "breadth_score", "avg_regime_score",
                       "stress_score", "leadership_score"],
        "date_col": "date",
        "key_cols": ["date"],
        "formula": (
            "JOIN of stock_dna + breadth parquets — market-level aggregation. "
            "avg_regime_score = mean(regime_score) across all 500 symbols on that date. "
            "stress_score = GREATEST(0, 100 + mean(drawdown_pct) * 2). "
            "leadership_score = % symbols with rs_score > 60 AND regime_score > 60. "
            "market_dna_score = breadth_score*0.30 + avg_regime_score*0.30 "
            "+ leadership_score*0.25 + stress_score*0.15. "
            "Labels: >=70 Expansion, >=50 Recovery, >=30 Contraction, <30 Recession."
        ),
        "warmup_bars": 503,
        "lookback": "503 trading days (via stock_dna dependency)",
        "recompute": "full (daily)",
    },
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _percentiles(arr: np.ndarray, cols: str = "") -> dict:
    a = arr[~np.isnan(arr)]
    if len(a) == 0:
        return {}
    return {
        "min":    round(float(a.min()),  2),
        "p25":    round(float(np.percentile(a, 25)), 2),
        "median": round(float(np.median(a)),         2),
        "p75":    round(float(np.percentile(a, 75)), 2),
        "max":    round(float(a.max()),  2),
        "mean":   round(float(a.mean()), 2),
        "std":    round(float(a.std()),  2),
    }


def _print_sep(char: str = "-", n: int = 70) -> None:
    print(char * n)


def _print_section(title: str) -> None:
    _print_sep("=")
    print(f"  {title}")
    _print_sep("=")


# ── Section 1: Raw OHLCV inventory ────────────────────────────────────────────

def raw_inventory(con: duckdb.DuckDBPyConnection) -> dict:
    _print_section("1. RAW OHLCV INVENTORY")

    summary = con.execute("""
        SELECT
            COUNT(DISTINCT symbol) AS n_symbols,
            COUNT(*)               AS total_rows,
            MIN(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS earliest,
            MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS latest,
            ROUND(COUNT(*) / COUNT(DISTINCT symbol), 0)  AS avg_rows_per_symbol
        FROM equities_prices
    """).fetchone()

    n_sym, total, earliest, latest, avg_rows = summary
    print(f"  Symbols          : {n_sym}")
    print(f"  Total rows       : {total:,}")
    print(f"  Date range       : {earliest}  to  {latest}")
    print(f"  Avg rows/symbol  : {avg_rows:.0f}")

    # Per-symbol breakdown (min/max rows to spot coverage issues)
    per_sym = con.execute("""
        SELECT
            MIN(cnt) AS min_rows,
            ROUND(AVG(cnt), 0) AS avg_rows,
            MAX(cnt) AS max_rows,
            COUNT(*) AS n_symbols
        FROM (
            SELECT symbol, COUNT(*) AS cnt
            FROM equities_prices
            GROUP BY symbol
        )
    """).fetchone()
    print(f"  Rows per symbol  : min={per_sym[0]}  avg={per_sym[1]:.0f}  max={per_sym[2]}")

    # Gaps: symbols with fewer than 1500 rows (expect ~1601 trading days 2020-2026)
    gaps = con.execute("""
        SELECT symbol, COUNT(*) AS rows,
               MIN(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS from_date,
               MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS to_date
        FROM equities_prices
        GROUP BY symbol
        HAVING COUNT(*) < 1500
        ORDER BY COUNT(*) ASC
        LIMIT 20
    """).pl()

    print(f"\n  Symbols with < 1500 rows (potentially limited history): {len(gaps)}")
    if len(gaps) > 0:
        for row in gaps.to_dicts()[:10]:
            print(f"    {row['symbol']:20s}  {row['rows']:5d} rows  {row['from_date']} to {row['to_date']}")

    print()
    return {
        "n_symbols": n_sym,
        "total_rows": total,
        "earliest": earliest,
        "latest": latest,
        "avg_rows_per_symbol": avg_rows,
        "symbols_under_1500": len(gaps),
    }


# ── Section 2: Feature Catalog ────────────────────────────────────────────────

def feature_catalog() -> list[dict]:
    _print_section("2. FEATURE CATALOG")
    results = []

    for stem, meta in FEATURE_META.items():
        path = FEATURES_DIR / f"{stem}.parquet"
        if not path.exists():
            print(f"  {stem:30s}  MISSING")
            continue

        df = pl.read_parquet(path)
        size_kb = path.stat().st_size // 1024

        date_col = meta["date_col"]
        if date_col and date_col in df.columns:
            date_ser = df[date_col].cast(pl.Utf8)
            earliest = date_ser.min()
            latest   = date_ser.max()
        else:
            earliest = latest = "n/a"

        n_symbols = df["symbol"].n_unique() if "symbol" in df.columns else 1
        n_rows = len(df)

        # Score distributions
        dist: dict[str, dict] = {}
        for col in meta["score_cols"]:
            if col in df.columns:
                arr = df[col].to_numpy().astype(float)
                dist[col] = _percentiles(arr)

        print(f"\n  {'-'*66}")
        print(f"  {meta['label']}")
        print(f"  File       : {stem}.parquet   ({size_kb:,} KB)")
        print(f"  Rows       : {n_rows:,}   Symbols: {n_symbols}")
        print(f"  Date range : {earliest}  to  {latest}")
        print(f"  Lookback   : {meta['lookback']}")
        print(f"  Recompute  : {meta['recompute']}")
        print(f"  Formula    :")
        # Word-wrap formula at 60 chars
        words = meta["formula"].split(". ")
        for clause in words:
            print(f"    - {clause.strip('.')}")

        if dist:
            print(f"  Score distributions:")
            for col, stats in dist.items():
                print(f"    {col:25s}  min={stats['min']:6.1f}  p25={stats['p25']:5.1f}  "
                      f"median={stats['median']:5.1f}  p75={stats['p75']:5.1f}  "
                      f"max={stats['max']:6.1f}  mean={stats['mean']:5.1f}  std={stats['std']:4.1f}")

        results.append({
            "feature":    stem,
            "label":      meta["label"],
            "rows":       n_rows,
            "symbols":    n_symbols,
            "size_kb":    size_kb,
            "earliest":   earliest,
            "latest":     latest,
            "lookback":   meta["lookback"],
            "warmup_bars":meta["warmup_bars"],
            "recompute":  meta["recompute"],
            "formula":    meta["formula"],
            "score_distributions": dist,
        })

    print()
    return results


# ── Section 3: Cross-feature correlation matrix ───────────────────────────────

def correlation_matrix() -> dict:
    _print_section("3. CROSS-FEATURE SPEARMAN CORRELATION MATRIX")
    print("  (stock_dna score columns on a shared symbol×date basis)\n")

    path = FEATURES_DIR / "stock_dna.parquet"
    if not path.exists():
        print("  stock_dna.parquet not found — skipping")
        return {}

    df = pl.read_parquet(path).drop_nulls(
        subset=["regime_score", "rs_score", "recovery_score", "efficiency_score", "stock_dna_score"]
    )

    cols = ["regime_score", "rs_score", "recovery_score", "efficiency_score", "stock_dna_score"]
    short = ["regime", "rs", "recovery", "eff", "dna"]

    from scipy import stats
    n = len(cols)
    mat = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            r, _ = stats.spearmanr(df[cols[i]].to_numpy(), df[cols[j]].to_numpy())
            mat[i, j] = r

    # Print header
    hdr = "  " + " " * 12 + "  ".join(f"{s:>8}" for s in short)
    print(hdr)
    _print_sep(" ")
    for i, (col, s) in enumerate(zip(cols, short)):
        row = "  " + f"{s:<10}" + "  ".join(f"{mat[i,j]:8.3f}" for j in range(n))
        print(row)

    print()

    # Highlight high correlations (|r| > 0.6) excluding diagonal
    high = []
    for i in range(n):
        for j in range(i + 1, n):
            if abs(mat[i, j]) > 0.6:
                high.append((cols[i], cols[j], round(mat[i, j], 3)))

    if high:
        print("  High correlations (|r| > 0.6):")
        for a, b, r in high:
            print(f"    {a} <-> {b}  r={r}")
    else:
        print("  No pairs with |r| > 0.6")

    print()
    return {"columns": cols, "matrix": [[round(v, 4) for v in row] for row in mat.tolist()],
            "high_correlations": high}


# ── Section 4: Regime label distribution ─────────────────────────────────────

def regime_distribution() -> dict:
    _print_section("4. REGIME LABEL DISTRIBUTIONS")

    result: dict = {}

    # SMA regime labels
    path = FEATURES_DIR / "sma_regime.parquet"
    if path.exists():
        df = pl.read_parquet(path, columns=["regime_label"])
        vc = df["regime_label"].value_counts().sort("count", descending=True)
        total = len(df)
        print("  SMA Regime Labels (stock-days):")
        for row in vc.to_dicts():
            pct = row["count"] / total * 100
            print(f"    {row['regime_label']:20s}  {row['count']:8,}  ({pct:5.1f}%)")
        result["sma_regime"] = {r["regime_label"]: r["count"] for r in vc.to_dicts()}

    # Markov regime labels
    path = FEATURES_DIR / "markov_regimes.parquet"
    if path.exists():
        df = pl.read_parquet(path, columns=["regime"])
        vc = df["regime"].value_counts().sort("count", descending=True)
        total = len(df)
        print("\n  Markov Regime Labels (symbol-months):")
        for row in vc.to_dicts():
            pct = row["count"] / total * 100
            print(f"    {row['regime']:20s}  {row['count']:8,}  ({pct:5.1f}%)")
        result["markov_regimes"] = {r["regime"]: r["count"] for r in vc.to_dicts()}

    # Stock DNA labels
    path = FEATURES_DIR / "stock_dna.parquet"
    if path.exists():
        df = pl.read_parquet(path, columns=["stock_dna_label"])
        vc = df["stock_dna_label"].value_counts().sort("count", descending=True)
        total = len(df)
        print("\n  Stock DNA Labels (stock-days):")
        for row in vc.to_dicts():
            pct = row["count"] / total * 100
            print(f"    {row['stock_dna_label']:20s}  {row['count']:8,}  ({pct:5.1f}%)")
        result["stock_dna"] = {r["stock_dna_label"]: r["count"] for r in vc.to_dicts()}

    # Market DNA labels
    path = FEATURES_DIR / "market_dna.parquet"
    if path.exists():
        df = pl.read_parquet(path, columns=["market_dna_label"])
        vc = df["market_dna_label"].value_counts().sort("count", descending=True)
        total = len(df)
        print("\n  Market DNA Labels (market-days):")
        for row in vc.to_dicts():
            pct = row["count"] / total * 100
            print(f"    {row['market_dna_label']:20s}  {row['count']:8,}  ({pct:5.1f}%)")
        result["market_dna"] = {r["market_dna_label"]: r["count"] for r in vc.to_dicts()}

    print()
    return result


# ── Section 5: Data gaps ──────────────────────────────────────────────────────

def data_gaps(con: duckdb.DuckDBPyConnection) -> list[dict]:
    _print_section("5. SYMBOLS WITH SIGNIFICANT DATA GAPS (> 5 MISSING TRADING DAYS)")

    # All trading days in the full universe
    all_days = con.execute("""
        SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, COUNT(DISTINCT symbol) AS n
        FROM equities_prices
        GROUP BY d
        ORDER BY d
    """).pl()

    max_expected = int(all_days["n"].max())
    total_days   = len(all_days)
    print(f"  Total trading days in dataset : {total_days}")
    print(f"  Max symbols on any single day : {max_expected}")

    # Symbols whose row count is < (total_days - 5)
    threshold = total_days - 5
    gaps = con.execute(f"""
        SELECT symbol, COUNT(*) AS rows,
               {total_days} - COUNT(*) AS missing_days,
               MIN(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS from_date,
               MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS to_date
        FROM equities_prices
        GROUP BY symbol
        HAVING COUNT(*) < {threshold}
        ORDER BY COUNT(*) ASC
        LIMIT 30
    """).pl()

    print(f"  Symbols with > 5 missing days : {len(gaps)}")
    if len(gaps) > 0:
        print(f"\n  {'Symbol':20s}  {'Rows':>6}  {'Missing':>7}  {'From':>12}  {'To':>12}")
        _print_sep()
        for row in gaps.to_dicts():
            print(f"  {row['symbol']:20s}  {row['rows']:6d}  {row['missing_days']:7d}  "
                  f"{row['from_date']:>12}  {row['to_date']:>12}")

    print()
    return gaps.to_dicts()


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    t_start = time.perf_counter()

    from warehouse.register_views import get_connection
    con = get_connection()

    report: dict = {}

    report["raw_ohlcv"]         = raw_inventory(con)
    report["feature_catalog"]   = feature_catalog()
    report["correlation_matrix"]= correlation_matrix()
    report["regime_distribution"]= regime_distribution()
    report["data_gaps"]         = data_gaps(con)

    elapsed = time.perf_counter() - t_start

    _print_sep("=")
    print(f"  EDA complete in {elapsed:.1f}s")
    _print_sep("=")

    # Save JSON
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    out = DERIVED_DIR / "eda_report.json"
    out.write_text(json.dumps(report, indent=2, default=str))
    print(f"\n  Report saved: {out}\n")


if __name__ == "__main__":
    main()
