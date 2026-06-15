"""Implementations for every MCP tool.

Each handler accepts a plain dict of arguments (from Claude tool_use),
calls the appropriate service, and returns a JSON-serialisable dict.
Handlers NEVER raise — they catch all exceptions and return {"error": "..."}.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

# ─── helpers ──────────────────────────────────────────────────────────────────

def _ok(symbol: str | None = None, **data: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"status": "ok"}
    if symbol:
        out["symbol"] = symbol
    out.update(data)
    return out


def _err(exc: Exception) -> dict[str, Any]:
    log.exception("mcp_handler error: %s", exc)
    return {"status": "error", "error": str(exc)}


def _roadmap(tool: str, description: str) -> dict[str, Any]:
    return {
        "status": "roadmap",
        "tool": tool,
        "message": f"{description} — not yet implemented. Scheduled for Phase 3+.",
    }


# ─── Tool 1: calculate_regime ─────────────────────────────────────────────────

def calculate_regime(symbol: str) -> dict[str, Any]:
    """Return Regime Score (0-100) for a single NIFTY 50 stock."""
    try:
        from app.services.regime_service import get_regime_score
        r = get_regime_score(symbol.upper())
        return _ok(
            symbol=r.symbol,
            date=r.date,
            close=r.close,
            regime_score=r.regime_score,
            regime_label=r.regime_label,
            components={
                "price_score": r.components.price_score,
                "alignment_score": r.components.alignment_score,
                "slope_score": r.components.slope_score,
            },
            sma={
                "sma20": r.sma.sma20,
                "sma50": r.sma.sma50,
                "sma100": r.sma.sma100,
                "sma200": r.sma.sma200,
                "above_sma20": r.sma.above_sma20,
                "above_sma50": r.sma.above_sma50,
                "above_sma100": r.sma.above_sma100,
                "above_sma200": r.sma.above_sma200,
            },
            slope={
                "sma20_rising": r.slope.sma20_rising,
                "sma50_rising": r.slope.sma50_rising,
                "sma200_rising": r.slope.sma200_rising,
            },
            sma_fully_aligned=r.sma_fully_aligned,
            computed_at=r.computed_at,
            formula="price_position(40) + sma_alignment(30) + sma_slope(30)",
        )
    except Exception as exc:
        return _err(exc)


# ─── Tool 2: calculate_breadth ────────────────────────────────────────────────

def calculate_breadth() -> dict[str, Any]:
    """Return Market Breadth Score (0-100) across NIFTY 50."""
    try:
        from app.services.regime_service import get_breadth_score
        b = get_breadth_score()
        return _ok(
            date=b.date,
            breadth_score=b.breadth_score,
            breadth_label=b.breadth_label,
            pct_above_sma20=b.pct_above_sma20,
            pct_above_sma50=b.pct_above_sma50,
            pct_above_sma200=b.pct_above_sma200,
            count_above_sma20=b.count_above_sma20,
            count_above_sma50=b.count_above_sma50,
            count_above_sma200=b.count_above_sma200,
            total_symbols=b.total_symbols,
            computed_at=b.computed_at,
            formula="pct_above_sma20×0.30 + pct_above_sma50×0.40 + pct_above_sma200×0.30",
            interpretation=(
                "≥70 → Broad Participation; 50-69 → Moderate; "
                "30-49 → Narrow; <30 → Poor Breadth"
            ),
        )
    except Exception as exc:
        return _err(exc)


# ─── Tool 3: calculate_drawdown ───────────────────────────────────────────────

def calculate_drawdown(symbol: str, lookback_days: int = 252) -> dict[str, Any]:
    """Return max drawdown and current drawdown for a stock over lookback_days."""
    try:
        from app.services.duckdb_client import get_connection
        con = get_connection()
        rows = con.execute(
            """
            SELECT STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, close
            FROM equities_prices
            WHERE symbol = ?
            ORDER BY date DESC
            LIMIT ?
            """,
            [symbol.upper(), lookback_days],
        ).fetchall()

        if len(rows) < 20:
            return {"status": "error", "error": f"{symbol}: insufficient data ({len(rows)} bars)"}

        closes = np.array([float(r[1]) for r in reversed(rows)])
        dates  = [r[0] for r in reversed(rows)]
        peak   = np.maximum.accumulate(closes)
        dd_pct = (closes - peak) / peak * 100  # negative values

        cur_dd  = float(dd_pct[-1])
        max_dd  = float(np.min(dd_pct))
        max_dd_idx = int(np.argmin(dd_pct))
        cur_price = float(closes[-1])
        peak_val  = float(peak[-1])

        return _ok(
            symbol=symbol.upper(),
            current_price=round(cur_price, 2),
            peak_price=round(peak_val, 2),
            current_drawdown_pct=round(cur_dd, 2),
            max_drawdown_pct=round(max_dd, 2),
            max_drawdown_date=dates[max_dd_idx],
            lookback_days=lookback_days,
            formula="(price - rolling_peak) / rolling_peak × 100",
        )
    except Exception as exc:
        return _err(exc)


# ─── Tool 4: calculate_recovery ───────────────────────────────────────────────

def calculate_recovery(symbol: str, lookback_days: int = 252) -> dict[str, Any]:
    """Return Recovery Score (0-100): how much of the max drawdown has been retraced."""
    try:
        dd = calculate_drawdown(symbol, lookback_days)
        if dd.get("status") == "error":
            return dd

        from app.services.duckdb_client import get_connection
        con = get_connection()
        rows = con.execute(
            """
            SELECT close FROM equities_prices
            WHERE symbol = ?
            ORDER BY date DESC LIMIT ?
            """,
            [symbol.upper(), lookback_days],
        ).fetchall()
        closes = np.array([float(r[0]) for r in reversed(rows)])
        peak   = np.maximum.accumulate(closes)
        dd_arr = (closes - peak) / peak * 100
        trough_val = float(np.min(dd_arr))  # most negative
        cur_dd     = float(dd_arr[-1])

        if trough_val == 0.0:
            recovery_score = 100.0
            pct_recovered  = 100.0
        else:
            pct_recovered  = max(0.0, min(100.0, (1 - cur_dd / trough_val) * 100))
            recovery_score = round(pct_recovered, 1)

        label = (
            "Full Recovery" if recovery_score >= 95 else
            "Strong Recovery" if recovery_score >= 75 else
            "Partial Recovery" if recovery_score >= 40 else
            "Early Recovery" if recovery_score >= 10 else
            "In Drawdown"
        )

        return _ok(
            symbol=symbol.upper(),
            recovery_score=recovery_score,
            recovery_label=label,
            pct_recovered=round(pct_recovered, 1),
            current_drawdown_pct=round(cur_dd, 2),
            max_drawdown_pct=round(trough_val, 2),
            formula="(1 - current_drawdown / max_drawdown) × 100",
        )
    except Exception as exc:
        return _err(exc)


# ─── Tool 5: calculate_relative_strength ──────────────────────────────────────

def calculate_relative_strength(symbol: str) -> dict[str, Any]:
    """Return Relative Strength Score (0-100) vs NIFTY 50 universe on 20-day return."""
    try:
        from app.services.duckdb_client import get_connection
        from app.services.stock_metrics import get_universe
        sym = symbol.upper()
        symbols_sql = ", ".join(f"'{s}'" for s in get_universe())
        con = get_connection()

        # 21 bars gives us 20 daily returns
        rows = con.execute(
            f"""
            SELECT symbol, STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS d, close
            FROM equities_prices
            WHERE symbol IN ({symbols_sql})
            ORDER BY symbol, date DESC
            """,
        ).fetchall()

        # Group last 21 closes per symbol
        from collections import defaultdict
        sym_closes: dict[str, list[float]] = defaultdict(list)
        for r in rows:
            if len(sym_closes[r[0]]) < 21:
                sym_closes[r[0]].append(float(r[2]))

        returns: dict[str, float] = {}
        for s, closes in sym_closes.items():
            if len(closes) >= 21:
                returns[s] = (closes[0] - closes[20]) / closes[20] * 100

        if sym not in returns:
            return {"status": "error", "error": f"{sym}: insufficient data for RS"}

        sorted_syms = sorted(returns.keys(), key=lambda s: returns[s])
        rank = sorted_syms.index(sym)
        n    = len(sorted_syms)
        rs_score = round(rank / (n - 1) * 100, 1) if n > 1 else 50.0

        label = (
            "Top Quartile" if rs_score >= 75 else
            "Above Average" if rs_score >= 50 else
            "Below Average" if rs_score >= 25 else
            "Bottom Quartile"
        )

        return _ok(
            symbol=sym,
            rs_score=rs_score,
            rs_label=label,
            return_20d=round(returns[sym], 2),
            rank=rank + 1,
            universe_size=n,
            formula="percentile_rank(20d_return) × 100 across NIFTY 50 universe",
        )
    except Exception as exc:
        return _err(exc)


# ─── Tool 6: calculate_stock_dna ──────────────────────────────────────────────

def calculate_stock_dna(symbol: str) -> dict[str, Any]:
    """Return Stock DNA Score (0-100): composite of regime, recovery, drawdown, RS, efficiency."""
    try:
        sym = symbol.upper()

        regime  = calculate_regime(sym)
        recover = calculate_recovery(sym)
        rs      = calculate_relative_strength(sym)
        dd      = calculate_drawdown(sym)

        if any(r.get("status") == "error" for r in [regime, recover, rs, dd]):
            errors = [
                r["error"] for r in [regime, recover, rs, dd]
                if r.get("status") == "error"
            ]
            return {"status": "error", "error": "; ".join(errors)}

        # Efficiency Ratio: directional move / total path over 20 bars
        from app.services.duckdb_client import get_connection
        con = get_connection()
        rows = con.execute(
            """
            SELECT close FROM equities_prices
            WHERE symbol = ? ORDER BY date DESC LIMIT 21
            """,
            [sym],
        ).fetchall()
        closes = [float(r[0]) for r in rows]
        if len(closes) >= 21:
            net_move  = abs(closes[0] - closes[20])
            total_path = sum(abs(closes[i] - closes[i + 1]) for i in range(20))
            efficiency = (net_move / total_path * 100) if total_path > 0 else 0.0
        else:
            efficiency = 50.0

        # Weights: regime 35%, recovery 25%, RS 25%, efficiency 15%
        # Drawdown modifies the score: heavy drawdown cap
        max_dd_pct = abs(dd.get("max_drawdown_pct", 0.0))
        dd_penalty = min(20.0, max_dd_pct * 0.2)  # up to -20 pts

        composite = (
            regime.get("regime_score", 0.0) * 0.35
            + recover.get("recovery_score", 0.0) * 0.25
            + rs.get("rs_score", 0.0) * 0.25
            + efficiency * 0.15
            - dd_penalty
        )
        dna_score = round(max(0.0, min(100.0, composite)), 1)

        label = (
            "Elite" if dna_score >= 80 else
            "Strong" if dna_score >= 65 else
            "Moderate" if dna_score >= 45 else
            "Weak" if dna_score >= 25 else
            "Distressed"
        )

        return _ok(
            symbol=sym,
            dna_score=dna_score,
            dna_label=label,
            components={
                "regime_score": regime.get("regime_score"),
                "regime_label": regime.get("regime_label"),
                "recovery_score": recover.get("recovery_score"),
                "rs_score": rs.get("rs_score"),
                "efficiency_ratio": round(efficiency, 1),
                "max_drawdown_pct": dd.get("max_drawdown_pct"),
                "dd_penalty": round(dd_penalty, 1),
            },
            weights="regime×0.35 + recovery×0.25 + rs×0.25 + efficiency×0.15 − drawdown_penalty",
        )
    except Exception as exc:
        return _err(exc)


# ─── Tool 7: calculate_market_dna ─────────────────────────────────────────────

def calculate_market_dna() -> dict[str, Any]:
    """Return Market DNA Score (0-100): composite market health indicator."""
    try:
        from app.services.regime_service import get_market_snapshot
        snap = get_market_snapshot()

        breadth_score = snap.breadth.breadth_score
        avg_regime    = snap.avg_regime_score
        leadership    = round(snap.strong_bull_count / max(len(snap.stocks), 1) * 100, 1)
        stress_score  = round(snap.strong_bear_count / max(len(snap.stocks), 1) * 100, 1)

        # Market DNA = breadth×0.35 + avg_regime×0.30 + leadership×0.20 + (100-stress)×0.15
        market_dna = round(
            breadth_score * 0.35
            + avg_regime   * 0.30
            + leadership   * 0.20
            + (100 - stress_score) * 0.15,
            1,
        )

        label = (
            "Healthy Bull" if market_dna >= 70 else
            "Moderate Bull" if market_dna >= 55 else
            "Neutral" if market_dna >= 40 else
            "Moderate Bear" if market_dna >= 25 else
            "Stressed Market"
        )

        return _ok(
            date=snap.date,
            market_dna_score=market_dna,
            market_dna_label=label,
            components={
                "breadth_score": breadth_score,
                "avg_regime_score": avg_regime,
                "leadership_pct": leadership,
                "stress_pct": stress_score,
                "strong_bull_count": snap.strong_bull_count,
                "strong_bear_count": snap.strong_bear_count,
                "total_stocks": len(snap.stocks),
            },
            formula="breadth×0.35 + avg_regime×0.30 + leadership×0.20 + (100-stress)×0.15",
        )
    except Exception as exc:
        return _err(exc)


# ─── Tool 8: query_raw_data ───────────────────────────────────────────────────

def query_raw_data(sql: str) -> dict[str, Any]:
    """Execute a DuckDB SQL query against equities_prices. Fallback for ad-hoc analysis."""
    try:
        from app.services.duckdb_client import get_connection
        con = get_connection()
        result = con.execute(sql)
        columns = [d[0] for d in result.description]
        rows    = result.fetchall()
        MAX_ROWS = 200
        data = [dict(zip(columns, row)) for row in rows[:MAX_ROWS]]
        out: dict[str, Any] = {"columns": columns, "data": data, "total_rows": len(rows)}
        if len(rows) > MAX_ROWS:
            out["note"] = f"Truncated to {MAX_ROWS} of {len(rows)} rows"
        return out
    except Exception as exc:
        return {"error": str(exc)}


# ─── Stubs ────────────────────────────────────────────────────────────────────

def run_backtest(symbol: str, strategy: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return _roadmap("run_backtest", f"Backtest '{strategy}' on {symbol} with VectorBT (Phase 3)")


def validate_metric(metric: str, symbol: str) -> dict[str, Any]:
    return _roadmap("validate_metric", f"Decile + forward-return validation for '{metric}' on {symbol} (Phase 3)")


def construct_portfolio(symbols: list[str], weights: dict[str, float] | None = None) -> dict[str, Any]:
    return _roadmap("construct_portfolio", f"Portfolio construction for {len(symbols)} stocks (Phase 6)")


def analyze_options_strategy(symbol: str, strategy: str) -> dict[str, Any]:
    return _roadmap("analyze_options_strategy", f"Options strategy '{strategy}' on {symbol} (Phase 7)")


def run_macro_analysis(topic: str) -> dict[str, Any]:
    return _roadmap("run_macro_analysis", f"Macro research on '{topic}' (Phase 8)")
