# Strategy — Long & Short (trend-aligned pullback entries)

Master rule: trade WITH the monthly trend, AGAINST the intraday move. Buy dips in uptrends, sell rallies in downtrends. Never against the monthly trend.

Sequence for every trade: **breadth gate → scatter (positioning) → normalized line (timing) → click → option chain (confirmation + live S/R + exit-risk read) → execute.**

---

## LONG STRATEGY — only in monthly UPtrends

**Setup:** stock in confirmed `UP` trend that sold off intraday and is now curling back up.

**Entry — all must hold:**
1. `trend == UP`.
2. Breadth gate == Risk-ON (or NEUTRAL, half size).
3. Normalized line = completed **V**: intraday low made, now rising, price back **above VWAP**.
4. Quadrant == `LONG_BUILDUP` (A-grade) or `SHORT_COVERING` (B-grade, half size, quicker exit).
5. Relative strength positive — stock outperforming Nifty off the lows.
6. Passes liquidity floor + past the 45–60 min time-of-day filter.

**Avoid:** `ret_per_atr > 1.5` (already extended — the pullback is spent; you've missed it). The entire point is entering near the day's low, not chasing.

**Stop:** below the intraday swing low that formed the V (structure-based, not fixed %).
**Exit:** trail; or exit on inverted-V forming + quadrant flipping to `LONG_UNWINDING`.

**Option-chain confirmation (Zone 3):** want **put writing** at/below ATM (put OI↑, put price↓ = writers defending support) and **call longs** (call OI↑ + price↑). If **call writing** is stacking above ATM instead, upside is capped → downgrade or skip.

---

## SHORT STRATEGY — only in monthly DOWNtrends (the mirror)

**Setup:** stock in confirmed `DOWN` trend that rallied intraday and is now rolling over.

**Entry — all must hold:**
1. `trend == DOWN`.
2. Breadth gate == Risk-OFF (or NEUTRAL, half size). Shorting into a strong-breadth day is how you get run over — this filter is critical for shorts.
3. Normalized line = completed **inverted-V**: intraday high made, now falling, price back **below VWAP**.
4. Quadrant == `SHORT_BUILDUP` (A-grade — fresh shorts) or `LONG_UNWINDING` (B-grade, half size — longs bailing, not shorts committing).
5. Relative strength negative — stock underperforming Nifty off the highs.
6. Passes liquidity floor + past the 45–60 min time-of-day filter.

**Avoid:** `ret_per_atr < -1.5` (already extended down — bounce risk high, poor R/R).

**Stop:** above the intraday swing high that formed the inverted-V.
**Exit:** trail; or exit on V forming + quadrant flipping to `SHORT_COVERING`.

**Option-chain confirmation (Zone 3):** want **call writing** at/above ATM (call OI↑, call price↓ = writers capping upside) and **put longs** building (put OI↑ + price↑). If **puts are being written** below ATM instead, support is forming → downgrade or skip.

---

## Quadrant → signal-quality grade table

| Quadrant | In UPtrend (longs) | In DOWNtrend (shorts) |
|---|---|---|
| `LONG_BUILDUP` (P↑ OI↑) | **A-grade long** | irrelevant / avoid |
| `SHORT_COVERING` (P↑ OI↓) | B-grade long (exhaustion, half size) | avoid — bounce can trap the short |
| `SHORT_BUILDUP` (P↓ OI↑) | avoid — fresh sellers, don't buy in | **A-grade short** |
| `LONG_UNWINDING` (P↓ OI↓) | avoid — longs bailing | B-grade short (half size) |

**The asymmetry to internalize:** A-grade signals are backed by **fresh conviction** (OI rising in your direction) — durable. B-grade signals are backed by the **other side capitulating** (OI falling) — real but shorter-lived, so smaller size and quicker exits.

## Position-sizing summary

- A-grade + gate aligned (Risk-ON for longs / Risk-OFF for shorts): full unit.
- B-grade, or NEUTRAL gate: half unit.
- Gate against you (Risk-OFF while wanting long, or Risk-ON while wanting short): **no trade**, regardless of grade.
