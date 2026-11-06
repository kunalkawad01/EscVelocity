import { Box, Typography } from '@mui/material'
import { usePalette } from '../../hooks/usePalette'
import { MONO } from './chartsCommon'
import { FilterField } from './FilterControls'
import type { UseLiveReturnFilters } from '../../hooks/useLiveReturnFilters'

// Live return filter bar -- vs yesterday's close / today's open / today's high /
// today's low, computed off the streaming tick with no scan/Apply step needed.
// Shared by /charts, /clusters and /chart-cart.
export function LiveReturnFilterBar({ f }: { f: UseLiveReturnFilters }) {
  const { INK3, BORDER } = usePalette()
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: INK3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Live Return Filters
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <FilterField label="vs Yday Close" filter={f.vsPrevClose} onChange={f.setVsPrevClose} placeholder="e.g. -3" labelWidth={88} />
        <FilterField label="vs Today Open" filter={f.vsOpen} onChange={f.setVsOpen} placeholder="e.g. 2" labelWidth={88} />
        <FilterField label="vs Today High" filter={f.vsHigh} onChange={f.setVsHigh} placeholder="e.g. -1" labelWidth={88} />
        <FilterField label="vs Today Low" filter={f.vsLow} onChange={f.setVsLow} placeholder="e.g. 1" labelWidth={88} />
        {f.active && (
          <Box onClick={f.clear} sx={{ px: 1.1, py: 0.5, borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...MONO, fontSize: '0.64rem', fontWeight: 700, color: INK3 }}>CLEAR</Typography>
          </Box>
        )}
      </Box>
      <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>
        Live off the streaming tick -- updates every second, no scan needed. "vs Today High/Low" reflect the session so far, not the final day's range.
      </Typography>
    </Box>
  )
}
