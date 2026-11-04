"""Pydantic models for the Postgres-backed personal Trading Rules page."""
from pydantic import BaseModel


class TradingRule(BaseModel):
    id: str
    text: str


class TradingRuleCategory(BaseModel):
    id: str
    title: str
    accent: str
    rules: list[TradingRule]


class TradingRulesDoc(BaseModel):
    categories: list[TradingRuleCategory]
    updated_at: str | None = None
