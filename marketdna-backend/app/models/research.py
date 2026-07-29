"""Pydantic models for the Research Copilot API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ResearchChatRequest(BaseModel):
    question: str
    universe: str = "nse500"


class ManifestStep(BaseModel):
    tool: str
    input: dict[str, Any]
    result_hash: str
    ms: int


class ResearchManifest(BaseModel):
    data_version: str
    methodology_version: str
    seed: int = 42
    reproducible: bool = True
    steps: list[ManifestStep] = []


class ResearchChatResponse(BaseModel):
    answer: str
    manifest: ResearchManifest
    artifacts: list[dict[str, Any]] = []  # raw tool results for the UI to render


class ScreenRequest(BaseModel):
    criteria: list[dict[str, Any]]
    universe: str = "nse500"
    as_of: str | None = None
    sort_by: str | None = None
    limit: int = 50
