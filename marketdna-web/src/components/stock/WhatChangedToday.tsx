import { Box, Typography, Stack } from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import type {
  StockSummary, RelativeStrengthResponse, RiskResponse,
  DrawdownResponse, PercentilesResponse,
} from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const GOLD = '#D4AA47'
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Event {
  title: string
  body: string
  type: 'positive' | 'negative' | 'warning' | 'neutral'
}

interface Props {
  summary: StockSummary | null
  rs: RelativeStrengthResponse | null
  risk: RiskResponse | null
  drawdown: DrawdownResponse | null
  percentiles: PercentilesResponse | null
}

function deriveEvents(
  summary: StockSummary,
  rs: RelativeStrengthResponse | null,
  risk: RiskResponse | null,
  drawdown: DrawdownResponse | null,
  percentiles: PercentilesResponse | null,
): Event[] {
  const events: Event[] = []

  if (Math.abs(summary.change_pct) > 3) {
    events.push({
      title: `${summary.change_pct > 0 ? '+' : ''}${summary.change_pct.toFixed(2)}% move today`,
      body: `Significant daily move — in the ${summary.change_pct > 0 ? 'top' : 'bottom'} 5% historically`,
      type: summary.change_pct > 0 ? 'positive' : 'negative',
    })
  }

  if (summary.regime === 'Bullish') {
    events.push({ title: 'Full Bull Structure', body: 'Trading above SMA20, SMA50 and SMA200 simultaneously', type: 'positive' })
  } else if (summary.regime === 'Bearish') {
    events.push({ title: 'Full Bear Structure', body: 'Trading below all key moving averages', type: 'negative' })
  }

  if (rs) {
    if (rs.stats.current_rank <= 5) {
      events.push({ title: `Elite rank #${rs.stats.current_rank} of ${rs.stats.total_symbols}`, body: `Top ${(100 - rs.stats.rank_percentile).toFixed(0)}% by 1-month return`, type: 'positive' })
    } else if (rs.stats.current_rank >= rs.stats.total_symbols - 4) {
      events.push({ title: `Weak rank #${rs.stats.current_rank} of ${rs.stats.total_symbols}`, body: 'Bottom 10% by 1-month return among NIFTY 50', type: 'negative' })
    }
  }

  if (risk) {
    if (risk.stats.atr_percentile > 85) {
      events.push({ title: `Elevated volatility — ${risk.stats.atr_percentile}th percentile`, body: `ATR ₹${risk.stats.current_atr} — unusually wide daily ranges`, type: 'warning' })
    } else if (risk.stats.atr_percentile < 10) {
      events.push({ title: `Compressed volatility — ${risk.stats.atr_percentile}th percentile`, body: 'ATR historically low — potential breakout setup', type: 'neutral' })
    }
  }

  if (drawdown) {
    if (drawdown.stats.current_drawdown < -20) {
      events.push({ title: `Deep drawdown: ${drawdown.stats.current_drawdown.toFixed(1)}% from peak`, body: `Avg recovery takes ${drawdown.stats.avg_recovery_days} days from trough`, type: 'negative' })
    } else if (Math.abs(drawdown.stats.current_drawdown) < 1) {
      events.push({ title: 'Near all-time high', body: 'Less than 1% from historical peak — strong uptrend continuation', type: 'positive' })
    }
  }

  if (percentiles) {
    for (const m of percentiles.metrics) {
      if (m.metric === '1-Month Return' && m.percentile > 92) {
        events.push({ title: `1-Month return at ${m.percentile.toFixed(0)}th percentile`, body: `+${m.current_value.toFixed(1)}% — exceptional 20-day momentum`, type: 'positive' })
      }
      if (m.metric === 'Volume' && m.percentile > 90) {
        events.push({ title: `Volume surge — ${m.percentile.toFixed(0)}th percentile`, body: `${m.current_value.toFixed(1)}M shares — unusually high participation`, type: 'neutral' })
      }
    }
  }

  return events
}

const typeConfig = {
  positive: { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',   Icon: TrendingUpIcon },
  negative: { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',   Icon: TrendingDownIcon },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  Icon: WarningAmberIcon },
  neutral:  { color: '#8B95AC', bg: 'rgba(139,149,172,0.08)', Icon: ShowChartIcon },
}

export default function WhatChangedToday({ summary, rs, risk, drawdown, percentiles }: Props) {
  const { PAPER, INK, INK2, INK3, BORDER } = usePalette()

  if (!summary) return null

  const events = deriveEvents(summary, rs, risk, drawdown, percentiles)
  if (events.length === 0) {
    events.push({ title: 'No significant events today', body: 'All metrics within normal historical ranges', type: 'neutral' })
  }

  return (
    <Box>
      <Box mb={2.5}>
        <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: GOLD, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
          Live Event Scanner
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, ...SANS }}>
            What Changed Today
          </Typography>
          <Box sx={{ px: 1.25, py: 0.3, borderRadius: '8px', bgcolor: PAPER, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK2, ...SANS }}>{events.length} event{events.length !== 1 ? 's' : ''}</Typography>
          </Box>
        </Box>
        <Typography sx={{ fontSize: '0.73rem', color: INK2, mt: 0.5, lineHeight: 1.5, ...SANS }}>
          Rule-based event scanner — automatically flags what is statistically notable today across price, volatility, momentum, and drawdown dimensions
        </Typography>
      </Box>

      <Stack spacing={1.5}>
        {events.map((ev, i) => {
          const { color, Icon } = typeConfig[ev.type]
          return (
            <Box
              key={i}
              sx={{
                display: 'flex', alignItems: 'flex-start', gap: 2,
                p: 2, borderRadius: '12px',
                bgcolor: PAPER,
                border: `1.5px solid ${BORDER}`,
                borderLeft: `3px solid ${color}`,
              }}
            >
              <Box sx={{ width: 32, height: 32, borderRadius: '10px', background: `${color}14`, border: `1px solid ${color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon sx={{ color, fontSize: 16 }} />
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 700, color, fontSize: '0.85rem', lineHeight: 1.3, ...SANS }}>
                  {ev.title}
                </Typography>
                <Typography sx={{ color: INK2, fontSize: '0.75rem', display: 'block', mt: 0.25, ...SANS }}>
                  {ev.body}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}
