import { useState } from 'react'
import {
  Box, Typography, Collapse, Tooltip, LinearProgress,
} from '@mui/material'
import type { PairResult, SpreadSignalStats } from '../../types/cointegration'
import { GRADE_COLOR, GRADE_BG } from '../../types/cointegration'

// ─── Z-score sparkline ────────────────────────────────────────────────────────

function ZSparkline({ data }: { data: number[] }) {
  if (data.length < 10) return null
  const W = 220, H = 56
  const PAD = { t: 6, r: 4, b: 6, l: 4 }
  const w = W - PAD.l - PAD.r
  const h = H - PAD.t - PAD.b
  const minZ = -4, maxZ = 4
  const clamp = (v: number) => Math.max(minZ, Math.min(maxZ, v))
  const toX = (i: number) => PAD.l + (i / (data.length - 1)) * w
  const toY = (z: number) => PAD.t + h - ((clamp(z) - minZ) / (maxZ - minZ)) * h
  const y0  = toY(0)
  const y2p = toY(2)
  const y2n = toY(-2)
  const pts = data.map((z, i) => `${toX(i).toFixed(1)},${toY(z).toFixed(1)}`).join(' ')
  const last = data[data.length - 1]
  const dotColor = Math.abs(last) >= 2 ? (last > 0 ? '#ef4444' : '#22c55e') : '#60a5fa'

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {/* Zero line */}
      <line x1={PAD.l} y1={y0} x2={W - PAD.r} y2={y0} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      {/* ±2 dashed bands */}
      <line x1={PAD.l} y1={y2p} x2={W - PAD.r} y2={y2p} stroke="rgba(239,68,68,0.3)"  strokeWidth={1} strokeDasharray="3,3" />
      <line x1={PAD.l} y1={y2n} x2={W - PAD.r} y2={y2n} stroke="rgba(34,197,94,0.3)"  strokeWidth={1} strokeDasharray="3,3" />
      {/* Z-score line */}
      <polyline points={pts} fill="none" stroke="#60a5fa" strokeWidth={1.5} strokeLinejoin="round" />
      {/* Current dot */}
      <circle cx={toX(data.length - 1)} cy={toY(last)} r={3} fill={dotColor} />
    </svg>
  )
}

// ─── Signal stats card ────────────────────────────────────────────────────────

function SignalCard({
  label, color, bg, stats,
}: {
  label: string; color: string; bg: string
  stats: SpreadSignalStats | null
}) {
  return (
    <Box sx={{ flex: 1, p: 1.5, borderRadius: '8px', bgcolor: bg, border: `1px solid ${color}30` }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color, textTransform: 'uppercase',
        letterSpacing: '0.08em', mb: 1 }}>
        {label}
      </Typography>
      {stats ? (
        <>
          <Box sx={{ display: 'flex', gap: 2.5, mb: 1 }}>
            <Box>
              <Typography sx={{ fontSize: '0.57rem', color: '#64748B' }}>Win Rate</Typography>
              <Typography sx={{ fontSize: '1rem', fontWeight: 900,
                color: stats.win_rate >= 60 ? '#22c55e' : stats.win_rate >= 50 ? '#fbbf24' : '#ef4444' }}>
                {stats.win_rate.toFixed(1)}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.57rem', color: '#64748B' }}>EV</Typography>
              <Typography sx={{ fontSize: '1rem', fontWeight: 900,
                color: stats.expected_value > 0 ? '#22c55e' : '#ef4444' }}>
                {stats.expected_value > 0 ? '+' : ''}{stats.expected_value.toFixed(2)}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.57rem', color: '#64748B' }}>Avg 1M</Typography>
              <Typography sx={{ fontSize: '1rem', fontWeight: 900,
                color: stats.avg_1m > 0 ? '#22c55e' : '#ef4444' }}>
                {stats.avg_1m > 0 ? '+' : ''}{stats.avg_1m.toFixed(2)}%
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.57rem', color: '#64748B' }}>N</Typography>
              <Typography sx={{ fontSize: '1rem', fontWeight: 900, color: '#94A3B8' }}>
                {stats.occurrences}
              </Typography>
            </Box>
          </Box>
          {/* Market regime conditional */}
          {(stats.mkt_regime_high_win_rate !== null || stats.mkt_regime_low_win_rate !== null) && (
            <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
              {stats.mkt_regime_high_win_rate !== null && (
                <Box sx={{ flex: 1, p: 0.75, borderRadius: '6px',
                  bgcolor: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
                  <Typography sx={{ fontSize: '0.55rem', color: '#22c55e', fontWeight: 700 }}>
                    Mkt ≥60 · {stats.mkt_regime_high_occurrences}
                  </Typography>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 800,
                    color: stats.mkt_regime_high_win_rate >= 60 ? '#22c55e' : '#fbbf24' }}>
                    {stats.mkt_regime_high_win_rate.toFixed(1)}%
                  </Typography>
                </Box>
              )}
              {stats.mkt_regime_low_win_rate !== null && (
                <Box sx={{ flex: 1, p: 0.75, borderRadius: '6px',
                  bgcolor: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <Typography sx={{ fontSize: '0.55rem', color: '#ef4444', fontWeight: 700 }}>
                    Mkt &lt;60 · {stats.mkt_regime_low_occurrences}
                  </Typography>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 800,
                    color: stats.mkt_regime_low_win_rate >= 60 ? '#22c55e' : '#fbbf24' }}>
                    {stats.mkt_regime_low_win_rate.toFixed(1)}%
                  </Typography>
                </Box>
              )}
            </Box>
          )}
          {/* Distribution bar */}
          <Box sx={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', mt: 1 }}>
            {Object.entries(stats.distribution).map(([bucket, count]) => {
              const total = Object.values(stats.distribution).reduce((a, b) => a + b, 0)
              const pct = total > 0 ? count / total * 100 : 0
              const isPos = bucket.startsWith('0') || bucket.startsWith('2') || bucket.startsWith('>')
              return pct > 0 ? (
                <Box key={bucket} sx={{
                  width: `${pct}%`,
                  bgcolor: isPos ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
                }} />
              ) : null
            })}
          </Box>
        </>
      ) : (
        <Typography sx={{ fontSize: '0.65rem', color: '#4B5563' }}>Insufficient signal history</Typography>
      )}
    </Box>
  )
}

// ─── Pair insight ─────────────────────────────────────────────────────────────

function buildPairInsight(pair: PairResult): string {
  const { half_life, current_zscore, long_stats, short_stats, p_value } = pair
  const hlLabel = half_life <= 10 ? `very fast (${half_life}d)`
    : half_life <= 20 ? `fast (${half_life}d)`
    : half_life <= 40 ? `moderate (${half_life}d)`
    : `slow (${half_life}d)`

  const longWR  = long_stats?.win_rate ?? null
  const shortWR = short_stats?.win_rate ?? null
  const isActiveSignal = Math.abs(current_zscore) >= 2

  if (isActiveSignal) {
    const dir = current_zscore > 2 ? 'short' : 'long'
    const stats = dir === 'long' ? long_stats : short_stats
    const wr = stats?.win_rate
    const side = dir === 'long'
      ? `long ${pair.symbol_y} / short ${pair.symbol_x}`
      : `short ${pair.symbol_y} / long ${pair.symbol_x}`
    return `Z = ${current_zscore.toFixed(2)} — active ${dir}-spread signal (${side}). ` +
      `${wr ? `Historically ${wr.toFixed(1)}% of these converged within 21 bars.` : 'Insufficient signal history.'} ` +
      `Mean reversion is ${hlLabel}.`
  }

  if (longWR !== null && shortWR !== null) {
    const diff = Math.abs(longWR - shortWR)
    if (diff < 5) {
      return `Symmetric pair — long spread wins ${longWR.toFixed(1)}% and short spread wins ${shortWR.toFixed(1)}% of the time. ` +
        `Mean reversion is ${hlLabel}. No active signal (Z = ${current_zscore.toFixed(2)}), wait for ±2 breach.`
    }
    const stronger = longWR > shortWR ? 'long' : 'short'
    const strongerWR = Math.max(longWR, shortWR).toFixed(1)
    const weakerWR   = Math.min(longWR, shortWR).toFixed(1)
    return `${stronger.charAt(0).toUpperCase() + stronger.slice(1)}-spread is the higher-conviction direction ` +
      `(${strongerWR}% vs ${weakerWR}% win rate). Mean reversion is ${hlLabel}. ` +
      `Current Z = ${current_zscore.toFixed(2)} — no active entry.`
  }

  return `Cointegration p = ${p_value.toFixed(4)}, half-life ${hlLabel}. ` +
    `Current Z = ${current_zscore.toFixed(2)}. Monitor for ±2 breach to enter.`
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function PairDetail({ pair }: { pair: PairResult }) {
  const insight = buildPairInsight(pair)
  const isActive = Math.abs(pair.current_zscore) >= 2

  return (
    <Box sx={{
      mx: 1, mb: 1, p: 2, borderRadius: '10px',
      bgcolor: 'rgba(255,255,255,0.015)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Z-score sparkline */}
      <Box sx={{ mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#4B5563',
            textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Z-score History (252 days)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Typography sx={{ fontSize: '0.6rem', color: '#64748B' }}>— spread line</Typography>
            <Typography sx={{ fontSize: '0.6rem', color: 'rgba(239,68,68,0.7)' }}>--- +2</Typography>
            <Typography sx={{ fontSize: '0.6rem', color: 'rgba(34,197,94,0.7)' }}>--- -2</Typography>
          </Box>
        </Box>
        <ZSparkline data={pair.zscore_history} />
      </Box>

      {/* Signal stats */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
        <SignalCard
          label={`Long Spread (Z < −2)  ·  buy ${pair.symbol_y} / sell ${pair.symbol_x}`}
          color="#22c55e" bg="rgba(34,197,94,0.05)"
          stats={pair.long_stats}
        />
        <SignalCard
          label={`Short Spread (Z > +2)  ·  sell ${pair.symbol_y} / buy ${pair.symbol_x}`}
          color="#ef4444" bg="rgba(239,68,68,0.05)"
          stats={pair.short_stats}
        />
      </Box>

      {/* Key insight */}
      <Box sx={{
        p: 1.5, borderRadius: '8px',
        bgcolor: isActive ? 'rgba(251,191,36,0.08)' : 'rgba(96,165,250,0.05)',
        border: `1px solid ${isActive ? 'rgba(251,191,36,0.25)' : 'rgba(96,165,250,0.15)'}`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
          <Typography sx={{ fontSize: '0.75rem', lineHeight: 1 }}>
            {isActive ? '🚨' : '💡'}
          </Typography>
          <Typography sx={{ fontSize: '0.62rem', fontWeight: 700,
            color: isActive ? '#fbbf24' : '#60a5fa',
            textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {isActive ? 'Active Signal' : 'Key Insight'}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.72rem', color: '#CBD5E1', lineHeight: 1.7 }}>
          {insight}
        </Typography>
      </Box>

      {/* Pair meta */}
      <Box sx={{ display: 'flex', gap: 3, mt: 1.5, flexWrap: 'wrap' }}>
        {[
          ['Hedge Ratio', pair.hedge_ratio.toFixed(4)],
          ['Spread Mean', pair.spread_mean.toFixed(4)],
          ['Spread Std', pair.spread_std.toFixed(4)],
          ['Correlation', pair.correlation.toFixed(3)],
          ['p-value', pair.p_value.toFixed(4)],
        ].map(([label, val]) => (
          <Box key={label}>
            <Typography sx={{ fontSize: '0.57rem', color: '#374151' }}>{label}</Typography>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8' }}>{val}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Table header ─────────────────────────────────────────────────────────────

type SortKey = 'grade' | 'p_value' | 'half_life' | 'current_zscore' | 'long_wr' | 'short_wr'

function Th({
  label, sortKey, active, asc, onClick,
}: {
  label: string; sortKey: SortKey
  active: boolean; asc: boolean
  onClick: (k: SortKey) => void
}) {
  return (
    <Box
      component="th"
      onClick={() => onClick(sortKey)}
      sx={{
        px: 1.5, py: 1, textAlign: 'left', cursor: 'pointer', userSelect: 'none',
        fontSize: '0.6rem', fontWeight: 700, color: active ? '#60a5fa' : '#4B5563',
        textTransform: 'uppercase', letterSpacing: '0.07em',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        whiteSpace: 'nowrap',
        '&:hover': { color: '#94A3B8' },
      }}
    >
      {label} {active ? (asc ? '↑' : '↓') : ''}
    </Box>
  )
}

// ─── Main table ───────────────────────────────────────────────────────────────

export default function PairScannerTable({ pairs }: { pairs: PairResult[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [sortKey, setSortKey]   = useState<SortKey>('grade')
  const [sortAsc, setSortAsc]   = useState(true)
  const [filter, setFilter]     = useState<'all' | 'active'>('all')

  const gradeOrder: Record<string, number> = { 'A+': 0, 'A': 1, 'B': 2, 'C': 3 }

  const sorted = [...pairs]
    .filter(p => filter === 'all' || Math.abs(p.current_zscore) >= 2)
    .sort((a, b) => {
      let va: number, vb: number
      switch (sortKey) {
        case 'grade':       va = gradeOrder[a.grade] ?? 9; vb = gradeOrder[b.grade] ?? 9; break
        case 'p_value':     va = a.p_value;          vb = b.p_value;          break
        case 'half_life':   va = a.half_life;         vb = b.half_life;        break
        case 'current_zscore': va = Math.abs(a.current_zscore); vb = Math.abs(b.current_zscore); break
        case 'long_wr':     va = a.long_stats?.win_rate  ?? -1; vb = b.long_stats?.win_rate  ?? -1; break
        case 'short_wr':    va = a.short_stats?.win_rate ?? -1; vb = b.short_stats?.win_rate ?? -1; break
        default: va = 0; vb = 0
      }
      return sortAsc ? va - vb : vb - va
    })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  const handleRow = (idx: number) => setExpandedIdx(prev => prev === idx ? null : idx)

  const thProps = { active: false, asc: sortAsc, onClick: handleSort }

  return (
    <Box>
      {/* Filter bar */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
        {(['all', 'active'] as const).map(f => (
          <Box
            key={f}
            onClick={() => setFilter(f)}
            sx={{
              px: 1.5, py: 0.5, borderRadius: '6px', cursor: 'pointer',
              fontSize: '0.65rem', fontWeight: 700,
              bgcolor: filter === f ? 'rgba(96,165,250,0.15)' : 'transparent',
              color: filter === f ? '#60a5fa' : '#4B5563',
              border: `1px solid ${filter === f ? 'rgba(96,165,250,0.3)' : 'rgba(255,255,255,0.05)'}`,
              textTransform: 'capitalize',
            }}
          >
            {f === 'active' ? '🔴 Active Signals Only' : 'All Pairs'}
          </Box>
        ))}
        <Typography sx={{ fontSize: '0.62rem', color: '#374151', ml: 'auto' }}>
          {sorted.length} pair{sorted.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Table */}
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <Box component="thead">
            <Box component="tr">
              <Th label="Pair (Y / X)"       sortKey="grade"         {...thProps} active={sortKey === 'grade'} />
              <Th label="Grade"               sortKey="grade"         {...thProps} active={sortKey === 'grade'} />
              <Th label="p-value"             sortKey="p_value"       {...thProps} active={sortKey === 'p_value'} />
              <Th label="Half-life"           sortKey="half_life"     {...thProps} active={sortKey === 'half_life'} />
              <Th label="Current Z"           sortKey="current_zscore"  {...thProps} active={sortKey === 'current_zscore'} />
              <Th label="Long WR"             sortKey="long_wr"       {...thProps} active={sortKey === 'long_wr'} />
              <Th label="Short WR"            sortKey="short_wr"      {...thProps} active={sortKey === 'short_wr'} />
              <Th label="Correlation"         sortKey="p_value"       {...thProps} active={false} />
              <Box component="th" sx={{ px: 1.5, py: 1, borderBottom: '1px solid rgba(255,255,255,0.06)',
                fontSize: '0.6rem', color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Z History
              </Box>
            </Box>
          </Box>
          <Box component="tbody">
            {sorted.map((pair, idx) => {
              const isExpanded = expandedIdx === idx
              const isActive = Math.abs(pair.current_zscore) >= 2
              const signalDir = pair.current_zscore > 2 ? 'short' : pair.current_zscore < -2 ? 'long' : null

              return (
                <>
                  <Box
                    component="tr"
                    key={`${pair.symbol_y}-${pair.symbol_x}`}
                    onClick={() => handleRow(idx)}
                    sx={{
                      cursor: 'pointer',
                      bgcolor: isExpanded ? 'rgba(96,165,250,0.04)' : 'transparent',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' },
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* Pair */}
                    <Box component="td" sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box>
                          <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: '#E2E8F0', lineHeight: 1.2 }}>
                            {pair.symbol_y}
                          </Typography>
                          <Typography sx={{ fontSize: '0.62rem', color: '#4B5563' }}>
                            / {pair.symbol_x}
                          </Typography>
                        </Box>
                        {isActive && (
                          <Tooltip title={`Active ${signalDir} spread signal`} arrow>
                            <Box sx={{
                              px: 0.75, py: 0.25, borderRadius: '4px', fontSize: '0.55rem',
                              fontWeight: 700, textTransform: 'uppercase',
                              bgcolor: signalDir === 'long' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                              color: signalDir === 'long' ? '#22c55e' : '#ef4444',
                              border: `1px solid ${signalDir === 'long' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                            }}>
                              {signalDir}
                            </Box>
                          </Tooltip>
                        )}
                      </Box>
                    </Box>

                    {/* Grade */}
                    <Box component="td" sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <Box sx={{
                        display: 'inline-flex', px: 1, py: 0.25, borderRadius: '5px',
                        bgcolor: GRADE_BG[pair.grade], color: GRADE_COLOR[pair.grade],
                        fontSize: '0.7rem', fontWeight: 900,
                      }}>
                        {pair.grade}
                      </Box>
                    </Box>

                    {/* p-value */}
                    <Box component="td" sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <Typography sx={{
                        fontSize: '0.72rem', fontWeight: 700,
                        color: pair.p_value < 0.01 ? '#22c55e' : pair.p_value < 0.02 ? '#86efac' : '#fbbf24',
                      }}>
                        {pair.p_value.toFixed(4)}
                      </Typography>
                    </Box>

                    {/* Half-life */}
                    <Box component="td" sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <Box>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#E2E8F0' }}>
                          {pair.half_life < 999 ? `${pair.half_life}d` : '—'}
                        </Typography>
                        {pair.half_life < 999 && (
                          <Box sx={{ mt: 0.25, width: 60, height: 3, borderRadius: 1,
                            bgcolor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                            <Box sx={{
                              height: '100%', borderRadius: 1,
                              width: `${Math.max(5, Math.min(100, (1 - pair.half_life / 60) * 100))}%`,
                              bgcolor: pair.half_life <= 15 ? '#22c55e' : pair.half_life <= 30 ? '#fbbf24' : '#94a3b8',
                            }} />
                          </Box>
                        )}
                      </Box>
                    </Box>

                    {/* Current Z */}
                    <Box component="td" sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <Typography sx={{
                        fontSize: '0.82rem', fontWeight: 900,
                        color: Math.abs(pair.current_zscore) >= 2
                          ? (pair.current_zscore > 0 ? '#ef4444' : '#22c55e')
                          : '#94A3B8',
                      }}>
                        {pair.current_zscore > 0 ? '+' : ''}{pair.current_zscore.toFixed(2)}
                      </Typography>
                    </Box>

                    {/* Long WR */}
                    <Box component="td" sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      {pair.long_stats ? (
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700,
                          color: pair.long_stats.win_rate >= 60 ? '#22c55e' : pair.long_stats.win_rate >= 50 ? '#fbbf24' : '#ef4444' }}>
                          {pair.long_stats.win_rate.toFixed(1)}%
                          <Typography component="span" sx={{ fontSize: '0.57rem', color: '#374151', ml: 0.5 }}>
                            ({pair.long_stats.occurrences})
                          </Typography>
                        </Typography>
                      ) : <Typography sx={{ color: '#374151', fontSize: '0.65rem' }}>—</Typography>}
                    </Box>

                    {/* Short WR */}
                    <Box component="td" sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      {pair.short_stats ? (
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700,
                          color: pair.short_stats.win_rate >= 60 ? '#22c55e' : pair.short_stats.win_rate >= 50 ? '#fbbf24' : '#ef4444' }}>
                          {pair.short_stats.win_rate.toFixed(1)}%
                          <Typography component="span" sx={{ fontSize: '0.57rem', color: '#374151', ml: 0.5 }}>
                            ({pair.short_stats.occurrences})
                          </Typography>
                        </Typography>
                      ) : <Typography sx={{ color: '#374151', fontSize: '0.65rem' }}>—</Typography>}
                    </Box>

                    {/* Correlation */}
                    <Box component="td" sx={{ px: 1.5, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: '#94A3B8' }}>
                        {pair.correlation.toFixed(3)}
                      </Typography>
                    </Box>

                    {/* Z sparkline mini */}
                    <Box component="td" sx={{ px: 1, py: 0.5, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <ZSparkline data={pair.zscore_history.slice(-60)} />
                    </Box>
                  </Box>

                  {/* Expandable detail */}
                  {isExpanded && (
                    <Box component="tr" key={`detail-${idx}`}>
                      <Box component="td" colSpan={9} sx={{ p: 0 }}>
                        <PairDetail pair={pair} />
                      </Box>
                    </Box>
                  )}
                </>
              )
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
