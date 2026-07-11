"""
Rule engine for user-defined ("custom") Quant Portfolios.

A custom portfolio is defined by handwritten expressions over the feature fields that
`portfolios_service.build_features()` produces — no hard-coded Python screener. This
module turns those expressions into vectorized pandas masks/series and adapts a
`PortfolioSpec` into the same `.select(feats, size)` contract the built-in `Portfolio`
screeners use, so it plugs straight into `get_screen` / the tracker.

SAFETY — expressions are parsed with `ast` and validated against a strict whitelist:
  * allowed: comparisons (< <= > >= == !=), boolean and/or/not, arithmetic (+ - * /)
             between KNOWN fields and numeric/boolean literals
  * rejected: function calls, attribute access, subscripting, names not in the field
             catalog, string literals, anything else
There is NO `eval` of arbitrary code and no attribute/call surface, so a rule cannot
execute anything — it can only compute a boolean/numeric column. Deterministic by
construction (Principle 3).
"""
from __future__ import annotations

import ast
import difflib

import numpy as np
import pandas as pd

# Position-relative fields available ONLY to eviction / stop-loss rules (they need an
# open position to be defined). Injected by the tracker at eviction-evaluation time.
POSITION_FIELDS = {"since_entry_pct", "days_held"}

# Fallback field set if build_features can't be consulted (e.g. no data yet). Kept in
# sync with build_features output; the live set from build_features wins when available.
_STATIC_NUMERIC = {
    "close", "sma20", "sma50", "sma200", "std20", "atr14", "atr_pct", "atr_pctile",
    "rsi14", "adx14", "bb_width", "bb_lower", "bb_upper", "pctb", "avg_vol20", "vol_surge",
    "high20", "high60", "high252", "low252", "dist_52w_high", "dist_52w_low", "drawdown",
    "ret_1m", "ret_3m", "ret_6m", "ret_12m", "efficiency_ratio", "r2", "consistency",
    "cagr", "max_dd_1y", "rs_ret_6m", "mom_score", "mom_rank", "rs_rank", "atr_pct_rank",
    "z20", "dist_sma50_pct", "dist_sma200_pct",
    "ret_1m_rank", "ret_3m_rank", "ret_6m_rank", "ret_12m_rank",
}
_STATIC_BOOL = {
    "rs_slope_up", "rs_above_sma200", "higher_lows", "above_sma200", "above_sma50",
    "golden_cross", "new_52w_high", "break_60d_high",
}

_OPERATORS = ["<", "<=", ">", ">=", "==", "!=", "and", "or", "not", "+", "-", "*", "/"]

_CMP = {
    ast.Lt: lambda a, b: a < b, ast.LtE: lambda a, b: a <= b,
    ast.Gt: lambda a, b: a > b, ast.GtE: lambda a, b: a >= b,
    ast.Eq: lambda a, b: a == b, ast.NotEq: lambda a, b: a != b,
}


class RuleError(ValueError):
    """A user rule failed to parse or referenced an unknown field / illegal construct."""


# (label, unit, group) metadata for the builder UI. Fields not listed fall back to a
# generic entry — the catalog still exposes them, just without a friendly label.
_FIELD_META: dict[str, tuple[str, str | None, str]] = {
    "close": ("Close price", "₹", "price"),
    "sma20": ("SMA 20", "₹", "price"), "sma50": ("SMA 50", "₹", "price"),
    "sma200": ("SMA 200", "₹", "price"), "std20": ("Price σ (20d)", "₹", "volatility"),
    "z20": ("Price z-score vs SMA20", "σ", "volatility"),
    "dist_sma50_pct": ("Distance from SMA50", "frac", "price"),
    "dist_sma200_pct": ("Distance from SMA200", "frac", "price"),
    "rsi14": ("RSI (14)", "0-100", "momentum"), "adx14": ("ADX (14)", "0-100", "trend"),
    "atr14": ("ATR (14)", "₹", "volatility"), "atr_pct": ("ATR %", "frac", "volatility"),
    "atr_pctile": ("ATR percentile (1y)", "0-100", "volatility"),
    "atr_pct_rank": ("ATR % rank (universe)", "0-100", "volatility"),
    "bb_width": ("Bollinger width", "frac", "volatility"),
    "pctb": ("%B (band position)", "0-1", "volatility"),
    "vol_surge": ("Volume vs 20d avg", "×", "volume"),
    "avg_vol20": ("Avg volume (20d)", "shares", "volume"),
    "dist_52w_high": ("Distance from 52w high", "frac", "price"),
    "dist_52w_low": ("Distance from 52w low", "frac", "price"),
    "drawdown": ("Drawdown from 1y peak", "frac", "risk"),
    "ret_1m": ("Return 1M", "frac", "momentum"), "ret_3m": ("Return 3M", "frac", "momentum"),
    "ret_6m": ("Return 6M", "frac", "momentum"), "ret_12m": ("Return 12M", "frac", "momentum"),
    "mom_score": ("Momentum score (blend)", "", "momentum"),
    "mom_rank": ("Momentum percentile (0-100)", "pctile", "momentum"),
    "ret_1m_rank": ("1M return rank (1=best)", "rank", "momentum"),
    "ret_3m_rank": ("3M return rank (1=best)", "rank", "momentum"),
    "ret_6m_rank": ("6M return rank (1=best)", "rank", "momentum"),
    "ret_12m_rank": ("12M return rank (1=best)", "rank", "momentum"),
    "rs_ret_6m": ("Relative strength 6M", "frac", "relative"),
    "rs_rank": ("RS rank (universe)", "0-100", "relative"),
    "r2": ("Trend R²", "0-1", "trend"), "efficiency_ratio": ("Efficiency ratio", "0-1", "trend"),
    "consistency": ("Up-day consistency", "%", "trend"),
    "cagr": ("1y CAGR", "frac", "return"), "max_dd_1y": ("Max drawdown (1y)", "frac", "risk"),
    "above_sma50": ("Price > SMA50", None, "trend"),
    "above_sma200": ("Price > SMA200", None, "trend"),
    "golden_cross": ("SMA50 > SMA200", None, "trend"),
    "new_52w_high": ("New 52-week high", None, "price"),
    "break_60d_high": ("Breaks 60-day high", None, "price"),
    "higher_lows": ("Higher lows forming", None, "trend"),
    "rs_slope_up": ("RS line rising", None, "relative"),
    "rs_above_sma200": ("RS above its SMA200", None, "relative"),
    "since_entry_pct": ("Return since entry", "%", "position"),
    "days_held": ("Days held", "days", "position"),
}

_CATALOG_OPERATORS = ["<", "<=", ">", ">=", "==", "!=", "and", "or", "not", "+", "-", "*", "/"]


def field_catalog(context: str = "eviction") -> list[dict]:
    """All rule fields with UI metadata. Default context includes position fields
    (flagged position_only) so the builder can offer them for eviction rules only."""
    num, boo = field_sets(context)
    out = []
    for name in sorted(num | boo):
        label, unit, group = _FIELD_META.get(name, (name, None, "other"))
        out.append({
            "name": name, "label": label,
            "kind": "boolean" if name in boo else "numeric",
            "unit": unit, "group": group, "position_only": name in POSITION_FIELDS,
        })
    return out


# ── field catalog ─────────────────────────────────────────────────────────────
def field_sets(context: str = "entry") -> tuple[set[str], set[str]]:
    """(numeric_fields, boolean_fields) allowed in a rule for the given context.

    `eviction` context additionally allows the position-relative fields."""
    from app.services import portfolios_service as ps
    num, boo = set(_STATIC_NUMERIC), set(_STATIC_BOOL)
    try:
        f = ps.build_features()          # day-cached
        if not f.empty:
            num, boo = set(), set()
            for c in f.columns:
                if c == "date":
                    continue
                if f[c].dtype == bool:
                    boo.add(c)
                elif pd.api.types.is_numeric_dtype(f[c]):
                    num.add(c)
    except Exception:
        pass
    if context == "eviction":
        num = num | POSITION_FIELDS
    return num, boo


# ── parse + validate ──────────────────────────────────────────────────────────
def _suggest(name: str, allowed: set[str]) -> str:
    close = difflib.get_close_matches(name, sorted(allowed), n=3, cutoff=0.6)
    return f" Did you mean: {', '.join(close)}?" if close else ""


def _check(node: ast.AST, allowed: set[str], used: set[str]) -> None:
    if isinstance(node, ast.BoolOp):
        if not isinstance(node.op, (ast.And, ast.Or)):
            raise RuleError("Only `and` / `or` are allowed as boolean operators.")
        for v in node.values:
            _check(v, allowed, used)
    elif isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, (ast.Not, ast.USub, ast.UAdd)):
            raise RuleError("Unsupported unary operator.")
        _check(node.operand, allowed, used)
    elif isinstance(node, ast.BinOp):
        if not isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            raise RuleError("Only + - * / arithmetic is allowed between fields.")
        _check(node.left, allowed, used)
        _check(node.right, allowed, used)
    elif isinstance(node, ast.Compare):
        for op in node.ops:
            if type(op) not in _CMP:
                raise RuleError("Unsupported comparison (use < <= > >= == !=).")
        _check(node.left, allowed, used)
        for c in node.comparators:
            _check(c, allowed, used)
    elif isinstance(node, ast.Name):
        if node.id not in allowed:
            raise RuleError(f"Unknown field '{node.id}'.{_suggest(node.id, allowed)}")
        used.add(node.id)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            return
        if not isinstance(node.value, (int, float)):
            raise RuleError(f"Only numbers and booleans are allowed, got {node.value!r}.")
    else:
        raise RuleError(
            f"'{type(node).__name__}' is not allowed in a rule "
            "(no function calls, attribute access, or indexing)."
        )


def _is_bool_node(node: ast.AST, bool_fields: set[str]) -> bool:
    if isinstance(node, (ast.BoolOp, ast.Compare)):
        return True
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return True
    if isinstance(node, ast.Name):
        return node.id in bool_fields
    if isinstance(node, ast.Constant):
        return isinstance(node.value, bool)
    return False


def compile_rule(expr: str, context: str = "entry", *, expect: str = "bool") -> ast.AST:
    """Parse + validate a rule expression, returning its AST body node.

    expect='bool' requires a condition (e.g. `rsi14 < 30`); expect='num' allows a value
    expression (e.g. `0.6*rs_ret_6m + 0.4*mom_score`) used for ranking / weighting."""
    if not expr or not expr.strip():
        raise RuleError("Rule is empty.")
    try:
        mod = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise RuleError(f"Could not parse rule: {e.msg}") from e
    num, boo = field_sets(context)
    used: set[str] = set()
    _check(mod.body, num | boo, used)
    if expect == "bool" and not _is_bool_node(mod.body, boo):
        raise RuleError(
            "This rule must be a condition, e.g. `rsi14 < 30` — it currently evaluates "
            "to a value. Add a comparison (like `> 0`)."
        )
    return mod.body


# ── evaluate ──────────────────────────────────────────────────────────────────
def _as_bool_series(v, index: pd.Index) -> pd.Series:
    if isinstance(v, pd.Series):
        s = v if v.dtype == bool else (v != 0)
        return s.reindex(index).fillna(False)
    return pd.Series(bool(v), index=index)


def _num(v):
    if isinstance(v, pd.Series) and v.dtype == bool:
        return v.astype(float)
    return v


def _ev(node: ast.AST, feats: pd.DataFrame):
    if isinstance(node, ast.BoolOp):
        parts = [_as_bool_series(_ev(x, feats), feats.index) for x in node.values]
        out = parts[0]
        for p in parts[1:]:
            out = (out & p) if isinstance(node.op, ast.And) else (out | p)
        return out
    if isinstance(node, ast.UnaryOp):
        if isinstance(node.op, ast.Not):
            return ~_as_bool_series(_ev(node.operand, feats), feats.index)
        val = _num(_ev(node.operand, feats))
        return -val if isinstance(node.op, ast.USub) else +val
    if isinstance(node, ast.BinOp):
        l, r = _num(_ev(node.left, feats)), _num(_ev(node.right, feats))
        if isinstance(node.op, ast.Add):
            return l + r
        if isinstance(node.op, ast.Sub):
            return l - r
        if isinstance(node.op, ast.Mult):
            return l * r
        if isinstance(node.op, ast.Div):                       # guard divide-by-zero
            if isinstance(r, pd.Series):
                r = r.replace(0, np.nan)
            elif r == 0:
                r = np.nan
            return l / r
    if isinstance(node, ast.Compare):
        left = _num(_ev(node.left, feats))
        result = None
        for op, comp in zip(node.ops, node.comparators):
            right = _num(_ev(comp, feats))
            c = _CMP[type(op)](left, right)
            result = c if result is None else (result & c)
            left = right                                        # chained comparisons
        return result
    if isinstance(node, ast.Name):
        return feats[node.id]
    if isinstance(node, ast.Constant):
        return node.value
    raise RuleError(f"Unsupported expression: {type(node).__name__}")


def evaluate_bool(node: ast.AST, feats: pd.DataFrame) -> pd.Series:
    """Boolean mask over feats.index for a compiled condition node."""
    return _as_bool_series(_ev(node, feats), feats.index)


def evaluate_num(node: ast.AST, feats: pd.DataFrame) -> pd.Series:
    """Numeric series over feats.index for a compiled value node."""
    v = _ev(node, feats)
    if not isinstance(v, pd.Series):
        v = pd.Series(float(v), index=feats.index)
    return v.astype(float)


# ── weights ───────────────────────────────────────────────────────────────────
def apply_weights(q: pd.DataFrame, spec) -> pd.Series:
    """Normalized (sum=1) weights for the selected holdings per a WeightSpec.

    equal / score (∝ 0-100 score) / inverse_vol (∝ 1/atr_pct) / by_field (∝ field)."""
    if q.empty:
        return pd.Series(dtype=float)
    scheme = spec.scheme
    if scheme == "equal":
        w = pd.Series(1.0, index=q.index)
    elif scheme == "score":
        w = q["score"].astype(float).clip(lower=0)
    elif scheme == "inverse_vol":
        vol = q["atr_pct"].astype(float).replace(0, np.nan)
        w = 1.0 / vol
    elif scheme == "by_field":
        if not spec.field or spec.field not in q.columns:
            raise RuleError(f"Weight field '{spec.field}' is not a valid field.")
        w = q[spec.field].astype(float).clip(lower=0)
    else:
        w = pd.Series(1.0, index=q.index)
    w = w.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    if w.sum() <= 0:                                            # degenerate -> equal weight
        w = pd.Series(1.0, index=q.index)
    return w / w.sum()


# ── explainability ────────────────────────────────────────────────────────────
def _split_and(node: ast.AST) -> list[ast.AST]:
    if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
        out: list[ast.AST] = []
        for v in node.values:
            out += _split_and(v)
        return out
    return [node]


def _leading_value(node: ast.AST, feats: pd.DataFrame):
    try:
        target = node.left if isinstance(node, ast.Compare) else node
        val = _ev(target, feats)
        return val if isinstance(val, pd.Series) else None
    except Exception:
        return None


def _explain(q: pd.DataFrame, entry_node: ast.AST, feats: pd.DataFrame) -> pd.DataFrame:
    """Attach reasons/checks by decomposing the top-level ANDs of the entry rule."""
    from app.services import portfolios_service as ps
    checks = []
    for sub in _split_and(entry_node):
        label = ast.unparse(sub)
        passed = evaluate_bool(sub, feats)
        checks.append((label, passed, _leading_value(sub, feats)))
    return ps._explain(q, checks)


# ── adapter: PortfolioSpec -> Portfolio-like object ───────────────────────────
class CustomPortfolio:
    """Duck-types the built-in `Portfolio` so get_screen / the tracker treat it the same."""

    def __init__(self, spec):
        self.spec = spec
        self.key = spec.key
        self.name = spec.name
        self.description = spec.description
        self.expected_holding = spec.expected_holding
        self.rebalance = {"W": "Weekly", "M": "Monthly", "Q": "Quarterly"}[spec.rebalance_freq]
        self.size = spec.max_holdings
        self.volatility = spec.volatility_stars
        self.is_custom = True
        # Compile up-front so construction fails fast on a bad rule.
        self._entry = compile_rule(spec.entry, "entry", expect="bool")
        self._rank = compile_rule(spec.rank_by, "entry", expect="num")
        self._eviction = compile_rule(spec.eviction, "eviction", expect="bool") if spec.eviction else None
        self._rebalance = (
            compile_rule(spec.rebalance, "entry", expect="bool") if spec.rebalance else self._entry
        )
        self._fill = compile_rule(spec.fill, "entry", expect="bool") if spec.fill else None
        self._fill_rank = (
            compile_rule(spec.fill_rank_by, "entry", expect="num") if spec.fill_rank_by else self._rank
        )

    def _ranked(self, node, feats, index) -> pd.Series:
        from app.services import portfolios_service as ps
        return ps._scale(evaluate_num(node, feats).reindex(index)).fillna(0.0)

    def select(self, feats: pd.DataFrame, size: int | None = None) -> pd.DataFrame:
        cap = size or self.spec.max_holdings
        # 1) core: the entry (must-have) names, ranked by rank_by, capped.
        core = feats[evaluate_bool(self._entry, feats)].copy()
        if not core.empty:
            core["score"] = self._ranked(self._rank, feats, core.index)
            core = _explain(core, self._entry, feats)
            core = core.sort_values("score", ascending=False).head(cap)

        # 2) fill: if short of cap and a fill pool is defined, top up from it (excluding
        #    names already picked), ordered by fill_rank_by. Fill names sit BELOW core.
        if self._fill is not None and len(core) < cap:
            picked = set(core.index)
            keep = evaluate_bool(self._fill, feats).to_numpy() & ~feats.index.isin(picked)
            pool = feats[keep].copy()
            if not pool.empty:
                pool["score"] = self._ranked(self._fill_rank, feats, pool.index)
                pool = pool.sort_values("score", ascending=False).head(cap - len(core))
                pool["reasons"] = [["Fill — top-up to target size"] for _ in range(len(pool))]
                pool["checks"] = [[] for _ in range(len(pool))]
                if not core.empty:                              # band so core outranks fill
                    core["score"] = 50.0 + core["score"] / 2.0
                    pool["score"] = pool["score"] / 2.0
                core = pd.concat([core, pool]) if not core.empty else pool

        if core.empty:
            return core
        core["weight"] = apply_weights(core, self.spec.weight)  # normalized over the final basket
        return core


def build_custom(spec) -> CustomPortfolio:
    """Construct (and thereby validate) a CustomPortfolio from a PortfolioSpec."""
    return CustomPortfolio(spec)


def validate_spec(spec) -> None:
    """Raise RuleError if any rule in the spec is invalid. Used by the create endpoint."""
    build_custom(spec)                                         # compiles every rule
    for w in (spec.weight, spec.rebalance_weight):
        if w.scheme == "by_field":
            num, boo = field_sets("entry")
            if not w.field or w.field not in (num | boo):
                raise RuleError(f"Weight field '{w.field}' is not a valid field.")
