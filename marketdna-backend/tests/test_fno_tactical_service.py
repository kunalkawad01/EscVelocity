"""Unit tests for the F&O tactical service pure logic.

Covers the deterministic decision core — market-state machine, quadrant truth
table, monthly-trend classification, breadth verdict, and signal grading — with
no Kite/DuckDB dependency (all inputs injected).
"""
from datetime import datetime

import app.services.fno_tactical_service as svc


# ── resolve_market_state ──────────────────────────────────────────────────────
def _ist(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm)


def test_state_live():
    # 2025-07-10 is a Thursday, not an NSE holiday
    st = svc.resolve_market_state(_ist(2025, 7, 10, 11, 0))
    assert st["state"] == "LIVE" and st["is_live"] is True
    assert st["session_date"] == "2025-07-10"


def test_state_pre_open_and_precompute():
    assert svc.resolve_market_state(_ist(2025, 7, 10, 9, 5))["state"] == "PRE_OPEN"
    assert svc.resolve_market_state(_ist(2025, 7, 10, 8, 30))["state"] == "PRE_PRECOMPUTE"


def test_state_closed_after_1530():
    st = svc.resolve_market_state(_ist(2025, 7, 10, 15, 45))
    assert st["state"] == "CLOSED" and st["is_live"] is False


def test_state_boundaries_exact():
    # 09:15 IST is the first LIVE minute; 15:30 flips to CLOSED
    assert svc.resolve_market_state(_ist(2025, 7, 10, 9, 15))["state"] == "LIVE"
    assert svc.resolve_market_state(_ist(2025, 7, 10, 9, 14))["state"] == "PRE_OPEN"
    assert svc.resolve_market_state(_ist(2025, 7, 10, 15, 30))["state"] == "CLOSED"
    assert svc.resolve_market_state(_ist(2025, 7, 10, 15, 29))["state"] == "LIVE"


def test_state_weekend_is_holiday_frame():
    # 2025-07-12 is a Saturday → HOLIDAY, session rolls back to Friday 07-11
    st = svc.resolve_market_state(_ist(2025, 7, 12, 11, 0))
    assert st["state"] == "HOLIDAY" and st["is_live"] is False
    assert st["session_date"] == "2025-07-11"


def test_state_nse_holiday():
    # 2025-08-15 (Independence Day) is in the holiday set even though it is a weekday
    st = svc.resolve_market_state(_ist(2025, 8, 15, 11, 0))
    assert st["state"] == "HOLIDAY"
    assert st["session_date"] == "2025-08-14"


# ── quadrant truth table ──────────────────────────────────────────────────────
def test_quadrant_truth_table():
    assert svc._quadrant(1, 1) == "LONG_BUILDUP"
    assert svc._quadrant(1, -1) == "SHORT_COVERING"
    assert svc._quadrant(-1, 1) == "SHORT_BUILDUP"
    assert svc._quadrant(-1, -1) == "LONG_UNWINDING"
    assert svc._quadrant(0, 1) is None
    assert svc._quadrant(1, 0) is None


# ── trend classification ──────────────────────────────────────────────────────
def test_trend_up():
    closes = [110 - i * 0.2 for i in range(60)]  # rising (most-recent-first = highest)
    assert svc._trend(ltp=112, sma20=108, sma50=104, closes_60d=closes) == "UP"


def test_trend_down():
    closes = [90 + i * 0.2 for i in range(60)]  # falling (most-recent-first = lowest)
    assert svc._trend(ltp=88, sma20=92, sma50=96, closes_60d=closes) == "DOWN"


def test_trend_none_when_mixed():
    closes = [100.0] * 60
    # ltp above sma50 but sma20 < sma50 → not a clean UP
    assert svc._trend(ltp=101, sma20=99, sma50=100, closes_60d=closes) == "NONE"


def test_trend_none_insufficient_data():
    assert svc._trend(ltp=100, sma20=None, sma50=None, closes_60d=[]) == "NONE"


# ── breadth verdict ───────────────────────────────────────────────────────────
def _rows(n_up, n_down, n_above_vwap):
    rows = []
    for i in range(n_up):
        rows.append({"ret_pct": 1.0, "above_vwap": i < n_above_vwap})
    for i in range(n_down):
        rows.append({"ret_pct": -1.0, "above_vwap": False})
    return rows


def test_breadth_risk_on():
    rows = _rows(n_up=80, n_down=20, n_above_vwap=70)  # 70% vwap, adv/decl=4, nifty>0
    b = svc._compute_breadth(rows, nifty_ret=0.6, ist=_ist(2025, 7, 10, 11, 0))
    assert b["verdict"] == "RISK_ON" and b["longs_enabled"] and not b["shorts_enabled"]


def test_breadth_risk_off():
    rows = _rows(n_up=20, n_down=80, n_above_vwap=10)  # 10% vwap, adv/decl=0.25, nifty<0
    b = svc._compute_breadth(rows, nifty_ret=-0.6, ist=_ist(2025, 7, 10, 11, 0))
    assert b["verdict"] == "RISK_OFF" and b["shorts_enabled"] and not b["longs_enabled"]


def test_breadth_neutral():
    rows = _rows(n_up=55, n_down=45, n_above_vwap=50)
    b = svc._compute_breadth(rows, nifty_ret=0.1, ist=_ist(2025, 7, 10, 11, 0))
    assert b["verdict"] == "NEUTRAL"


# ── signal grading ────────────────────────────────────────────────────────────
_LIVE_MIN = 660  # 11:00 IST — past the time-of-day filter


def _grade_row(**over):
    base = {
        "trend": "UP", "quadrant": "LONG_BUILDUP", "extended": False,
        "rel_strength": 0.8, "above_vwap": True,
    }
    base.update(over)
    return base


def test_grade_a_long_full_size_on_risk_on():
    g = svc._grade(_grade_row(), verdict="RISK_ON", state="LIVE", mins=_LIVE_MIN)
    assert g["direction"] == "long" and g["grade"] == "A" and g["size"] == "full"


def test_grade_b_long_half_on_short_covering():
    g = svc._grade(_grade_row(quadrant="SHORT_COVERING"), verdict="RISK_ON", state="LIVE", mins=_LIVE_MIN)
    assert g["grade"] == "B" and g["size"] == "half"


def test_grade_a_short_on_downtrend():
    g = svc._grade(_grade_row(trend="DOWN", quadrant="SHORT_BUILDUP", rel_strength=-0.9, above_vwap=False),
                   verdict="RISK_OFF", state="LIVE", mins=_LIVE_MIN)
    assert g["direction"] == "short" and g["grade"] == "A" and g["size"] == "full"


def test_grade_gate_suppresses_long_on_risk_off():
    g = svc._grade(_grade_row(), verdict="RISK_OFF", state="LIVE", mins=_LIVE_MIN)
    assert g["grade"] == "NONE" and g["direction"] == "none"


def test_grade_extended_is_skipped():
    g = svc._grade(_grade_row(extended=True), verdict="RISK_ON", state="LIVE", mins=_LIVE_MIN)
    assert g["grade"] == "NONE"


def test_grade_time_of_day_suppressed_early():
    g = svc._grade(_grade_row(), verdict="RISK_ON", state="LIVE", mins=560)  # 09:20, too early
    assert g["grade"] == "NONE"


def test_grade_no_trend_sits_out():
    g = svc._grade(_grade_row(trend="NONE"), verdict="RISK_ON", state="LIVE", mins=_LIVE_MIN)
    assert g["grade"] == "NONE"


def test_grade_rel_strength_must_align():
    g = svc._grade(_grade_row(rel_strength=-0.2), verdict="RISK_ON", state="LIVE", mins=_LIVE_MIN)
    assert g["grade"] == "NONE"


def test_grade_vwap_side_must_align():
    g = svc._grade(_grade_row(above_vwap=False), verdict="RISK_ON", state="LIVE", mins=_LIVE_MIN)
    assert g["grade"] == "NONE"


def test_grade_neutral_gate_is_half_size():
    g = svc._grade(_grade_row(), verdict="NEUTRAL", state="LIVE", mins=_LIVE_MIN)
    assert g["grade"] == "A" and g["size"] == "half"
