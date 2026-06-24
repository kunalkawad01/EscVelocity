# References — Druckenmiller ROC² Framework

## Primary Source

- Stan Druckenmiller interview (exact quote on second derivative ROC):
  "We ended up buying a system, and bring it internally. And because it used second derivative
  rate of change, these things will often bottom a year to a year and a half before the
  fundamentals." — Druckenmiller, various macro interviews 2010–2020s

## Integration with 9-Layer MarketDNA Pipeline

Layer 1 (Macro): Use Macro ROC² phase as regime gate

- `early_bottom` / `bottom_inflection` → increase allocation weight at stock layer
- `early_top` / `top_inflection` → reduce weight, tighten stops
- `strong_downtrend` → restrict long entries

Layer 2 (Sector): Run scan() on sector ETFs / sector indices

- Rank sectors by composite ROC² score
- Rotate into sectors where score >= +1.0

Layer 3 (Stock): Run scan() on stocks within top-ranked sectors

- Require macro + intermediate both positive for entry
- `lead_count == 3` = highest conviction

## DuckDB Table Reference

Tables used by this skill:
ohlcv — source OHLCV data
roc2_signals — persisted signal output (date, symbol, timeframe, roc, roc2, phase, lead, score, composite)

## Highcharts Version Requirement

Highstock 10.x or higher required for `zones` on `zoneAxis: 'y'` support.

## Volume ROC² Extension

Apply the same engine to volume series:
volume_roc = compute_roc(df["volume"], 63)
volume_roc2 = compute_roc2(volume_roc, 21)
Positive volume ROC² at same time as price ROC² = high conviction bottom signal.
