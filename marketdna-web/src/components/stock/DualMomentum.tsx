import { Box, Typography, Chip, CircularProgress, Grid, Stack } from '@mui/material'
import type { DualMomentumResponse, DualMomentumSignalPerf } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: DualMomentumResponse | null; loading: boolean }

function signalColor(signal: string): string {
  if (signal === 'Strong Buy') return '#22c55e'
  if (signal === 'Buy')        return '#4ade80'
  if (signal === 'Neutral')    return '#f59e0b'
  return '#ef4444'
}

function retColor(v: number): string {
  return v > 0 ? '#22c55e' : '#ef4444'
}

function Filter({ label, value, suffix, pass }: { label: string; value: number; suffix: string; pass: boolean }) {
  const c = pass ? '#22c55e' : '#ef4444'
  const icon = pass ? '✓' : '✗'
  return (
    <Box sx={{ p: 2, borderRadius: 2, border: `1px solid ${c}30`, bgcolor: `${c}08`, flex: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontSize: '1rem', color: c, fontWeight: 900 }}>{icon}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ ...MONO, fontSize: '1.25rem', fontWeight: 900, color: c }}>
        {value > 0 ? '+' : ''}{value.toFixed(1)}{suffix}
      </Typography>
    </Box>
  )
}

function PerfRow({ perf, isCurrent }: { perf: DualMomentumSignalPerf; isCurrent: boolean }) {
  const { BORDER } = usePalette()
  const sc = signalColor(perf.signal)
  const retC21 = retColor(perf.avg_fwd_21d)
  const retC63 = retColor(perf.avg_fwd_63d)

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 2, py: 1, px: 1.5,
      borderRadius: 1.5,
      bgcolor: isCurrent ? `${sc}10` : 'transparent',
      border: isCurrent ? `1px solid ${sc}30` : '1px solid transparent',
    }}>
      <Box sx={{ minWidth: 90 }}>
        <Chip label={perf.signal} size="small"
          sx={{ bgcolor: `${sc}18`, color: sc, fontWeight: 700, fontSize: '0.75rem', height: 20 }} />
      </Box>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ height: 4, borderRadius: 2, bgcolor: BORDER, overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${Math.min(100, Math.abs(perf.avg_fwd_21d) * 5)}%`, borderRadius: 2, bgcolor: retC21 }} />
        </Box>
      </Box>
      <Typography variant="caption" sx={{ fontWeight: 800, color: retC21, minWidth: 44, textAlign: 'right', fontSize: '0.7rem' }}>
        {perf.avg_fwd_21d > 0 ? '+' : ''}{perf.avg_fwd_21d.toFixed(1)}%
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 700, color: retC63, minWidth: 44, textAlign: 'right', fontSize: '0.7rem' }}>
        {perf.avg_fwd_63d > 0 ? '+' : ''}{perf.avg_fwd_63d.toFixed(1)}%
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 52, textAlign: 'right', fontSize: '0.6875rem' }}>
        {perf.pct_positive_21d.toFixed(0)}% pos
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 28, textAlign: 'right', fontSize: '0.75rem' }}>
        n={perf.count}
      </Typography>
    </Box>
  )
}

export default function DualMomentum({ data, loading }: Props) {
  const { BORDER, PAPER2, INK3 } = usePalette()
  if (loading) {
    return (
      <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexDirection: 'column' }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Computing dual momentum signals…</Typography>
      </Box>
    )
  }
  if (!data) return null

  const sc = signalColor(data.current_signal)

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#22C55E', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Momentum Framework · 12-month lookback
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', background: `linear-gradient(135deg, #FFFFFF 30%, ${INK3} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', mb: 0.5, display: 'block' }}>
        Dual Momentum
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK3, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        Absolute momentum (stock beat cash) AND relative momentum (stock beat index) must both pass — a dual-confirmation framework that filters out weak or crowded trades
      </Typography>

      <Grid container spacing={3}>
        {/* Left: filter logic + signal */}
        <Grid item xs={12} md={5}>
          {/* Filter 1 + Filter 2 */}
          <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 1 }}>
            Filter Results
          </Typography>
          <Stack direction="row" spacing={1.5} mb={2.5}>
            <Filter
              label="Absolute momentum (12M)"
              value={data.abs_momentum_12m}
              suffix="%"
              pass={data.abs_filter_pass}
            />
            <Filter
              label="vs Index (12M outperformance)"
              value={data.rel_momentum_vs_index}
              suffix="%"
              pass={data.rel_filter_pass}
            />
          </Stack>

          {/* Final signal */}
          <Box sx={{ p: 2.5, borderRadius: 2, border: `1px solid ${sc}40`, bgcolor: `${sc}08`, mb: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', mb: 0.5 }}>
              Signal
            </Typography>
            <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '1.75rem', fontWeight: 900, color: sc, mb: 0.75 }}>
              {data.current_signal}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', lineHeight: 1.6, display: 'block' }}>
              {data.rationale}
            </Typography>
          </Box>

          {/* Index comparison */}
          <Box sx={{ p: 1.5, borderRadius: 2, border: `1px solid ${BORDER}`, bgcolor: PAPER2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 1 }}>
              12-Month performance comparison
            </Typography>
            {[
              { label: data.symbol, value: data.abs_momentum_12m },
              { label: 'NIFTY 50 (proxy)', value: data.index_12m_return },
            ].map(({ label, value }) => (
              <Box key={label} sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem' }}>{label}</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: retColor(value), fontSize: '0.75rem' }}>
                    {value > 0 ? '+' : ''}{value.toFixed(1)}%
                  </Typography>
                </Box>
                <Box sx={{ height: 5, borderRadius: 2.5, bgcolor: BORDER, overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${Math.min(100, Math.max(0, (value + 50) / 100 * 100))}%`, borderRadius: 2.5, bgcolor: retColor(value) }} />
                </Box>
              </Box>
            ))}
          </Box>
        </Grid>

        {/* Right: historical performance per signal */}
        <Grid item xs={12} md={7}>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 1 }}>
            Historical performance by signal — avg forward return
          </Typography>
          <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', gap: 2, px: 1.5, mb: 0.5 }}>
              <Box sx={{ minWidth: 90 }} />
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 44, textAlign: 'right', fontSize: '0.75rem' }}>1M avg</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 44, textAlign: 'right', fontSize: '0.75rem' }}>3M avg</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 52, textAlign: 'right', fontSize: '0.75rem' }}>% pos 1M</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 28, textAlign: 'right', fontSize: '0.75rem' }}>n</Typography>
            </Box>
            {data.signal_performance.map(p => (
              <PerfRow key={p.signal} perf={p} isCurrent={p.signal === data.current_signal} />
            ))}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', lineHeight: 1.6, display: 'block', mt: 1.5 }}>
            Each row shows what happened in the 21d and 63d after the signal was active — based on all historical occurrences of that signal.
            The highlighted row is the current active signal.
          </Typography>
        </Grid>
      </Grid>
    </Box>
  )
}
