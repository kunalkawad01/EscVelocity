import { Box, Typography, Chip, CircularProgress, Grid, Stack } from '@mui/material'
import type { StatisticalSignalsResponse } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: StatisticalSignalsResponse | null; loading: boolean }

function Val({ label, value, color }: { label: string; value: string; color?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.6875rem', fontWeight: 600, color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block' }}>
        {label}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 700, color: color ?? INK }}>
        {value}
      </Typography>
    </Box>
  )
}

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { PAPER, BORDER, INK3 } = usePalette()
  return (
    <Box sx={{ p: 2.5, borderRadius: '14px', border: `1px solid ${BORDER}`, bgcolor: PAPER, height: '100%' }}>
      <Typography variant="overline" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block', mb: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

export default function StatisticalSignals({ data, loading }: Props) {
  const { INK, INK2, INK3 } = usePalette()

  const hurstColor = (regime: string) =>
    regime === 'Trending' ? '#22c55e' : regime === 'Mean-Reverting' ? '#3b82f6' : INK3

  if (loading) {
    return (
      <Box sx={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexDirection: 'column' }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ color: INK3 }}>Computing Hurst exponent and CVaR…</Typography>
      </Box>
    )
  }
  if (!data) return null

  const { hurst, cvar } = data

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#8B5CF6', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Statistical Edge
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Statistical Risk Metrics
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        Hurst exponent reveals whether price trends persistently or mean-reverts — CVaR quantifies the average loss in the worst 5% of trading periods, beyond what VaR captures
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <MetricCard title="Hurst Exponent (R/S Analysis)">
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 1 }}>
              <Typography sx={{ ...MONO, fontSize: '2.25rem', fontWeight: 900, color: hurstColor(hurst.regime), lineHeight: 1 }}>
                {hurst.hurst_exponent.toFixed(3)}
              </Typography>
              <Chip label={hurst.regime} size="small"
                sx={{ bgcolor: `${hurstColor(hurst.regime)}18`, color: hurstColor(hurst.regime), fontWeight: 700, fontSize: '0.75rem' }} />
            </Box>
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.75rem', lineHeight: 1.7, display: 'block', mb: 1.5 }}>
              {hurst.interpretation}
            </Typography>
            <Box sx={{ display: 'flex', gap: 3 }}>
              {[
                { label: '< 0.45', desc: 'Mean-Reverting', color: '#3b82f6' },
                { label: '≈ 0.50', desc: 'Random Walk',    color: INK3 },
                { label: '> 0.55', desc: 'Trending',       color: '#22c55e' },
              ].map(({ label, desc, color }) => (
                <Box key={label}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color, fontSize: '0.6875rem', display: 'block' }}>{label}</Typography>
                  <Typography variant="caption" sx={{ color: INK3, fontSize: '0.75rem' }}>{desc}</Typography>
                </Box>
              ))}
            </Box>
          </MetricCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <MetricCard title="Expected Shortfall — CVaR 95%">
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 1 }}>
              <Typography sx={{ ...MONO, fontSize: '2.25rem', fontWeight: 900, color: '#ef4444', lineHeight: 1 }}>
                {cvar.cvar_95.toFixed(1)}%
              </Typography>
              <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem' }}>avg loss, worst 5% periods</Typography>
            </Box>
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.75rem', lineHeight: 1.7, display: 'block', mb: 1.5 }}>
              {cvar.interpretation}
            </Typography>
            <Stack direction="row" spacing={3}>
              <Val label="VaR 95%" value={`${cvar.var_95.toFixed(1)}%`} color="#f97316" />
              <Val label="Daily Vol (Ann.)" value={`${cvar.daily_vol.toFixed(1)}%`} />
            </Stack>
          </MetricCard>
        </Grid>
      </Grid>
    </Box>
  )
}
