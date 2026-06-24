"""Regression tests for intraday_race_service pure-logic functions.

Run from marketdna-backend/ with venv active:
    .venv/Scripts/python.exe -m pytest tests/test_intraday_race.py -v

These tests verify the core computation logic that drives the IntradayRacePage.
They do not hit DuckDB, Kite, or the network — all external state is patched.
"""
import pytest
import app.services.live_trading_service as _lts
from app.services.intraday_race_service import (
    _classify,
    _atr2_from_iday,
    _kite_result_looks_degenerate,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _ranked(n: int) -> list[tuple[str, float]]:
    """n symbols ranked best→worst: SYM00 has highest return."""
    return [(f"SYM{i:02d}", float(n - i)) for i in range(n)]


def _inject_iday(sym: str, buf: list[tuple[str, float]]) -> None:
    _lts._iday[sym] = buf


def _clear_iday(sym: str) -> None:
    _lts._iday.pop(sym, None)


# ── _classify ─────────────────────────────────────────────────────────────────

class TestClassify:

    def test_top10_assigned_correctly(self):
        ranked = _ranked(50)
        cats = _classify(ranked, {})
        for sym, _ in ranked[:10]:
            assert cats[sym] == "top", f"{sym} should be 'top'"

    def test_bot10_assigned_correctly(self):
        ranked = _ranked(50)
        cats = _classify(ranked, {})
        for sym, _ in ranked[40:]:
            assert cats[sym] == "bot", f"{sym} should be 'bot'"

    def test_top_bot_never_overlap(self):
        """Edge case: n=10 — top and bot pools must be disjoint."""
        ranked = _ranked(10)
        cats = _classify(ranked, {})
        top_syms = {s for s, c in cats.items() if c == "top"}
        bot_syms = {s for s, c in cats.items() if c == "bot"}
        assert top_syms.isdisjoint(bot_syms)

    def test_recovering_stock(self):
        """A middle stock that moved up 10 places → 'rec'."""
        ranked = _ranked(30)
        prev = {s: i + 1 for i, (s, _) in enumerate(ranked)}
        prev["SYM14"] = 25   # was 25th, now 15th → gained 10 places
        cats = _classify(ranked, prev)
        assert cats["SYM14"] == "rec"

    def test_declining_stock(self):
        """A middle stock that dropped 6 places → 'dec'."""
        ranked = _ranked(30)
        prev = {s: i + 1 for i, (s, _) in enumerate(ranked)}
        prev["SYM15"] = 10   # was 10th, now 16th → dropped 6 places
        cats = _classify(ranked, prev)
        assert cats["SYM15"] == "dec"

    def test_no_rank_change_is_neu(self):
        ranked = _ranked(30)
        prev = {s: i + 1 for i, (s, _) in enumerate(ranked)}
        cats = _classify(ranked, prev)
        for sym, _ in ranked[10:20]:   # middle band
            assert cats[sym] == "neu", f"{sym} with unchanged rank should be 'neu'"

    def test_empty_universe(self):
        assert _classify([], {}) == {}

    def test_small_universe_no_crash(self):
        ranked = _ranked(3)
        cats = _classify(ranked, {})
        valid = {"top", "bot", "rec", "dec", "neu"}
        for sym, cat in cats.items():
            assert cat in valid

    def test_rec_dec_counts_capped_at_10(self):
        """With 100 stocks all improving rank, rec count must be ≤ 10."""
        ranked = _ranked(100)
        # All middle stocks appear to have improved (prev_rank >> cur_rank)
        prev = {s: i + 51 for i, (s, _) in enumerate(ranked)}
        cats = _classify(ranked, prev)
        assert sum(1 for c in cats.values() if c == "rec") <= 10
        assert sum(1 for c in cats.values() if c == "dec") <= 10

    def test_all_symbols_assigned(self):
        ranked = _ranked(50)
        cats = _classify(ranked, {})
        assert set(cats.keys()) == {s for s, _ in ranked}

    def test_top_symbols_never_become_rec_dec(self):
        """Top-10 symbols are immune to rec/dec even with large rank deltas."""
        ranked = _ranked(50)
        prev = {s: i + 20 for i, (s, _) in enumerate(ranked)}
        cats = _classify(ranked, prev)
        for sym, _ in ranked[:10]:
            assert cats[sym] == "top"

    def test_bot_symbols_never_become_rec_dec(self):
        ranked = _ranked(50)
        prev = {s: max(1, i - 20) for i, (s, _) in enumerate(ranked)}
        cats = _classify(ranked, prev)
        for sym, _ in ranked[40:]:
            assert cats[sym] == "bot"


# ── _atr2_from_iday ───────────────────────────────────────────────────────────

class TestAtr2FromIday:

    def teardown_method(self):
        _clear_iday("TESTSYM")

    def test_missing_symbol_returns_zero(self):
        _clear_iday("TESTSYM")
        assert _atr2_from_iday("TESTSYM") == 0.0

    def test_too_few_ticks_returns_zero(self):
        _inject_iday("TESTSYM", [("09:15", 100.0), ("09:16", 101.0)])
        assert _atr2_from_iday("TESTSYM") == 0.0

    def test_too_few_minutes_returns_zero(self):
        # 4 ticks but all in the same minute → only 1 bar → need ≥ 3
        _inject_iday("TESTSYM", [("09:15", 100.0)] * 4)
        assert _atr2_from_iday("TESTSYM") == 0.0

    def test_basic_atr2(self):
        """3 minutes of symmetric 4-point ranges → ATR(2) = 4.0."""
        buf = [
            ("09:15", 98.0), ("09:15", 102.0),   # bar1: h=102, l=98, c=102
            ("09:16", 99.0), ("09:16", 103.0),   # bar2: h=103, l=99, c=103
            ("09:17", 100.0), ("09:17", 104.0),  # bar3: h=104, l=100, c=104
        ]
        _inject_iday("TESTSYM", buf)
        atr2 = _atr2_from_iday("TESTSYM")
        # TR1 = max(103,102) − min(99,102) = 103−99 = 4
        # TR2 = max(104,103) − min(100,103) = 104−100 = 4
        # ATR(2) = mean([4, 4]) = 4.0
        assert atr2 == pytest.approx(4.0, abs=0.01)

    def test_uses_only_last_3_minutes(self):
        """With 5 minutes of data the first 2 minutes are ignored."""
        buf = [
            ("09:13", 50.0), ("09:13", 70.0),    # irrelevant early bar
            ("09:14", 50.0), ("09:14", 70.0),    # irrelevant early bar
            ("09:15", 98.0), ("09:15", 102.0),   # last 3 bars start here
            ("09:16", 99.0), ("09:16", 103.0),
            ("09:17", 100.0), ("09:17", 104.0),
        ]
        _inject_iday("TESTSYM", buf)
        atr2 = _atr2_from_iday("TESTSYM")
        assert atr2 == pytest.approx(4.0, abs=0.01)

    def test_non_negative(self):
        """ATR must always be ≥ 0."""
        buf = [
            ("09:15", 100.0), ("09:15", 100.5),
            ("09:16", 100.2), ("09:16", 100.7),
            ("09:17", 100.1), ("09:17", 100.6),
        ]
        _inject_iday("TESTSYM", buf)
        assert _atr2_from_iday("TESTSYM") >= 0.0


# ── _kite_result_looks_degenerate ─────────────────────────────────────────────

class TestKiteResultLooksDegenerate:

    def test_empty_dict_is_degenerate(self):
        assert _kite_result_looks_degenerate({}) is True

    def test_near_zero_returns_is_degenerate(self):
        result = {"15:25": {"SYM1": {"return_pct": 0.01}, "SYM2": {"return_pct": -0.02}}}
        assert _kite_result_looks_degenerate(result) is True

    def test_real_returns_not_degenerate(self):
        result = {
            "15:25": {"SYM1": {"return_pct": 1.5}, "SYM2": {"return_pct": -2.3}},
            "15:26": {"SYM1": {"return_pct": 1.6}, "SYM2": {"return_pct": -2.4}},
        }
        assert _kite_result_looks_degenerate(result) is False

    def test_threshold_boundary_not_degenerate(self):
        """avg |ret| == 0.05 is NOT strictly less than 0.05 → not degenerate."""
        result = {"15:25": {"SYM1": {"return_pct": 0.05}, "SYM2": {"return_pct": -0.05}}}
        assert _kite_result_looks_degenerate(result) is False

    def test_mixed_frames_uses_average(self):
        """One frame with real returns, one with zeros — average is above threshold."""
        result = {
            "15:25": {"SYM1": {"return_pct": 1.0}},
            "15:26": {"SYM1": {"return_pct": 0.0}},
        }
        # avg |ret| = 0.5 → not degenerate
        assert _kite_result_looks_degenerate(result) is False

    def test_single_symbol_positive_return(self):
        result = {"15:25": {"RELIANCE": {"return_pct": 0.8}}}
        assert _kite_result_looks_degenerate(result) is False

    def test_all_zero_returns_is_degenerate(self):
        result = {
            "15:25": {"SYM1": {"return_pct": 0.0}, "SYM2": {"return_pct": 0.0}},
            "15:26": {"SYM1": {"return_pct": 0.0}, "SYM2": {"return_pct": 0.0}},
        }
        assert _kite_result_looks_degenerate(result) is True
