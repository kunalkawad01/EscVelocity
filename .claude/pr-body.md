## Summary

- **Fix Best Indicator card overflow** — root cause was `height: '100%'` from `iCard()` being inherited by the three stacked right-column cards; each card tried to fill the full height of the Grid item (which stretches to match the tall left zone). Fixed with `height: 'auto'` override on all three right-column cards.
- **Fix Best Indicator text clipping** — added `minWidth: 0` + `overflow: hidden` + `textOverflow: ellipsis` to the `best_indicator` Typography flex child, and a 3-line CSS clamp on `best_setup`.
- **Fix `current_signals` field name** — code was accessing `.signal` / `.name` (both `undefined`); correct field is `.signal_label` per the backend `CurrentSignal` Pydantic model.
- **Add `TransparencyDrawer` to all 9 Stock Intelligence cards** — collapsible panel at the bottom of each card showing Formula / Interpretation / Conclusion, with conclusions computed from live data so any user can independently verify every score.

## Cards with transparency drawers

| Card | Conclusion uses |
|------|----------------|
| Health Score | Total + weakest sub-score identified by name |
| Trend Structure | N/4 score + what failing conditions mean as resistance |
| 52-Week Range | pct52w + distance to 52W high/low |
| Relative Strength | secRank/secTotal + sector name |
| Momentum | Today's return% + momentum score /25 |
| Volume Analysis | volRatio + direction context |
| Drawdown Analysis | 1M and 1Y drawdown % + severity zone |
| Key Price Levels | Distance to nearest resistance and support |
| Conclusion | Bull/bear/neutral bullet count + balance summary |

## Test plan

- [ ] Open Stock Intelligence on any symbol — verify Best Indicator card no longer overflows into Signal Priority section below
- [ ] Right-column cards (Action, Best Indicator, Best Pattern Now) render at natural height, not stretched
- [ ] Active signal label in Best Indicator card now shows text (was blank before due to wrong field name)
- [ ] Click "How is this calculated?" on each of the 9 cards — Formula / Interpretation / Conclusion panels expand and collapse correctly
- [ ] Conclusion text in each panel reflects live data for the selected symbol
- [ ] Toggle dark/light theme — panel colors follow palette tokens

Generated with [Claude Code](https://claude.com/claude-code)
