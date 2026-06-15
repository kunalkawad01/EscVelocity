import { useState, useEffect } from 'react'
import {
  Box, Typography, LinearProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Select, MenuItem, OutlinedInput,
} from '@mui/material'
import { regimeApi } from '../../api/regimeApi'
import type { MarketRegimeSnapshot, StockRegimeSummary, BreadthScoreResult } from '../../types/regime'
import { REGIME_COLOR, REGIME_BG, regimeColor } from '../../types/regime'

import { usePalette, useTokens } from '../../hooks/usePalette'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: '2px', bgcolor: accent, flexShrink: 0, boxShadow: `0 0 8px ${accent}80` }} />
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: INK, letterSpacing: '-0.01em', ...JAKARTA }}>{title}</Typography>
      {meta && <Typography sx={{ fontSize: '0.72rem', color: INK3, ml: 'auto', ...JAKARTA }}>{meta}</Typography>}
    </Box>
  )
}

// ─── SVG Sparkline ────────────────────────────────────────────────────────────

function Sparkline({ data, color = '#14b8a6', height = 48 }: {
  data: number[], color?: string, height?: number
}) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = (max - min) || 1
  const W = 300
  const H = height
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Score dial (arc gauge) ───────────────────────────────────────────────────

function ScoreDial({ score, color, size = 96 }: { score: number; color: string; size?: number }) {
  const { BORDER } = usePalette()
  const r = (size - 12) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  // 270° arc (from -135° to +135°)
  const arcLength = circ * 0.75
  const filled = arcLength * (score / 100)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={BORDER}
        strokeWidth="8" strokeDasharray={`${arcLength} ${circ}`}
        strokeDashoffset={0} strokeLinecap="round"
        transform={`rotate(135 ${cx} ${cy})`} />
      {/* Fill */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color}
        strokeWidth="8" strokeDasharray={`${filled} ${circ}`}
        strokeDashoffset={0} strokeLinecap="round"
        transform={`rotate(135 ${cx} ${cy})`} />
      <text x={cx} y={cy + 4} textAnchor="middle"
        fill={color} fontSize="16" fontWeight="800">
        {Math.round(score)}
      </text>
    </svg>
  )
}

// ─── Regime distribution bar ──────────────────────────────────────────────────

const DIST_ORDER = ['Strong Bull', 'Moderate Bull', 'Neutral', 'Moderate Bear', 'Strong Bear']

function RegimeDistBar({ snap }: { snap: MarketRegimeSnapshot }) {
  const { BORDER, INK2, INK } = usePalette()
  const total = snap.stocks.length || 1
  const counts: Record<string, number> = {
    'Strong Bull':   snap.strong_bull_count,
    'Moderate Bull': snap.bull_count,
    'Neutral':       snap.neutral_count,
    'Moderate Bear': snap.bear_count,
    'Strong Bear':   snap.strong_bear_count,
  }
  return (
    <Box>
      <Box sx={{ display: 'flex', height: 20, borderRadius: '6px', overflow: 'hidden', gap: '1px', mb: 1 }}>
        {DIST_ORDER.map(label => {
          const n = counts[label] ?? 0
          const pct = n / total * 100
          if (pct === 0) return null
          return (
            <Tooltip key={label} title={`${label}: ${n} stocks (${pct.toFixed(0)}%)`} placement="top">
              <Box sx={{ width: `${pct}%`, bgcolor: REGIME_COLOR[label], minWidth: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {pct > 12 && (
                  <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#000', opacity: 0.75 }}>
                    {n}
                  </Typography>
                )}
              </Box>
            </Tooltip>
          )
        })}
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        {DIST_ORDER.map(label => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: 1, bgcolor: REGIME_COLOR[label] }} />
            <Typography sx={{ fontSize: '0.6rem', color: INK2, ...JAKARTA }}>
              {label} <span style={{ color: INK, fontWeight: 700 }}>{counts[label]}</span>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Breadth panel ────────────────────────────────────────────────────────────

function BreadthPanel({ b }: { b: BreadthScoreResult }) {
  const { CARD, BORDER, CYAN, INK, INK2, INK3, PAPER2 } = useTokens()
  const bColor = regimeColor(b.breadth_score)
  const histScores = b.history.map(h => h.breadth_score)

  return (
    <Box sx={{ ...CARD, mb: 2 }}>
      <SectionHead title="Market Breadth Score" accent="#14b8a6" meta={b.date} />
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Dial + label */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
          <ScoreDial score={b.breadth_score} color={bColor} size={104} />
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: bColor, ...JAKARTA }}>
            {b.breadth_label}
          </Typography>
          <Typography sx={{ fontSize: '0.58rem', color: INK3, ...JAKARTA }}>
            {b.total_symbols} stocks
          </Typography>
        </Box>

        {/* Three SMA participation bars */}
        <Box sx={{ flex: 1, minWidth: 200 }}>
          {[
            { label: 'Above SMA 20',  pct: b.pct_above_sma20,  count: b.count_above_sma20,  color: '#60a5fa' },
            { label: 'Above SMA 50',  pct: b.pct_above_sma50,  count: b.count_above_sma50,  color: '#a78bfa' },
            { label: 'Above SMA 200', pct: b.pct_above_sma200, count: b.count_above_sma200, color: '#f472b6' },
          ].map(item => (
            <Box key={item.label} sx={{ mb: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                <Typography sx={{ fontSize: '0.65rem', color: INK2, ...JAKARTA }}>{item.label}</Typography>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: item.color, ...JAKARTA }}>
                  {item.count} / {b.total_symbols} &nbsp;({item.pct.toFixed(0)}%)
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate" value={item.pct}
                sx={{
                  height: 6, borderRadius: 3,
                  bgcolor: BORDER,
                  '& .MuiLinearProgress-bar': { bgcolor: item.color, borderRadius: 3 },
                }}
              />
            </Box>
          ))}
        </Box>

        {/* Sparkline — last 252 days of breadth */}
        <Box sx={{ width: { xs: '100%', md: 220 }, flexShrink: 0 }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: INK3,
            textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.75, ...JAKARTA }}>
            Breadth Score — 1 Year
          </Typography>
          <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: '6px',
            p: '4px', bgcolor: PAPER2 }}>
            <Sparkline data={histScores} color={bColor} height={52} />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.4 }}>
            <Typography sx={{ fontSize: '0.53rem', color: INK3, ...JAKARTA }}>
              {b.history[0]?.date ?? ''}
            </Typography>
            <Typography sx={{ fontSize: '0.53rem', color: INK3, ...JAKARTA }}>
              {b.history[b.history.length - 1]?.date ?? ''}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Stock regime table ───────────────────────────────────────────────────────

type SortKey = 'regime_score' | 'symbol' | 'close' | 'price_score' | 'alignment_score' | 'slope_score'

function sortStocks(items: StockRegimeSummary[], key: SortKey, asc: boolean) {
  return [...items].sort((a, b) => {
    const va = a[key] as number | string
    const vb = b[key] as number | string
    if (typeof va === 'string') return asc ? va.localeCompare(vb as string) : (vb as string).localeCompare(va)
    return asc ? (va - (vb as number)) : ((vb as number) - va)
  })
}

function StockRegimeTable({
  stocks,
  onSelect,
}: {
  stocks: StockRegimeSummary[]
  onSelect?: (symbol: string) => void
}) {
  const { TH, TD, t1, t2, t3, INPUT_SX, BORDER, CYAN, PAPER, PAPER2, INK, INK2, INK3 } = useTokens()
  const [sortKey, setSortKey] = useState<SortKey>('regime_score')
  const [sortAsc, setSortAsc] = useState(false)
  const [filterLabel, setFilterLabel] = useState('All')
  const [search, setSearch] = useState('')

  const filtered = sortStocks(
    stocks.filter(s => {
      if (filterLabel !== 'All' && s.regime_label !== filterLabel) return false
      if (search && !s.symbol.includes(search.toUpperCase())) return false
      return true
    }),
    sortKey, sortAsc,
  )

  function SortTH({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col
    return (
      <TableCell
        sx={{ ...TH, cursor: 'pointer', userSelect: 'none',
          color: active ? INK : INK2, '&:hover': { color: INK } }}
        onClick={() => { if (active) setSortAsc(a => !a); else { setSortKey(col); setSortAsc(false) } }}>
        {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </TableCell>
    )
  }

  return (
    <Box>
      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <OutlinedInput size="small" placeholder="Search symbol…" value={search}
          onChange={e => setSearch(e.target.value)} sx={{ ...INPUT_SX, width: 130, bgcolor: PAPER2 }} />
        <Select value={filterLabel} onChange={e => setFilterLabel(e.target.value)}
          input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
          sx={{ minWidth: 150, ...INPUT_SX, bgcolor: PAPER2 }}
          MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
          <MenuItem value="All" sx={{ fontSize: '0.8rem', color: INK }}>All Regimes</MenuItem>
          {['Strong Bull','Moderate Bull','Neutral','Moderate Bear','Strong Bear'].map(l => (
            <MenuItem key={l} value={l} sx={{ fontSize: '0.8rem', color: REGIME_COLOR[l] }}>{l}</MenuItem>
          ))}
        </Select>
        {(filterLabel !== 'All' || search) && (
          <Box component="button" onClick={() => { setFilterLabel('All'); setSearch('') }}
            sx={{ px: 1.25, py: 0.5, borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer',
              border: `1px solid ${BORDER}`, bgcolor: 'transparent', color: INK2,
              '&:hover': { color: INK, borderColor: INK2 }, transition: 'all 0.12s' }}>
            Clear
          </Box>
        )}
        <Typography sx={{ fontSize: '0.62rem', color: INK3, ml: 'auto', ...JAKARTA }}>
          {filtered.length} / {stocks.length}
        </Typography>
      </Box>

      <TableContainer sx={{ maxHeight: 480, borderRadius: '12px', border: `1px solid ${BORDER}` }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <SortTH label="Symbol"    col="symbol" />
              <SortTH label="Score"     col="regime_score" />
              <TableCell sx={TH}>Regime</TableCell>
              <SortTH label="Close"     col="close" />
              <SortTH label="Price /40" col="price_score" />
              <SortTH label="Align /30" col="alignment_score" />
              <SortTH label="Slope /30" col="slope_score" />
              <TableCell sx={TH}>SMA200</TableCell>
              <TableCell sx={TH}>Bull Stack</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map(s => {
              const c = regimeColor(s.regime_score)
              return (
                <TableRow key={s.symbol}
                  onClick={() => onSelect?.(s.symbol)}
                  sx={{
                    cursor: onSelect ? 'pointer' : 'default',
                    bgcolor: PAPER,
                    '&:hover td': { bgcolor: 'rgba(0,153,204,0.05)' },
                  }}>
                  {/* T1+CYAN: symbol is primary identifier */}
                  <TableCell sx={{ ...TD, ...t1, color: CYAN }}>{s.symbol}</TableCell>
                  {/* T1 semantic: score is the headline number */}
                  <TableCell sx={{ ...TD, ...t1, color: c, fontWeight: 800 }}>
                    {s.regime_score.toFixed(0)}
                  </TableCell>
                  {/* T2 semantic: regime label */}
                  <TableCell sx={TD}>
                    <Typography sx={{ ...t2, color: c }}>{s.regime_label}</Typography>
                  </TableCell>
                  {/* T2: close price */}
                  <TableCell sx={{ ...TD, ...t2 }}>₹{s.close.toLocaleString('en-IN')}</TableCell>
                  {/* Component bars — T3 for sub-score numbers (supporting context) */}
                  {[
                    { val: s.price_score,     max: 40 },
                    { val: s.alignment_score, max: 30 },
                    { val: s.slope_score,     max: 30 },
                  ].map((item, i) => (
                    <TableCell key={i} sx={{ ...TD, minWidth: 80 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Box sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: BORDER, overflow: 'hidden' }}>
                          <Box sx={{ width: `${item.val / item.max * 100}%`, height: '100%', bgcolor: c, borderRadius: 2 }} />
                        </Box>
                        <Typography sx={{ ...t3, color: c, minWidth: 18, textAlign: 'right' }}>
                          {item.val.toFixed(0)}
                        </Typography>
                      </Box>
                    </TableCell>
                  ))}
                  {/* T2 semantic: SMA200 position */}
                  <TableCell sx={TD}>
                    {s.above_sma200
                      ? <Typography sx={{ ...t2, color: '#22c55e', fontWeight: 700 }}>Above</Typography>
                      : <Typography sx={{ ...t2, color: '#ef4444' }}>Below</Typography>}
                  </TableCell>
                  {/* T2/T3: full alignment is a bonus flag */}
                  <TableCell sx={TD}>
                    {s.sma_fully_aligned
                      ? <Typography sx={{ ...t2, color: '#22c55e', fontWeight: 700 }}>Yes</Typography>
                      : <Typography sx={{ ...t3 }}>No</Typography>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function MarketRegimeDashboard({
  onSymbolSelect,
}: {
  onSymbolSelect?: (symbol: string) => void
}) {
  const { BG, CARD, BORDER, CYAN, INK, INK2, INK3 } = useTokens()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [snap,    setSnap]    = useState<MarketRegimeSnapshot | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setSnap(await regimeApi.getSnapshot())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <Box sx={{ mb: 3 }}>
      {/* ─ Breadth panel ─ */}
      {snap && <BreadthPanel b={snap.breadth} />}

      {/* ─ Snapshot table ─ */}
      <Box sx={{ ...CARD }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <SectionHead title="Market Regime Snapshot" accent="#6366f1" />
          {snap && (
            <Box sx={{ display: 'flex', gap: 2, ml: 0, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.65rem', color: INK2, ...JAKARTA }}>
                Avg Regime Score:&nbsp;
                <span style={{ color: regimeColor(snap.avg_regime_score), fontWeight: 800 }}>
                  {snap.avg_regime_score}
                </span>
              </Typography>
              <Typography sx={{ fontSize: '0.62rem', color: INK3, ...JAKARTA }}>
                {snap.computed_at}
              </Typography>
            </Box>
          )}
          <Box component="button" onClick={load} disabled={loading} sx={{
            ml: 'auto', px: 2, py: 0.75, borderRadius: '8px', fontSize: '0.72rem', fontWeight: 700,
            cursor: loading ? 'wait' : 'pointer',
            background: `linear-gradient(135deg, ${CYAN}, #0090C8)`,
            color: '#FFFFFF', border: 'none', opacity: loading ? 0.6 : 1,
            boxShadow: `0 0 16px ${CYAN}40`,
            '&:hover:not(:disabled)': { boxShadow: `0 0 24px ${CYAN}70`, transform: 'translateY(-1px)' },
            transition: 'all 0.15s',
            ...JAKARTA,
          }}>
            {loading ? 'Loading…' : 'Refresh'}
          </Box>
        </Box>

        {loading && (
          <>
            <LinearProgress sx={{
              borderRadius: 1, mb: 1,
              bgcolor: BORDER,
              '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
            }} />
            <Typography sx={{ fontSize: '0.65rem', color: INK3, mb: 2, ...JAKARTA }}>
              Computing regime scores for all NIFTY 50 stocks…
            </Typography>
          </>
        )}

        {error && (
          <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)', mb: 2 }}>
            <Typography sx={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</Typography>
          </Box>
        )}

        {snap && (
          <>
            {/* Regime distribution bar */}
            <Box sx={{ mb: 2 }}>
              <RegimeDistBar snap={snap} />
            </Box>

            {/* Per-stock table */}
            <StockRegimeTable stocks={snap.stocks} onSelect={onSymbolSelect} />
          </>
        )}
      </Box>
    </Box>
  )
}
