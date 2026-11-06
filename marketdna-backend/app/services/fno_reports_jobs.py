"""Background job runner for on-demand F&O PDF report generation.

Powers the two buttons on the /clusters frontend page so the user never has
to remember the CLI commands. Launches the existing report scripts
(scripts/generate_fno_pdf_report.py, scripts/generate_fno_cluster_report.py)
as subprocesses under the same venv interpreter the backend itself runs
under (sys.executable) — report-generation logic stays in one place (the
scripts / fno_cluster_service) instead of being duplicated here.

Status is an in-process dict, like every other day-cache in this codebase —
good enough since this only tracks "is a generation currently running," not
anything that needs to survive a server restart.
"""
import datetime as dt
import glob
import os
import subprocess
import sys
import threading

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SERVICE_DIR)
BACKEND_DIR = os.path.dirname(APP_DIR)
SCRIPTS_DIR = os.path.join(BACKEND_DIR, "scripts")
REPORTS_DIR = os.path.join(BACKEND_DIR, "reports")

_JOB_SCRIPT = {
    "returns": "generate_fno_pdf_report.py",
    "cluster": "generate_fno_cluster_report.py",
}
_JOB_GLOB = {
    "returns": "FNO_Returns_Report_*.pdf",
    "cluster": "FNO_Cluster_Analysis_*.pdf",
}
_TIMEOUT_SEC = 1200  # 20 min — the returns report fetches live intraday for ~630 candles

_status: dict[str, dict] = {
    job: {"state": "idle", "started_at": None, "finished_at": None, "pdf_filename": None, "error": None}
    for job in _JOB_SCRIPT
}
_lock = threading.Lock()


def get_status(job: str) -> dict:
    with _lock:
        return {"job": job, **_status[job]}


def _latest_pdf(pattern: str) -> str | None:
    files = glob.glob(os.path.join(REPORTS_DIR, pattern))
    if not files:
        return None
    return os.path.basename(max(files, key=os.path.getmtime))


def _build_args(job: str) -> list[str]:
    args = [sys.executable, os.path.join(SCRIPTS_DIR, _JOB_SCRIPT[job])]
    if job == "returns":
        # Auto-attach today's movers research file if a separate research pass
        # already produced one, exactly like a manual run would.
        today = dt.date.today().isoformat()
        movers_path = os.path.join(REPORTS_DIR, f"movers_findings_{today}.json")
        if os.path.exists(movers_path):
            args += ["--movers-json", movers_path]
    return args


def _run(job: str):
    pattern = _JOB_GLOB[job]
    try:
        proc = subprocess.run(
            _build_args(job), cwd=BACKEND_DIR, capture_output=True, text=True, timeout=_TIMEOUT_SEC,
        )
        with _lock:
            if proc.returncode == 0:
                _status[job].update(
                    state="done",
                    finished_at=dt.datetime.now().isoformat(timespec="seconds"),
                    pdf_filename=_latest_pdf(pattern),
                    error=None,
                )
            else:
                _status[job].update(
                    state="error",
                    finished_at=dt.datetime.now().isoformat(timespec="seconds"),
                    error=(proc.stderr or proc.stdout)[-2000:],
                )
    except Exception as e:
        with _lock:
            _status[job].update(
                state="error", finished_at=dt.datetime.now().isoformat(timespec="seconds"), error=str(e),
            )


def start_job(job: str) -> dict:
    with _lock:
        if _status[job]["state"] == "running":
            return {"job": job, **_status[job]}
        _status[job].update(
            state="running",
            started_at=dt.datetime.now().isoformat(timespec="seconds"),
            finished_at=None, pdf_filename=None, error=None,
        )
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return get_status(job)
