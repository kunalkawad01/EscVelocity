"""Pydantic models for the Live Agent API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class LiveChatRequest(BaseModel):
    question: str
    universe: str = "nifty50"


class LiveChatResponse(BaseModel):
    answer: str
    manifest: dict[str, Any]
    artifacts: list[dict[str, Any]] = []
