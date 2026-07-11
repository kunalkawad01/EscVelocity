"""
Quant Portfolios — forward tracker (paper-portfolio engine).

Each of the 10 screens is treated as an individual, persistently-tracked portfolio.
On first access a portfolio is "constituted" at its inception date (10 Jul 2026) with
the current screen holdings and their entry closes; ₹100 is notionally invested. From
then on we keep one EOD NAV point per trading day, so the growth-of-₹100 curve is a true
FORWARD live track record (not a backtest). Holdings are held fixed between rebalances;
on each rebalance date the basket is re-screened, the diff is logged with rationale, and
NAV continuity is preserved (new entry closes, same running NAV).

Live NAV
--------
The DURABLE curve (nav.parquet) stores one EOD point per trading day, keyed by the actual
trading dates present in equities_prices (which lags intraday — today's bar is ingested
post-market). DURING market hours the current NAV is recomputed from live Kite LTPs
(base_nav * mean(ltp / entry_close)) and returned as a moving "tip" on the curve + the
headline NAV. Intraday values are NOT persisted — only EOD points are, written whenever
equities_prices has today's bar (i.e. by the post-market snapshot or the next visit).

Persistence (PostgreSQL via the app.db pool — see init_store):
  portfolio_basis        current active holdings + entry closes (replaced per key/universe on rebalance)
  portfolio_nav          one EOD NAV row per (key, universe, date) — upserted
  portfolio_rebalances   append-only event log (INCEPTION / ADD / DROP) with rationale

The legacy pandas-parquet stores under data_lake/derived/portfolios/ are migrated into these
tables once at startup (init_store) and then left untouched. If Postgres is unreachable the
tracker raises StoreUnavailable and the track endpoint surfaces 503 — there is no file fallback.
"""
from __future__ import annotations

import ast
import logging
import threading
from datetime import date as _date

import numpy as np
import pandas as pd

from app.config import settings
from app.db import StoreUnavailable, connection, ensure_database
from app.services.duckdb_client import get_connection
from app.services import portfolios_service as ps
from app.services import portfolios_rules as pr

log = logging.getLogger(__name__)

INCEPTION_DATE = _date(2026, 7, 10)
BASE_NAV = 100.0
CASH_SYMBOL = "$CASH"          # reserved basis row for the un-invested (cash) sleeve

# Legacy parquet location — read once at startup (init_store) to migrate pre-existing
# forward-track history into Postgres. Files are left in place after migration.
_LEGACY_DIR = settings.data_path / "data_lake" / "derived" / "portfolios"
_LEGACY_BASIS = _LEGACY_DIR / "basis.parquet"
_LEGACY_NAV = _LEGACY_DIR / "nav.parquet"
_LEGACY_LOG = _LEGACY_DIR / "rebalances.parquet"

_lock = threading.Lock()

_BASIS_COLS = ["key", "universe", "base_date", "base_nav", "symbol", "entry_close", "weight", "rationale"]
_NAV_COLS = ["key", "universe", "date", "nav"]
_LOG_COLS = ["key", "universe", "date", "action", "symbol", "rationale"]

# Trailing-return horizons -> bars back (rn offset = bars + 1, since rn=1 is latest).
_HORIZONS = {"ret_1d": 1, "ret_5d": 5, "ret_1m": 21, "ret_3m": 63, "ret_6m": 126, "ret_1y": 252}


# ── postgres schema / persistence ───────────────────────────────────────────────
_DDL = (
    """
    CREATE TABLE IF NOT EXISTS portfolio_basis (
        key         TEXT             NOT NULL,
        universe    TEXT             NOT NULL,
        symbol      TEXT             NOT NULL,
        base_date   TEXT             NOT NULL,
        base_nav    DOUBLE PRECISION NOT NULL,
        entry_close DOUBLE PRECISION NOT NULL,
        weight      DOUBLE PRECISION NOT NULL,
        rationale   TEXT             NOT NULL DEFAULT '',
        PRIMARY KEY (key, universe, symbol)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS portfolio_nav (
        key      TEXT             NOT NULL,
        universe TEXT             NOT NULL,
        date     TEXT             NOT NULL,
        nav      DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (key, universe, date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS portfolio_rebalances (
        id        BIGSERIAL PRIMARY KEY,
        key       TEXT NOT NULL,
        universe  TEXT NOT NULL,
        date      TEXT NOT NULL,
        action    TEXT NOT NULL,
        symbol    TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT ''
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_portfolio_rebalances_key "
    "ON portfolio_rebalances (key, universe, date)",
)


def init_store() -> None:
    """Ensure the tracker tables exist and migrate any legacy parquet history into Postgres.

    Non-fatal: if Postgres is unreachable this logs a warning and returns; forward tracking
    stays unavailable (get_track raises StoreUnavailable) until the DB is reachable."""
    try:
        ensure_database()                              # create the DB on a fresh install
        with connection() as con:
            for stmt in _DDL:
                con.execute(stmt)
    except StoreUnavailable as exc:
        log.warning("tracker: Postgres unavailable at startup (%s) — forward tracking "
                    "disabled until the DB is reachable", exc)
        return
    _migrate_legacy_parquet()


# ── one-time legacy parquet → postgres migration ─────────────────────────────────
def _s(v) -> str:
    """NaN/None-safe text coercion for migrated parquet cells."""
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) else str(v)


def _read_legacy(path, cols) -> pd.DataFrame:
    try:
        return pd.read_parquet(path).reindex(columns=cols)
    except Exception as exc:
        log.warning("tracker: could not read legacy %s (%s); skipping", path, exc)
        return pd.DataFrame(columns=cols)


def _table_empty(con, table: str) -> bool:
    return con.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() is None


def _migrate_legacy_parquet() -> None:
    """Import the old basis/nav/rebalances parquet files into Postgres exactly once.

    Each table is imported only when it is still empty, so this is idempotent and never
    double-imports the append-only rebalance log. Parquet files are left in place. The
    basis migration is essential — without the original entry closes a re-inception would
    re-baseline the whole book at today's prices and corrupt the forward track."""
    try:
        _migrate_basis()
        _migrate_nav()
        _migrate_log()
    except StoreUnavailable:
        return


def _migrate_basis() -> None:
    if not _LEGACY_BASIS.exists():
        return
    with connection() as con:
        if not _table_empty(con, "portfolio_basis"):
            return
        df = _read_legacy(_LEGACY_BASIS, _BASIS_COLS)
        rows = [(r["key"], r["universe"], _s(r["base_date"]), float(r["base_nav"]), r["symbol"],
                 float(r["entry_close"]), float(r["weight"]), _s(r["rationale"]))
                for _, r in df.iterrows() if r["symbol"] is not None]
        if rows:
            con.cursor().executemany(
                "INSERT INTO portfolio_basis (key, universe, base_date, base_nav, symbol, "
                "entry_close, weight, rationale) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (key, universe, symbol) DO NOTHING", rows)
            log.info("tracker: migrated %d legacy basis row(s) into Postgres", len(rows))


def _migrate_nav() -> None:
    if not _LEGACY_NAV.exists():
        return
    with connection() as con:
        if not _table_empty(con, "portfolio_nav"):
            return
        df = _read_legacy(_LEGACY_NAV, _NAV_COLS)
        rows = [(r["key"], r["universe"], _s(r["date"]), float(r["nav"]))
                for _, r in df.iterrows() if r["key"] is not None]
        if rows:
            con.cursor().executemany(
                "INSERT INTO portfolio_nav (key, universe, date, nav) VALUES (%s,%s,%s,%s) "
                "ON CONFLICT (key, universe, date) DO NOTHING", rows)
            log.info("tracker: migrated %d legacy NAV row(s) into Postgres", len(rows))


def _migrate_log() -> None:
    if not _LEGACY_LOG.exists():
        return
    with connection() as con:
        if not _table_empty(con, "portfolio_rebalances"):
            return
        df = _read_legacy(_LEGACY_LOG, _LOG_COLS)
        rows = [(r["key"], r["universe"], _s(r["date"]), r["action"], r["symbol"], _s(r["rationale"]))
                for _, r in df.iterrows() if r["key"] is not None]
        if rows:
            con.cursor().executemany(
                "INSERT INTO portfolio_rebalances (key, universe, date, action, symbol, rationale) "
                "VALUES (%s,%s,%s,%s,%s,%s)", rows)
            log.info("tracker: migrated %d legacy rebalance-log row(s) into Postgres", len(rows))


# ── scoped reads (one key/universe slice, as a DataFrame matching *_COLS) ─────────
def _basis_for(key: str, universe: str) -> pd.DataFrame:
    with connection() as con:
        rows = con.execute(
            "SELECT key, universe, base_date, base_nav, symbol, entry_close, weight, rationale "
            "FROM portfolio_basis WHERE key=%s AND universe=%s", (key, universe)).fetchall()
    return pd.DataFrame(rows, columns=_BASIS_COLS)


def _nav_for(key: str, universe: str) -> pd.DataFrame:
    with connection() as con:
        rows = con.execute(
            "SELECT key, universe, date, nav FROM portfolio_nav "
            "WHERE key=%s AND universe=%s ORDER BY date", (key, universe)).fetchall()
    return pd.DataFrame(rows, columns=_NAV_COLS)


def _log_for(key: str, universe: str) -> pd.DataFrame:
    with connection() as con:
        rows = con.execute(
            "SELECT key, universe, date, action, symbol, rationale FROM portfolio_rebalances "
            "WHERE key=%s AND universe=%s", (key, universe)).fetchall()
    return pd.DataFrame(rows, columns=_LOG_COLS)


# ── scoped writes (share a caller's connection so a whole phase is one transaction) ──
def _replace_basis(con, key: str, universe: str, df: pd.DataFrame) -> None:
    """Replace the entire basis slice for one key/universe (delete + reinsert)."""
    con.execute("DELETE FROM portfolio_basis WHERE key=%s AND universe=%s", (key, universe))
    rows = [(key, universe, str(r["base_date"]), float(r["base_nav"]), r["symbol"],
             float(r["entry_close"]), float(r["weight"]), (r["rationale"] or ""))
            for _, r in df.iterrows()]
    if rows:
        con.cursor().executemany(
            "INSERT INTO portfolio_basis (key, universe, base_date, base_nav, symbol, "
            "entry_close, weight, rationale) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", rows)


def _append_log(con, events: list[dict]) -> None:
    if not events:
        return
    con.cursor().executemany(
        "INSERT INTO portfolio_rebalances (key, universe, date, action, symbol, rationale) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        [(e["key"], e["universe"], str(e["date"]), e["action"], e["symbol"],
          (e.get("rationale") or "")) for e in events])


def _upsert_nav(con, key: str, universe: str, date: str, nav: float) -> None:
    con.execute(
        "INSERT INTO portfolio_nav (key, universe, date, nav) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT (key, universe, date) DO UPDATE SET nav = EXCLUDED.nav",
        (key, universe, str(date), float(nav)))


# ── market data ───────────────────────────────────────────────────────────────
def _asof() -> str:
    con = get_connection()
    return str(con.execute("SELECT MAX(CAST(date AS DATE)) FROM equities_prices").fetchone()[0])


@ps._day_cached
def _returns_table(universe: str) -> pd.DataFrame:
    """Per-symbol latest close + trailing returns + in-universe percentile ranks.

    Day-cached (shared with portfolios_service `_cache`, cleared by /invalidate): this
    full-history scan (~7s) runs on every get_track, so caching makes every track page
    load after the first one instant. Callers read the frame only (never mutate)."""
    syms = ps._universe_symbols(universe)
    con = get_connection()
    where = ""
    if syms:
        inlist = ",".join("'" + s.replace("'", "''") + "'" for s in sorted(syms))
        where = f"WHERE symbol IN ({inlist})"
    rows = con.execute(f"""
        WITH base AS (
            SELECT symbol, close,
                   row_number() OVER (PARTITION BY symbol ORDER BY CAST(date AS DATE) DESC) AS rn
            FROM equities_prices {where}
        )
        SELECT symbol,
            max(CASE WHEN rn=1   THEN close END) AS c0,
            max(CASE WHEN rn=2   THEN close END) AS c_1d,
            max(CASE WHEN rn=6   THEN close END) AS c_5d,
            max(CASE WHEN rn=22  THEN close END) AS c_1m,
            max(CASE WHEN rn=64  THEN close END) AS c_3m,
            max(CASE WHEN rn=127 THEN close END) AS c_6m,
            max(CASE WHEN rn=253 THEN close END) AS c_1y
        FROM base WHERE rn <= 253 GROUP BY symbol
    """).df()
    if rows.empty:
        return rows
    rows = rows.set_index("symbol")
    src = {"ret_1d": "c_1d", "ret_5d": "c_5d", "ret_1m": "c_1m",
           "ret_3m": "c_3m", "ret_6m": "c_6m", "ret_1y": "c_1y"}
    for ret_col, base_col in src.items():
        rows[ret_col] = rows["c0"] / rows[base_col] - 1.0
        rows[f"{ret_col}_pct"] = rows[ret_col].rank(pct=True) * 100.0
    return rows


def _live_quotes(symbols: list[str]) -> tuple[dict[str, float], dict]:
    """({symbol: ltp}, market_state). Empty ltp map when the market isn't LIVE or Kite fails."""
    try:
        from app.services.fno_tactical_service import resolve_market_state
    except Exception:
        return {}, {"is_live": False, "label": "", "session_date": None}
    state = resolve_market_state()
    if not state.get("is_live") or not symbols:
        return {}, state
    try:
        from app.services import live_trading_service
        q = live_trading_service._quotes(list(symbols))
        return {s: float(v["ltp"]) for s, v in q.items() if v.get("ltp")}, state
    except Exception as exc:
        log.warning("tracker: live quotes failed (%s); using EOD", exc)
        return {}, state


def _basket_nav(basis_df: pd.DataFrame, rtab: pd.DataFrame, ltps: dict[str, float] | None = None) -> float:
    """base_nav * weighted mean(price / entry_close). price = live LTP if given, else EOD close.

    Weights come from the `weight` column (falls back to equal-weight if absent/NaN, so
    legacy baskets are unchanged). A reserved CASH_SYMBOL row (from `hold_cash` eviction)
    contributes ratio 1.0 for its weight, so a partially-invested basket marks correctly.
    Weights of symbols with no usable price are dropped and the rest renormalized."""
    if not len(basis_df):
        return BASE_NAV
    base_nav = float(basis_df["base_nav"].iloc[0])
    n = len(basis_df)
    num = wsum = 0.0
    for _, r in basis_df.iterrows():
        sym = r["symbol"]
        w = float(r["weight"]) if "weight" in r and pd.notna(r["weight"]) else 1.0 / n
        if sym == CASH_SYMBOL:
            ratio = 1.0
        else:
            entry = float(r["entry_close"]) if r["entry_close"] else 0.0
            px = None
            if ltps and sym in ltps and ltps[sym]:
                px = float(ltps[sym])
            elif sym in rtab.index and pd.notna(rtab.loc[sym, "c0"]):
                px = float(rtab.loc[sym, "c0"])
            if not (px and entry):
                continue
            ratio = px / entry
        num += w * ratio
        wsum += w
    return round(base_nav * num / wsum, 4) if wsum > 0 else base_nav


# ── inception / rebalance ─────────────────────────────────────────────────────
def _rebalance_period(d: _date, cadence: str) -> tuple:
    """Coarse period key for a cadence: weekly -> (iso-year, iso-week);
    quarterly -> (year, quarter); else monthly -> (year, month)."""
    c = cadence.lower()
    if c.startswith("w"):
        iso = d.isocalendar()
        return (iso[0], iso[1])
    if c.startswith("q"):
        return (d.year, (d.month - 1) // 3)
    return (d.year, d.month)


def _brow(key, universe, base_date, base_nav, symbol, entry, weight, rationale) -> dict:
    return {"key": key, "universe": universe, "base_date": str(base_date), "base_nav": float(base_nav),
            "symbol": symbol, "entry_close": float(entry), "weight": float(weight), "rationale": rationale}


def _make_basis_rows(key, universe, base_date, base_nav, screen, rtab) -> pd.DataFrame:
    """Constitute basis rows from a screen. Uses each holding's `weight` if present
    (custom portfolios), else equal-weight (built-ins). Weights are renormalized over
    the holdings that actually have an entry price."""
    included = []
    for h in screen["holdings"]:
        sym = h["symbol"]
        entry = float(rtab.loc[sym, "c0"]) if sym in rtab.index and pd.notna(rtab.loc[sym, "c0"]) else None
        if entry is None:
            continue
        included.append((sym, entry, h.get("weight"), "; ".join(h.get("reasons", []))))
    if not included:
        return pd.DataFrame(columns=_BASIS_COLS)
    raw = [w for _, _, w, _ in included]
    if any(w is None for w in raw):
        wts = [1.0 / len(included)] * len(included)          # built-in / unweighted -> equal
    else:
        tot = float(sum(raw)) or 1.0
        wts = [float(w) / tot for w in raw]                  # renormalize over priced names
    rows = [_brow(key, universe, base_date, base_nav, sym, entry, wt, rat)
            for (sym, entry, _, rat), wt in zip(included, wts)]
    return pd.DataFrame(rows, columns=_BASIS_COLS)


# ── custom-portfolio weighting + eviction ─────────────────────────────────────
def _custom_weights(p, symbols: list[str], feats, wspec) -> dict[str, float]:
    """{symbol: normalized weight} for a custom portfolio under a WeightSpec.
    Returns {} for built-ins (=> downstream equal-weight)."""
    if not getattr(p, "is_custom", False) or feats is None or feats.empty:
        return {}
    idx = [s for s in symbols if s in feats.index]
    if not idx:
        return {}
    q = feats.loc[idx].copy()
    if wspec.scheme == "score":
        q["score"] = ps._scale(pr.evaluate_num(p._rank, feats).reindex(q.index)).fillna(0.0)
    try:
        w = pr.apply_weights(q, wspec)
    except pr.RuleError:
        return {}
    return {s: float(w.get(s, 0.0)) for s in idx}


def _inject_weights(screen: dict, weights: dict[str, float]) -> None:
    """Overwrite the screen holdings' weights (used to apply rebalance_weight)."""
    if not weights:
        return
    for h in screen["holdings"]:
        if h["symbol"] in weights:
            h["weight"] = weights[h["symbol"]]


def _eviction_mask(p, mine: pd.DataFrame, feats, rtab, asof: _date, base_date: _date) -> dict[str, bool]:
    """Per held (non-cash) symbol: True => evict per the portfolio's eviction rule.
    Injects position fields `since_entry_pct` (from re-baselined entry) and `days_held`."""
    node = getattr(p, "_eviction", None)
    if node is None or feats is None or feats.empty:
        return {}
    entry_by = dict(zip(mine["symbol"], mine["entry_close"].astype(float)))
    idx = [s for s in mine["symbol"] if s != CASH_SYMBOL and s in feats.index]
    if not idx:
        return {}
    frame = feats.loc[idx].copy()
    cur = {s: (float(rtab.loc[s, "c0"]) if s in rtab.index and pd.notna(rtab.loc[s, "c0"]) else np.nan) for s in idx}
    frame["since_entry_pct"] = [
        (cur[s] / entry_by[s] - 1) * 100 if (np.isfinite(cur[s]) and entry_by.get(s)) else np.nan for s in idx
    ]
    frame["days_held"] = (asof - base_date).days
    mask = pr.evaluate_bool(node, frame)
    return {s: bool(mask.get(s, False)) for s in idx}


def _evict(p, mine: pd.DataFrame, evicted: list[str], rtab, cur_nav: float,
           base_date: _date, key: str, universe: str) -> pd.DataFrame:
    """Rebuild basis after a mid-period eviction, re-baselined to preserve NAV continuity.
    redistribute -> survivor weights renormalized; hold_cash (or no survivors) -> freed
    weight parked in a $CASH sleeve (ratio 1)."""
    wmap = dict(zip(mine["symbol"], mine["weight"].astype(float)))
    ratmap = dict(zip(mine["symbol"], mine["rationale"]))
    non_cash = [s for s in mine["symbol"] if s != CASH_SYMBOL]
    survivors = [s for s in non_cash if s not in evicted and s in rtab.index and pd.notna(rtab.loc[s, "c0"])]
    prior_cash = sum(float(wmap[s]) for s in mine["symbol"] if s == CASH_SYMBOL)
    freed = sum(float(wmap[s]) for s in evicted if s in wmap)
    rows = []
    if p.spec.eviction_weight == "redistribute" and survivors:
        base = {s: float(wmap.get(s, 0.0)) for s in survivors}
        tot = sum(base.values()) or float(len(survivors))
        for s in survivors:
            w = (base[s] / tot) if sum(base.values()) > 0 else (1.0 / len(survivors))
            rows.append(_brow(key, universe, base_date, cur_nav, s, float(rtab.loc[s, "c0"]), w, ratmap.get(s, "")))
    else:  # hold_cash, or redistribute with nothing left to hold
        for s in survivors:
            rows.append(_brow(key, universe, base_date, cur_nav, s, float(rtab.loc[s, "c0"]),
                              float(wmap.get(s, 0.0)), ratmap.get(s, "")))
        cash = prior_cash + freed
        if cash > 1e-9 or not survivors:
            rows.append(_brow(key, universe, base_date, cur_nav, CASH_SYMBOL, 0.0,
                              max(cash, 1.0 if not survivors else cash), "Cash — from stop-outs"))
    return pd.DataFrame(rows, columns=_BASIS_COLS)


# ── public API ────────────────────────────────────────────────────────────────
def _empty_track(p, key: str, universe: str, asof_str: str) -> dict:
    """Valid TrackResponse payload for a portfolio whose screen currently has no holdings."""
    return {
        "key": key, "name": p.name, "description": p.description, "universe": universe,
        "rebalance": p.rebalance, "expected_holding": p.expected_holding,
        "volatility_stars": p.volatility, "inception_date": asof_str, "as_of": asof_str,
        "is_live": False, "source": "eod",
        "current_nav": BASE_NAV, "total_return_pct": 0.0,
        "days_live": 0, "count": 0,
        "equity_curve": [], "holdings": [], "rebalance_log": [],
    }


def get_track(key: str, universe: str = ps.DEFAULT_UNIVERSE) -> dict:
    p = ps.get_portfolio(key)
    is_custom = getattr(p, "is_custom", False)
    asof_str = _asof()
    asof = _date.fromisoformat(asof_str)
    rtab = _returns_table(universe)
    if rtab.empty:
        raise ValueError("No price data available to track this portfolio.")
    # Custom portfolios need the feature frame for weight schemes + eviction rules.
    feats = ps.build_features(universe=universe) if is_custom else None

    with _lock:
        mine = _basis_for(key, universe)

        # 1) Constitute at inception if never tracked.
        if mine.empty:
            screen = ps.get_screen(key, universe=universe)
            base_date = INCEPTION_DATE
            new_basis = _make_basis_rows(key, universe, base_date, BASE_NAV, screen, rtab)
            # Screen currently yields no qualifying holdings — nothing to track yet.
            # Return a valid empty response without persisting a bogus inception row
            # (which would also duplicate the NAV point on every subsequent call).
            if new_basis.empty:
                return _empty_track(p, key, universe, asof_str)
            log_rows = [{"key": key, "universe": universe, "date": str(base_date),
                         "action": "INCEPTION", "symbol": r["symbol"], "rationale": r["rationale"]}
                        for _, r in new_basis.iterrows()]
            with connection() as con, con.transaction():
                _replace_basis(con, key, universe, new_basis)
                _append_log(con, log_rows)
                _upsert_nav(con, key, universe, str(base_date), BASE_NAV)
            mine = new_basis

        # 2) Rebalance if a new cadence period has begun since the current basis date.
        base_date = _date.fromisoformat(str(mine["base_date"].iloc[0]))
        is_rebalance = (_rebalance_period(asof, p.rebalance) != _rebalance_period(base_date, p.rebalance)
                        and asof > base_date)
        if is_rebalance:
            old_nav = _basket_nav(mine, rtab)          # carry forward the EOD NAV
            screen = ps.get_screen(key, universe=universe)
            new_syms = {h["symbol"] for h in screen["holdings"]}
            old_syms = {s for s in mine["symbol"] if s != CASH_SYMBOL}
            # Weight AFTER rebalance (req #7) may differ from the formation weight.
            _inject_weights(screen, _custom_weights(p, list(new_syms), feats, p.spec.rebalance_weight)
                            if is_custom else {})
            reason_by = {h["symbol"]: "; ".join(h.get("reasons", [])) for h in screen["holdings"]}
            events = []
            for s in sorted(new_syms - old_syms):
                events.append({"key": key, "universe": universe, "date": asof_str,
                               "action": "ADD", "symbol": s, "rationale": reason_by.get(s, "")})
            for s in sorted(old_syms - new_syms):
                events.append({"key": key, "universe": universe, "date": asof_str,
                               "action": "DROP", "symbol": s, "rationale": "No longer meets screen criteria"})
            new_basis = _make_basis_rows(key, universe, asof, old_nav, screen, rtab)
            with connection() as con, con.transaction():
                _replace_basis(con, key, universe, new_basis)
                _append_log(con, events)
            mine = new_basis

        # 2b) Otherwise, between rebalances, apply intra-period eviction / stop-loss
        #     (custom portfolios only). NAV is carried forward and the surviving basket
        #     is re-baselined so the ₹100 curve stays continuous.
        elif is_custom and getattr(p, "_eviction", None) is not None:
            evmask = _eviction_mask(p, mine, feats, rtab, asof, base_date)
            evicted = sorted(s for s, hit in evmask.items() if hit)
            if evicted:
                cur_nav = _basket_nav(mine, rtab)
                rule_txt = ast.unparse(p._eviction)
                events = [{"key": key, "universe": universe, "date": asof_str, "action": "DROP",
                           "symbol": s, "rationale": f"Eviction rule: {rule_txt}"} for s in evicted]
                new_basis = _evict(p, mine, evicted, rtab, cur_nav, base_date, key, universe)
                with connection() as con, con.transaction():
                    _replace_basis(con, key, universe, new_basis)
                    _append_log(con, events)
                mine = new_basis

        # 3) Write the EOD NAV point for `asof` (the latest ingested trading day).
        eod_nav = _basket_nav(mine, rtab)
        with connection() as con:
            _upsert_nav(con, key, universe, asof_str, eod_nav)

        curve_df = _nav_for(key, universe).sort_values("date").copy()
        my_log = _log_for(key, universe).copy()
        mine_out = mine.copy()

    # ── live overlay (outside the lock: network I/O) ──
    symbols = [s for s in mine_out["symbol"] if s != CASH_SYMBOL]
    ltps, state = _live_quotes(symbols)
    is_live = bool(state.get("is_live") and ltps)

    curve_pts = [{"date": str(d), "nav": round(float(v), 2)} for d, v in zip(curve_df["date"], curve_df["nav"])]
    if is_live:
        live_nav = _basket_nav(mine_out, rtab, ltps)
        live_date = str(state.get("session_date") or asof_str)
        if curve_pts and curve_pts[-1]["date"] == live_date:
            curve_pts[-1]["nav"] = round(live_nav, 2)
        else:
            curve_pts.append({"date": live_date, "nav": round(live_nav, 2)})
        current_nav = round(live_nav, 2)
        source = "live"
    else:
        current_nav = curve_pts[-1]["nav"] if curve_pts else BASE_NAV
        source = "eod"

    inception = curve_pts[0]["date"] if curve_pts else str(INCEPTION_DATE)
    names = ps._name_map(universe)
    holdings = []
    for _, r in mine_out.iterrows():
        sym = r["symbol"]
        rr = rtab.loc[sym] if sym in rtab.index else None
        entry = float(r["entry_close"])
        ltp = ltps.get(sym) if is_live else (float(rr["c0"]) if rr is not None and pd.notna(rr["c0"]) else None)
        row = {"symbol": sym, "name": "Cash" if sym == CASH_SYMBOL else names.get(sym),
               "weight_pct": round(float(r["weight"]) * 100, 2),
               "entry_close": round(entry, 2),
               "ltp": round(float(ltp), 2) if ltp else None,
               "since_entry_pct": round((float(ltp) / entry - 1) * 100, 2) if ltp and entry else None,
               "rationale": r["rationale"]}
        for rc in _HORIZONS:
            v = rr[rc] if rr is not None and pd.notna(rr[rc]) else None
            pc = rr[f"{rc}_pct"] if rr is not None and pd.notna(rr[f"{rc}_pct"]) else None
            row[rc] = round(float(v) * 100, 2) if v is not None else None
            row[f"{rc}_rank"] = round(float(pc), 0) if pc is not None else None
        holdings.append(row)

    holdings.sort(key=lambda h: (h["since_entry_pct"] is not None, h["since_entry_pct"] or -1e9), reverse=True)
    log_rows = [{"date": str(r["date"]), "action": r["action"], "symbol": r["symbol"], "rationale": r["rationale"]}
                for _, r in my_log.sort_values("date", ascending=False).iterrows()]

    return {
        "key": key, "name": p.name, "description": p.description, "universe": universe,
        "rebalance": p.rebalance, "expected_holding": p.expected_holding,
        "volatility_stars": p.volatility, "inception_date": inception, "as_of": asof_str,
        "is_live": is_live, "source": source,
        "current_nav": current_nav, "total_return_pct": round((current_nav / BASE_NAV - 1) * 100, 2),
        "days_live": len(curve_pts), "count": len(holdings),
        "equity_curve": curve_pts, "holdings": holdings, "rebalance_log": log_rows,
    }


def snapshot_all() -> dict:
    """Persist an EOD NAV point for every portfolio × universe. Call from the post-market
    job AFTER equities ingestion so today's bar is present in equities_prices."""
    done, failed = 0, []
    for key in ps.all_portfolios():
        for uni in ("nifty200", "nifty500"):
            try:
                get_track(key, universe=uni)
                done += 1
            except Exception as exc:
                failed.append(f"{key}/{uni}")
                log.warning("tracker snapshot failed for %s/%s: %s", key, uni, exc)
    return {"snapshotted": done, "failed": failed}


def purge(key: str) -> dict:
    """Remove all tracker rows (basis / NAV / rebalance log) for a portfolio key across
    every universe. Called when a custom portfolio is deleted so its history doesn't linger.
    Raises StoreUnavailable if Postgres is down."""
    removed = {}
    with _lock:
        with connection() as con, con.transaction():
            for table in ("portfolio_basis", "portfolio_nav", "portfolio_rebalances"):
                cur = con.execute(f"DELETE FROM {table} WHERE key=%s", (key,))
                removed[table] = cur.rowcount
    return removed
