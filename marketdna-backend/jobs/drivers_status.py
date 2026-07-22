"""Stock Drivers content status — validation, coverage, and staleness report.

Standalone batch tool (never runs inside the server). Run from marketdna-backend/:

    .\\.venv\\Scripts\\python.exe -m jobs.drivers_status

Reports:
  1. Validation — every content/drivers/*.yaml parsed against the Pydantic schema.
  2. Staleness — dossiers past their review_cadence (the authoring backlog).
  3. Coverage — dossiers present vs the F&O universe (marketdna-data/FO.csv).

Exit code 1 if any dossier fails validation (CI-friendly); 0 otherwise.
"""

from __future__ import annotations

import csv
import sys
from datetime import date
from pathlib import Path

import yaml

from app.models.drivers import StockDrivers

_BACKEND = Path(__file__).resolve().parents[1]
_CONTENT_DIR = _BACKEND / "content" / "drivers"
_FO_CSV = _BACKEND.parent / "marketdna-data" / "FO.csv"

_CADENCE_DAYS = {"monthly": 31, "quarterly": 92, "half_yearly": 183, "yearly": 366}


def _load_fo_universe() -> list[str]:
    """F&O symbols from FO.csv (column 'Ticker') — the coverage target."""
    if not _FO_CSV.exists():
        return []
    with _FO_CSV.open(newline="", encoding="utf-8-sig") as fh:
        return sorted({
            (row.get("Ticker") or row.get("ticker") or "").strip().upper()
            for row in csv.DictReader(fh)
            if (row.get("Ticker") or row.get("ticker") or "").strip()
        })


def main() -> int:
    files = sorted(_CONTENT_DIR.glob("*.yaml"))
    valid: dict[str, StockDrivers] = {}
    errors: list[str] = []

    for path in files:
        try:
            with path.open(encoding="utf-8") as fh:
                dossier = StockDrivers.model_validate(yaml.safe_load(fh))
            valid[dossier.symbol.upper()] = dossier
        except Exception as exc:
            errors.append(f"  FAIL {path.name}: {exc}")

    print(f"— Validation: {len(valid)} valid, {len(errors)} failed")
    for line in errors:
        print(line)

    today = date.today()
    stale = []
    for sym, d in sorted(valid.items()):
        age = (today - d.last_reviewed).days
        limit = _CADENCE_DAYS.get(d.review_cadence, 92)
        if age > limit:
            stale.append((sym, d.last_reviewed.isoformat(), age))
    print(f"\n— Staleness: {len(stale)} past review cadence")
    for sym, reviewed, age in stale:
        print(f"  STALE {sym}: reviewed {reviewed} ({age}d ago)")

    universe = _load_fo_universe()
    if universe:
        covered = [s for s in universe if s in valid]
        missing = [s for s in universe if s not in valid]
        extra = [s for s in valid if s not in universe]
        print(f"\n— Coverage: {len(covered)}/{len(universe)} F&O symbols "
              f"({len(covered) / len(universe) * 100:.0f}%)")
        if missing:
            print(f"  next up ({min(15, len(missing))} of {len(missing)} missing): "
                  + ", ".join(missing[:15]))
        if extra:
            print(f"  outside F&O universe: {', '.join(sorted(extra))}")
    else:
        print("\n— Coverage: FO.csv not found — skipped")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
