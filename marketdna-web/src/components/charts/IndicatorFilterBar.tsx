import { Box, OutlinedInput, Typography } from '@mui/material'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { CHARTS_TFS } from '../../types/charts'
import { MONO, TF_LABELS } from './chartsCommon'
import type { UseIndicatorFilters, FilterOp, IndicatorFilterValue } from '../../hooks/useIndicatorFilters'

function OpToggle({ op, onChange }: { op: FilterOp; onChange: (op: FilterOp) => void }) {
  const { INK3, CYAN, BORDER } = usePalette()
  return (
    <Box sx={{ display: 'flex', gap: 0.2 }}>
      {(['<', '>'] as const).map(o => (
        <Box
          key={o}
          onClick={() => onChange(o)}
          sx={{
            width: 20, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 0.75, cursor: 'pointer',
            bgcolor: op === o ? `${CYAN}20` : 'transparent',
            border: `1px solid ${op === o ? CYAN : BORDER}`,
          }}
        >
          <Typography sx={{ ...MONO, fontSize: '0.7rem', fontWeight: 800, color: op === o ? CYAN : INK3 }}>{o}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function FilterField({
  label, filter, onChange, placeholder,
}: {
  label: string
  filter: IndicatorFilterValue
  onChange: (f: IndicatorFilterValue) => void
  placeholder: string
}) {
  const { INK3 } = usePalette()
  const { INPUT_SX, PAPER2 } = useTokens()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: INK3, minWidth: 54, flexShrink: 0 }}>
        {label}
      </Typography>
      <OpToggle op={filter.op} onChange={op => onChange({ ...filter, op })} />
      <OutlinedInput
        size="small"
        value={filter.value}
        onChange={e => onChange({ ...filter, value: e.target.value })}
        placeholder={placeholder}
        inputProps={{ inputMode: 'decimal' }}
        sx={{ ...INPUT_SX, width: 76, bgcolor: PAPER2, '& input': { ...MONO, fontSize: '0.68rem', py: 0.6 } }}
      />
    </Box>
  )
}

// Shared RSI / ATR% / Returns% filter bar -- used identically on /charts (filters the
// grid) and /chart-cart (filters the cart). Fetches a bulk indicator snapshot on
// "Apply" (slow cold scan, see useIndicatorFilters), then every subsequent
// operator/threshold tweak re-filters client-side with no extra network call.
export function IndicatorFilterBar({ f }: { f: UseIndicatorFilters }) {
  const { INK3, CYAN, BORDER } = usePalette()
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, flexWrap: 'wrap' }}>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: INK3, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
          Indicator TF
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.35, flexWrap: 'wrap' }}>
          {CHARTS_TFS.map(t => (
            <Box
              key={t}
              onClick={() => f.setTf(t)}
              sx={{
                px: 0.9, py: 0.3, borderRadius: 1, cursor: 'pointer',
                bgcolor: f.tf === t ? `${CYAN}20` : 'transparent',
                border: `1px solid ${f.tf === t ? CYAN : BORDER}`,
              }}
            >
              <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: f.tf === t ? 800 : 600, color: f.tf === t ? CYAN : INK3 }}>
                {TF_LABELS[t]}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <FilterField label="RSI" filter={f.rsi} onChange={f.setRsi} placeholder="e.g. 30" />
        <FilterField label="ATR %" filter={f.atr} onChange={f.setAtr} placeholder="e.g. 2" />
        <FilterField label="Returns %" filter={f.returns} onChange={f.setReturns} placeholder="e.g. -5" />

        <Box
          onClick={f.loading ? undefined : f.apply}
          sx={{
            px: 1.1, py: 0.5, borderRadius: 1, cursor: f.loading ? 'default' : 'pointer',
            bgcolor: `${CYAN}20`, border: `1px solid ${CYAN}`, opacity: f.loading ? 0.6 : 1,
          }}
        >
          <Typography sx={{ ...MONO, fontSize: '0.64rem', fontWeight: 800, color: CYAN }}>
            {f.loading ? 'SCANNING…' : f.hasSnapshot ? 'RE-SCAN' : 'APPLY'}
          </Typography>
        </Box>

        {(f.hasSnapshot || f.rsi.value || f.atr.value || f.returns.value) && (
          <Box onClick={f.clear} sx={{ px: 1.1, py: 0.5, borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...MONO, fontSize: '0.64rem', fontWeight: 700, color: INK3 }}>CLEAR</Typography>
          </Box>
        )}
      </Box>

      {(f.loading || f.error || f.hasSnapshot) && (
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: f.error ? '#ef4444' : INK3 }}>
          {f.loading
            ? `Scanning ~209 symbols at ${TF_LABELS[f.tf]} — first scan for a timeframe can take up to a minute…`
            : f.error
            ? f.error
            : `Snapshot as of ${f.computedAt ?? '—'} (${TF_LABELS[f.tf]}). Change RSI/ATR/Returns or re-pick the timeframe, then Re-scan.`}
        </Typography>
      )}
    </Box>
  )
}
