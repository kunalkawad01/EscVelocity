from datetime import date
from ingestion.kite.history import download_history
from storage.parquet_writer import write_symbol_data
RELIANCE_TOKEN=738561
path=write_symbol_data('RELIANCE',download_history(RELIANCE_TOKEN,'2020-01-01',str(date.today())))
print(path)
