import { Box, Typography, Stack, Chip, CircularProgress } from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import SpeedIcon from '@mui/icons-material/Speed'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import type { InsightsResponse } from '../../types/stock'

const INK    = '#F2EDE4'
const INK2   = '#8B95AC'
const INK3   = '#5B6880'
const BORDER = '#0F1526'

interface Props { data: InsightsResponse | null; loading: boolean }

const CATEGORY_CONFIG = {
  trend:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  Icon: TrendingUpIcon },
  momentum:  { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',   Icon: SpeedIcon },
  risk:      { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  Icon: WarningAmberIcon },
  strength:  { color: '#a78bfa', bg: 'rgba(167,139,250,0.08)', Icon: EmojiEventsIcon },
}

const SIG_COLOR = { high: '#22c55e', medium: '#f59e0b', low: INK3 }

export default function ResearchInsights({ data, loading }: Props) {
  if (loading) {
    return (
      <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
        <CircularProgress size={28} />
        <Typography variant="caption" sx={{ color: INK3 }}>Generating insights…</Typography>
      </Box>
    )
  }
  if (!data) return null

  const high = data.insights.filter(i => i.significance === 'high')
  const medium = data.insights.filter(i => i.significance === 'medium')

  return (
    <Box>
      <Box mb={0.5}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
          Automated Analysis
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK }}>
            Research Insights
          </Typography>
          <Box sx={{ px: 1.25, py: 0.3, borderRadius: '8px', background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.25)' }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa' }}>{data.insights.length} insights</Typography>
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: INK3, ml: 'auto' }}>{data.generated_at}</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.73rem', color: INK2, mt: 0.5, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
          Rule-based alerts triggered when metrics cross statistically significant thresholds — each insight includes the event, context, and significance level
        </Typography>
      </Box>

      {data.insights.length === 0 ? (
        <Typography variant="body2" sx={{ color: INK3 }}>
          No statistically significant events detected
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {[...high, ...medium].map((insight, i) => {
            const cat = CATEGORY_CONFIG[insight.category] ?? CATEGORY_CONFIG.trend
            const { color, bg, Icon } = cat
            return (
              <Box
                key={i}
                sx={{
                  display: 'flex',
                  gap: 2,
                  p: 2,
                  borderRadius: '12px',
                  background: '#07090F',
                  border: `1px solid ${BORDER}`,
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: `${color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon sx={{ color, fontSize: 16 }} />
                </Box>
                <Box flex={1}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: INK }}>
                      {insight.title}
                    </Typography>
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: SIG_COLOR[insight.significance],
                        flexShrink: 0,
                      }}
                    />
                  </Box>
                  <Typography variant="caption" sx={{ color: INK2, lineHeight: 1.5 }}>
                    {insight.body}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Stack>
      )}

      <Typography variant="caption" sx={{ color: INK3, display: 'block', mt: 2, fontSize: '0.6875rem' }}>
        All insights derived from DuckDB queries on historical price data. No estimates or predictions.
      </Typography>
    </Box>
  )
}
