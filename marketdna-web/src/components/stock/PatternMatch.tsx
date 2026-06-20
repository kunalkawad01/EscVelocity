import { Box, Typography, Chip, CircularProgress, Grid, Stack } from '@mui/material'
import type { PatternMatchResponse, DTWPattern } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: PatternMatchResponse | null; loading: boolean }

function fmt(v: number | null): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

function retColor(v: number | null, ink3: string): string {
  if (v === null) return ink3
  return v > 0 ? '#22c55e' : '#ef4444'
}

function directionColor(dir: string): string {
  if (dir === 'Bullish') return '#22c55e'
  if (dir === 'Bearish') return '#ef4444'
  return '#f59e0b'
}

function DTWCard({ pattern, rank }: { pattern: DTWPattern; rank: number }) {
  const { BORDER, PAPER2, INK3 } = usePalette()
  const dateLabel = new Date(pattern.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  const simColor = pattern.pattern_similarity >= 75 ? '#22c55e' : pattern.pattern_similarity >= 50 ? '#f59e0b' : INK3

  return (
    <Box sx={{
      p: 1.5, borderRadius: 2, border: `1px solid ${BORDER}`,
      bgcolor: PAPER2, display: 'flex', gap: 2, alignItems: 'center',
    }}>
      {/* Similarity */}
      <Box sx={{ textAlign: 'center', minWidth: 48 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', display: 'block' }}>SIM</Typography>
        <Typography sx={{ ...MONO, fontWeight: 800, fontSize: '1rem', color: simColor }}>
          {pattern.pattern_similarity.toFixed(0)}%
        </Typography>
      </Box>

      <Box flex={1}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem' }}>#{rank}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{dateLabel}</Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          {[
            { label: '→ 1M', val: pattern.fwd_1m },
            { label: '→ 3M', val: pattern.fwd_3m },
          ].map(({ label, val }) => (
            <Box key={label}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', display: 'block' }}>{label}</Typography>
              <Typography variant="caption" sx={{ fontWeight: 800, color: retColor(val, INK3), fontSize: '0.7rem' }}>
                {fmt(val)}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  )
}

export default function PatternMatch({ data, loading }: Props) {
  const { BORDER, PAPER2, INK3 } = usePalette()
  if (loading) {
    return (
      <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexDirection: 'column' }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Running KNN and DTW pattern search…</Typography>
      </Box>
    )
  }
  if (!data) return null

  const { knn, dtw_patterns: dtw, dtw_avg_fwd_1m, dtw_avg_fwd_3m, dtw_pct_positive_1m } = data
  const dc = directionColor(knn.predicted_direction)

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#F59E0B', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Similarity Search
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', background: 'linear-gradient(135deg, #FFFFFF 30%, #94A3B8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', mb: 0.5, display: 'block' }}>
        Pattern Match Engine
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK3, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        KNN finds the 10 most feature-similar historical environments; DTW finds the 5 price shapes most geometrically similar to the current 21-day window — what happened next in those cases
      </Typography>

      <Grid container spacing={2}>
        {/* KNN */}
        <Grid item xs={12} md={4}>
          <Box sx={{ p: 2, borderRadius: 2, border: `1px solid ${BORDER}`, bgcolor: PAPER2 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 1.5 }}>
              KNN ({knn.k} neighbors)
            </Typography>
            <Chip label={knn.predicted_direction} size="small"
              sx={{ bgcolor: `${dc}18`, color: dc, fontWeight: 800, fontSize: '0.7rem', mb: 1.5 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 1.5 }}>
              {knn.confidence.toFixed(0)}% of neighbors agree
            </Typography>
            <Stack direction="row" spacing={3}>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>Avg 1M</Typography>
                <Typography sx={{ ...MONO, fontSize: '0.9rem', fontWeight: 800, color: retColor(knn.avg_fwd_1m, INK3) }}>
                  {fmt(knn.avg_fwd_1m)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>Avg 3M</Typography>
                <Typography sx={{ ...MONO, fontSize: '0.9rem', fontWeight: 800, color: retColor(knn.avg_fwd_3m, INK3) }}>
                  {fmt(knn.avg_fwd_3m)}
                </Typography>
              </Box>
            </Stack>
          </Box>
        </Grid>

        {/* DTW patterns */}
        <Grid item xs={12} md={5}>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 1 }}>
            Most similar price shapes
          </Typography>
          <Stack spacing={1}>
            {dtw.length === 0
              ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>Insufficient history for DTW</Typography>
              : dtw.map((p, i) => <DTWCard key={p.date} pattern={p} rank={i + 1} />)
            }
          </Stack>
        </Grid>

        {/* DTW aggregate */}
        <Grid item xs={12} md={3}>
          <Box sx={{ p: 2, borderRadius: 2, border: `1px solid ${BORDER}`, bgcolor: PAPER2, height: '100%' }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 2 }}>
              DTW Aggregate
            </Typography>
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>Avg → 1M</Typography>
                <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: retColor(dtw_avg_fwd_1m, INK3) }}>
                  {fmt(dtw_avg_fwd_1m)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>Avg → 3M</Typography>
                <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: retColor(dtw_avg_fwd_3m, INK3) }}>
                  {fmt(dtw_avg_fwd_3m)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>% Positive 1M</Typography>
                <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: dtw_pct_positive_1m >= 60 ? '#22c55e' : dtw_pct_positive_1m <= 40 ? '#ef4444' : '#f59e0b' }}>
                  {dtw_pct_positive_1m.toFixed(0)}%
                </Typography>
              </Box>
            </Stack>
          </Box>
        </Grid>
      </Grid>
    </Box>
  )
}
