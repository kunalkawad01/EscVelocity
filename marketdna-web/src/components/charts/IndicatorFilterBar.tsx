import { Box, Typography } from '@mui/material'
import { usePalette } from '../../hooks/usePalette'
import { CHARTS_TFS } from '../../types/charts'
import { MONO, TF_LABELS } from './chartsCommon'
import { FilterField } from './FilterControls'
import type { UseIndicatorFilters } from '../../hooks/useIndicatorFilters'

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
