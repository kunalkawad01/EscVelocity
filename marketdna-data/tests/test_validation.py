import polars as pl
from validation.price_validator import validate_prices


def test_empty_df():
    assert len(validate_prices(pl.DataFrame())) > 0


def test_valid_ohlcv():
    df = pl.DataFrame({
        'date': ['2024-01-01'],
        'open': [100.0], 'high': [110.0], 'low': [95.0],
        'close': [105.0], 'volume': [1000],
    })
    assert validate_prices(df) == []


def test_high_less_than_low():
    df = pl.DataFrame({
        'date': ['2024-01-01'],
        'open': [100.0], 'high': [90.0], 'low': [95.0],
        'close': [105.0], 'volume': [1000],
    })
    errors = validate_prices(df)
    assert any('high < low' in e for e in errors)


def test_non_positive_close():
    df = pl.DataFrame({
        'date': ['2024-01-01'],
        'open': [0.0], 'high': [0.0], 'low': [0.0],
        'close': [0.0], 'volume': [0],
    })
    errors = validate_prices(df)
    assert any('Non-positive' in e for e in errors)
