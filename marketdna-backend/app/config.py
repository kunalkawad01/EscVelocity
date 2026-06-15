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

    model_config = {"env_prefix": "MARKETDNA_"}


settings = Settings()
