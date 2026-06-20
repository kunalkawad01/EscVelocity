import { Box, Typography, Grid, CircularProgress, LinearProgress } from '@mui/material'
import type { PercentilesResponse } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: PercentilesResponse | null; loading: boolean }

export default function PercentileDashboard({ data, loading }: Props) {
  const { INK, INK2, INK3 } = usePalette()
  if (loading) {
    return (
      <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={32} />
      </Box>
    )
  }
  if (!data) return null

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Historical Context
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Percentile Command Center
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 3, display: 'block', lineHeight: 1.5 }}>
        Every metric ranked against its full multi-year history — turns raw numbers into percentile context that reveals whether conditions are extreme or ordinary
      </Typography>
      <Grid container spacing={2}>
        {data.metrics.map(m => (
          <Grid item xs={12} sm={6} md={4} key={m.metric}>
            <PercentileCard metric={m} />
          </Grid>
        ))}
      </Grid>
    </Box>
  )
}

function PercentileCard({ metric }: { metric: { metric: string; current_value: number; unit: string; percentile: number; label: string } }) {
  const { PAPER, BORDER, INK, INK3 } = usePalette()
  const pct = metric.percentile
  const barColor = pct >= 75 ? '#ef4444' : pct >= 50 ? '#f59e0b' : pct >= 25 ? '#4f9cf9' : '#22c55e'

  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: '14px',
        border: `1px solid ${BORDER}`,
        bgcolor: PAPER,
        transition: 'border-color 0.2s',
        '&:hover': { borderColor: `${barColor}50` },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
        <Box>
          <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block' }}>
            {metric.label}
          </Typography>
          <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.875rem', fontWeight: 700, color: INK }}>
            {metric.metric}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ ...MONO, fontSize: '0.9rem', fontWeight: 700, color: INK }}>
            {metric.current_value}{metric.unit}
          </Typography>
        </Box>
      </Box>
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" sx={{ color: INK3, fontSize: '0.75rem' }}>0th</Typography>
          <Typography variant="caption" sx={{ color: barColor, fontWeight: 700, fontSize: '0.7rem' }}>
            {pct.toFixed(0)}th percentile
          </Typography>
          <Typography variant="caption" sx={{ color: INK3, fontSize: '0.75rem' }}>100th</Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={pct}
          sx={{
            height: 6,
            borderRadius: 3,
            bgcolor: BORDER,
            '& .MuiLinearProgress-bar': {
              borderRadius: 3,
              bgcolor: barColor,
            },
          }}
        />
      </Box>
    </Box>
  )
}
