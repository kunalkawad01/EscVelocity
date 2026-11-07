import { Box, IconButton, MenuItem, OutlinedInput, Select, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { MONO } from './chartsCommon'
import {
  SCREENER_FIELDS, SCREENER_FIELD_LABELS, PERCENTILE_KEYS, PERCENTILE_LABELS, pctileBandFor,
} from '../../hooks/useScreenerFilters'
import type { PercentileKey, ScreenerField, ScreenerOp, UseScreenerFilters } from '../../hooks/useScreenerFilters'

// Three-way op toggle for a screener condition -- '<' / '>' compare against one
// value, 'between' compares against an inclusive range (two values). Local to
// this file rather than the shared chartsCommon OpToggle, which only knows '<'/'>'
// and is still used as-is by IndicatorFilterBar/LiveReturnFilterBar.
// `allowBetween=false` (percentile mode) hides the B/W option -- a percentile
// condition is already "< / > one breakpoint", not a fixed numeric range.
function ScreenerOpToggle({ op, onChange, allowBetween = true }: { op: ScreenerOp; onChange: (op: ScreenerOp) => void; allowBetween?: boolean }) {
  const { INK2, CYAN, BORDER } = usePalette()
  const OPS: Array<{ value: ScreenerOp; label: string }> = [
    { value: '<', label: '<' },
    { value: '>', label: '>' },
    ...(allowBetween ? [{ value: 'between' as ScreenerOp, label: 'B/W' }] : []),
  ]
  return (
    <Box sx={{ display: 'flex', gap: 0.2 }}>
      {OPS.map(o => (
        <Box
          key={o.value}
          onClick={() => onChange(o.value)}
          sx={{
            minWidth: 20, height: 24, px: 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 0.75, cursor: 'pointer',
            bgcolor: op === o.value ? `${CYAN}20` : 'transparent',
            border: `1px solid ${op === o.value ? CYAN : BORDER}`,
          }}
        >
          <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 800, color: op === o.value ? CYAN : INK2 }}>
            {o.label}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

// The two preset quick-filter buttons -- "Never Above Open" / "Never Below
// Open". Thresholds are a hair off zero (0.001 / -0.001), not exactly 0,
// because the day's high/low very commonly *equals* the open for a stock that
// has only moved one direction all session -- a strict "< 0"/"> 0" would wrongly
// exclude that equality case (see live_screener_page.md Lessons Learnt).
const NEVER_ABOVE_OPEN = { field: 'highVsOpen' as const, op: '<' as const, value: '0.001' }
const NEVER_BELOW_OPEN = { field: 'lowVsOpen' as const, op: '>' as const, value: '-0.001' }

// Dynamic AND/OR return-condition builder: any number of (field, op, value[,
// value2], pctileMode) rows, combined by one chosen logic (Match ALL / Match
// ANY). "Between" conditions (e.g. "Give-back % between 60 and 90") take two
// values instead of one threshold. A condition on "vs Yday Close" or "vs Today
// Open" can switch to "vs OWN %ILE" mode -- instead of typing a fixed number,
// pick one of that stock's own 5-year percentile breakpoints (Min/25th/
// 50th/75th/90th/Max) as the threshold, e.g. "vs Yday Close < this stock's own
// 25th %ile" (an unusually weak day for THAT stock specifically). Live off the
// streaming tick (plus the bulk screener-stats snapshot for SMA/percentile
// fields) -- no Apply step, no extra network call from this component itself.
export function ScreenerFilterBar({ f }: { f: UseScreenerFilters }) {
  const { INK, INK2, CYAN, BORDER } = usePalette()
  const { INPUT_SX, PAPER2 } = useTokens()

  const aboveActive = f.hasQuickFilter(NEVER_ABOVE_OPEN.field, NEVER_ABOVE_OPEN.op, NEVER_ABOVE_OPEN.value)
  const belowActive = f.hasQuickFilter(NEVER_BELOW_OPEN.field, NEVER_BELOW_OPEN.op, NEVER_BELOW_OPEN.value)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: INK2, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Dynamic Return Filter
        </Typography>
        {f.conditions.length > 1 && (
          <Box sx={{ display: 'flex', gap: 0.3 }}>
            {(['AND', 'OR'] as const).map(m => (
              <Box
                key={m}
                onClick={() => f.setCombinator(m)}
                sx={{
                  px: 1, py: 0.25, borderRadius: 1, cursor: 'pointer',
                  bgcolor: f.combinator === m ? `${CYAN}20` : 'transparent',
                  border: `1px solid ${f.combinator === m ? CYAN : BORDER}`,
                }}
              >
                <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 800, color: f.combinator === m ? CYAN : INK2 }}>
                  Match {m === 'AND' ? 'ALL' : 'ANY'}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ ...MONO, fontSize: '0.56rem', fontWeight: 700, color: INK2, letterSpacing: '0.06em' }}>
          QUICK:
        </Typography>
        <Box
          onClick={() => f.toggleQuickFilter(NEVER_ABOVE_OPEN.field, NEVER_ABOVE_OPEN.op, NEVER_ABOVE_OPEN.value)}
          sx={{
            px: 1, py: 0.35, borderRadius: 1, cursor: 'pointer',
            bgcolor: aboveActive ? `${CYAN}20` : 'transparent',
            border: `1px solid ${aboveActive ? CYAN : BORDER}`,
          }}
        >
          <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 800, color: aboveActive ? CYAN : INK }}>
            NEVER ABOVE OPEN
          </Typography>
        </Box>
        <Box
          onClick={() => f.toggleQuickFilter(NEVER_BELOW_OPEN.field, NEVER_BELOW_OPEN.op, NEVER_BELOW_OPEN.value)}
          sx={{
            px: 1, py: 0.35, borderRadius: 1, cursor: 'pointer',
            bgcolor: belowActive ? `${CYAN}20` : 'transparent',
            border: `1px solid ${belowActive ? CYAN : BORDER}`,
          }}
        >
          <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 800, color: belowActive ? CYAN : INK }}>
            NEVER BELOW OPEN
          </Typography>
        </Box>
        <Typography sx={{ ...MONO, fontSize: '0.56rem', color: INK2 }}>
          (High vs Open % &lt; 0.001 / Low vs Open % &gt; -0.001 — "Open" follows the Open Ref toggle above)
        </Typography>
      </Box>

      {f.conditions.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {f.conditions.map((c, i) => {
            const pctileCapable = pctileBandFor(c.field) !== null
            return (
              <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: 800, color: CYAN, minWidth: 26, textAlign: 'center' }}>
                  {i === 0 ? 'IF' : f.combinator}
                </Typography>
                <Select
                  size="small"
                  value={c.field}
                  onChange={e => {
                    const field = e.target.value as ScreenerField
                    // Percentile mode only makes sense for fields with a precomputed
                    // band -- switching away from vs Yday Close / vs Today Open drops it.
                    const stillPctileCapable = pctileBandFor(field) !== null
                    f.updateCondition(c.id, {
                      field,
                      pctileMode: c.pctileMode && stillPctileCapable,
                      value: c.pctileMode && !stillPctileCapable ? '' : c.value,
                    })
                  }}
                  sx={{ ...INPUT_SX, width: 150, '& .MuiSelect-select': { ...MONO, fontSize: '0.66rem', py: 0.6, color: INK } }}
                  MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2 } } }}
                >
                  {SCREENER_FIELDS.map(fld => (
                    <MenuItem key={fld} value={fld} sx={{ ...MONO, fontSize: '0.7rem', color: INK }}>
                      {SCREENER_FIELD_LABELS[fld]}
                    </MenuItem>
                  ))}
                </Select>
                <ScreenerOpToggle
                  op={c.op}
                  allowBetween={!c.pctileMode}
                  onChange={op => f.updateCondition(c.id, { op })}
                />
                {c.pctileMode ? (
                  <Select
                    size="small"
                    value={PERCENTILE_KEYS.includes(c.value as PercentileKey) ? c.value : 'p50'}
                    onChange={e => f.updateCondition(c.id, { value: e.target.value })}
                    sx={{ ...INPUT_SX, width: 150, '& .MuiSelect-select': { ...MONO, fontSize: '0.66rem', py: 0.6, color: INK } }}
                    MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2 } } }}
                  >
                    {PERCENTILE_KEYS.map(k => (
                      <MenuItem key={k} value={k} sx={{ ...MONO, fontSize: '0.7rem', color: INK }}>
                        {PERCENTILE_LABELS[k]}
                      </MenuItem>
                    ))}
                  </Select>
                ) : (
                  <>
                    <OutlinedInput
                      size="small"
                      value={c.value}
                      onChange={e => f.updateCondition(c.id, { value: e.target.value })}
                      placeholder={c.op === 'between' ? 'e.g. 60' : 'e.g. 2'}
                      inputProps={{ inputMode: 'decimal' }}
                      sx={{ ...INPUT_SX, width: 72, bgcolor: PAPER2, '& input': { ...MONO, fontSize: '0.68rem', py: 0.6, color: INK } }}
                    />
                    {c.op === 'between' && (
                      <>
                        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK2 }}>and</Typography>
                        <OutlinedInput
                          size="small"
                          value={c.value2}
                          onChange={e => f.updateCondition(c.id, { value2: e.target.value })}
                          placeholder="e.g. 90"
                          inputProps={{ inputMode: 'decimal' }}
                          sx={{ ...INPUT_SX, width: 72, bgcolor: PAPER2, '& input': { ...MONO, fontSize: '0.68rem', py: 0.6, color: INK } }}
                        />
                      </>
                    )}
                    <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK2 }}>%</Typography>
                  </>
                )}
                {pctileCapable && (
                  <Box
                    onClick={() => f.updateCondition(c.id, {
                      pctileMode: !c.pctileMode,
                      op: !c.pctileMode && c.op === 'between' ? '>' : c.op,
                      value: !c.pctileMode ? 'p50' : '',
                    })}
                    sx={{
                      px: 0.8, py: 0.25, borderRadius: 1, cursor: 'pointer',
                      bgcolor: c.pctileMode ? `${CYAN}20` : 'transparent',
                      border: `1px solid ${c.pctileMode ? CYAN : BORDER}`,
                    }}
                  >
                    <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: 800, color: c.pctileMode ? CYAN : INK2 }}>
                      vs OWN %ILE
                    </Typography>
                  </Box>
                )}
                <IconButton size="small" onClick={() => f.removeCondition(c.id)} sx={{ p: 0.3 }}>
                  <DeleteOutlineIcon sx={{ fontSize: '0.95rem', color: INK2 }} />
                </IconButton>
              </Box>
            )
          })}
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          onClick={f.addCondition}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1.1, py: 0.5, borderRadius: 1, cursor: 'pointer', border: `1px solid ${CYAN}55` }}
        >
          <AddIcon sx={{ fontSize: '0.85rem', color: CYAN }} />
          <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: CYAN }}>ADD CONDITION</Typography>
        </Box>
        {f.conditions.length > 0 && (
          <Box onClick={f.clear} sx={{ px: 1.1, py: 0.5, borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...MONO, fontSize: '0.64rem', fontWeight: 700, color: INK2 }}>CLEAR</Typography>
          </Box>
        )}
      </Box>

      <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK2 }}>
        Add any number of conditions on live return fields (op can be &lt;, &gt;, or B/W for a between-range), then
        pick Match ALL (AND) or Match ANY (OR) to combine them. "vs Yday Close"/"vs Today Open" conditions can
        switch to "vs OWN %ILE" to compare against that stock's own 5-year percentile instead of a fixed number.
        Live off the streaming tick — updates every second, no scan needed.
      </Typography>
    </Box>
  )
}
