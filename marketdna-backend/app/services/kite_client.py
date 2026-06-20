import logging
from functools import lru_cache
from dotenv import dotenv_values
from kiteconnect import KiteConnect
from app.config import settings

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_kite() -> KiteConnect:
    """Single shared KiteConnect instance. Reads credentials from marketdna-data/.env."""
    env = dotenv_values(settings.data_path / ".env")
    api_key = env.get("KITE_API_KEY", "")
    access_token = env.get("KITE_ACCESS_TOKEN", "")
    if not api_key or not access_token:
        raise RuntimeError("KITE_API_KEY / KITE_ACCESS_TOKEN missing from marketdna-data/.env")
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    log.info("KiteConnect initialised")
    return kite
