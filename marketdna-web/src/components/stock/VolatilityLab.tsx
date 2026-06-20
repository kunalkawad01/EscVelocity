import { Box, Typography, Chip, CircularProgress, Grid, Stack } from '@mui/material'
import type { VolatilityLabResponse } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: VolatilityLabResponse | null; loading: boolean }

function Val({ label, value, color }: { label: string; value: string; color?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.6875rem', fontWeight: 600, color: INK3, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block' }}>
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

export default function VolatilityLab({ data, loading }: Props) {
  const { INK, INK2, INK3, BORDER } = usePalette()

  const retColor = (v: number) => v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : INK3
  const regimeChipColor = (regime: string) => regime === 'Expanding' ? '#ef4444' : regime === 'Contracting' ? '#22c55e' : INK3
  const betaColor = (beta: number) => beta > 1.3 ? '#ef4444' : beta < 0.7 ? '#22c55e' : INK3

  if (loading) {
    return (
      <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexDirection: 'column' }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ color: INK3 }}>Fitting GARCH model…</Typography>
      </Box>
    )
  }
  if (!data) return null

  const { realized_vol: rv, garch, rolling_beta: beta, quantile_regression: qr } = data
  const rvPctColor = rv.rv_percentile > 80 ? '#ef4444' : rv.rv_percentile < 20 ? '#22c55e' : '#f59e0b'
  const asymColor = qr.tail_asymmetry.startsWith('Positive') ? '#22c55e' : qr.tail_asymmetry.startsWith('Negative') ? '#ef4444' : INK3

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#F59E0B', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Volatility Intelligence
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Volatility Lab
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        Realized vol measures what happened; GARCH forecasts what's likely next; Beta shows market sensitivity; Quantile Regression maps the full shape of return distribution asymmetry
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <MetricCard title="Realized Volatility">
            <Typography sx={{ ...MONO, fontSize: '1.75rem', fontWeight: 800, color: rvPctColor, mb: 0.5, lineHeight: 1 }}>
              {rv.current_rv.toFixed(1)}%
            </Typography>
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block', mb: 1 }}>
              21d realized, annualized
            </Typography>
            <Box sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem' }}>Percentile</Typography>
                <Typography variant="caption" sx={{ fontWeight: 700, color: rvPctColor, fontSize: '0.75rem' }}>
                  {rv.rv_percentile.toFixed(0)}th
                </Typography>
              </Box>
              <Box sx={{ height: 4, borderRadius: 2, bgcolor: BORDER }}>
                <Box sx={{ height: '100%', width: `${rv.rv_percentile}%`, borderRadius: 2, bgcolor: rvPctColor }} />
              </Box>
            </Box>
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.75rem' }}>
              {rv.interpretation}
            </Typography>
          </MetricCard>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <MetricCard title="GARCH(1,1) Volatility">
            <Typography sx={{ ...MONO, fontSize: '1.75rem', fontWeight: 800, mb: 0.5, color: regimeChipColor(garch.vol_regime), lineHeight: 1 }}>
              {garch.current_conditional_vol.toFixed(1)}%
            </Typography>
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block', mb: 1 }}>
              Conditional vol (annualized)
            </Typography>
            <Chip label={garch.vol_regime} size="small"
              sx={{ bgcolor: `${regimeChipColor(garch.vol_regime)}18`, color: regimeChipColor(garch.vol_regime), fontWeight: 700, fontSize: '0.75rem', mb: 1 }} />
            <Val label="1-Day Forecast" value={`${garch.one_day_forecast.toFixed(1)}% ann.`} />
          </MetricCard>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <MetricCard title="Rolling Beta (63d)">
            <Typography sx={{ ...MONO, fontSize: '1.75rem', fontWeight: 800, mb: 0.5, color: betaColor(beta.current_beta), lineHeight: 1 }}>
              {beta.current_beta.toFixed(2)}β
            </Typography>
            <Chip label={beta.beta_trend} size="small"
              sx={{ bgcolor: `${BORDER}`, color: INK2, fontWeight: 600, fontSize: '0.75rem', mb: 1 }} />
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block' }}>
              {beta.interpretation}
            </Typography>
          </MetricCard>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <MetricCard title="21d Return Distribution">
            <Stack spacing={1} mb={1.5}>
              {[
                { label: 'Q90 (Optimistic)',  val: qr.q90_expected_return },
                { label: 'Q50 (Median)',      val: qr.q50_expected_return },
                { label: 'Q10 (Pessimistic)', val: qr.q10_expected_return },
              ].map(({ label, val }) => (
                <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem' }}>{label}</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: retColor(val), fontSize: '0.7rem' }}>
                    {val > 0 ? '+' : ''}{val.toFixed(1)}%
                  </Typography>
                </Box>
              ))}
            </Stack>
            <Chip label={qr.tail_asymmetry.split('—')[0].trim()} size="small"
              sx={{ bgcolor: `${asymColor}18`, color: asymColor, fontWeight: 700, fontSize: '0.75rem' }} />
          </MetricCard>
        </Grid>
      </Grid>
    </Box>
  )
}
