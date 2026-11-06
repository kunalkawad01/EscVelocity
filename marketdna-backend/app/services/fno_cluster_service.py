"""F&O universe return-profile clustering: PCA + K-Means over gap-inclusive
close-to-close returns across five timeframes (1D/5D/1M/3M/1Y).

Single source of truth for this analysis — both the CLI report generator
(scripts/generate_fno_cluster_report.py) and the /api/fno-reports/cluster-snapshot
endpoint (powers the /clusters page's live chart grouping) import from here, so
the PDF and the live page can never drift apart.

Pure DuckDB-over-parquet, no live/backend data needed. Cached per calendar date
(see CLAUDE.md Caching convention — in-process dict keyed by date string).
"""
import os
import string
import datetime as dt
import threading

import duckdb
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))        # app/services
APP_DIR = os.path.dirname(SERVICE_DIR)                          # app
BACKEND_DIR = os.path.dirname(APP_DIR)                          # marketdna-backend
REPO = os.path.dirname(BACKEND_DIR)                              # EscVel
FO_CSV = os.path.join(REPO, "marketdna-data", "FO.csv")
EQUITIES_GLOB = os.path.join(
    REPO, "marketdna-data", "data_lake", "raw", "equities", "**", "*.parquet"
).replace("\\", "/")

TIMEFRAMES = [("1D", 1), ("5D", 5), ("1M", 20), ("3M", 60), ("1Y", 252)]
FEATURE_COLS = [tf for tf, _ in TIMEFRAMES]
K_RANGE = range(3, 8)
RANDOM_STATE = 42

_cache: dict[str, dict] = {}
_lock = threading.Lock()


# ---------------------------------------------------------------- symbols --

def load_symbols() -> list[str]:
    df = pd.read_csv(FO_CSV)
    col = "Ticker" if "Ticker" in df.columns else df.columns[-1]
    return sorted(df[col].dropna().astype(str).str.strip().unique().tolist())


def load_prices(symbols: list[str]) -> pd.DataFrame:
    con = duckdb.connect(":memory:")
    con.execute(
        f"CREATE VIEW equities_prices AS "
        f"SELECT * FROM read_parquet('{EQUITIES_GLOB}', hive_partitioning=1)"
    )
    placeholders = ",".join(f"'{s}'" for s in symbols)
    q = f"""
        SELECT symbol,
               STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
               close
        FROM equities_prices
        WHERE symbol IN ({placeholders})
          AND CAST(date AS DATE) >= CURRENT_DATE - INTERVAL 620 DAY
        ORDER BY symbol, date
    """
    df = con.execute(q).fetchdf()
    con.close()
    return df


def pct_return(closes: np.ndarray, n: int):
    if len(closes) > n:
        base = closes[-1 - n]
        if base and base != 0:
            return float(closes[-1] / base - 1.0) * 100.0
    return None


def build_feature_table(prices: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for symbol, g in prices.groupby("symbol", sort=False):
        closes = g["close"].to_numpy()
        as_of = g["date"].iloc[-1] if len(g) else None
        feats = {tf: pct_return(closes, n) for tf, n in TIMEFRAMES}
        if any(v is None for v in feats.values()):
            continue
        feats["symbol"] = symbol
        feats["as_of_date"] = as_of
        rows.append(feats)
    return pd.DataFrame(rows)


# --------------------------------------------------------------- analysis --

def choose_k(X: np.ndarray):
    scores = []
    for k in K_RANGE:
        km = KMeans(n_clusters=k, random_state=RANDOM_STATE, n_init=10)
        labels = km.fit_predict(X)
        scores.append({"k": k, "inertia": km.inertia_, "silhouette": silhouette_score(X, labels)})
    best = max(scores, key=lambda r: r["silhouette"])
    return best["k"], pd.DataFrame(scores)


def run_analysis(feat: pd.DataFrame):
    """Standardize -> PCA (viz/loadings) + K-Means (grouping, full feature space).
    Returns (feat_with_cluster_cols, pca, best_k, silhouette, diagnostics_df, scaler)."""
    X_raw = feat[FEATURE_COLS].to_numpy()
    scaler = StandardScaler()
    X = scaler.fit_transform(X_raw)

    pca = PCA(n_components=min(5, len(FEATURE_COLS)), random_state=RANDOM_STATE)
    pcs = pca.fit_transform(X)

    best_k, diag = choose_k(X)
    km = KMeans(n_clusters=best_k, random_state=RANDOM_STATE, n_init=10)
    raw_labels = km.fit_predict(X)
    sil = silhouette_score(X, raw_labels)

    feat = feat.copy()
    feat["PC1"] = pcs[:, 0]
    feat["PC2"] = pcs[:, 1]
    feat["raw_cluster"] = raw_labels

    # relabel clusters A, B, C... by descending mean 1Y return
    order = feat.groupby("raw_cluster")["1Y"].mean().sort_values(ascending=False).index.tolist()
    relabel = {raw: string.ascii_uppercase[i] for i, raw in enumerate(order)}
    feat["cluster"] = feat["raw_cluster"].map(relabel)

    return feat, pca, best_k, sil, diag, scaler


def characterize(row: dict) -> str:
    vals = {tf: row[tf] for tf in FEATURE_COLS}
    short_term = (vals["1D"] + vals["5D"]) / 2
    long_term = (vals["3M"] + vals["1Y"]) / 2
    if long_term > 10 and short_term > 0:
        return "Broad-based uptrend, momentum intact"
    if long_term > 10 and short_term < 0:
        return "Strong 1Y uptrend, short-term pullback"
    if long_term < -10 and short_term < 0:
        return "Broad-based downtrend, momentum intact"
    if long_term < -10 and short_term > 0:
        return "Weak 1Y trend, short-term bounce"
    if abs(long_term) <= 10 and short_term > 2:
        return "Range-bound, sharp near-term pop"
    if abs(long_term) <= 10 and short_term < -2:
        return "Range-bound, sharp near-term drop"
    return "Range-bound / no strong directional bias"


# -------------------------------------------------------------- snapshot --

def _compute_snapshot() -> dict:
    symbols = load_symbols()
    prices = load_prices(symbols)
    feat = build_feature_table(prices)
    excluded = len(symbols) - len(feat)
    as_of = feat["as_of_date"].max() if len(feat) else dt.date.today().isoformat()

    feat, pca, best_k, sil, diag, scaler = run_analysis(feat)

    groups = []
    for c in sorted(feat["cluster"].unique()):
        sub = feat[feat["cluster"] == c].sort_values("1Y", ascending=False)
        means = sub[FEATURE_COLS].mean()
        groups.append({
            "cluster": c,
            "n": int(len(sub)),
            "character": characterize(means.to_dict()),
            "mean_1d": float(means["1D"]), "mean_5d": float(means["5D"]),
            "mean_1m": float(means["1M"]), "mean_3m": float(means["3M"]),
            "mean_1y": float(means["1Y"]),
            "symbols": sub["symbol"].tolist(),
        })

    items = [
        {
            "symbol": r["symbol"], "cluster": r["cluster"],
            "pc1": float(r["PC1"]), "pc2": float(r["PC2"]),
            "ret_1d": float(r["1D"]), "ret_5d": float(r["5D"]),
            "ret_1m": float(r["1M"]), "ret_3m": float(r["3M"]), "ret_1y": float(r["1Y"]),
        }
        for _, r in feat.iterrows()
    ]

    return {
        "as_of_date": as_of,
        "k": int(best_k),
        "silhouette": float(sil),
        "groups": groups,
        "items": items,
        "excluded": int(excluded),
    }


def get_cluster_snapshot(force: bool = False) -> dict:
    today = dt.date.today().isoformat()
    with _lock:
        if not force and today in _cache:
            return _cache[today]
    result = _compute_snapshot()
    with _lock:
        _cache[today] = result
    return result


def invalidate():
    with _lock:
        _cache.clear()
