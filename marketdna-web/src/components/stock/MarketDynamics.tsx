import { Box, Typography, Chip, CircularProgress, Grid } from '@mui/material'
import type { MarketDynamicsResponse, LeadLagPair } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: MarketDynamicsResponse | null; loading: boolean }

function PairRow({ pair }: { pair: LeadLagPair }) {
  const { BORDER, PAPER2, INK3 } = usePalette()
  const isLeader = pair.peak_lag > 0
  const labelColor = isLeader ? '#22c55e' : pair.peak_lag < 0 ? '#3b82f6' : INK3
  const corrColor  = pair.peak_correlation > 0 ? '#22c55e' : '#ef4444'

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        py: 0.75,
        px: 1.5,
        borderRadius: 1.5,
        '&:nth-of-type(odd)': { bgcolor: PAPER2 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, minWidth: 100 }}>
          {pair.other_symbol}
        </Typography>
        <Chip
          label={isLeader ? `Leads by ${pair.peak_lag}d` : pair.peak_lag < 0 ? `Lags by ${Math.abs(pair.peak_lag)}d` : 'Coincident'}
          size="small"
          sx={{ bgcolor: `${labelColor}15`, color: labelColor, fontWeight: 700, fontSize: '0.75rem', height: 18 }}
        />
      </Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: corrColor, fontSize: '0.75rem', ml: 1 }}>
        r = {pair.peak_correlation > 0 ? '+' : ''}{pair.peak_correlation.toFixed(3)}
      </Typography>
    </Box>
  )
}

export default function MarketDynamics({ data, loading }: Props) {
  const { BORDER, INK3 } = usePalette()
  if (loading) {
    return (
      <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexDirection: 'column' }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Computing cross-stock lead-lag correlations…</Typography>
      </Box>
    )
  }
  if (!data) return null

  const leaders = data.lead_lag_pairs.filter(p => p.peak_lag > 0)
  const laggers  = data.lead_lag_pairs.filter(p => p.peak_lag < 0)
  const coinc    = data.lead_lag_pairs.filter(p => p.peak_lag === 0)

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#22C55E', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Cross-Stock Correlation · Lags ±5 Days
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', background: `linear-gradient(135deg, #FFFFFF 30%, ${INK3} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', mb: 0.5, display: 'block' }}>
        Market Dynamics
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK3, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        Which stocks move first and which follow {data.symbol} — based on cross-correlation at lags ±5 days
      </Typography>

      {data.lead_lag_pairs.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
          No significant lead-lag relationships detected (|r| &lt; 0.1 for all pairs).
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {/* Summary chips */}
          {(data.strongest_leader || data.strongest_lagger) && (
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 0.5 }}>
                {data.strongest_leader && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem' }}>Strongest leader:</Typography>
                    <Chip label={data.strongest_leader} size="small"
                      sx={{ bgcolor: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }} />
                  </Box>
                )}
                {data.strongest_lagger && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem' }}>Strongest lagger:</Typography>
                    <Chip label={data.strongest_lagger} size="small"
                      sx={{ bgcolor: 'rgba(59,130,246,0.12)', color: '#3b82f6', fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }} />
                  </Box>
                )}
              </Box>
            </Grid>
          )}

          {/* Leaders */}
          {leaders.length > 0 && (
            <Grid item xs={12} md={4}>
              <Typography variant="overline" sx={{ color: '#22c55e', fontSize: '0.6875rem', display: 'block', mb: 1 }}>
                Stocks that lead {data.symbol}
              </Typography>
              <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
                {leaders.slice(0, 5).map(p => <PairRow key={p.other_symbol} pair={p} />)}
              </Box>
            </Grid>
          )}

          {/* Laggers */}
          {laggers.length > 0 && (
            <Grid item xs={12} md={4}>
              <Typography variant="overline" sx={{ color: '#3b82f6', fontSize: '0.6875rem', display: 'block', mb: 1 }}>
                Stocks that lag {data.symbol}
              </Typography>
              <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
                {laggers.slice(0, 5).map(p => <PairRow key={p.other_symbol} pair={p} />)}
              </Box>
            </Grid>
          )}

          {/* Coincident */}
          {coinc.length > 0 && (
            <Grid item xs={12} md={4}>
              <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 1 }}>
                Coincident
              </Typography>
              <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
                {coinc.slice(0, 5).map(p => <PairRow key={p.other_symbol} pair={p} />)}
              </Box>
            </Grid>
          )}
        </Grid>
      )}
    </Box>
  )
}
