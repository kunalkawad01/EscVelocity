import { Box, OutlinedInput, Typography } from '@mui/material'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { MONO } from './chartsCommon'
import type { FilterOp, FilterValue } from './chartsCommon'

// Op (< / >) + threshold input, shared by every filter bar on /charts, /clusters
// and /chart-cart (IndicatorFilterBar, LiveReturnFilterBar) so they read as one
// system instead of each inventing its own control.
export function OpToggle({ op, onChange }: { op: FilterOp; onChange: (op: FilterOp) => void }) {
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

export function FilterField({
  label, filter, onChange, placeholder, labelWidth = 54,
}: {
  label: string
  filter: FilterValue
  onChange: (f: FilterValue) => void
  placeholder: string
  labelWidth?: number
}) {
  const { INK3 } = usePalette()
  const { INPUT_SX, PAPER2 } = useTokens()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: INK3, minWidth: labelWidth, flexShrink: 0 }}>
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
