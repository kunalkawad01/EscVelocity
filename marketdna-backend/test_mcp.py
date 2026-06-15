"""Quick smoke test for MCP tool handlers."""
import json
from mcp_server.server import dispatch_tool

def section(title):
    print(f"\n{'='*40}")
    print(f"  {title}")
    print('='*40)

# ── calculate_regime ──────────────────────────────
section("calculate_regime RELIANCE")
r = json.loads(dispatch_tool("calculate_regime", {"symbol": "RELIANCE"}))
print(f"  status        : {r.get('status')}")
print(f"  regime_score  : {r.get('regime_score')}")
print(f"  regime_label  : {r.get('regime_label')}")
print(f"  date          : {r.get('date')}")
print(f"  close         : {r.get('close')}")
comp = r.get('components', {})
print(f"  price/align/slope: {comp.get('price_score')} / {comp.get('alignment_score')} / {comp.get('slope_score')}")

# ── calculate_breadth ─────────────────────────────
section("calculate_breadth (market-wide)")
r = json.loads(dispatch_tool("calculate_breadth", {}))
print(f"  status         : {r.get('status')}")
print(f"  breadth_score  : {r.get('breadth_score')}")
print(f"  breadth_label  : {r.get('breadth_label')}")
print(f"  above SMA20/50/200: {r.get('pct_above_sma20')}% / {r.get('pct_above_sma50')}% / {r.get('pct_above_sma200')}%")

# ── calculate_drawdown ────────────────────────────
section("calculate_drawdown TCS")
r = json.loads(dispatch_tool("calculate_drawdown", {"symbol": "TCS"}))
print(f"  status               : {r.get('status')}")
print(f"  current_drawdown_pct : {r.get('current_drawdown_pct')}%")
print(f"  max_drawdown_pct     : {r.get('max_drawdown_pct')}%")
print(f"  max_drawdown_date    : {r.get('max_drawdown_date')}")

# ── calculate_relative_strength ───────────────────
section("calculate_relative_strength HDFCBANK")
r = json.loads(dispatch_tool("calculate_relative_strength", {"symbol": "HDFCBANK"}))
print(f"  status      : {r.get('status')}")
print(f"  rs_score    : {r.get('rs_score')}")
print(f"  rs_label    : {r.get('rs_label')}")
print(f"  return_20d  : {r.get('return_20d')}%")
print(f"  rank        : {r.get('rank')} / {r.get('universe_size')}")

# ── calculate_stock_dna ───────────────────────────
section("calculate_stock_dna INFY")
r = json.loads(dispatch_tool("calculate_stock_dna", {"symbol": "INFY"}))
print(f"  status    : {r.get('status')}")
print(f"  dna_score : {r.get('dna_score')}")
print(f"  dna_label : {r.get('dna_label')}")
comp = r.get('components', {})
print(f"  regime    : {comp.get('regime_score')} ({comp.get('regime_label')})")
print(f"  recovery  : {comp.get('recovery_score')}")
print(f"  rs_score  : {comp.get('rs_score')}")
print(f"  efficiency: {comp.get('efficiency_ratio')}")
print(f"  dd_penalty: {comp.get('dd_penalty')}")

# ── calculate_market_dna ─────────────────────────
section("calculate_market_dna (market-wide)")
r = json.loads(dispatch_tool("calculate_market_dna", {}))
print(f"  status              : {r.get('status')}")
print(f"  market_dna_score    : {r.get('market_dna_score')}")
print(f"  market_dna_label    : {r.get('market_dna_label')}")
comp = r.get('components', {})
print(f"  breadth_score       : {comp.get('breadth_score')}")
print(f"  avg_regime_score    : {comp.get('avg_regime_score')}")
print(f"  leadership_pct      : {comp.get('leadership_pct')}%")
print(f"  stress_pct          : {comp.get('stress_pct')}%")

# ── roadmap stub ──────────────────────────────────
section("run_backtest (roadmap stub)")
r = json.loads(dispatch_tool("run_backtest", {"symbol": "RELIANCE", "strategy": "momentum"}))
print(f"  status  : {r.get('status')}")
print(f"  message : {r.get('message')}")

print("\nAll tests complete.")
