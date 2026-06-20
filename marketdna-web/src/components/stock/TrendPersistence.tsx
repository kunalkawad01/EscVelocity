import { Box, Typography, Stack, CircularProgress } from '@mui/material'
import type { TrendPersistenceResponse } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: TrendPersistenceResponse | null; loading: boolean }

export default function TrendPersistence({ data, loading }: Props) {
  const { INK, INK2, INK3, BORDER } = usePalette()

  if (loading) {
    return (
      <Box sx={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    )
  }
  if (!data) return null

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Streak Analysis
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Trend Persistence
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        Days above/below each SMA measures conviction, not just direction — a 150-day streak above SMA200 is structurally different from a fresh cross
      </Typography>

      <Stack spacing={2.5}>
        {data.streaks.map(s => {
          const isAbove = s.streak_direction === 'above'
          const color = isAbove ? '#22c55e' : '#ef4444'
          const pct = s.streak_percentile

          return (
            <Box key={s.label}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 1 }}>
                <Box>
                  <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                    {s.label}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                    <Typography sx={{ ...MONO, fontSize: '1.25rem', fontWeight: 800, color, lineHeight: 1 }}>
                      {s.current_streak}d
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {isAbove ? 'above' : 'below'}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    Historical percentile
                  </Typography>
                  <Typography sx={{ ...MONO, fontSize: '0.875rem', fontWeight: 700, color }}>
                    {pct.toFixed(0)}th
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ height: 5, borderRadius: 3, bgcolor: BORDER }}>
                <Box
                  sx={{
                    height: '100%',
                    width: `${pct}%`,
                    borderRadius: 3,
                    bgcolor: color,
                    opacity: 0.8,
                    transition: 'width 0.8s ease',
                  }}
                />
              </Box>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}
