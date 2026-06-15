from pydantic import BaseModel, model_validator
from dotenv import load_dotenv
import os

load_dotenv()


class Settings(BaseModel):
    kite_api_key: str
    kite_api_secret: str
    kite_access_token: str

    @model_validator(mode='before')
    @classmethod
    def require_all(cls, values: dict) -> dict:
        missing = [k for k, v in values.items() if not v]
        if missing:
            raise ValueError(f"Missing required env vars: {', '.join(missing)}")
        return values


settings = Settings(
    kite_api_key=os.getenv('KITE_API_KEY', ''),
    kite_api_secret=os.getenv('KITE_API_SECRET', ''),
    kite_access_token=os.getenv('KITE_ACCESS_TOKEN', ''),
)
