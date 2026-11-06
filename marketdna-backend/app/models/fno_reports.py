"""Pydantic models for the Clusters page: PCA+K-Means snapshot + on-demand
PDF report generation job status."""
from typing import List, Optional
from pydantic import BaseModel


class ClusterSymbolEntry(BaseModel):
    symbol: str
    cluster: str
    pc1: float
    pc2: float
    ret_1d: float
    ret_5d: float
    ret_1m: float
    ret_3m: float
    ret_1y: float


class ClusterGroup(BaseModel):
    cluster: str
    n: int
    character: str
    mean_1d: float
    mean_5d: float
    mean_1m: float
    mean_3m: float
    mean_1y: float
    symbols: List[str]  # member symbols, sorted desc by 1Y return


class ClusterSnapshotResponse(BaseModel):
    as_of_date: str
    k: int
    silhouette: float
    groups: List[ClusterGroup]
    items: List[ClusterSymbolEntry]
    excluded: int


class ReportJobStatus(BaseModel):
    job: str                      # "returns" | "cluster"
    state: str                    # "idle" | "running" | "done" | "error"
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    pdf_filename: Optional[str] = None
    error: Optional[str] = None
