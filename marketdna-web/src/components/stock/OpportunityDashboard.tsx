import { Box, Typography, Stack } from '@mui/material'
import type {
  StockSummary, RelativeStrengthResponse, RiskResponse, DrawdownResponse,
} from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const GOLD = '#D4AA47'
const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props {
  summary: StockSummary | null
  rs: RelativeStrengthResponse | null
  risk: RiskResponse | null
  drawdown: DrawdownResponse | null
}

interface Component {
  label: string
  score: number
  description: string
}

function computeComponents(
  summary: StockSummary,
  rs: RelativeStrengthResponse | null,
  risk: RiskResponse | null,
  drawdown: DrawdownResponse | null,
): Component[] {
  const regimeScore = summary.regime === 'Bullish' ? 100 : summary.regime === 'Mixed' ? 55 : 15
  const regimeDetail = summary.regime === 'Bullish' ? 'Above all SMAs' : summary.regime === 'Mixed' ? 'Mixed structure' : 'Below all SMAs'
  const rsScore = rs ? rs.stats.rank_percentile : 50
  const rsDetail = rs ? `Rank #${rs.stats.current_rank} of ${rs.stats.total_symbols}` : '—'
  const volHealth = risk ? Math.max(0, 100 - risk.stats.atr_percentile) : 50
  const volDetail = risk ? `ATR at ${risk.stats.atr_percentile}th percentile` : '—'
  const ddHealth = drawdown ? Math.max(0, Math.min(100, 100 + drawdown.stats.current_drawdown * 2)) : 50
  const ddDetail = drawdown ? `${drawdown.stats.current_drawdown.toFixed(1)}% from peak` : '—'

  return [
    { label: 'Trend Structure',   score: regimeScore, description: regimeDetail },
    { label: 'Relative Strength', score: rsScore,     description: rsDetail },
    { label: 'Volatility Health', score: volHealth,   description: volDetail },
    { label: 'Drawdown Health',   score: ddHealth,    description: ddDetail },
  ]
}

function opportunityRating(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Exceptional', color: '#22c55e' }
  if (score >= 60) return { label: 'Strong',      color: '#4ade80' }
  if (score >= 40) return { label: 'Neutral',     color: '#f59e0b' }
  if (score >= 20) return { label: 'Weak',        color: '#fb923c' }
  return              { label: 'Avoid',         color: '#ef4444' }
}

export default function OpportunityDashboard({ summary, rs, risk, drawdown }: Props) {
  const { INK, INK2, INK3, BORDER } = usePalette()

  if (!summary) return null

  const components = computeComponents(summary, rs, risk, drawdown)
  const total = Math.round(components.reduce((s, c) => s + c.score, 0) / components.length)
  const { label: rating, color } = opportunityRating(total)

  const R = 54
  const circ = 2 * Math.PI * R
  const dash = (total / 100) * circ

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: GOLD, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Composite Score
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Opportunity Dashboard
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        Composite 0–100 score integrating regime, relative strength, volatility, and drawdown recovery into a single actionable research signal
      </Typography>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems={{ md: 'center' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
          <Box sx={{ position: 'relative', width: 140, height: 140 }}>
            <svg width={140} height={140} viewBox="0 0 140 140">
              <circle cx={70} cy={70} r={R} fill="none" stroke={BORDER} strokeWidth={10} />
              <circle
                cx={70} cy={70} r={R} fill="none"
                stroke={color} strokeWidth={10}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={circ * 0.25}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 1s ease' }}
              />
            </svg>
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ ...MONO, fontSize: '1.75rem', fontWeight: 800, color, lineHeight: 1 }}>{total}</Typography>
              <Typography component="span" sx={{ color: INK3, fontSize: '0.6875rem' }}>/ 100</Typography>
            </Box>
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color, mt: 0.5 }}>{rating}</Typography>
          <Typography variant="caption" sx={{ color: INK3 }}>Opportunity Score</Typography>
        </Box>

        <Stack spacing={2} flex={1}>
          {components.map(c => {
            const cColor = c.score >= 70 ? '#22c55e' : c.score >= 45 ? '#f59e0b' : '#ef4444'
            return (
              <Box key={c.label}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" sx={{ color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {c.label}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ color: INK2, fontSize: '0.75rem' }}>{c.description}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: cColor, minWidth: 28, textAlign: 'right' }}>{Math.round(c.score)}</Typography>
                  </Box>
                </Box>
                <Box sx={{ height: 4, borderRadius: 2, bgcolor: BORDER }}>
                  <Box sx={{ height: '100%', width: `${c.score}%`, borderRadius: 2, bgcolor: cColor, transition: 'width 0.8s ease' }} />
                </Box>
              </Box>
            )
          })}
        </Stack>
      </Stack>

      <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${BORDER}` }}>
        <Stack direction="row" spacing={0} sx={{ borderRadius: 1, overflow: 'hidden' }}>
          {[
            { label: '0–20 Avoid',       color: '#ef4444' },
            { label: '20–40 Weak',       color: '#fb923c' },
            { label: '40–60 Neutral',    color: '#f59e0b' },
            { label: '60–80 Strong',     color: '#4ade80' },
            { label: '80–100 Exceptional', color: '#22c55e' },
          ].map(r => (
            <Box key={r.label} sx={{ flex: 1, py: 0.5, textAlign: 'center', bgcolor: `${r.color}15`, borderRight: `1px solid ${BORDER}` }}>
              <Typography variant="caption" sx={{ color: r.color, fontWeight: 600, fontSize: '0.75rem' }}>{r.label}</Typography>
            </Box>
          ))}
        </Stack>
        <Box sx={{ position: 'relative', height: 3, mt: 0 }}>
          <Box sx={{ position: 'absolute', left: `${total}%`, transform: 'translateX(-50%)', width: 3, height: 8, bgcolor: color, borderRadius: 1 }} />
        </Box>
      </Box>
    </Box>
  )
}
