"""Unit tests for options_service pure-logic functions.

Run from marketdna-backend/ with venv active:
    .venv/Scripts/python.exe -m pytest tests/test_options_service.py -v

These test the deterministic computation layer (IV cleaning, Black-Scholes
greeks, OI-buildup signal, max pain) — no DuckDB, Kite, or network.
"""
import math

import pytest

from app.services.options_service import (
    _clean_iv,
    _bs_greeks,
    _build_signal,
    _compute_max_pain,
    _nearest_strike,
    _IV_MIN,
    _IV_MAX,
)
from app.models.options import StrikeData


# ── _clean_iv ─────────────────────────────────────────────────────────────────

class TestCleanIV:

    def test_none_is_none(self):
        assert _clean_iv(None) is None

    def test_plausible_kept(self):
        assert _clean_iv(22.5) == 22.5

    def test_garbage_high_dropped(self):
        assert _clean_iv(499.94) is None
        assert _clean_iv(150.01) is None

    def test_too_low_dropped(self):
        assert _clean_iv(0.5) is None

    def test_band_boundaries_inclusive(self):
        assert _clean_iv(_IV_MIN) == _IV_MIN
        assert _clean_iv(_IV_MAX) == _IV_MAX

    def test_non_numeric_is_none(self):
        assert _clean_iv("abc") is None


# ── _bs_greeks ────────────────────────────────────────────────────────────────

class TestBSGreeks:

    def test_atm_call_delta_near_half(self):
        g = _bs_greeks(1280, 1280, 22.5, 15, "CE")
        assert g is not None
        assert 0.5 <= g["delta"] <= 0.6   # slightly > 0.5 with positive rate

    def test_atm_put_delta_near_negative_half(self):
        g = _bs_greeks(1280, 1280, 22.5, 15, "PE")
        assert g is not None
        assert -0.55 <= g["delta"] <= -0.4

    def test_put_call_delta_parity(self):
        """call_delta - put_delta == 1 at the same strike/IV (BS identity)."""
        c = _bs_greeks(1280, 1300, 25.0, 30, "CE")
        p = _bs_greeks(1280, 1300, 25.0, 30, "PE")
        assert c["delta"] - p["delta"] == pytest.approx(1.0, abs=1e-3)

    def test_gamma_vega_positive_theta_negative(self):
        g = _bs_greeks(1280, 1280, 22.5, 15, "CE")
        assert g["gamma"] > 0
        assert g["vega"] > 0
        assert g["theta"] < 0

    def test_gamma_equal_for_ce_and_pe(self):
        c = _bs_greeks(1280, 1290, 20.0, 20, "CE")
        p = _bs_greeks(1280, 1290, 20.0, 20, "PE")
        assert c["gamma"] == pytest.approx(p["gamma"], rel=1e-6)

    def test_deep_otm_call_delta_low(self):
        g = _bs_greeks(1280, 1600, 22.5, 15, "CE")
        assert g["delta"] < 0.15

    def test_deep_itm_call_delta_high(self):
        g = _bs_greeks(1280, 1000, 22.5, 15, "CE")
        assert g["delta"] > 0.9

    def test_garbage_iv_returns_none(self):
        assert _bs_greeks(1280, 1280, 499.0, 15, "CE") is None

    def test_missing_iv_returns_none(self):
        assert _bs_greeks(1280, 1280, None, 15, "CE") is None

    def test_zero_spot_returns_none(self):
        assert _bs_greeks(0, 1280, 22.5, 15, "CE") is None

    def test_zero_dte_clamped_not_crash(self):
        # dte clamped to >= 1, so a value is returned rather than a div-by-zero
        assert _bs_greeks(1280, 1280, 22.5, 0, "CE") is not None

    def test_deterministic(self):
        a = _bs_greeks(1280, 1310, 21.0, 12, "PE")
        b = _bs_greeks(1280, 1310, 21.0, 12, "PE")
        assert a == b


# ── _build_signal ─────────────────────────────────────────────────────────────

class TestBuildSignal:

    def test_bullish_buildup(self):
        # CE OI down, PE OI up → puts writers supporting = bullish
        sig, _ = _build_signal(-100, 200, pcr=1.1)
        assert sig == "Bullish Build-up"

    def test_bearish_buildup(self):
        sig, _ = _build_signal(200, -100, pcr=0.9)
        assert sig == "Bearish Build-up"

    def test_aggressive_long_when_price_up(self):
        sig, _ = _build_signal(200, 200, pcr=1.0, price_up=True)
        assert sig == "Aggressive Long Build"

    def test_aggressive_short_when_price_down(self):
        sig, _ = _build_signal(200, 200, pcr=1.0, price_up=False)
        assert sig == "Aggressive Short Build"

    def test_short_covering(self):
        sig, _ = _build_signal(-100, -100, pcr=1.0, price_up=True)
        assert sig == "Short Covering"

    def test_long_unwinding(self):
        sig, _ = _build_signal(-100, -100, pcr=1.0, price_up=False)
        assert sig == "Long Unwinding"

    def test_pcr_fallback_when_no_oi_change(self):
        # No OI-change data (first ingest day) → PCR heuristic
        assert _build_signal(None, None, pcr=1.5)[0] == "Bullish Build-up"
        assert _build_signal(None, None, pcr=0.5)[0] == "Bearish Build-up"
        assert _build_signal(None, None, pcr=1.0)[0] == "Neutral"

    def test_signal_returns_hex_color(self):
        _, color = _build_signal(-100, 200, pcr=1.1)
        assert color.startswith("#") and len(color) == 7


# ── _compute_max_pain / _nearest_strike ───────────────────────────────────────

def _sd(strike, ce_oi, pe_oi):
    return StrikeData(strike=strike, ce_oi=ce_oi, pe_oi=pe_oi,
                      ce_volume=0, pe_volume=0, ce_ltp=0.0, pe_ltp=0.0)


class TestMaxPain:

    def test_max_pain_at_balanced_strike(self):
        # OI symmetric around 1300 → max pain should land near 1300
        strikes = [_sd(1200, 100, 500), _sd(1300, 300, 300), _sd(1400, 500, 100)]
        mp, curve = _compute_max_pain(strikes)
        assert mp == 1300
        assert len(curve) == 3

    def test_empty_strikes_no_crash(self):
        mp, curve = _compute_max_pain([])
        assert mp == 0.0 and curve == []

    def test_nearest_strike(self):
        assert _nearest_strike([1200, 1250, 1300], 1280) == 1300
        assert _nearest_strike([1200, 1250, 1300], 1220) == 1200
