"""Atomic feature parquet writer with ZSTD compression."""
import logging
from pathlib import Path

import polars as pl

FEATURES_DIR = Path("data_lake/features")
log = logging.getLogger(__name__)


def write_feature(name: str, df: pl.DataFrame) -> int:
    """Write df to data_lake/features/{name}.parquet with ZSTD-3 compression.

    Returns row count written.
    """
    FEATURES_DIR.mkdir(parents=True, exist_ok=True)
    path = FEATURES_DIR / f"{name}.parquet"
    df.write_parquet(path, compression="zstd", compression_level=3)
    log.info("wrote %s: %d rows -> %s", name, len(df), path)
    return len(df)
