"""Intraday Race Intelligence service.

Reuses live_trading_service's _iday accumulator and Kite quote pipeline.
Adds: rank tracking, 9:15 baseline, ATR(2) from minute ticks, category classification.

Post-market fallback: when _iday is empty (server restarted after close), fetches
1-minute Kite historical candles for the 15:20–15:35 window as replay data.
"""
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Optional

import numpy as np

import app.services.live_trading_service as _lts
from app.services.live_trading_service import (
    _get_hist,
    _get_quotes,
    _push_intraday,
    _market_is_open,
)

log = logging.getLogger(__name__)

# ── Category colours (kept in sync with frontend constants) ───────────────────
CAT_COLORS = {
    "top": "#1D9E75",
    "rec": "#378ADD",
    "dec": "#D85A30",
    "bot": "#E24B4A",
    "neu": "#888780",
}

# ── Rank persistence across calls ─────────────────────────────────────────────
_prev_ranks: dict[str, int] = {}
_rank_lock = threading.Lock()

# ── 9:15 price baseline (reset daily) ─────────────────────────────────────────
_price_at_915: dict[str, float] = {}
_p915_date: str = ""
_p915_lock = threading.Lock()

# ── Replay cache (Kite historical 15:20–15:35, built once per trade date) ─────
_replay_cache: dict[str, dict[str, dict]] = {}   # time_str → {symbol → data}
_replay_cache_date: str = ""
_replay_source: str = "eod"                       # "eod" or "kite"
_replay_lock = threading.Lock()


def _ist_now() -> datetime:
    return datetime.utcnow() + timedelta(hours=5, minutes=30)


def _last_trading_day() -> str:
    """YYYY-MM-DD of the most recently completed NSE session."""
    ist = _ist_now()
    d = ist.date()
    mins = ist.hour * 60 + ist.minute
    # Weekday after 15:30 → today is a completed session
    if d.weekday() < 5 and mins >= 930:
        return d.isoformat()
    # Otherwise find the most recent past weekday
    d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def _seed_915_baseline(quotes: dict[str, dict]) -> None:
    """Seed price_at_915 for any unseen symbol during the 9:15–9:20 window."""
    global _p915_date
    ist = _ist_now()
    today = ist.date().isoformat()
    mins = ist.hour * 60 + ist.minute
    if mins < 555 or mins > 560:  # only seed 09:15 – 09:20 IST
        return
    with _p915_lock:
        if _p915_date != today:
            _price_at_915.clear()
            _p915_date = today
        for sym, q in quotes.items():
            if sym not in _price_at_915:
                _price_at_915[sym] = float(q["ltp"])


def _get_p915(sym: str, hist: dict[str, dict]) -> Optional[float]:
    """Return 9:15 baseline: runtime seed → first 09:15 _iday tick → prev_close fallback."""
    if sym in _price_at_915:
        return _price_at_915[sym]
    # Try first "09:15" tick stored in _iday
    buf = _lts._iday.get(sym, [])
    for t, ltp in buf:
        if t == "09:15":
            return ltp
    # Fallback: use yesterday's close so norm_return ≈ day's return from open
    h = hist.get(sym, {})
    pc = h.get("prev_close")
    return float(pc) if pc else None


def _atr2_from_iday(sym: str) -> float:
    """ATR(2) from the last 3 minute-candles in _iday tick buffer.

    Each tick stored as (HH:MM, ltp); group by minute → compute H/L/C per bar.
    True Range = max(high, prev_close) − min(low, prev_close) across consecutive bars.
    ATR(2) = mean of the last 2 TR values.
    """
    buf = _lts._iday.get(sym, [])
    if len(buf) < 4:
        return 0.0

    minute_map: dict[str, list[float]] = {}
    for t, ltp in buf:
        minute_map.setdefault(t, []).append(ltp)

    minutes = sorted(minute_map.keys())
    if len(minutes) < 3:
        return 0.0

    recent = minutes[-3:]
    bars: list[dict] = []
    for m in recent:
        ltps = minute_map[m]
        bars.append({"high": max(ltps), "low": min(ltps), "close": ltps[-1]})

    trs: list[float] = []
    for i in range(1, len(bars)):
        tr = max(bars[i]["high"], bars[i - 1]["close"]) - min(bars[i]["low"], bars[i - 1]["close"])
        trs.append(tr)

    return round(float(np.mean(trs[-2:])), 4) if trs else 0.0


def _classify(
    ranked: list[tuple[str, float]],
    prev_rank_map: dict[str, int],
) -> dict[str, str]:
    """Assign category: top / bot / rec / dec / neu per the spec."""
    n = len(ranked)
    top_n = min(10, n)
    bot_n = min(10, n)

    top_syms = {s for s, _ in ranked[:top_n]}
    bot_syms = {s for s, _ in ranked[max(0, n - bot_n):]}
    # ensure no overlap (edge case: very small universe)
    bot_syms -= top_syms

    # rank changes for middle stocks only
    middle_changes: list[tuple[str, int]] = []
    for i, (sym, _) in enumerate(ranked):
        if sym in top_syms or sym in bot_syms:
            continue
        cur = i + 1
        prev = prev_rank_map.get(sym, cur)
        # positive delta = improved rank (prev rank was higher number = worse)
        middle_changes.append((sym, prev - cur))

    rec_sorted = sorted([(s, d) for s, d in middle_changes if d > 0], key=lambda x: -x[1])
    dec_sorted = sorted([(s, d) for s, d in middle_changes if d < 0], key=lambda x: x[1])
    rec_syms = {s for s, _ in rec_sorted[:10]}
    dec_syms = {s for s, _ in dec_sorted[:10]}

    cats: dict[str, str] = {}
    for sym, _ in ranked:
        if sym in top_syms:
            cats[sym] = "top"
        elif sym in bot_syms:
            cats[sym] = "bot"
        elif sym in rec_syms:
            cats[sym] = "rec"
        elif sym in dec_syms:
            cats[sym] = "dec"
        else:
            cats[sym] = "neu"
    return cats


# ── Replay: Kite historical 1-min candles ─────────────────────────────────────

def _build_replay_from_kite(trade_date: str) -> dict[str, dict[str, dict]]:
    """Fetch 1-min candles (15:20→15:35) from Kite for all hist symbols.

    Returns {time_str: {symbol: {ltp, prev_close, return_pct, norm_return, atr2}}}
    where time_str = close-time of each bar (bar_date + 1 min).

    bar_date 15:24 → label '15:25' (close = price at the end of the 15:24 bar)
    bar_date 15:29 → label '15:30' (market close price)

    Uses 15 concurrent Kite calls for speed; cached per trade date.
    """
    hist = _get_hist()
    symbols = list(hist.keys())
    if not symbols:
        return {}

    try:
        from app.services.kite_client import get_kite
        kite = get_kite()

        y, m, d = (int(x) for x in trade_date.split("-"))
        from_dt = datetime(y, m, d, 15, 20)
        to_dt   = datetime(y, m, d, 15, 35)

        # One batched ltp() call to get all instrument tokens
        ltp_resp = kite.ltp([f"NSE:{s}" for s in symbols])
        tokens: dict[str, int] = {
            k.replace("NSE:", ""): int(v["instrument_token"])
            for k, v in ltp_resp.items()
        }

        if not tokens:
            log.warning("Replay: no instrument tokens returned from Kite")
            return {}

        import time as _time

        def _fetch_bars(sym_tok: tuple[str, int]) -> tuple[str, list]:
            sym, tok = sym_tok
            for attempt in range(3):
                try:
                    bars = kite.historical_data(tok, from_dt, to_dt, "minute")
                    return sym, bars or []
                except Exception as exc:
                    msg = str(exc)
                    if "429" in msg or "Too many" in msg:
                        _time.sleep(1.0 * (attempt + 1))  # back-off: 1s, 2s, 3s
                        continue
                    log.debug("Replay candles %s: %s", sym, exc)
                    return sym, []
            log.debug("Replay candles %s: rate-limited after retries", sym)
            return sym, []

        # 3 workers keeps concurrent Kite historical-data calls well within rate limits
        with ThreadPoolExecutor(max_workers=3) as pool:
            fetched = dict(pool.map(_fetch_bars, tokens.items()))

        # When hist was refreshed AFTER the trade date (e.g. server runs on Saturday
        # after Friday's EOD data is ingested), prev_close (rn=1) equals Friday's close —
        # the same price Kite returns for the 15:25-15:30 candles → returns = 0%.
        # Use yesterday_close (rn=2) as the benchmark instead: it is always the day
        # before the most recent DuckDB row, which is correct once EOD data is loaded.
        hist_date = _lts._hist_date   # date string for which _get_hist() was computed
        use_yesterday = hist_date > trade_date

        result: dict[str, dict[str, dict]] = {}
        for sym, bars in fetched.items():
            if not bars:
                continue
            h = hist.get(sym, {})
            if use_yesterday:
                pc = float(h.get("yesterday_close") or h.get("prev_close") or 0)
            else:
                pc = float(h.get("prev_close") or 0)
            if not pc:
                continue
            # Use runtime 9:15 seed if captured during today's session; else prev_close
            p915 = float(_price_at_915.get(sym) or pc)

            for bar in bars:
                # bar["date"] is bar START; close label = start + 1 minute
                close_label = (bar["date"] + timedelta(minutes=1)).strftime("%H:%M")
                ltp = float(bar["close"])
                ret = round((ltp - pc) / pc * 100, 2)
                norm_ret = round((ltp / p915 - 1) * 100, 2)
                result.setdefault(close_label, {})[sym] = {
                    "ltp":         round(ltp, 2),
                    "prev_close":  round(pc, 2),
                    "return_pct":  ret,
                    "norm_return": norm_ret,
                    "atr2":        0.0,
                }

        n_times = len(result)
        n_syms = len({s for frame in result.values() for s in frame})
        log.info(
            "Replay cache built: %d time points × %d symbols (trade_date=%s)",
            n_times, n_syms, trade_date,
        )
        return result

    except Exception as exc:
        log.warning("Replay Kite fetch failed: %s", exc)
        return {}


def _build_replay_from_eod() -> dict[str, dict[str, dict]]:
    """Build static replay frames from parquet EOD data (weekend / post-ingestion fallback).

    All 6 frames are identical — ranks won't change between them — but the
    Top/Bottom panels show real day returns and Rank Decliners/Recoverers
    correctly show 'No rank changes in closing 5 min'.

    Field mapping from _get_hist() (rn = row number ordered by date DESC):
      prev_close      = rn=1 = last trading day's closing price  (today's EOD)
      yesterday_close = rn=2 = day before that                   (previous session close)
    """
    hist = _get_hist()
    if not hist:
        return {}

    frame: dict[str, dict] = {}
    for sym, h in hist.items():
        ltp = float(h.get("prev_close") or 0)           # last trading day close
        pc  = float(h.get("yesterday_close") or 0)      # day before → return benchmark
        if not ltp or not pc:
            continue
        ret  = round((ltp - pc) / pc * 100, 2)
        atr2 = round(float(h.get("atr14") or 0) / ltp * 100, 4) if ltp else 0.0
        frame[sym] = {
            "ltp":         round(ltp, 2),
            "prev_close":  round(pc, 2),
            "return_pct":  ret,
            "norm_return": ret,
            "atr2":        atr2,
        }

    if not frame:
        return {}

    times = ["15:25", "15:26", "15:27", "15:28", "15:29", "15:30"]
    log.info("Replay EOD fallback: %d symbols × %d static frames", len(frame), len(times))
    return {t: dict(frame) for t in times}


def _kite_result_looks_degenerate(result: dict[str, dict[str, dict]]) -> bool:
    """Return True if Kite replay data has near-zero returns.

    This happens when EOD ingestion has already run: rn=1 is today's closing price,
    which equals the Kite bar price, so (bar - prev_close) / prev_close ≈ 0%.
    Threshold: average |return| < 0.05% across all symbols/frames.
    """
    if not result:
        return True
    abs_rets: list[float] = []
    for frame in result.values():
        for sym_data in frame.values():
            abs_rets.append(abs(sym_data.get("return_pct", 0.0)))
    if not abs_rets:
        return True
    return (sum(abs_rets) / len(abs_rets)) < 0.05


def _get_replay_cache() -> dict[str, dict[str, dict]]:
    """Return replay cache, rebuilding from appropriate source if stale.

    Priority:
    1. Weekend / holiday (ist_today != last_trading_day) → parquet EOD fallback.
    2. Same trading day → try Kite 1-min candles.
       If Kite returns empty or near-zero returns (post-EOD-ingestion case where
       rn=1 in DuckDB equals today's close price = same as Kite bar prices),
       fall back to parquet EOD data.

    Sets _replay_source = "kite" | "eod" so get_snapshot() can communicate
    the source to the frontend.
    """
    global _replay_cache, _replay_cache_date, _replay_source
    td = _last_trading_day()
    if _replay_cache_date == td and _replay_cache:
        return _replay_cache
    with _replay_lock:
        if _replay_cache_date == td and _replay_cache:
            return _replay_cache
        ist_today = _ist_now().date().isoformat()
        if ist_today != td:
            # Weekend / holiday: parquet is authoritative
            _replay_cache = _build_replay_from_eod()
            _replay_source = "eod"
        else:
            kite_result = _build_replay_from_kite(td)
            if _kite_result_looks_degenerate(kite_result):
                log.info("Replay Kite result degenerate — using EOD parquet fallback")
                _replay_cache = _build_replay_from_eod()
                _replay_source = "eod"
            else:
                _replay_cache = kite_result
                _replay_source = "kite"
        _replay_cache_date = td
    return _replay_cache


def _replay_baseline_ranks(replay: dict[str, dict[str, dict]]) -> dict[str, int]:
    """Compute per-symbol ranks at the 15:25 frame (or earliest available) for rec/dec."""
    baseline_key = "15:25" if "15:25" in replay else (min(replay.keys()) if replay else "")
    if not baseline_key:
        return {}
    baseline_frame = replay[baseline_key]
    baseline_sorted = sorted(
        baseline_frame.items(), key=lambda kv: kv[1]["return_pct"], reverse=True
    )
    return {sym: i + 1 for i, (sym, _) in enumerate(baseline_sorted)}


# ── Public API ─────────────────────────────────────────────────────────────────

def get_returns() -> dict:
    """Primary endpoint: current return, rank, ATR(2), category for all symbols."""
    global _prev_ranks

    hist = _get_hist()
    live, data_mode = _get_quotes(hist)
    market_open = _market_is_open()

    # Only accumulate ticks and seed the 9:15 baseline during actual trading hours.
    # Kite returns stale EOD prices after close, which would pollute _iday with
    # flat data and produce zero ATR(2) for every symbol.
    if data_mode == "live" and market_open:
        _push_intraday(live)
        _seed_915_baseline(live)

    sym_data: list[dict] = []
    for sym, q in live.items():
        h = hist.get(sym)
        if not h:
            continue
        ltp = float(q["ltp"])
        pc = float(q.get("prev_close") or h.get("prev_close") or 0)
        if not pc:
            continue
        ret = round((ltp - pc) / pc * 100, 2)
        p915 = _get_p915(sym, hist)
        norm_ret = round((ltp / p915 - 1) * 100, 2) if p915 else ret
        if data_mode == "live" and market_open:
            # ATR(2) from live minute candles — meaningful only during trading hours
            atr2 = _atr2_from_iday(sym)
        else:
            # Use daily ATR14 scaled to ~1-minute intraday magnitude
            atr2 = round(float(h.get("atr14") or 0) * 0.05, 4)
        sym_data.append({
            "symbol": sym, "ltp": round(ltp, 2), "prev_close": round(pc, 2),
            "return_pct": ret, "atr2": atr2, "norm_return": norm_ret,
        })

    sym_data.sort(key=lambda x: x["return_pct"], reverse=True)
    ranked = [(d["symbol"], d["return_pct"]) for d in sym_data]

    with _rank_lock:
        prev = dict(_prev_ranks)
        cats = _classify(ranked, prev)
        _prev_ranks = {s: i + 1 for i, (s, _) in enumerate(ranked)}

    for i, d in enumerate(sym_data):
        sym = d["symbol"]
        d["rank"] = i + 1
        d["prev_rank"] = prev.get(sym, i + 1)
        d["category"] = cats.get(sym, "neu")

    effective_mode = data_mode if market_open else "eod_fallback"
    return {
        "as_of": datetime.now().isoformat(timespec="seconds"),
        "market_open": market_open,
        "data_mode": effective_mode,
        "symbols": sym_data,
    }


def get_norm_history() -> dict:
    """Normalized return time-series (9:15 baseline) for all symbols.

    Primary source: _lts._iday accumulator (live session).
    Fallback: Kite historical 1-min candles for the 15:20–15:30 replay window.
    """
    hist = _get_hist()

    with _lts._iday_lock:
        snapshot = {sym: list(buf) for sym, buf in _lts._iday.items()}

    # ── Primary: live _iday data ───────────────────────────────────────────────
    all_times_set: set[str] = set()
    for buf in snapshot.values():
        for t, _ in buf:
            all_times_set.add(t)

    if all_times_set:
        all_times = sorted(all_times_set)

        series: dict[str, list[float]] = {}
        p915_map: dict[str, float] = {}

        for sym, buf in snapshot.items():
            if not buf:
                continue
            p915 = _get_p915(sym, hist)
            if not p915:
                continue
            p915_map[sym] = round(p915, 2)

            tick_map: dict[str, float] = {}
            for t, ltp in buf:
                tick_map[t] = ltp

            pts: list[float] = []
            last_ltp = p915
            for t in all_times:
                if t in tick_map:
                    last_ltp = tick_map[t]
                pts.append(round((last_ltp / p915 - 1) * 100, 3))
            series[sym] = pts

        with _rank_lock:
            pr = dict(_prev_ranks)
        if pr:
            ranked = sorted(pr.items(), key=lambda x: x[1])
            ranked_list = [(s, 0.0) for s, _ in ranked]
            cats = _classify(ranked_list, {})
        else:
            cats = {sym: "neu" for sym in series}

        return {
            "price_at_915": p915_map,
            "times": all_times,
            "series": series,
            "categories": cats,
        }

    # ── Fallback: Kite replay cache (15:20–15:30) ─────────────────────────────
    replay = _get_replay_cache()
    if not replay:
        return {"price_at_915": {}, "times": [], "series": {}, "categories": {}}

    all_times = sorted(replay.keys())
    all_syms: set[str] = set()
    for frame in replay.values():
        all_syms.update(frame.keys())

    series_r: dict[str, list[float]] = {}
    p915_map_r: dict[str, float] = {}

    for sym in all_syms:
        pts: list[float] = []
        prev_nr = 0.0
        for t in all_times:
            frame_sym = replay[t].get(sym)
            if frame_sym:
                nr = frame_sym["norm_return"]
                pc = frame_sym["prev_close"]
                if pc and sym not in p915_map_r:
                    p915_map_r[sym] = round(pc, 2)
                prev_nr = nr
            else:
                nr = prev_nr  # forward-fill missing ticks
            pts.append(round(nr, 3))
        series_r[sym] = pts

    # Categories: compare last frame vs 15:25 baseline
    baseline_rank_map = _replay_baseline_ranks(replay)
    last_frame = replay[all_times[-1]]
    last_sorted = sorted(last_frame.items(), key=lambda kv: kv[1]["return_pct"], reverse=True)
    ranked_r = [(sym, 0.0) for sym, _ in last_sorted]
    cats_r = _classify(ranked_r, baseline_rank_map)

    return {
        "price_at_915": p915_map_r,
        "times": all_times,
        "series": series_r,
        "categories": cats_r,
    }


def get_snapshot(time_str: str) -> dict:
    """Reconstruct market state at a given HH:MM — used for post-market replay.

    Primary source: _lts._iday (live session ticks).
    Fallback: Kite historical 1-min candles cached in _replay_cache.

    rec/dec categories are computed relative to the 15:25 baseline frame
    so panels C/D show rank movement over the final 5 minutes of trading.
    """
    hist = _get_hist()

    with _lts._iday_lock:
        snapshot = {sym: list(buf) for sym, buf in _lts._iday.items()}

    # ── Primary: _iday (server was running during market hours) ───────────────
    if snapshot:
        sym_data: list[dict] = []
        for sym, buf in snapshot.items():
            h = hist.get(sym)
            if not h:
                continue
            ltp = None
            for t, price in reversed(buf):
                if t <= time_str:
                    ltp = price
                    break
            if ltp is None:
                continue
            pc = float(h.get("prev_close") or 0)
            if not pc:
                continue
            ret = round((ltp - pc) / pc * 100, 2)
            p915 = _get_p915(sym, hist)
            norm_ret = round((ltp / p915 - 1) * 100, 2) if p915 else ret
            sym_data.append({
                "symbol": sym, "ltp": round(ltp, 2), "prev_close": round(pc, 2),
                "return_pct": ret, "atr2": 0.0, "norm_return": norm_ret,
            })

        sym_data.sort(key=lambda x: x["return_pct"], reverse=True)
        ranked = [(d["symbol"], d["return_pct"]) for d in sym_data]
        cats = _classify(ranked, {})
        for i, d in enumerate(sym_data):
            d["rank"] = i + 1
            d["prev_rank"] = i + 1
            d["category"] = cats.get(d["symbol"], "neu")
        return {
            "as_of": time_str,
            "market_open": False,
            "data_mode": "snapshot",
            "symbols": sym_data,
        }

    # ── Fallback: Kite replay cache ────────────────────────────────────────────
    replay = _get_replay_cache()
    if not replay:
        return {"as_of": time_str, "market_open": False, "data_mode": "snapshot", "symbols": []}

    # Find exact time or nearest earlier frame
    frame_data = replay.get(time_str)
    if frame_data is None:
        earlier = sorted(t for t in replay if t <= time_str)
        frame_data = replay[earlier[-1]] if earlier else None
    if not frame_data:
        return {"as_of": time_str, "market_open": False, "data_mode": "snapshot", "symbols": []}

    # Baseline ranks from 15:25 → used as prev_rank for rec/dec categories
    baseline_rank_map = _replay_baseline_ranks(replay)

    sym_data_r = [
        {
            "symbol":      sym,
            "ltp":         v["ltp"],
            "prev_close":  v["prev_close"],
            "return_pct":  v["return_pct"],
            "atr2":        0.0,
            "norm_return": v["norm_return"],
        }
        for sym, v in frame_data.items()
    ]
    sym_data_r.sort(key=lambda x: x["return_pct"], reverse=True)
    ranked_r = [(d["symbol"], d["return_pct"]) for d in sym_data_r]
    cats_r = _classify(ranked_r, baseline_rank_map)

    for i, d in enumerate(sym_data_r):
        d["rank"] = i + 1
        d["prev_rank"] = baseline_rank_map.get(d["symbol"], i + 1)
        d["category"] = cats_r.get(d["symbol"], "neu")

    return {
        "as_of": time_str,
        "market_open": False,
        "data_mode": "snapshot",
        "replay_source": _replay_source,
        "symbols": sym_data_r,
    }
