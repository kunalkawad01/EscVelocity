"""Research Copilot — Phase 3: sandboxed run_python escape hatch.

The release valve for open-ended analysis no pre-built tool covers. The LLM
writes a short snippet; it runs in a SEPARATE PROCESS with:
  - AST validation (no dunder access, no unsafe imports/calls)
  - restricted builtins + a whitelist-only __import__
  - read-only pre-loaded `df` (pandas) + `con` (read-only DuckDB over the lake)
  - wall-clock timeout + (POSIX) memory cap
  - typed `result` return, serialized to JSON
  - (code, data_version) replay cache → identical inputs, identical bytes

Config is passed to the child as a JSON file (NOT string-formatted into the
source), so the harness can contain arbitrary braces safely.

No FastAPI imports. See RESEARCH_COPILOT_SPEC.md §7.
"""
from __future__ import annotations

import ast
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

from app.config import settings
from app.services.research_tools import data_version, _cache, _cache_key, _hash_result

WALLCLOCK_SEC = 20
MEM_MB = 1024
MAX_RESULT_ROWS = 500

_ALLOWED_MODULES = {
    "pandas", "numpy", "vectorbt", "talib",
    "scipy", "math", "statistics", "datetime", "json", "itertools", "collections",
}

_FORBIDDEN_NODES = (
    ast.With, ast.AsyncWith, ast.AsyncFunctionDef, ast.Await,
    ast.Global, ast.Nonlocal,
)

_FORBIDDEN_CALLS = {
    "open", "eval", "exec", "compile", "input", "__import__",
    "globals", "locals", "vars", "getattr", "setattr", "delattr",
    "memoryview", "breakpoint", "help", "exit", "quit",
}

# Sentinel separating any incidental child stdout from our JSON payload.
_MARKER = "<<<SANDBOX_JSON>>>"


class SandboxError(Exception):
    pass


def _validate(code: str) -> None:
    """Static AST checks before the code ever runs (defense in depth)."""
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise SandboxError(f"SyntaxError: {exc}")
    for node in ast.walk(tree):
        if isinstance(node, _FORBIDDEN_NODES):
            raise SandboxError(f"Disallowed construct: {type(node).__name__}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise SandboxError(f"Disallowed dunder attribute: {node.attr}")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise SandboxError(f"Disallowed dunder name: {node.id}")
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] not in _ALLOWED_MODULES:
                    raise SandboxError(f"Import not allowed: {alias.name}")
        if isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root not in _ALLOWED_MODULES:
                raise SandboxError(f"Import not allowed: from {node.module}")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in _FORBIDDEN_CALLS:
                raise SandboxError(f"Disallowed call: {node.func.id}()")


# Static child harness (reads config JSON from argv[1]). No .format() — safe braces.
_CHILD = r'''
import sys, json

cfg = json.load(open(sys.argv[1]))
MEM_BYTES = cfg["mem_bytes"]; GLOB = cfg["glob"]; SYMBOLS = cfg["symbols"]
ALLOWED = set(cfg["allowed"]); MAX_ROWS = cfg["max_rows"]; MARKER = cfg["marker"]

try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (MEM_BYTES, MEM_BYTES))
except Exception:
    pass

import numpy as np
import pandas as pd
np.random.seed(42)
try:
    import scipy
except Exception:
    scipy = None

import duckdb
_raw = duckdb.connect(":memory:")
_raw.execute("CREATE VIEW equities_prices AS SELECT * FROM read_parquet('" + GLOB + "', hive_partitioning=true)")

class _ROCon:
    def __init__(self, c): self._c = c
    def execute(self, sql, params=None):
        low = sql.strip().lower()
        if not (low.startswith("select") or low.startswith("with")):
            raise RuntimeError("con is read-only: only SELECT/WITH allowed")
        return self._c.execute(sql, params or [])
con = _ROCon(_raw)

df = None
if SYMBOLS:
    ph = ",".join(["?"] * len(SYMBOLS))
    df = con.execute(
        "SELECT symbol, CAST(date AS DATE) AS date, open, high, low, close, volume "
        "FROM equities_prices WHERE symbol IN (" + ph + ") ORDER BY symbol, date", SYMBOLS
    ).fetchdf()

def _safe_import(name, g=None, l=None, fromlist=(), level=0):
    if name.split(".")[0] not in ALLOWED:
        raise ImportError("import of " + repr(name) + " is not allowed in the sandbox")
    return __import__(name, g, l, fromlist, level)

_SAFE_BUILTINS = {
    "abs": abs, "min": min, "max": max, "sum": sum, "len": len, "range": range,
    "round": round, "sorted": sorted, "enumerate": enumerate, "zip": zip, "map": map,
    "filter": filter, "list": list, "dict": dict, "set": set, "tuple": tuple,
    "float": float, "int": int, "str": str, "bool": bool, "print": print,
    "isinstance": isinstance, "all": all, "any": any, "reversed": reversed,
    "divmod": divmod, "pow": pow, "type": type, "repr": repr, "format": format,
    "True": True, "False": False, "None": None, "__import__": _safe_import,
}

g = {"__builtins__": _SAFE_BUILTINS, "np": np, "pd": pd, "scipy": scipy,
     "df": df, "con": con, "result": None}
try:
    import talib; g["talib"] = talib
except Exception:
    pass
try:
    import vectorbt as vbt; g["vbt"] = vbt
except Exception:
    pass

def _ser(v):
    if isinstance(v, pd.DataFrame):
        v2 = v.head(MAX_ROWS)
        return {"type": "dataframe", "columns": [str(c) for c in v2.columns],
                "rows": json.loads(v2.to_json(orient="records", date_format="iso")),
                "shape": [int(v.shape[0]), int(v.shape[1])]}
    if isinstance(v, pd.Series):
        return {"type": "series", "values": json.loads(v.head(MAX_ROWS).to_json(date_format="iso"))}
    if isinstance(v, np.ndarray):
        return {"type": "array", "values": v[:MAX_ROWS].tolist()}
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return float(v)
    return v

user_code = open(cfg["code_path"]).read()
try:
    exec(compile(user_code, "<sandbox>", "exec"), g)
    out = {"ok": True, "result": _ser(g.get("result"))}
except Exception as exc:
    out = {"ok": False, "error": type(exc).__name__ + ": " + str(exc)}

sys.stdout.write(MARKER + json.dumps(out, default=str))
'''


def _equities_glob() -> str:
    return str(settings.data_path / "data_lake/raw/equities/**/*.parquet").replace("\\", "/")


def run_python(code: str, frames: Optional[list[str]] = None,
               symbols: Optional[list[str]] = None) -> dict[str, Any]:
    """Execute whitelisted Python against read-only data in an isolated process."""
    syms = symbols or frames or []
    key = _cache_key("run_python", {"code": code, "symbols": syms})
    if key in _cache:
        return _cache[key]

    try:
        _validate(code)
    except SandboxError as exc:
        return {"ok": False, "error": str(exc), "blocked": True}

    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        code_path = tdp / "user_code.py"
        code_path.write_text(code, encoding="utf-8")
        child_path = tdp / "child.py"
        child_path.write_text(_CHILD, encoding="utf-8")
        cfg_path = tdp / "cfg.json"
        cfg_path.write_text(json.dumps({
            "mem_bytes": MEM_MB * 1024 * 1024,
            "glob": _equities_glob(),
            "symbols": syms,
            "allowed": sorted(_ALLOWED_MODULES),
            "max_rows": MAX_RESULT_ROWS,
            "marker": _MARKER,
            "code_path": str(code_path),
        }), encoding="utf-8")

        try:
            proc = subprocess.run(
                [sys.executable, str(child_path), str(cfg_path)],
                capture_output=True, text=True, timeout=WALLCLOCK_SEC,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"Timed out after {WALLCLOCK_SEC}s"}

        if _MARKER not in proc.stdout:
            err = (proc.stderr or "").strip()[-400:]
            return {"ok": False, "error": f"Sandbox produced no result. {err}"}
        payload = proc.stdout.split(_MARKER, 1)[1]
        try:
            parsed = json.loads(payload)
        except Exception as exc:
            return {"ok": False, "error": f"Bad sandbox output: {exc}"}

    parsed["data_version"] = data_version()
    parsed["result_hash"] = _hash_result(parsed.get("result"))
    parsed["reproducible"] = True
    _cache[key] = parsed
    return parsed
