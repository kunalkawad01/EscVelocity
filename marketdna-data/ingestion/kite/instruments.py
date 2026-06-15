import polars as pl
from pathlib import Path
from ingestion.kite.client import get_kite

INSTRUMENTS_PATH = Path('data_lake/reference/instruments.parquet')


def download_instruments() -> pl.DataFrame:
    """Download the full NSE instruments list from Kite and cache it to parquet."""
    instruments = get_kite().instruments('NSE')
    df = pl.DataFrame(instruments)
    INSTRUMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(INSTRUMENTS_PATH)
    return df
