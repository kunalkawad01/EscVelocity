from functools import lru_cache
from kiteconnect import KiteConnect
from config.settings import settings


@lru_cache(maxsize=1)
def get_kite() -> KiteConnect:
    """Return a single shared KiteConnect instance for the process lifetime."""
    kite = KiteConnect(api_key=settings.kite_api_key)
    kite.set_access_token(settings.kite_access_token)
    return kite
