import { Box, Typography, Stack, Chip, CircularProgress, Grid } from '@mui/material'
import type { AnalogResponse, AnalogPeriod, AnalogSnapshot } from '../../types/stock'

interface Props { data: AnalogResponse | null; loading: boolean }

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null, decimals = 1): string {
  if (v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(decimals)}%`
}

function fwdColor(v: number | null): string {
  if (v === null) return '#64748b'
  return v > 0 ? '#22c55e' : '#ef4444'
}

function regimeColor(r: string): string {
  if (r === 'Super Bull') return '#22c55e'
  if (r === 'Bull')       return '#4ade80'
  if (r === 'Neutral')    return '#f59e0b'
  return '#ef4444'
}

// ── Current snapshot row ──────────────────────────────────────────────────────

function SnapshotBar({ snap }: { snap: AnalogSnapshot }) {
  const color = regimeColor(snap.regime)
  const items = [
    { label: 'Regime',      value: snap.regime,                       color },
    { label: '1M Return',   value: fmt(snap.ret_1m),                  color: fwdColor(snap.ret_1m) },
    { label: '3M Return',   value: fmt(snap.ret_3m ?? null),          color: fwdColor(snap.ret_3m ?? null) },
    { label: 'Drawdown',    value: fmt(snap.drawdown),                 color: fwdColor(snap.drawdown) },
    { label: 'ATR(14)',     value: `₹${snap.atr14.toFixed(2)}`,       color: '#94a3b8' },
  ]

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        p: 2.5,
        borderRadius: '14px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        mb: 3,
      }}
    >
      {items.map(it => (
        <Box key={it.label} sx={{ minWidth: 90 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.6875rem', display: 'block' }}>
            {it.label}
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: it.color }}>
            {it.value}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

// ── Similarity arc ─────────────────────────────────────────────────────────────

function SimilarityArc({ pct }: { pct: number }) {
  const R = 22
  const circ = 2 * Math.PI * R
  const dash = (pct / 100) * circ
  const color = pct >= 85 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#64748b'

  return (
    <Box sx={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
      <svg width={56} height={56} viewBox="0 0 56 56">
        <circle cx={28} cy={28} r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={5} />
        <circle
          cx={28} cy={28} r={R}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ * 0.25}
          strokeLinecap="round"
        />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color }}>
          {pct.toFixed(0)}%
        </Typography>
      </Box>
    </Box>
  )
}

// ── Analog card ───────────────────────────────────────────────────────────────

function AnalogCard({ analog, rank }: { analog: AnalogPeriod; rank: number }) {
  const rc = regimeColor(analog.regime)
  const dateLabel = new Date(analog.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: '14px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.025)',
        display: 'flex',
        gap: 2,
        alignItems: 'flex-start',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': { borderColor: 'rgba(59,130,246,0.3)', boxShadow: '0 0 20px rgba(59,130,246,0.08)' },
      }}
    >
      {/* Similarity arc */}
      <SimilarityArc pct={analog.similarity} />

      {/* Main content */}
      <Box flex={1} minWidth={0}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
            #{rank}
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {dateLabel}
          </Typography>
          <Chip
            label={analog.regime}
            size="small"
            sx={{ bgcolor: `${rc}15`, color: rc, fontWeight: 700, fontSize: '0.6875rem', height: 18 }}
          />
        </Box>

        {/* Leading metrics */}
        <Stack direction="row" spacing={2} mb={1}>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>
              1M leading
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 700, color: fwdColor(analog.ret_1m) }}>
              {fmt(analog.ret_1m)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>
              Drawdown
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 700, color: fwdColor(analog.drawdown) }}>
              {fmt(analog.drawdown)}
            </Typography>
          </Box>
        </Stack>

        {/* Forward returns */}
        <Box
          sx={{
            display: 'flex',
            gap: 1.5,
            pt: 1,
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {[
            { label: '→ 1M', val: analog.fwd_1m },
            { label: '→ 3M', val: analog.fwd_3m },
            { label: '→ 6M', val: analog.fwd_6m },
          ].map(({ label, val }) => (
            <Box key={label}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', display: 'block' }}>
                {label}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 800, color: fwdColor(val), fontSize: '0.75rem' }}>
                {fmt(val)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ── Aggregate stats panel ─────────────────────────────────────────────────────

function AggregatePanel({ stats }: { stats: AnalogResponse['stats']; count: number }) {
  const rows = [
    { horizon: '1 Month',  avg: stats.avg_fwd_1m, pctPos: stats.pct_positive_1m },
    { horizon: '3 Months', avg: stats.avg_fwd_3m, pctPos: stats.pct_positive_3m },
    { horizon: '6 Months', avg: stats.avg_fwd_6m, pctPos: null },
  ]

  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: 2,
        border: '1px solid rgba(255,255,255,0.08)',
        bgcolor: 'rgba(255,255,255,0.025)',
        height: '100%',
      }}
    >
      <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
        Avg Forward Return
      </Typography>

      <Stack spacing={2}>
        {rows.map(r => (
          <Box key={r.horizon}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {r.horizon}
              </Typography>
              <Stack direction="row" spacing={1.5} alignItems="center">
                {r.pctPos !== null && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem' }}>
                    {r.pctPos.toFixed(0)}% positive
                  </Typography>
                )}
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 800, color: fwdColor(r.avg), minWidth: 52, textAlign: 'right' }}
                >
                  {fmt(r.avg)}
                </Typography>
              </Stack>
            </Box>
            <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.07)' }}>
              <Box
                sx={{
                  height: '100%',
                  width: `${Math.min(100, Math.abs(r.avg) * 3)}%`,
                  borderRadius: 2,
                  bgcolor: fwdColor(r.avg),
                  transition: 'width 0.8s ease',
                }}
              />
            </Box>
          </Box>
        ))}
      </Stack>

      <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', lineHeight: 1.6, display: 'block' }}>
          Based on weighted similarity across regime, momentum, drawdown, and volatility.
          Past analogs are not a guarantee of future returns.
        </Typography>
      </Box>
    </Box>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function HistoricalAnalog({ data, loading }: Props) {
  if (loading) {
    return (
      <Box sx={{ height: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
        <CircularProgress size={28} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Scanning history for similar environments…
        </Typography>
      </Box>
    )
  }

  if (!data) return null

  return (
    <Box>
      {/* Header */}
      <Box mb={2.5}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#14B8A6', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
          Pattern Memory
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', background: 'linear-gradient(135deg, #FFFFFF 30%, #94A3B8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            Historical Analog Engine
          </Typography>
          <Box sx={{ px: 1.25, py: 0.3, borderRadius: '8px', background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.2)' }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#14B8A6' }}>{data.analogs.length} analogs</Typography>
          </Box>
        </Box>
        <Typography sx={{ fontSize: '0.73rem', color: '#4B5563', mt: 0.5, lineHeight: 1.5 }}>
          Find historical periods with a similar regime, momentum, drawdown, and volatility signature — then see what the next 1–6 months actually returned
        </Typography>
      </Box>

      {/* Current environment fingerprint */}
      <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        Today's Environment
      </Typography>
      <SnapshotBar snap={data.current_snapshot} />

      {data.analogs.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 3, textAlign: 'center' }}>
          Not enough historical data to find analogs yet.
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {/* Analog cards */}
          <Grid item xs={12} md={7}>
            <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              Most Similar Periods
            </Typography>
            <Stack spacing={1.5}>
              {data.analogs.map((a, i) => (
                <AnalogCard key={a.date} analog={a} rank={i + 1} />
              ))}
            </Stack>
          </Grid>

          {/* Aggregate stats */}
          <Grid item xs={12} md={5}>
            <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              Historical Outcome
            </Typography>
            <AggregatePanel stats={data.stats} count={data.analogs.length} />
          </Grid>
        </Grid>
      )}
    </Box>
  )
}
