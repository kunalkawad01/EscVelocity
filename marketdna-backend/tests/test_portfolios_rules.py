"""Unit tests for the custom-portfolio rule engine (portfolios_rules)."""
import numpy as np
import pandas as pd
import pytest

from app.models.portfolios import PortfolioSpec, WeightSpec
from app.services import portfolios_rules as pr
from app.services import portfolios_service as ps


@pytest.fixture(scope="module")
def feats():
    f = ps.build_features(universe="nifty500")
    if f.empty:
        pytest.skip("no equities data available")
    return f


def _mask_eq(a: pd.Series, b: pd.Series) -> bool:
    a, b = a.reindex(sorted(a.index)), b.reindex(sorted(b.index))
    return bool((a.fillna(False) == b.fillna(False)).all())


# ── parsing / safety ──────────────────────────────────────────────────────────
def test_unknown_field_rejected():
    with pytest.raises(pr.RuleError) as e:
        pr.compile_rule("std_dev > 3", "entry")
    assert "Unknown field" in str(e.value)


def test_function_call_rejected():
    with pytest.raises(pr.RuleError):
        pr.compile_rule("abs(rsi14) > 30", "entry")


def test_attribute_and_subscript_rejected():
    with pytest.raises(pr.RuleError):
        pr.compile_rule("rsi14.real > 3", "entry")
    with pytest.raises(pr.RuleError):
        pr.compile_rule("rsi14[0] > 3", "entry")


def test_bare_value_rejected_as_entry():
    with pytest.raises(pr.RuleError):
        pr.compile_rule("rsi14", "entry", expect="bool")           # not a condition


def test_position_field_only_in_eviction():
    pr.compile_rule("since_entry_pct < -8", "eviction")            # ok
    with pytest.raises(pr.RuleError):
        pr.compile_rule("since_entry_pct < -8", "entry")           # not allowed at entry


# ── evaluation matches native pandas ──────────────────────────────────────────
def test_simple_predicate_matches_pandas(feats):
    node = pr.compile_rule("rsi14 < 30 and above_sma200", "entry")
    got = pr.evaluate_bool(node, feats)
    want = (feats["rsi14"] < 30) & feats["above_sma200"]
    assert _mask_eq(got, want)


def test_arithmetic_zscore_matches_pandas(feats):
    # "3 std devs above SMA20" via raw arithmetic (Option B)...
    node = pr.compile_rule("(close - sma20) / std20 > 3", "entry")
    got = pr.evaluate_bool(node, feats)
    want = ((feats["close"] - feats["sma20"]) / feats["std20"].replace(0, np.nan) > 3)
    assert _mask_eq(got, want)


def test_convenience_field_matches_arithmetic(feats):
    # ...and the pre-computed convenience field (Option C) agrees.
    a = pr.evaluate_bool(pr.compile_rule("z20 > 3", "entry"), feats)
    b = pr.evaluate_bool(pr.compile_rule("(close - sma20) / std20 > 3", "entry"), feats)
    assert _mask_eq(a, b)


# ── weights ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("scheme,field", [
    ("equal", None), ("score", None), ("inverse_vol", None), ("by_field", "mom_score"),
])
def test_weights_sum_to_one(feats, scheme, field):
    q = feats.head(10).copy()
    q["score"] = np.linspace(10, 90, len(q))
    w = pr.apply_weights(q, WeightSpec(scheme=scheme, field=field))
    assert abs(float(w.sum()) - 1.0) < 1e-9
    assert (w >= 0).all()


def test_equal_weights_are_uniform(feats):
    q = feats.head(8).copy()
    w = pr.apply_weights(q, WeightSpec(scheme="equal"))
    assert np.allclose(w.values, 1.0 / len(q))


# ── CustomPortfolio.select contract ───────────────────────────────────────────
def test_custom_select_contract(feats):
    spec = PortfolioSpec(
        key="test_oversold", name="Test Oversold", entry="rsi14 < 40 and above_sma200",
        rank_by="mom_score", max_holdings=5, weight=WeightSpec(scheme="score"),
    )
    port = pr.build_custom(spec)
    out = port.select(feats)
    assert len(out) <= 5
    if not out.empty:
        assert {"score", "reasons", "checks", "weight"} <= set(out.columns)
        assert abs(float(out["weight"].sum()) - 1.0) < 1e-9
        # every selected name genuinely satisfies the entry rule
        want = feats[(feats["rsi14"] < 40) & feats["above_sma200"]]
        assert set(out.index) <= set(want.index)
        assert (out["score"] >= 0).all() and (out["score"] <= 100).all()


def test_bad_rule_fails_construction():
    spec = PortfolioSpec(key="bad_rule", name="Bad", entry="notafield > 1")
    with pytest.raises(pr.RuleError):
        pr.build_custom(spec)


# ── ordinal rank fields + core/fill selection (12m∩6m with 12m fill) ───────────
def test_ordinal_rank_fields_present(feats):
    for c in ("ret_12m_rank", "ret_6m_rank", "ret_3m_rank", "ret_1m_rank"):
        assert c in feats.columns
    # rank 1 == the single highest 12m return
    top = feats["ret_12m"].idxmax()
    assert float(feats.loc[top, "ret_12m_rank"]) == 1.0


def test_intersection_only(feats):
    spec = PortfolioSpec(key="mom_isect", name="Intersect", max_holdings=20,
                         entry="ret_12m_rank <= 20 and ret_6m_rank <= 20", rank_by="ret_12m")
    out = pr.build_custom(spec).select(feats)
    want = feats[(feats["ret_12m_rank"] <= 20) & (feats["ret_6m_rank"] <= 20)]
    assert set(out.index) == set(want.index)                 # exact intersection
    assert len(out) <= 20


def test_core_plus_fill_tops_up_to_max(feats):
    spec = PortfolioSpec(
        key="mom_1206", name="12m∩6m + 12m fill", max_holdings=20,
        entry="ret_12m_rank <= 20 and ret_6m_rank <= 20",
        fill="ret_12m_rank <= 40", rank_by="ret_12m",
    )
    core = feats[(feats["ret_12m_rank"] <= 20) & (feats["ret_6m_rank"] <= 20)]
    out = pr.build_custom(spec).select(feats)
    # the whole intersection is retained...
    assert set(core.index) <= set(out.index)
    # ...and the basket is filled to 20 (universe easily has 40 ranked names)
    assert len(out) == 20
    # fill names are flagged, and every extra name is within the top-40 by 12m
    extras = [s for s in out.index if s not in set(core.index)]
    for s in extras:
        assert feats.loc[s, "ret_12m_rank"] <= 40
    assert all(out.loc[s, "reasons"] == ["Fill — top-up to target size"] for s in extras)
    assert abs(float(out["weight"].sum()) - 1.0) < 1e-9


# ── Phase 2: store + registry resolver ────────────────────────────────────────
def test_store_roundtrip_and_resolver():
    from app.services import portfolios_store as store
    key = "test_unit_rt"
    store.delete_spec(key)                                     # clean slate
    try:
        spec = PortfolioSpec(
            key=key, name="RT", entry="rsi14 < 50 and above_sma200",
            rank_by="mom_score", max_holdings=7, rebalance_freq="W",
        )
        store.save_spec(spec)
        assert store.get_spec(key) is not None
        # resolves through the SAME entry point as built-ins
        p = ps.get_portfolio(key)
        assert p.is_custom and p.rebalance == "Weekly" and p.size == 7
        assert key in ps.all_portfolios()
        assert any(m["key"] == key and m["is_custom"] for m in ps.list_portfolios())
    finally:
        assert store.delete_spec(key)
        assert store.get_spec(key) is None


def test_invalid_spec_not_persisted():
    from app.services import portfolios_store as store
    key = "test_unit_bad"
    store.delete_spec(key)
    spec = PortfolioSpec(key=key, name="Bad", entry="nope > 1")
    with pytest.raises(pr.RuleError):
        store.save_spec(spec)
    assert store.get_spec(key) is None                        # nothing written on failure


def test_field_catalog_shape():
    fc = pr.field_catalog("eviction")
    names = {f["name"] for f in fc}
    assert {"rsi14", "z20", "above_sma200"} <= names
    pos = {f["name"] for f in fc if f["position_only"]}
    assert pos == {"since_entry_pct", "days_held"}
    assert all(f["kind"] in ("numeric", "boolean") for f in fc)


# ── Phase 3: weighting + eviction / stop-loss ─────────────────────────────────
from datetime import date as _date  # noqa: E402
from app.services import portfolios_tracker_service as tk  # noqa: E402


def test_rebalance_period_quarterly():
    assert tk._rebalance_period(_date(2026, 1, 15), "Quarterly") == \
           tk._rebalance_period(_date(2026, 3, 31), "Quarterly")            # same quarter
    assert tk._rebalance_period(_date(2026, 3, 31), "Quarterly") != \
           tk._rebalance_period(_date(2026, 4, 1), "Quarterly")            # next quarter


def test_make_basis_rows_uses_custom_weights():
    rtab = pd.DataFrame({"c0": [100.0, 200.0, 50.0]}, index=["A", "B", "C"])
    screen = {"holdings": [
        {"symbol": "A", "weight": 0.5, "reasons": []},
        {"symbol": "B", "weight": 0.3, "reasons": []},
        {"symbol": "C", "weight": 0.2, "reasons": []},
    ]}
    b = tk._make_basis_rows("k", "nifty500", _date(2026, 7, 10), 100.0, screen, rtab)
    w = dict(zip(b["symbol"], b["weight"]))
    assert abs(w["A"] - 0.5) < 1e-9 and abs(w["B"] - 0.3) < 1e-9 and abs(w["C"] - 0.2) < 1e-9


def test_make_basis_rows_equal_when_unweighted():
    rtab = pd.DataFrame({"c0": [100.0, 200.0]}, index=["A", "B"])
    screen = {"holdings": [{"symbol": "A", "weight": None, "reasons": []},
                           {"symbol": "B", "weight": None, "reasons": []}]}
    b = tk._make_basis_rows("k", "nifty500", _date(2026, 7, 10), 100.0, screen, rtab)
    assert np.allclose(b["weight"].values, 0.5)


def test_custom_weights_inverse_vol(feats):
    port = pr.build_custom(PortfolioSpec(key="cwt", name="cwt", entry="above_sma200",
                                         weight=WeightSpec(scheme="inverse_vol")))
    syms = list(feats.index[:5])
    w = tk._custom_weights(port, syms, feats, WeightSpec(scheme="inverse_vol"))
    assert abs(sum(w.values()) - 1.0) < 1e-9
    # lower ATR% => higher weight
    lo = min(syms, key=lambda s: feats.loc[s, "atr_pct"])
    hi = max(syms, key=lambda s: feats.loc[s, "atr_pct"])
    assert w[lo] > w[hi]


def _mine(symbols, weights, entries, base_nav=100.0):
    return pd.DataFrame([
        tk._brow("k", "nifty500", _date(2026, 7, 10), base_nav, s, e, w, "")
        for s, w, e in zip(symbols, weights, entries)
    ], columns=tk._BASIS_COLS)


def test_eviction_mask_stop_loss():
    port = pr.build_custom(PortfolioSpec(key="evt", name="evt", entry="above_sma200",
                                         eviction="since_entry_pct < -5"))
    mine = _mine(["A", "B"], [0.5, 0.5], [100.0, 100.0])
    feats = pd.DataFrame({"close": [88.0, 101.0]}, index=["A", "B"])  # rule uses only position fields
    rtab = pd.DataFrame({"c0": [88.0, 101.0]}, index=["A", "B"])   # A -12% (stop), B +1%
    mask = tk._eviction_mask(port, mine, feats, rtab, _date(2026, 7, 20), _date(2026, 7, 10))
    assert mask == {"A": True, "B": False}


def test_evict_redistribute_preserves_nav():
    port = pr.build_custom(PortfolioSpec(key="ert", name="ert", entry="above_sma200",
                                         eviction="since_entry_pct < -5", eviction_weight="redistribute"))
    mine = _mine(["A", "B", "C"], [0.4, 0.35, 0.25], [100.0, 100.0, 100.0])
    rtab = pd.DataFrame({"c0": [88.0, 110.0, 120.0]}, index=["A", "B", "C"])
    nav_before = tk._basket_nav(mine, rtab)
    nb = tk._evict(port, mine, ["A"], rtab, nav_before, _date(2026, 7, 10), "k", "nifty500")
    assert set(nb["symbol"]) == {"B", "C"}                 # A dropped, no cash
    assert abs(nb["weight"].sum() - 1.0) < 1e-9
    assert abs(tk._basket_nav(nb, rtab) - nav_before) < 1e-6   # NAV continuous


def test_evict_hold_cash_preserves_nav():
    port = pr.build_custom(PortfolioSpec(key="ect", name="ect", entry="above_sma200",
                                         eviction="since_entry_pct < -5", eviction_weight="hold_cash"))
    mine = _mine(["A", "B", "C"], [0.4, 0.35, 0.25], [100.0, 100.0, 100.0])
    rtab = pd.DataFrame({"c0": [88.0, 110.0, 120.0]}, index=["A", "B", "C"])
    nav_before = tk._basket_nav(mine, rtab)
    nb = tk._evict(port, mine, ["A"], rtab, nav_before, _date(2026, 7, 10), "k", "nifty500")
    assert tk.CASH_SYMBOL in set(nb["symbol"])
    assert abs(float(nb.loc[nb["symbol"] == tk.CASH_SYMBOL, "weight"].iloc[0]) - 0.4) < 1e-9
    assert abs(tk._basket_nav(nb, rtab) - nav_before) < 1e-6   # NAV continuous
