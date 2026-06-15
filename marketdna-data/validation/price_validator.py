import polars as pl

REQUIRED_COLUMNS = {'date', 'open', 'high', 'low', 'close', 'volume'}


def validate_prices(df: pl.DataFrame) -> list[str]:
    """Run basic OHLCV sanity checks. Returns a list of error strings (empty = valid)."""
    errors: list[str] = []

    if df.is_empty():
        errors.append('Empty dataframe')
        return errors

    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        errors.append(f'Missing columns: {sorted(missing)}')
        return errors

    if any(df.null_count().row(0)):
        errors.append('Null values present')

    if (df['high'] < df['low']).any():
        errors.append('high < low in some rows')

    if (df['close'] <= 0).any():
        errors.append('Non-positive close prices')

    if (df['volume'] < 0).any():
        errors.append('Negative volume')

    return errors
