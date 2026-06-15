import polars as pl
from pathlib import Path


def write_symbol_data(symbol: str, data: list[dict]) -> Path:
    """Persist OHLCV records for a symbol to the data lake.

    Writes to data_lake/raw/equities/symbol=<SYMBOL>/data.parquet.
    Records are sorted by date before writing. Overwrites any existing file
    for the symbol (full refresh semantics).
    """
    df = pl.DataFrame(data).sort('date')
    path = Path(f'data_lake/raw/equities/symbol={symbol}')
    path.mkdir(parents=True, exist_ok=True)
    file_path = path / 'data.parquet'
    df.write_parquet(file_path)
    return file_path
