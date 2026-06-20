"""
DuckDB warehouse layer for marketdna.

Architecture
------------
Raw OHLCV data lives as Hive-partitioned parquet files:
    data_lake/raw/equities/symbol=RELIANCE/data.parquet
    data_lake/raw/equities/symbol=TCS/data.parquet
    ...

Feature parquets (flat, computed by feature_engine):
    data_lake/features/sma_regime.parquet
    data_lake/features/relative_strength.parquet
    ...

DuckDB reads these directly — no ETL, no data movement.

Usage
-----
    from warehouse.register_views import get_connection

    con = get_connection()
    df = con.execute("SELECT * FROM equities_prices WHERE symbol = 'RELIANCE'").pl()
    df = con.execute("SELECT * FROM regime_features WHERE symbol = 'RELIANCE'").pl()
"""

import duckdb
from functools import lru_cache
from pathlib import Path

DB_PATH        = Path("warehouse/marketdna.duckdb")
EQUITIES_GLOB  = "data_lake/raw/equities/**/*.parquet"
DELIVERY_GLOB  = "data_lake/raw/delivery/**/*.parquet"
OPTIONS_GLOB   = "data_lake/raw/options/date=*/data.parquet"
FUTURES_GLOB   = "data_lake/raw/futures/date=*/data.parquet"

# (view_name, parquet_file_stem)
FEATURE_VIEWS: list[tuple[str, str]] = [
    ("regime_features",      "sma_regime"),
    ("rs_features",          "relative_strength"),
    ("drawdown_features",    "drawdown_recovery"),
    ("breadth_features",     "breadth"),
    ("returns_vol_features", "returns_vol"),
    ("indicators_features",  "technical_indicators"),
    ("zscore_features",      "zscore"),
    ("returns_features",     "returns"),
    ("std_deviation_features", "std_deviation"),
    ("markov_regimes",       "markov_regimes"),
    ("markov_forecast",      "markov_forecast"),
    ("stock_dna",            "stock_dna"),
    ("market_dna",           "market_dna"),
]


@lru_cache(maxsize=1)
def get_connection() -> duckdb.DuckDBPyConnection:
    """Return the shared DuckDB connection with all views registered.

    Cached per process — safe to call from multiple analysis modules.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH))
    _register_views(con)
    register_feature_views(con)
    return con


def _register_views(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(f"""
        CREATE OR REPLACE VIEW equities_prices AS
        SELECT *
        FROM read_parquet(
            '{EQUITIES_GLOB}',
            hive_partitioning = true
        )
    """)
    options_dir = Path("data_lake/raw/options")
    if options_dir.exists() and any(options_dir.rglob("*.parquet")):
        con.execute(f"""
            CREATE OR REPLACE VIEW options_chain AS
            SELECT *
            FROM read_parquet('{OPTIONS_GLOB}', hive_partitioning = true)
        """)
    futures_dir = Path("data_lake/raw/futures")
    if futures_dir.exists() and any(futures_dir.rglob("*.parquet")):
        con.execute(f"""
            CREATE OR REPLACE VIEW futures_chain AS
            SELECT *
            FROM read_parquet('{FUTURES_GLOB}', hive_partitioning = true)
        """)
    delivery_dir = Path("data_lake/raw/delivery")
    if delivery_dir.exists() and any(delivery_dir.rglob("*.parquet")):
        con.execute(f"""
            CREATE OR REPLACE VIEW delivery_data AS
            SELECT *
            FROM read_parquet('{DELIVERY_GLOB}', hive_partitioning = true)
        """)


def register_feature_views(con: duckdb.DuckDBPyConnection) -> None:
    """Register a DuckDB view for each feature parquet that exists on disk."""
    features_dir = Path("data_lake/features")
    registered = 0
    for view_name, file_stem in FEATURE_VIEWS:
        path = features_dir / f"{file_stem}.parquet"
        if path.exists():
            posix = path.as_posix()
            con.execute(f"""
                CREATE OR REPLACE VIEW {view_name} AS
                SELECT * FROM read_parquet('{posix}')
            """)
            registered += 1
    if registered:
        import logging
        logging.getLogger(__name__).info(
            "register_feature_views: registered %d/%d feature views",
            registered, len(FEATURE_VIEWS),
        )


if __name__ == "__main__":
    con = get_connection()

    # Raw OHLCV summary
    summary = con.execute("""
        SELECT symbol, COUNT(*) AS rows,
               MIN(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS from_date,
               MAX(STRFTIME('%Y-%m-%d', CAST(date AS DATE))) AS to_date
        FROM equities_prices
        GROUP BY symbol
        ORDER BY symbol
    """).pl()
    print(summary)

    # Feature summary
    import logging
    logging.basicConfig(level=logging.INFO)
    features_dir = Path("data_lake/features")
    if features_dir.exists():
        print("\nFeature parquets:")
        for _, stem in FEATURE_VIEWS:
            p = features_dir / f"{stem}.parquet"
            if p.exists():
                size_kb = p.stat().st_size // 1024
                print(f"  {stem:30s}  {size_kb:>6} KB")
