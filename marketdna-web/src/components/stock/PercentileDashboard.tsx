import { Box, Typography, Grid, CircularProgress, LinearProgress } from '@mui/material'
import type { PercentilesResponse } from '../../types/stock'

const INK    = '#F2EDE4'
const INK2   = '#8B95AC'
const INK3   = '#5B6880'
const BORDER = '#0F1526'

interface Props { data: PercentilesResponse | null; loading: boolean }

export default function PercentileDashboard({ data, loading }: Props) {
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
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
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
  const pct = metric.percentile
  const barColor = pct >= 75 ? '#ef4444' : pct >= 50 ? '#f59e0b' : pct >= 25 ? '#4f9cf9' : '#22c55e'

  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: '14px',
        border: `1px solid ${BORDER}`,
        background: '#07090F',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': { borderColor: `${barColor}50`, boxShadow: `0 0 18px ${barColor}12` },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
        <Box>
          <Typography variant="caption" sx={{ color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.75rem', display: 'block' }}>
            {metric.label}
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: INK }}>
            {metric.metric}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="body2" sx={{ fontWeight: 700, color: INK }}>
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
