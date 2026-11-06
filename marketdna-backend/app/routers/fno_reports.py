"""Routes for the /clusters frontend page: on-demand PDF generation (the two
buttons) + the live PCA/K-Means cluster snapshot that groups the chart grid."""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.models.fno_reports import ClusterSnapshotResponse, ReportJobStatus
from app.services import fno_cluster_service, fno_reports_jobs

router = APIRouter(prefix="/api/fno-reports", tags=["fno-reports"])

_VALID_JOBS = ("returns", "cluster")


def _check_job(job: str):
    if job not in _VALID_JOBS:
        raise HTTPException(status_code=404, detail=f"unknown job '{job}' — must be 'returns' or 'cluster'")


@router.get("/cluster-snapshot", response_model=ClusterSnapshotResponse)
def cluster_snapshot(force: bool = False):
    """PCA + K-Means over the F&O universe's 1D/5D/1M/3M/1Y return profile.
    Cached per calendar date — pass force=true to recompute (e.g. after fresh
    EOD ingestion)."""
    return fno_cluster_service.get_cluster_snapshot(force=force)


@router.post("/cluster-snapshot/invalidate")
def invalidate_cluster_snapshot():
    fno_cluster_service.invalidate()
    return {"status": "cluster snapshot invalidated"}


@router.post("/{job}/generate", response_model=ReportJobStatus)
def generate(job: str):
    """Kick off PDF generation in a background thread. No-op if already running."""
    _check_job(job)
    return fno_reports_jobs.start_job(job)


@router.get("/{job}/status", response_model=ReportJobStatus)
def status(job: str):
    _check_job(job)
    return fno_reports_jobs.get_status(job)


@router.get("/{job}/download")
def download(job: str):
    _check_job(job)
    st = fno_reports_jobs.get_status(job)
    filename = st.get("pdf_filename")
    if not filename:
        raise HTTPException(status_code=404, detail="no report generated yet this session — click Generate first")
    path = os.path.join(fno_reports_jobs.REPORTS_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="report file is missing on disk")
    return FileResponse(path, media_type="application/pdf", filename=filename)
