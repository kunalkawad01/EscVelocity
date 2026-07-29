"""Research Copilot — Phase 5: Live Market Agent (read-only observer).

Deterministic detectors over the price data answer "what is changing that
matters?" The LLM narrates and hypothesizes on top — it never invents a signal.
Read-only: NO order placement anywhere in this module or its tools.

Data source is adaptive: during NSE market hours it overlays live Kite LTPs
(via live_trading_service) onto the EOD series; outside hours it falls back to
the DuckDB EOD lake. A state store diffs today's snapshot vs the last, so alerts
fire on meaningful CHANGE, not every bar. No FastAPI imports.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np

from app.config import settings
from app.services import research_tools as rt
from app.services.research_tools import (
    _load_universe_frames, _resolve_universe, _rsi, _sma, _atr,
    data_version, _cache, _cache_key,
)

_STATE_DIR = settings.data_path / "data_lake" / "derived" / "live_agent"
_STATE_FILE = _STATE_DIR / "state.json"
_EVENTS_FILE = _STATE_DIR / "events.jsonl"
TRADING_DAYS = 252


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _intraday_bucket() -> Optional[str]:
    """A per-minute cache token during market hours, else None.

    data_version() (COUNT+MAX date) is constant intraday, so caching by it alone
    would freeze the live snapshot for the whole session. Including this bucket in
    the cache key makes market_state/board recompute each minute with fresh Kite
    quotes, while still coalescing repeat requests within the same minute (protects
    the Kite rate limit). Outside market hours it returns None → normal daily cache.
    """
    try:
        from datetime import timedelta
        from app.services import live_trading_service as lts
        if lts._market_is_open():
            ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
            return ist.strftime("%Y-%m-%dT%H:%M")
    except Exception:
        pass
    return None


# ── Sector map (from sector_heatmap_service) ──────────────────────────────────

_sector_cache: dict[str, dict[str, dict[str, str]]] = {}


def _sector_map(universe: str) -> dict[str, dict[str, str]]:
    """symbol -> {sector, color}, sourced from the sector heatmap definitions."""
    if universe in _sector_cache:
        return _sector_cache[universe]
    out: dict[str, dict[str, str]] = {}
    try:
        from app.services.sector_heatmap_service import _build_sector_list
        layer = "nifty500" if universe == "nse500" else "nifty50"
        for sec in _build_sector_list(layer):
            for s in sec["stocks"]:
                out[s["symbol"]] = {"sector": sec["name"], "color": sec.get("color", "#888")}
    except Exception:
        pass
    _sector_cache[universe] = out
    return out


# ── Live quote overlay (from live_trading_service) ────────────────────────────

def _live_prices(symbols: list[str]) -> tuple[dict[str, float], str]:
    """Return (symbol->ltp, source). 'live' during market hours if Kite responds,
    else 'eod'. Never raises — any failure falls back to EOD."""
    try:
        from app.services import live_trading_service as lts
        if not lts._market_is_open():
            return {}, "eod"
        quotes = lts._quotes(symbols)
        prices = {s: float(q["ltp"]) for s, q in quotes.items()
                  if q.get("ltp")}
        return (prices, "live") if prices else ({}, "eod")
    except Exception:
        return {}, "eod"


def _append_live_bar(f: dict[str, np.ndarray], ltp: float) -> dict[str, np.ndarray]:
    """Append a synthetic current bar at the live price so all downstream
    detectors treat `ltp` as today's price (prior close = last EOD bar)."""
    return {
        "date": np.append(f["date"], "LIVE"),
        "open": np.append(f["open"], ltp),
        "high": np.append(f["high"], ltp),
        "low": np.append(f["low"], ltp),
        "close": np.append(f["close"], ltp),
        "volume": np.append(f["volume"], f["volume"][-1] if len(f["volume"]) else 0.0),
    }


# ── Per-symbol EOD/live metrics ───────────────────────────────────────────────

def _metrics(f: dict[str, np.ndarray]) -> Optional[dict[str, float]]:
    c, h, l, v = f["close"], f["high"], f["low"], f["volume"]
    if len(c) < 210:
        return None
    sma20 = _sma(c, 20)[-1]; sma50 = _sma(c, 50)[-1]; sma200 = _sma(c, 200)[-1]
    rsi = _rsi(c, 14)[-1]
    ret_1d = (c[-1] / c[-2] - 1.0) * 100
    ret_20d = (c[-1] / c[-21] - 1.0) * 100 if len(c) > 21 else np.nan
    avg_v = np.mean(v[-21:-1]) if len(v) > 21 else np.nan
    vol_ratio = v[-1] / avg_v if avg_v > 0 else np.nan
    hi_20 = np.max(h[-21:-1]) if len(h) > 21 else np.nan
    hi_252 = np.max(h[-252:]) if len(h) >= 252 else np.max(h)
    atr = _atr(h, l, c, 14)
    atrv = atr[~np.isnan(atr)]
    atr_pct = float((atrv[-252:] < atrv[-1]).mean() * 100) if len(atrv) >= 20 else np.nan
    return {
        "close": float(c[-1]), "ret_1d": float(ret_1d), "ret_20d": float(ret_20d),
        "rsi": float(rsi), "vol_ratio": float(vol_ratio) if vol_ratio == vol_ratio else 1.0,
        "above20": float(c[-1] > sma20), "above50": float(c[-1] > sma50),
        "above200": float(c[-1] > sma200),
        "breakout20": float(c[-1] >= hi_20 and (vol_ratio != vol_ratio or vol_ratio > 1.5)),
        "new_high": float(c[-1] >= hi_252 * 0.999),
        "atr_pct": float(atr_pct) if atr_pct == atr_pct else 0.0,
        "dist_52w_high": float((c[-1] / hi_252 - 1.0) * 100),
        "last_date": str(f["date"][-2]) if str(f["date"][-1]) == "LIVE" else str(f["date"][-1]),
    }


def _load_metrics(universe: str, live: bool = True) -> tuple[dict[str, dict[str, float]], str]:
    symbols = _resolve_universe(universe)
    frames = _load_universe_frames(symbols, 700, None)
    prices, source = ({}, "eod")
    if live:
        prices, source = _live_prices(list(frames.keys()))
    smap = _sector_map(universe)
    out: dict[str, dict[str, float]] = {}
    for sym, f in frames.items():
        if source == "live" and sym in prices:
            f = _append_live_bar(f, prices[sym])
        m = _metrics(f)
        if m:
            m["sector"] = smap.get(sym, {}).get("sector", "Other")
            m["sector_color"] = smap.get(sym, {}).get("color", "#888")
            out[sym] = m
    return out, source


# ── Sector aggregates ─────────────────────────────────────────────────────────

def _sector_aggregates(m: dict[str, dict[str, float]]) -> tuple[list[dict[str, Any]], dict[str, float]]:
    grp: dict[str, dict[str, Any]] = {}
    for sym, d in m.items():
        sec = d.get("sector", "Other")
        g = grp.setdefault(sec, {"rets": [], "color": d.get("sector_color", "#888")})
        if d["ret_20d"] == d["ret_20d"]:
            g["rets"].append(d["ret_20d"])
    sectors = [{"sector": s, "avg_ret_20d": round(float(np.mean(g["rets"])), 2),
                "count": len(g["rets"]), "color": g["color"]}
               for s, g in grp.items() if g["rets"]]
    sectors.sort(key=lambda x: x["avg_ret_20d"], reverse=True)
    n = len(sectors)
    strength = {sec["sector"]: (n - 1 - i) / (n - 1) * 100 if n > 1 else 50.0
                for i, sec in enumerate(sectors)}
    return sectors, strength


# ── TOOL: market_state ────────────────────────────────────────────────────────

def market_state(universe: str = "nifty50") -> dict[str, Any]:
    key = _cache_key("market_state", {"u": universe, "t": _intraday_bucket()})
    if key in _cache:
        return _cache[key]
    m, source = _load_metrics(universe)
    if not m:
        return {"error": "no data"}
    syms = list(m.keys())
    p20 = np.mean([m[s]["above20"] for s in syms]) * 100
    p50 = np.mean([m[s]["above50"] for s in syms]) * 100
    p200 = np.mean([m[s]["above200"] for s in syms]) * 100
    breadth = round(p20 * 0.30 + p50 * 0.40 + p200 * 0.30, 1)
    advancers = sum(1 for s in syms if m[s]["ret_1d"] > 0)
    new_highs = [s for s in syms if m[s]["new_high"] >= 1]
    breakouts = [s for s in syms if m[s]["breakout20"] >= 1]
    leaders = sorted(syms, key=lambda s: m[s]["ret_20d"], reverse=True)[:5]
    laggards = sorted(syms, key=lambda s: m[s]["ret_20d"])[:5]
    sectors, _ = _sector_aggregates(m)

    result = {
        "as_of": m[syms[0]]["last_date"], "source": source, "universe": universe,
        "breadth": breadth,
        "pct_above_sma20": round(p20, 1), "pct_above_sma50": round(p50, 1),
        "pct_above_sma200": round(p200, 1),
        "regime": _regime_label(breadth),
        "advancers": advancers, "decliners": len(syms) - advancers, "total": len(syms),
        "new_highs": new_highs, "new_high_count": len(new_highs),
        "breakouts": breakouts, "breakout_count": len(breakouts),
        "leaders": [{"symbol": s, "ret_20d": round(m[s]["ret_20d"], 2)} for s in leaders],
        "laggards": [{"symbol": s, "ret_20d": round(m[s]["ret_20d"], 2)} for s in laggards],
        "sectors": sectors,
        "leading_sector": sectors[0]["sector"] if sectors else None,
        "lagging_sector": sectors[-1]["sector"] if sectors else None,
        "data_version": data_version(),
    }
    _cache[key] = result
    return result


def _regime_label(b: float) -> str:
    if b >= 70:
        return "Healthy Bull"
    if b >= 55:
        return "Moderate Bull"
    if b >= 40:
        return "Neutral"
    if b >= 25:
        return "Moderate Bear"
    return "Stressed"


# ── TOOL: sector_rotation ─────────────────────────────────────────────────────

def sector_rotation(universe: str = "nifty50") -> dict[str, Any]:
    m, source = _load_metrics(universe)
    if not m:
        return {"error": "no data"}
    sectors, _ = _sector_aggregates(m)
    return {"universe": universe, "source": source,
            "sectors": sectors,
            "leading": sectors[0] if sectors else None,
            "lagging": sectors[-1] if sectors else None,
            "note": "Sectors ranked by average 20-day return of their constituents.",
            "data_version": data_version()}


# ── TOOL: opportunity_board ───────────────────────────────────────────────────

_DEFAULT_WEIGHTS = {"trend": 0.25, "rel_strength": 0.20, "volume": 0.15,
                    "vol_breakout": 0.10, "sector": 0.15, "breadth": 0.15}


def opportunity_board(universe: str = "nifty50", top_n: int = 15,
                      weights: Optional[dict[str, float]] = None) -> dict[str, Any]:
    key = _cache_key("opportunity_board", {"u": universe, "n": top_n, "w": weights, "t": _intraday_bucket()})
    if key in _cache:
        return _cache[key]
    w = {**_DEFAULT_WEIGHTS, **(weights or {})}
    m, source = _load_metrics(universe)
    if not m:
        return {"error": "no data"}
    syms = list(m.keys())
    ret20 = np.array([m[s]["ret_20d"] for s in syms])
    rs_rank = _pct_rank(ret20)
    _, sector_strength = _sector_aggregates(m)
    breadth = market_state(universe).get("breadth", 50)

    rows = []
    for i, s in enumerate(syms):
        trend = (m[s]["above20"] + m[s]["above50"] + m[s]["above200"]) / 3 * 100
        vol_exp = min(100.0, (m[s]["vol_ratio"] or 0) * 40)
        vol_bo = m[s]["atr_pct"]
        sec_str = sector_strength.get(m[s].get("sector", "Other"), 50.0)
        score = (w["trend"] * trend + w["rel_strength"] * rs_rank[i] +
                 w["volume"] * vol_exp + w["vol_breakout"] * vol_bo +
                 w["sector"] * sec_str + w["breadth"] * breadth)
        rows.append({
            "symbol": s, "score": round(float(score), 1),
            "trend": round(trend, 0), "rel_strength": round(float(rs_rank[i]), 0),
            "volume_expansion": round(vol_exp, 0), "vol_breakout": round(vol_bo, 0),
            "sector_strength": round(sec_str, 0), "sector": m[s].get("sector", "Other"),
            "ret_20d": round(m[s]["ret_20d"], 2), "rsi": round(m[s]["rsi"], 1),
            "breakout": bool(m[s]["breakout20"] >= 1),
        })
    rows.sort(key=lambda r: r["score"], reverse=True)
    result = {"universe": universe, "source": source, "weights": w,
              "breadth_context": breadth, "board": rows[:top_n], "data_version": data_version()}
    _cache[key] = result
    return result


def _pct_rank(a: np.ndarray) -> np.ndarray:
    order = a.argsort().argsort()
    return order / max(1, len(a) - 1) * 100


# ── TOOL: why_move ────────────────────────────────────────────────────────────

def why_move(symbol: str, universe: str = "nifty50") -> dict[str, Any]:
    m, source = _load_metrics(universe)
    sym = symbol.upper()
    if sym not in m:
        frames = _load_universe_frames([sym], 700, None)
        if sym not in frames:
            return {"error": f"no data for {sym}"}
        prices, source = _live_prices([sym])
        f = frames[sym]
        if source == "live" and sym in prices:
            f = _append_live_bar(f, prices[sym])
        met = _metrics(f)
        if not met:
            return {"error": f"insufficient history for {sym}"}
        met["sector"] = _sector_map(universe).get(sym, {}).get("sector", "Other")
        m[sym] = met
    d = m[sym]
    drivers = []
    drivers.append(f"up {d['ret_1d']:.1f}% today" if d["ret_1d"] > 0 else f"down {abs(d['ret_1d']):.1f}% today")
    if d["vol_ratio"] and d["vol_ratio"] > 1.5:
        drivers.append(f"volume {d['vol_ratio']:.1f}x its 20-day average")
    if d["breakout20"] >= 1:
        drivers.append("broke above its 20-day high")
    if d["new_high"] >= 1:
        drivers.append("at/near a 52-week high")
    if d["above50"] and d["above200"]:
        drivers.append("trading above its 50- and 200-day SMAs (uptrend)")
    if d["rsi"] > 70:
        drivers.append(f"RSI {d['rsi']:.0f} (overbought)")
    elif d["rsi"] < 30:
        drivers.append(f"RSI {d['rsi']:.0f} (oversold)")
    drivers.append(f"sector: {d.get('sector', 'Other')}")
    return {"symbol": sym, "as_of": d["last_date"], "source": source,
            "ret_1d_pct": round(d["ret_1d"], 2), "ret_20d_pct": round(d["ret_20d"], 2),
            "drivers": drivers,
            "note": "Attribution from price/volume/trend/sector — not news or fundamentals.",
            "data_version": data_version()}


# ── State store + change detection + event memory ─────────────────────────────

def _read_state() -> Optional[dict[str, Any]]:
    if _STATE_FILE.exists():
        try:
            return json.loads(_STATE_FILE.read_text())
        except Exception:
            return None
    return None


def _write_state(state: dict[str, Any]) -> None:
    _STATE_DIR.mkdir(parents=True, exist_ok=True)
    _STATE_FILE.write_text(json.dumps(state))


def _append_events(events: list[dict[str, Any]]) -> None:
    if not events:
        return
    _STATE_DIR.mkdir(parents=True, exist_ok=True)
    with _EVENTS_FILE.open("a") as fh:
        for e in events:
            fh.write(json.dumps(e) + "\n")


def detect_changes(universe: str = "nifty50", persist: bool = True) -> dict[str, Any]:
    cur = market_state(universe)
    if "error" in cur:
        return cur
    prev = _read_state()
    events: list[dict[str, Any]] = []
    ts = _now()

    if prev and prev.get("universe") == universe and prev.get("as_of") != cur["as_of"]:
        if prev.get("regime") != cur["regime"]:
            events.append({"ts": ts, "type": "regime_change", "severity": "high",
                           "text": f"Market regime shifted {prev['regime']} → {cur['regime']} "
                                   f"(breadth {prev.get('breadth')}→{cur['breadth']})."})
        db = cur["breadth"] - prev.get("breadth", cur["breadth"])
        if abs(db) >= 10:
            events.append({"ts": ts, "type": "breadth_shift",
                           "severity": "high" if abs(db) >= 20 else "medium",
                           "text": f"Breadth {'improved' if db > 0 else 'deteriorated'} {db:+.0f} pts to {cur['breadth']}."})
        prev_leaders = {x["symbol"] for x in prev.get("leaders", [])}
        new_leaders = [x["symbol"] for x in cur["leaders"] if x["symbol"] not in prev_leaders]
        if new_leaders:
            events.append({"ts": ts, "type": "leadership_change", "severity": "medium",
                           "text": f"New momentum leaders: {', '.join(new_leaders)}."})
        if prev.get("leading_sector") and prev.get("leading_sector") != cur.get("leading_sector"):
            events.append({"ts": ts, "type": "sector_rotation", "severity": "medium",
                           "text": f"Sector leadership rotated {prev['leading_sector']} → {cur['leading_sector']}."})
        dnh = cur["new_high_count"] - prev.get("new_high_count", 0)
        if dnh >= 3:
            events.append({"ts": ts, "type": "new_high_surge", "severity": "medium",
                           "text": f"{dnh} more stocks made 52-week highs ({cur['new_high_count']} total)."})
    elif not prev:
        events.append({"ts": ts, "type": "baseline", "severity": "info",
                       "text": f"Baseline snapshot: {cur['regime']}, breadth {cur['breadth']}, "
                               f"leading sector {cur.get('leading_sector')}."})

    if persist:
        _write_state(cur)
        _append_events(events)

    return {"as_of": cur["as_of"], "source": cur["source"], "universe": universe,
            "regime": cur["regime"], "breadth": cur["breadth"],
            "leading_sector": cur.get("leading_sector"),
            "changes": events, "change_count": len(events), "data_version": data_version()}


def recall_events(limit: int = 30) -> dict[str, Any]:
    if not _EVENTS_FILE.exists():
        return {"events": [], "count": 0}
    lines = _EVENTS_FILE.read_text().strip().splitlines()[-limit:]
    events = [json.loads(x) for x in lines if x.strip()]
    return {"events": events, "count": len(events)}


def invalidate() -> None:
    for k in [k for k in _cache if k.startswith(("market_state", "opportunity_board"))]:
        _cache.pop(k, None)
