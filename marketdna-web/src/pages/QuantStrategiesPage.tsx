import { useState } from 'react'
import Navbar from '../components/Navbar'
import {
  Box, Typography, CircularProgress, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, OutlinedInput, Tooltip, Grid,
} from '@mui/material'
import { quantStrategiesApi } from '../api/quantStrategiesApi'
import type {
  QuantScanResult, MomentumItem, MeanReversionItem, VolRankItem, SectorItem,
} from '../types/quant_strategies'
import {
  QUINTILE_COLOR, SIGNAL_COLOR, PHASE_COLOR, VOL_REGIME_COLOR,
} from '../types/quant_strategies'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

// ─── Module-level constants (no palette dependency) ───────────────────────────

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

const SECTION_ACCENTS = {
  momentum:  '#6366f1',
  reversion: '#f59e0b',
  vol:       '#14b8a6',
  sector:    '#8b5cf6',
}

const PHASE_DESC: Record<string, string> = {
  'Leading':   'Strong RS and improving — stay long',
  'Weakening': 'Strong RS but momentum fading — reduce / hedge',
  'Improving': 'Weak RS but recovering — consider early entry',
  'Lagging':   'Weak RS and declining — avoid / short bias',
}

const NAV_SECTIONS = [
  { label: 'Momentum',  anchor: 'momentum' },
  { label: 'Mean Rev.', anchor: 'reversion' },
  { label: 'Vol Rank',  anchor: 'vol-rank' },
  { label: 'Sectors',   anchor: 'sector-rotation' },
]

function pct(v: number, decimals = 1) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <Box component="span" sx={{
      display: 'inline-block', px: 0.75, py: 0.2, borderRadius: '5px',
      fontSize: '0.6875rem', fontWeight: 700, whiteSpace: 'nowrap',
      color, bgcolor: `${color}18`, border: `1px solid ${color}28`,
    }}>
      {label}
    </Box>
  )
}

function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ ...JAKARTA, fontSize: '0.82rem', fontWeight: 800, color: INK }}>{title}</Typography>
      {meta && <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3, ml: 'auto' }}>{meta}</Typography>}
    </Box>
  )
}

function RetCell({ value }: { value: number }) {
  const { INK2 } = usePalette()
  const color = value >= 2 ? '#22c55e' : value <= -2 ? '#ef4444' : INK2
  const bold  = value >= 2 || value <= -2
  return (
    <Typography sx={{ fontSize: '0.8rem', fontWeight: bold ? 700 : 500, color,
      fontVariantNumeric: 'tabular-nums' }}>
      {pct(value)}
    </Typography>
  )
}

function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      {children}
    </Box>
  )
}

function ClearBtn({ onClick }: { onClick: () => void }) {
  const { BORDER, INK3, INK2 } = usePalette()
  return (
    <Box component="button" onClick={onClick} sx={{
      px: 1.25, py: 0.4, borderRadius: '6px', fontSize: '0.65rem', cursor: 'pointer',
      border: `1px solid ${BORDER}`, bgcolor: 'transparent', color: INK3,
      '&:hover': { color: INK2 },
      ...JAKARTA,
    }}>Clear</Box>
  )
}

function CountBadge({ shown, total }: { shown: number; total: number }) {
  const { INK3 } = usePalette()
  return (
    <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK3, ml: 'auto',
      fontVariantNumeric: 'tabular-nums' }}>
      {shown} / {total}
    </Typography>
  )
}

// ─── Summary Cards (Top/Bottom strip) ────────────────────────────────────────

function SummaryStrip({ items }: {
  items: { label: string; symbols: string[]; color: string; strategy?: string }[]
}) {
  const { CARD, INK, INK3 } = useTokens()
  return (
    <Box sx={{ display: 'flex', gap: 2, mb: 2.5, flexWrap: 'wrap' }}>
      {items.map(({ label, symbols, color, strategy }) => (
        <Box key={label} sx={{
          ...CARD, flex: '1 1 180px', p: 1.5,
          borderLeft: `3px solid ${color}`,
        }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', fontWeight: 700, color,
            mb: 0.375, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {label} {symbols.length > 0 && `(${symbols.length})`}
          </Typography>
          {strategy && (
            <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK3, mb: 0.5 }}>
              {strategy}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.625 }}>
            {symbols.map(s => (
              <Typography key={s} sx={{ ...JAKARTA, fontSize: '0.72rem', fontWeight: 700, color: INK }}>
                {s}
              </Typography>
            ))}
            {symbols.length === 0 && (
              <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK3 }}>None</Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// ─── 1. Momentum Scanner ─────────────────────────────────────────────────────

function MomentumSection({ data }: { data: QuantScanResult['momentum'] }) {
  const { CARD, TH, TD, t1, t2, t3, INPUT_SX, BORDER, CYAN, PAPER, INK, INK2, INK3 } = useTokens()
  const [filterStock,  setFilterStock]  = useState('')
  const [filterQ,      setFilterQ]      = useState(0)
  const [filterSector, setFilterSector] = useState('All')

  const sectors = Array.from(new Set(data.items.map(i => i.sector))).sort()
  const rows = data.items.filter(it =>
    (!filterStock || it.symbol.toLowerCase().includes(filterStock.toLowerCase())) &&
    (!filterQ || it.quintile === filterQ) &&
    (filterSector === 'All' || it.sector === filterSector)
  )

  return (
    <Box id="momentum" sx={{ scrollMarginTop: '64px' }}>
      <Box sx={{ ...CARD }}>
        <SectionHead title="Cross-Sectional Momentum" accent={SECTION_ACCENTS.momentum}
          meta={`12-1 month skip-one · ${data.as_of}`} />

        <SummaryStrip items={[
          { label: 'Top 5 — Long',    symbols: data.top_5,    color: '#22c55e' },
          { label: 'Bottom 5 — Avoid', symbols: data.bottom_5, color: '#ef4444' },
        ]} />

        <FilterBar>
          <OutlinedInput placeholder="Stock…" value={filterStock}
            onChange={e => setFilterStock(e.target.value)}
            sx={{ ...INPUT_SX, width: 90 }} />
          <Select value={filterQ} onChange={e => setFilterQ(Number(e.target.value))}
            input={<OutlinedInput sx={INPUT_SX} />}
            sx={{ minWidth: 130, ...INPUT_SX }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER, border: `1px solid ${BORDER}`, color: INK } } }}
            displayEmpty>
            <MenuItem value={0} sx={{ fontSize: '0.72rem', color: INK2 }}>All Quintiles</MenuItem>
            {[1,2,3,4,5].map(q => (
              <MenuItem key={q} value={q} sx={{ fontSize: '0.72rem', color: QUINTILE_COLOR[q] }}>
                Q{q} — {['Strong Long','Long','Neutral','Avoid','Strong Avoid'][q-1]}
              </MenuItem>
            ))}
          </Select>
          <Select value={filterSector} onChange={e => setFilterSector(e.target.value)}
            input={<OutlinedInput sx={INPUT_SX} />}
            sx={{ minWidth: 160, ...INPUT_SX }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER, border: `1px solid ${BORDER}`, color: INK } } }}
            displayEmpty>
            <MenuItem value="All" sx={{ fontSize: '0.72rem', color: INK2 }}>All Sectors</MenuItem>
            {sectors.map(s => <MenuItem key={s} value={s} sx={{ fontSize: '0.72rem', color: INK }}>{s}</MenuItem>)}
          </Select>
          {(filterStock || filterQ > 0 || filterSector !== 'All') &&
            <ClearBtn onClick={() => { setFilterStock(''); setFilterQ(0); setFilterSector('All') }} />}
          <CountBadge shown={rows.length} total={data.items.length} />
        </FilterBar>

        <TableContainer sx={{ maxHeight: 420, borderRadius: '12px', border: `1px solid ${BORDER}` }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Rank','Stock','Sector','12-1M Return','3M Return','1M Return','Quintile','Signal','Strategy'].map(h => (
                  <TableCell key={h} sx={TH}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(item => (
                <TableRow key={item.symbol}
                  sx={{ bgcolor: PAPER, '&:hover td': { bgcolor: `${CYAN}08` } }}>
                  {/* t3: rank is ordinal meta */}
                  <TableCell sx={{ ...TD, ...t3 }}>{item.rank}</TableCell>
                  {/* t1+CYAN: symbol is the primary identity */}
                  <TableCell sx={{ ...TD, ...t1, color: CYAN }}>{item.symbol}</TableCell>
                  {/* t3: sector is categorisation context */}
                  <TableCell sx={{ ...TD, ...t3 }}>{item.sector}</TableCell>
                  <TableCell sx={TD}><RetCell value={item.ret_12_1m} /></TableCell>
                  <TableCell sx={TD}><RetCell value={item.ret_3m} /></TableCell>
                  <TableCell sx={TD}><RetCell value={item.ret_1m} /></TableCell>
                  <TableCell sx={TD}><Pill label={`Q${item.quintile}`} color={QUINTILE_COLOR[item.quintile]} /></TableCell>
                  <TableCell sx={TD}><Pill label={item.signal} color={SIGNAL_COLOR[item.signal] ?? INK2} /></TableCell>
                  {/* t3: strategy description is meta guidance */}
                  <TableCell sx={{ ...TD, ...t3 }}>{item.options_strategy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  )
}

// ─── 2. Mean Reversion Scanner ────────────────────────────────────────────────

function MeanReversionSection({ data }: { data: QuantScanResult['mean_reversion'] }) {
  const { CARD, TH, TD, t1, t2, t3, INPUT_SX, BORDER, CYAN, PAPER, INK, INK2, INK3 } = useTokens()
  const [filterStock,  setFilterStock]  = useState('')
  const [filterSignal, setFilterSignal] = useState('All')

  const signals = ['Overbought', 'Near OB', 'Neutral', 'Near OS', 'Oversold']
  const rows = data.items.filter(it =>
    (!filterStock || it.symbol.toLowerCase().includes(filterStock.toLowerCase())) &&
    (filterSignal === 'All' || it.signal === filterSignal)
  )

  const scoreBar = (score: number) => {
    const clamped = Math.max(-3, Math.min(3, score))
    const frac    = ((clamped + 3) / 6) * 100
    const color   = score >= 1.5 ? '#ef4444' : score <= -1.5 ? '#22c55e' : INK3
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1, height: 5, borderRadius: 3, bgcolor: BORDER, position: 'relative' }}>
          <Box sx={{ position: 'absolute', left: '50%', width: 1, top: 0, bottom: 0, bgcolor: INK3 }} />
          <Box sx={{
            position: 'absolute',
            left: score >= 0 ? '50%' : `${frac}%`,
            width: `${Math.abs(frac - 50)}%`,
            top: 0, bottom: 0, borderRadius: 3, bgcolor: color,
          }} />
        </Box>
        <Typography sx={{ ...t2, color, width: 38, textAlign: 'right', fontWeight: 700 }}>
          {score > 0 ? '+' : ''}{score.toFixed(2)}
        </Typography>
      </Box>
    )
  }

  return (
    <Box id="reversion" sx={{ scrollMarginTop: '64px' }}>
      <Box sx={{ ...CARD }}>
        <SectionHead title="Mean Reversion Z-Score" accent={SECTION_ACCENTS.reversion}
          meta={`Bollinger Z + RSI composite · ${data.as_of}`} />

        <SummaryStrip items={[
          { label: 'Overbought', symbols: data.overbought, color: '#ef4444', strategy: 'Sell Calls / Bear Spreads' },
          { label: 'Oversold',   symbols: data.oversold,   color: '#22c55e', strategy: 'Sell Puts / Bull Spreads'  },
        ]} />

        <FilterBar>
          <OutlinedInput placeholder="Stock…" value={filterStock}
            onChange={e => setFilterStock(e.target.value)}
            sx={{ ...INPUT_SX, width: 90 }} />
          <Select value={filterSignal} onChange={e => setFilterSignal(e.target.value)}
            input={<OutlinedInput sx={INPUT_SX} />}
            sx={{ minWidth: 130, ...INPUT_SX }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER, border: `1px solid ${BORDER}`, color: INK } } }}
            displayEmpty>
            <MenuItem value="All" sx={{ fontSize: '0.72rem', color: INK2 }}>All Signals</MenuItem>
            {signals.map(s => (
              <MenuItem key={s} value={s} sx={{ fontSize: '0.72rem', color: SIGNAL_COLOR[s] ?? INK2 }}>{s}</MenuItem>
            ))}
          </Select>
          {(filterStock || filterSignal !== 'All') &&
            <ClearBtn onClick={() => { setFilterStock(''); setFilterSignal('All') }} />}
          <CountBadge shown={rows.length} total={data.items.length} />
        </FilterBar>

        <TableContainer sx={{ maxHeight: 420, borderRadius: '12px', border: `1px solid ${BORDER}` }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Stock','Sector','Score (OB↑ / OS↓)','Z 20d','Z 50d','BB %B','RSI','Signal','Strategy'].map(h => (
                  <TableCell key={h} sx={TH}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(item => (
                <TableRow key={item.symbol}
                  sx={{ bgcolor: PAPER, '&:hover td': { bgcolor: `${CYAN}08` } }}>
                  <TableCell sx={{ ...TD, ...t1, color: CYAN }}>{item.symbol}</TableCell>
                  <TableCell sx={{ ...TD, ...t3 }}>{item.sector}</TableCell>
                  <TableCell sx={{ ...TD, minWidth: 140 }}>{scoreBar(item.reversion_score)}</TableCell>
                  {/* Z-scores: t2 base, semantic color override */}
                  <TableCell sx={TD}>
                    <Typography sx={{ ...t2, color: item.z_score_20d > 1.5 ? '#ef4444' : item.z_score_20d < -1.5 ? '#22c55e' : INK2 }}>
                      {item.z_score_20d > 0 ? '+' : ''}{item.z_score_20d.toFixed(2)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={TD}>
                    <Typography sx={{ ...t2, color: item.z_score_50d > 1.5 ? '#ef4444' : item.z_score_50d < -1.5 ? '#22c55e' : INK2 }}>
                      {item.z_score_50d > 0 ? '+' : ''}{item.z_score_50d.toFixed(2)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={TD}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <LinearProgress variant="determinate"
                        value={Math.max(0, Math.min(100, item.bb_pct_b * 100))}
                        sx={{
                          width: 40, height: 4, borderRadius: 2, bgcolor: BORDER,
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 2,
                            bgcolor: item.bb_pct_b > 0.9 ? '#ef4444' : item.bb_pct_b < 0.1 ? '#22c55e' : INK3,
                          },
                        }}
                      />
                      <Typography sx={{ ...t3 }}>{(item.bb_pct_b * 100).toFixed(0)}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={TD}>
                    <Typography sx={{ ...t2, color: item.rsi >= 70 ? '#ef4444' : item.rsi <= 30 ? '#22c55e' : INK2 }}>
                      {item.rsi}
                    </Typography>
                  </TableCell>
                  <TableCell sx={TD}><Pill label={item.signal} color={SIGNAL_COLOR[item.signal] ?? INK2} /></TableCell>
                  <TableCell sx={{ ...TD, ...t3 }}>{item.options_strategy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  )
}

// ─── 3. Volatility Rank ───────────────────────────────────────────────────────

function VolRankSection({ data }: { data: QuantScanResult['vol_rank'] }) {
  const { CARD, TH, TD, t1, t2, t3, INPUT_SX, BORDER, CYAN, PAPER, INK, INK2, INK3 } = useTokens()
  const [filterStock,  setFilterStock]  = useState('')
  const [filterAction, setFilterAction] = useState('All')
  const [filterRegime, setFilterRegime] = useState('All')

  const regimes = ['Very High', 'Elevated', 'Normal', 'Low', 'Very Low']
  const rows = data.items.filter(it =>
    (!filterStock || it.symbol.toLowerCase().includes(filterStock.toLowerCase())) &&
    (filterAction === 'All' || it.iv_action === filterAction) &&
    (filterRegime === 'All' || it.regime === filterRegime)
  )

  return (
    <Box id="vol-rank" sx={{ scrollMarginTop: '64px' }}>
      <Box sx={{ ...CARD }}>
        <SectionHead title="Realized Volatility Rank" accent={SECTION_ACCENTS.vol}
          meta={`HV20 percentile vs 252-day window · ${data.as_of}`} />

        <SummaryStrip items={[
          { label: 'Sell Premium (HV Rank ≥ 70)', symbols: data.sell_candidates, color: '#ef4444', strategy: 'Iron Condor / Short Strangle' },
          { label: 'Buy Premium (HV Rank ≤ 30)',  symbols: data.buy_candidates,  color: '#22c55e', strategy: 'Long Straddle / Debit Spreads' },
        ]} />

        <FilterBar>
          <OutlinedInput placeholder="Stock…" value={filterStock}
            onChange={e => setFilterStock(e.target.value)}
            sx={{ ...INPUT_SX, width: 90 }} />
          <Select value={filterAction} onChange={e => setFilterAction(e.target.value)}
            input={<OutlinedInput sx={INPUT_SX} />}
            sx={{ minWidth: 110, ...INPUT_SX }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER, border: `1px solid ${BORDER}`, color: INK } } }}
            displayEmpty>
            <MenuItem value="All"     sx={{ fontSize: '0.72rem', color: INK2 }}>IV: All</MenuItem>
            <MenuItem value="Sell"    sx={{ fontSize: '0.72rem', color: '#ef4444' }}>IV Sell</MenuItem>
            <MenuItem value="Neutral" sx={{ fontSize: '0.72rem', color: INK2 }}>IV Neutral</MenuItem>
            <MenuItem value="Buy"     sx={{ fontSize: '0.72rem', color: '#22c55e' }}>IV Buy</MenuItem>
          </Select>
          <Select value={filterRegime} onChange={e => setFilterRegime(e.target.value)}
            input={<OutlinedInput sx={INPUT_SX} />}
            sx={{ minWidth: 120, ...INPUT_SX }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER, border: `1px solid ${BORDER}`, color: INK } } }}
            displayEmpty>
            <MenuItem value="All" sx={{ fontSize: '0.72rem', color: INK2 }}>All Regimes</MenuItem>
            {regimes.map(r => (
              <MenuItem key={r} value={r} sx={{ fontSize: '0.72rem', color: VOL_REGIME_COLOR[r] }}>{r}</MenuItem>
            ))}
          </Select>
          {(filterStock || filterAction !== 'All' || filterRegime !== 'All') &&
            <ClearBtn onClick={() => { setFilterStock(''); setFilterAction('All'); setFilterRegime('All') }} />}
          <CountBadge shown={rows.length} total={data.items.length} />
        </FilterBar>

        <TableContainer sx={{ maxHeight: 420, borderRadius: '12px', border: `1px solid ${BORDER}` }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Stock','Sector','HV Rank','HV20 Now','HV20 1M Ago','Trend','Regime','IV Action','Strategy'].map(h => (
                  <TableCell key={h} sx={TH}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(item => (
                <TableRow key={item.symbol}
                  sx={{ bgcolor: PAPER, '&:hover td': { bgcolor: `${CYAN}08` } }}>
                  <TableCell sx={{ ...TD, ...t1, color: CYAN }}>{item.symbol}</TableCell>
                  <TableCell sx={{ ...TD, ...t3 }}>{item.sector}</TableCell>
                  <TableCell sx={TD}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LinearProgress variant="determinate" value={item.hv_rank}
                        sx={{
                          width: 56, height: 5, borderRadius: 3, bgcolor: BORDER,
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 3, bgcolor: VOL_REGIME_COLOR[item.regime],
                          },
                        }}
                      />
                      {/* t1: HV rank is the key metric in this section */}
                      <Typography sx={{ ...t1, color: VOL_REGIME_COLOR[item.regime] }}>
                        {item.hv_rank.toFixed(0)}
                      </Typography>
                    </Box>
                  </TableCell>
                  {/* t2 with semantic color */}
                  <TableCell sx={TD}>
                    <Typography sx={{ ...t2, color: VOL_REGIME_COLOR[item.regime] }}>
                      {item.hv20.toFixed(1)}%
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ ...TD, ...t3 }}>{item.hv20_1m_ago.toFixed(1)}%</TableCell>
                  <TableCell sx={TD}>
                    <Typography sx={{
                      ...t2,
                      color: item.vol_trend === 'Rising' ? '#ef4444' : item.vol_trend === 'Falling' ? '#22c55e' : INK2,
                    }}>
                      {item.vol_trend === 'Rising' ? '↑' : item.vol_trend === 'Falling' ? '↓' : '→'} {item.vol_trend}
                    </Typography>
                  </TableCell>
                  <TableCell sx={TD}><Pill label={item.regime} color={VOL_REGIME_COLOR[item.regime]} /></TableCell>
                  <TableCell sx={TD}>
                    {/* t1: IV action is the key decision signal */}
                    <Typography sx={{ ...t1, color: item.iv_action === 'Sell' ? '#ef4444' : item.iv_action === 'Buy' ? '#22c55e' : INK2 }}>
                      {item.iv_action}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ ...TD, ...t3 }}>{item.options_strategy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  )
}

// ─── 4. Sector Rotation ───────────────────────────────────────────────────────

function SectorRotationSection({ data }: { data: QuantScanResult['sector_rotation'] }) {
  const { CARD, TH, TD, t1, t2, t3, BORDER, CYAN, PAPER, INK, INK2, INK3 } = useTokens()

  const quadrants: Array<{ phase: string; sectors: SectorItem[] }> = [
    { phase: 'Leading',   sectors: data.sectors.filter(s => s.phase === 'Leading') },
    { phase: 'Weakening', sectors: data.sectors.filter(s => s.phase === 'Weakening') },
    { phase: 'Improving', sectors: data.sectors.filter(s => s.phase === 'Improving') },
    { phase: 'Lagging',   sectors: data.sectors.filter(s => s.phase === 'Lagging') },
  ]

  return (
    <Box id="sector-rotation" sx={{ scrollMarginTop: '64px' }}>
      <Box sx={{ ...CARD }}>
        <SectionHead title="Sector Relative Strength Rotation" accent={SECTION_ACCENTS.sector}
          meta={`NIFTY proxy 1M ${pct(data.nifty_ret_1m)} · 3M ${pct(data.nifty_ret_3m)} · ${data.as_of}`} />

        {/* RRG Quadrant Grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2.5 }}>
          {quadrants.map(({ phase, sectors }) => (
            <Box key={phase} sx={{
              ...CARD, p: 1.5, borderLeft: `3px solid ${PHASE_COLOR[phase]}`, minHeight: 100,
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.875 }}>
                <Pill label={phase} color={PHASE_COLOR[phase]} />
                <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK3 }}>
                  {PHASE_DESC[phase]}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {sectors.length === 0 && (
                  <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK3 }}>—</Typography>
                )}
                {sectors.map(s => (
                  <Box key={s.sector} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {/* t2: sector name in quadrant card */}
                    <Typography sx={{ ...t2, fontWeight: 600 }}>{s.sector}</Typography>
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                      <Typography sx={{ ...t3, color: s.rs_1m >= 0 ? '#22c55e' : '#ef4444' }}>
                        RS 1M {pct(s.rs_1m)}
                      </Typography>
                      <Typography sx={{ ...t3, color: s.rs_3m >= 0 ? '#22c55e' : '#ef4444' }}>
                        RS 3M {pct(s.rs_3m)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>

        {/* Sector detail table */}
        <TableContainer sx={{ maxHeight: 380, borderRadius: '12px', border: `1px solid ${BORDER}` }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Rank','Sector','Phase','Ret 1M','Ret 3M','RS vs NIFTY 1M','RS vs NIFTY 3M','Stocks'].map(h => (
                  <TableCell key={h} sx={TH}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.sectors.map(s => (
                <TableRow key={s.sector}
                  sx={{ bgcolor: PAPER, '&:hover td': { bgcolor: `${CYAN}08` } }}>
                  <TableCell sx={{ ...TD, ...t3 }}>{s.rank_3m}</TableCell>
                  {/* t1: sector name is the primary identity */}
                  <TableCell sx={{ ...TD, ...t1 }}>{s.sector}</TableCell>
                  <TableCell sx={TD}><Pill label={s.phase} color={PHASE_COLOR[s.phase]} /></TableCell>
                  <TableCell sx={TD}><RetCell value={s.ret_1m} /></TableCell>
                  <TableCell sx={TD}><RetCell value={s.ret_3m} /></TableCell>
                  <TableCell sx={TD}>
                    {/* t1: RS is the key metric — semantic color */}
                    <Typography sx={{ ...t1, color: s.rs_1m >= 0 ? '#22c55e' : '#ef4444' }}>
                      {pct(s.rs_1m)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={TD}>
                    <Typography sx={{ ...t1, color: s.rs_3m >= 0 ? '#22c55e' : '#ef4444' }}>
                      {pct(s.rs_3m)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={TD}>
                    <Tooltip title={s.symbols.join(', ')} placement="top">
                      <Typography sx={{ ...t3, cursor: 'default' }}>
                        {s.n_stocks} stocks ↗
                      </Typography>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  const { PAPER, BORDER, CYAN, INK, INK2, INK3 } = usePalette()
  const NAV = [
    { label: 'Platform',     links: ['Stock DNA', 'Pattern DNA', 'Markov Options', 'Quant Strategies', 'Indicators']         },
    { label: 'Intelligence', links: ['Market Regime', 'Breadth Score', 'Edge Lab', 'Cointegration', 'Delivery Intel']        },
    { label: 'Research',     links: ['Validation Framework', 'MCP Architecture', 'AI Agents', 'Feature Store', 'Backtests'] },
  ]
  return (
    <Box component="footer" sx={{ bgcolor: PAPER, borderTop: `1px solid ${BORDER}`, mt: 8 }}>
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, pt: 6, pb: 4 }}>
        <Box sx={{ display: 'flex', gap: 6, flexWrap: 'wrap', mb: 5 }}>

          {/* Brand block */}
          <Box sx={{ flex: '0 0 auto', maxWidth: 260 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Box sx={{
                width: 7, height: 7, bgcolor: CYAN,
                animation: 'blink 1.4s step-end infinite',
                '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } },
              }} />
              <Typography sx={{ ...JAKARTA, fontWeight: 800, fontSize: '1rem', color: INK, letterSpacing: '0.08em' }}>
                MARKET<Box component="span" sx={{ color: CYAN }}>DNA</Box>
              </Typography>
            </Box>
            <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: INK3, lineHeight: 1.7, mb: 2 }}>
              Quantitative market intelligence for Indian equities and options. Research precedes product. Validation is mandatory.
            </Typography>
            <Box
              component="img"
              src="https://cdn.undraw.co/illustration/data-at-work_3tbf.svg"
              alt=""
              sx={{ width: 140, opacity: 0.6 }}
            />
          </Box>

          {/* Nav columns */}
          {NAV.map(col => (
            <Box key={col.label} sx={{ flex: '1 1 140px' }}>
              <Typography sx={{
                ...JAKARTA, fontSize: '0.7rem', fontWeight: 700, color: CYAN,
                letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1.75,
              }}>
                {col.label}
              </Typography>
              {col.links.map(link => (
                <Typography key={link} sx={{
                  ...JAKARTA, fontSize: '0.8rem', color: INK3, mb: 0.875, cursor: 'default',
                  transition: 'color 0.12s', '&:hover': { color: INK2 },
                }}>
                  {link}
                </Typography>
              ))}
            </Box>
          ))}

          {/* Illustration */}
          <Box sx={{ flex: '0 0 auto', display: { xs: 'none', lg: 'flex' }, alignItems: 'center' }}>
            <Box
              component="img"
              src="https://cdn.undraw.co/illustration/real-time-analytics_50za.svg"
              alt=""
              sx={{ width: 180, opacity: 0.55 }}
            />
          </Box>
        </Box>

        {/* Bottom bar */}
        <Box sx={{
          borderTop: `1px solid ${BORDER}`, pt: 3,
          display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5,
        }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.7rem', color: INK3 }}>
            © 2024 MarketDNA · Data sourced from NSE via Kite Connect · For research purposes only
          </Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.7rem', color: INK3 }}>
            Not investment advice · Past performance is not indicative of future results
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuantStrategiesPage() {
  const { BG, PAPER, PAPER2, BORDER, CYAN, INK, INK2, INK3, CARD } = useTokens()
  const { mode } = useThemeMode()
  const [result,  setResult]  = useState<QuantScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [ran,     setRan]     = useState(false)

  function runScan() {
    if (loading) return
    setLoading(true)
    setError(null)
    quantStrategiesApi.scan()
      .then(d => { setResult(d); setRan(true) })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK, transition: 'background 0.2s' }}>
      <Navbar sections={NAV_SECTIONS} />

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background glows */}
        <Box sx={{
          position: 'absolute', top: -100, right: '10%',
          width: 500, height: 400, borderRadius: '50%',
          background: `radial-gradient(ellipse, ${CYAN}12 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />
        <Box sx={{
          position: 'absolute', bottom: -60, left: '5%',
          width: 300, height: 300, borderRadius: '50%',
          background: `radial-gradient(ellipse, #6366f118 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 6, md: 9 }, position: 'relative' }}>
          <Grid container spacing={{ xs: 4, md: 8 }} alignItems="center">
            <Grid item xs={12} md={7}>

              {/* Tag pill */}
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5,
                px: 1.5, py: 0.5, borderRadius: '20px',
                border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D`,
              }}>
                <Box sx={{
                  width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN,
                  animation: 'hpulse 2s ease-in-out infinite',
                  '@keyframes hpulse': {
                    '0%,100%': { boxShadow: `0 0 4px ${CYAN}` },
                    '50%':     { boxShadow: `0 0 14px ${CYAN}` },
                  },
                }} />
                <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  Quantitative Research · Factor Models
                </Typography>
              </Box>

              {/* Headline */}
              <Typography sx={{
                ...JAKARTA, fontWeight: 800, color: INK,
                fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' },
                lineHeight: 1.1, letterSpacing: '-0.03em', mb: 1.5,
              }}>
                Quant{' '}
                <Box component="span" sx={{ color: CYAN, textShadow: `0 0 32px ${CYAN}70` }}>
                  Strategy
                </Box>
                {' '}Engine
              </Typography>

              <Typography sx={{ ...JAKARTA, fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, mb: 4, maxWidth: 520 }}>
                Four evidence-based modules — cross-sectional momentum, mean reversion,
                realized vol rank, and sector rotation. Each generates an actionable options strategy signal.
              </Typography>

              {/* Module quick-links */}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {NAV_SECTIONS.map(({ label, anchor }) => (
                  <Box
                    key={anchor}
                    component="a" href={`#${anchor}`}
                    sx={{
                      px: 1.5, py: 0.625, borderRadius: '8px', textDecoration: 'none',
                      border: `1px solid ${BORDER}`, bgcolor: `${CYAN}08`,
                      ...JAKARTA, fontSize: '0.72rem', fontWeight: 600, color: INK2,
                      transition: 'all 0.15s',
                      '&:hover': { borderColor: CYAN, color: CYAN, bgcolor: `${CYAN}12` },
                    }}
                  >
                    {label}
                  </Box>
                ))}
              </Box>
            </Grid>

            {/* Right — stats (shown after scan) */}
            {result && (
              <Grid item xs={12} md={5}>
                <Box sx={{
                  display: 'flex', flexDirection: 'column', gap: 1.5,
                  p: 2.5, borderRadius: '16px',
                  bgcolor: mode === 'dark' ? `${CYAN}08` : `${CYAN}06`,
                  border: `1px solid ${CYAN}30`,
                }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase', mb: 0.5 }}>
                    Scan results
                  </Typography>
                  {[
                    { label: 'Stocks scanned',     value: `${result.momentum.items.length}` },
                    { label: 'Sectors tracked',    value: `${result.sector_rotation.sectors.length}` },
                    { label: 'Computed',           value: result.computed_at.split(' ')[0] },
                  ].map(({ label, value }) => (
                    <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3 }}>{label}</Typography>
                      <Typography sx={{ ...JAKARTA, fontSize: '1.1rem', fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>
                        {value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2.5, md: 8, lg: 12 }, py: 4 }}>

        {/* Scan gate */}
        {!ran && (
          <Box sx={{ ...CARD, mb: 3 }}>
            <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: INK2, mb: 2 }}>
              Scans all NIFTY 50 stocks in a single pass. Takes ~5–15 seconds.
            </Typography>

            {loading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <CircularProgress size={18} sx={{ color: CYAN }} />
                <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3 }}>
                  Computing momentum, mean reversion, vol rank, sector rotation…
                </Typography>
              </Box>
            ) : (
              <Box component="button" onClick={runScan} sx={{
                px: 2.5, py: 0.875, borderRadius: '10px', fontSize: '0.875rem', fontWeight: 700,
                cursor: 'pointer', border: 'none', color: '#FFFFFF',
                background: `linear-gradient(135deg, ${CYAN}, #0078A8)`,
                boxShadow: `0 0 16px ${CYAN}40`,
                '&:hover': { boxShadow: `0 0 24px ${CYAN}70`, transform: 'translateY(-1px)' },
                transition: 'all 0.15s',
                ...JAKARTA,
              }}>
                Run Quant Scan
              </Box>
            )}

            {error && (
              <Box sx={{ mt: 2, p: 1.5, borderRadius: '8px',
                bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: '#ef4444' }}>{error}</Typography>
              </Box>
            )}
          </Box>
        )}

        {ran && result && (
          <>
            {/* Re-run + meta bar */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3,
                fontVariantNumeric: 'tabular-nums' }}>
                Computed {result.computed_at}
              </Typography>
              <Box component="button" onClick={runScan} disabled={loading} sx={{
                px: 1.5, py: 0.4, borderRadius: '8px', fontSize: '0.72rem',
                border: `1px solid ${BORDER}`, bgcolor: PAPER2, color: INK2,
                cursor: loading ? 'default' : 'pointer', ...JAKARTA,
                '&:hover:not(:disabled)': { borderColor: CYAN, color: INK },
                transition: 'all 0.12s',
              }}>
                {loading ? 'Running…' : '↺ Re-run'}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <MomentumSection      data={result.momentum} />
              <MeanReversionSection data={result.mean_reversion} />
              <VolRankSection       data={result.vol_rank} />
              <SectorRotationSection data={result.sector_rotation} />
            </Box>
          </>
        )}
      </Box>

      <Footer />
    </Box>
  )
}
