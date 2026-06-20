import threading
import duckdb
from app.config import settings

_equities_glob = str(
    settings.data_path / "data_lake/raw/equities/**/*.parquet"
).replace("\\", "/")

_delivery_path = settings.data_path / "data_lake" / "raw" / "delivery"

# One shared base connection: VIEWs (and their Parquet metadata scan) are created
# once at import time. Per-thread cursors share this catalog so new threads don't
# need to re-scan the Parquet files on every cold start.
_base_con = duckdb.connect(":memory:")
_base_con.execute(f"""
    CREATE VIEW equities_prices AS
    SELECT * FROM read_parquet('{_equities_glob}', hive_partitioning = true)
""")
if _delivery_path.exists() and any(_delivery_path.rglob("*.parquet")):
    _delivery_glob = str(_delivery_path / "**" / "*.parquet").replace("\\", "/")
    _base_con.execute(f"""
        CREATE VIEW delivery_data AS
        SELECT * FROM read_parquet('{_delivery_glob}', hive_partitioning = true)
    """)

_options_glob = str(
    settings.data_path / "data_lake/raw/options/date=*/data.parquet"
).replace("\\", "/")

_options_dir = settings.data_path / "data_lake" / "raw" / "options"
if _options_dir.exists() and any(_options_dir.rglob("*.parquet")):
    _base_con.execute(f"""
        CREATE VIEW options_chain AS
        SELECT * FROM read_parquet('{_options_glob}', hive_partitioning = true)
    """)

_futures_glob = str(
    settings.data_path / "data_lake/raw/futures/date=*/data.parquet"
).replace("\\", "/")
_futures_dir = settings.data_path / "data_lake" / "raw" / "futures"
if _futures_dir.exists() and any(_futures_dir.rglob("*.parquet")):
    _base_con.execute(f"""
        CREATE VIEW futures_chain AS
        SELECT * FROM read_parquet('{_futures_glob}', hive_partitioning = true)
    """)

_returns_path = str(settings.data_path / "data_lake/features/returns.parquet").replace("\\", "/")
_std_path = str(settings.data_path / "data_lake/features/std_deviation.parquet").replace("\\", "/")

if (settings.data_path / "data_lake/features/returns.parquet").exists():
    _base_con.execute(f"CREATE VIEW returns_features AS SELECT * FROM read_parquet('{_returns_path}')")
if (settings.data_path / "data_lake/features/std_deviation.parquet").exists():
    _base_con.execute(f"CREATE VIEW std_deviation_features AS SELECT * FROM read_parquet('{_std_path}')")

_local = threading.local()


def ensure_fo_views() -> None:
    """Re-register options_chain / futures_chain if parquet now exists.

    Called by options_service so the views are available even when the backend
    started before the data was ingested (CREATE OR REPLACE is idempotent).
    """
    if _options_dir.exists() and any(_options_dir.rglob("*.parquet")):
        try:
            _base_con.execute(
                f"CREATE OR REPLACE VIEW options_chain AS "
                f"SELECT * FROM read_parquet('{_options_glob}', hive_partitioning = true)"
            )
        except Exception:
            pass
    if _futures_dir.exists() and any(_futures_dir.rglob("*.parquet")):
        try:
            _base_con.execute(
                f"CREATE OR REPLACE VIEW futures_chain AS "
                f"SELECT * FROM read_parquet('{_futures_glob}', hive_partitioning = true)"
            )
        except Exception:
            pass


def get_connection() -> duckdb.DuckDBPyConnection:
    """Per-thread cursor on the shared base connection.

    cursor() gives each thread its own transaction state while sharing the
    catalog (views, schema) of the parent — no per-thread Parquet re-scan.
    """
    if not hasattr(_local, "con"):
        _local.con = _base_con.cursor()
    return _local.con
