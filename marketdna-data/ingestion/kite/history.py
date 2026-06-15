from ingestion.kite.client import get_kite


def download_history(instrument_token: int, start_date: str, end_date: str) -> list[dict]:
    """Fetch daily OHLCV candles from Kite for a single instrument and date range.

    Kite enforces a hard limit of 2000 calendar days per request. Use the
    date_chunks helper in download_all_nse to split longer ranges.
    """
    return get_kite().historical_data(instrument_token, start_date, end_date, interval='day')
