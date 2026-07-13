"""Shared test setup: load .env before any app import so Settings (Postgres creds,
API keys) match the running environment — mirrors app/main.py."""
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
