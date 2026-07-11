from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    data_path: Path = Path(__file__).parent.parent.parent / "marketdna-data"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
        "http://127.0.0.1:3000",
    ]
    redis_host: str = "localhost"
    redis_port: int = 6379

    # PostgreSQL (application layer — custom Quant Portfolios persistence).
    # Override via .env: MARKETDNA_PG_HOST / _PORT / _DB / _USER / _PASSWORD.
    pg_host: str = "localhost"
    pg_port: int = 5432
    pg_db: str = "marketdna"
    pg_user: str = "postgres"
    pg_password: str = "postgres"

    model_config = {"env_prefix": "MARKETDNA_"}


settings = Settings()
