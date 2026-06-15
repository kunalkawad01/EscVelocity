import time
import logging
from datetime import date, timedelta
from pathlib import Path

from ingestion.kite.instruments import download_instruments
from ingestion.kite.history import download_history
from storage.parquet_writer import write_symbol_data

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

START_DATE = date(2020, 1, 1)
END_DATE = date.today()
RATE_LIMIT_SLEEP = 0.4  # stay under 3 req/s
MAX_DAYS = 1900          # Kite hard limit is 2000 calendar days per request

NIFTY50_SYMBOLS = {
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
    "BAJAJ-AUTO", "BAJAJFINSV", "BAJFINANCE", "BHARTIARTL", "BPCL",
    "BRITANNIA", "CIPLA", "COALINDIA", "DIVISLAB", "DRREDDY",
    "EICHERMOT", "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE",
    "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK",
    "INFY", "ITC", "JIOFIN", "JSWSTEEL", "KOTAKBANK",
    "LT", "LTIM", "M&M", "MARUTI", "NESTLEIND",
    "NTPC", "ONGC", "POWERGRID", "RELIANCE", "SBILIFE",
    "SBIN", "SHRIRAMFIN", "SUNPHARMA", "TATACONSUM", "TATAMOTORS",
    "TATASTEEL", "TCS", "TECHM", "TITAN", "WIPRO",
}


def already_downloaded(symbol: str) -> bool:
    return Path(f"data_lake/raw/equities/symbol={symbol}/data.parquet").exists()


def date_chunks(start: date, end: date, chunk_days: int):
    """Yield (start, end) pairs that fit within chunk_days."""
    cursor = start
    while cursor < end:
        chunk_end = min(cursor + timedelta(days=chunk_days), end)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def main():
    log.info("Fetching NSE instruments list...")
    instruments = download_instruments()

    equities = instruments.filter(
        (instruments["exchange"] == "NSE")
        & (instruments["segment"] == "NSE")
        & (instruments["instrument_type"] == "EQ")
        & (instruments["tradingsymbol"].is_in(NIFTY50_SYMBOLS))
    )
    log.info(f"Found {len(equities)} Nifty 50 instruments")

    rows = equities.select(["instrument_token", "tradingsymbol"]).to_dicts()
    total = len(rows)
    skipped = 0
    failed = []

    for i, row in enumerate(rows, 1):
        token = int(row["instrument_token"])
        symbol = row["tradingsymbol"]

        if already_downloaded(symbol):
            skipped += 1
            continue

        log.info(f"[{i}/{total}] Downloading {symbol} (token={token})")
        try:
            all_data = []
            for chunk_start, chunk_end in date_chunks(START_DATE, END_DATE, MAX_DAYS):
                chunk = download_history(token, str(chunk_start), str(chunk_end))
                all_data.extend(chunk)
                time.sleep(RATE_LIMIT_SLEEP)

            if all_data:
                write_symbol_data(symbol, all_data)
            else:
                log.warning(f"{symbol}: empty response, skipping")
        except Exception as e:
            log.error(f"{symbol}: {e}")
            failed.append(symbol)
            time.sleep(RATE_LIMIT_SLEEP)

    log.info(f"Done. Skipped (already exist): {skipped}. Failed: {len(failed)}")
    if failed:
        log.warning(f"Failed symbols: {', '.join(failed)}")


if __name__ == "__main__":
    main()
