import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import {
  Box, Container, Typography, CircularProgress, Alert,
  Chip, FormControl, Select, MenuItem, OutlinedInput,
  Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts/highstock'
import type {
  PatternDetection, PatternScannerResponse, PatternScreenerResponse, PatternDNAResponse,
  ConfirmedFormingItem, ConfirmedFormingResponse,
  PatternHistoryResponse, PatternHistoryItem,
  BreakoutTrackerResponse,
  PatternHeatmapResponse, HeatmapCell,
  RegimeDNAResponse, RegimeDNAEntry,
  PatternFailureResponse,
} from '../types/pattern'
import type { ValidationReport, ValidationSummary, OOSSplitResult, DecileResult, DecileRow, CalibrationResult, ConfBin } from '../types/validation'
import type { OHLCVResponse } from '../types/stock'
import { patternApi } from '../api/patternApi'
import { stockApi } from '../api/stockApi'
import { hcTheme } from '../theme'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { Footer } from '../components/Footer'

const CATEGORY_COLOR: Record<string, string> = {
  'Bullish Reversal':    '#22c55e',
  'Bullish Continuation':'#4ade80',
  'Bearish Reversal':    '#ef4444',
  'Bearish Continuation':'#f87171',
  'Neutral':             '#f59e0b',
}

const STAGE_COLOR: Record<string, string> = {
  'Confirmed':      '#22c55e',
  'Breakout Watch': '#f59e0b',
  'Maturing':       '#60a5fa',
  'Forming':        '#94a3b8',
}

const SCREENER_PATTERNS = [
  'Double Bottom', 'Double Top',
  'Inverse Head & Shoulders', 'Head & Shoulders',
  'Bull Flag', 'Bear Flag',
  'Ascending Triangle', 'Descending Triangle',
  'Rectangle',
]

function retColor(v: number): string { return v > 0 ? '#22c55e' : '#ef4444' }
function fmt(v: number): string { return `${v > 0 ? '+' : ''}${v.toFixed(1)}%` }

// ── Shared section wrapper ────────────────────────────────────────────────────

function Section({ title, accent = '#60A5FA', children }: {
  title: string; accent?: string; children: React.ReactNode
}) {
  const { PAPER, BORDER, INK2 } = usePalette()
  return (
    <Box sx={{
      mb: 2, borderRadius: 0,
      background: PAPER,
      border: `1px solid ${BORDER}`,
      overflow: 'hidden', position: 'relative',
    }}>
      <Box sx={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px', zIndex: 2,
        background: `linear-gradient(90deg, transparent 0%, ${accent}55 35%, rgba(20,184,166,0.35) 65%, transparent 100%)`,
      }} />
      <Box sx={{
        px: { xs: 2.5, md: 3.5 }, py: 1.5,
        borderBottom: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', gap: 1.25,
      }}>
        <Box sx={{ width: 3, height: 16, borderRadius: '2px', bgcolor: accent, flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, letterSpacing: '-0.01em', color: INK2 }}>
          {title}
        </Typography>
      </Box>
      <Box sx={{ px: { xs: 2.5, md: 3.5 }, pb: 3.5, pt: 2.5 }}>
        {children}
      </Box>
    </Box>
  )
}

// ── Confidence ring ───────────────────────────────────────────────────────────

function ConfRing({ value }: { value: number }) {
  const { BORDER } = usePalette()
  const R = 16
  const circ = 2 * Math.PI * R
  const dash = (value / 100) * circ
  const color = value >= 80 ? '#22c55e' : value >= 65 ? '#f59e0b' : '#64748b'
  return (
    <Box sx={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
      <svg width={40} height={40} viewBox="0 0 40 40">
        <circle cx={20} cy={20} r={R} fill="none" stroke={BORDER} strokeWidth={4} />
        <circle cx={20} cy={20} r={R} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ * 0.25} strokeLinecap="round" />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color }}>{value}</Typography>
      </Box>
    </Box>
  )
}

// ── DNA genome bar ────────────────────────────────────────────────────────────

function GenomeBar({ label, score, color }: { label: string; score: number; color: string }) {
  const { INK2, BORDER } = usePalette()
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.72rem', color: INK2 }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color }}>{score}</Typography>
      </Box>
      <Box sx={{ height: 6, borderRadius: 3, bgcolor: BORDER }}>
        <Box sx={{
          height: '100%', borderRadius: 3,
          width: `${score}%`, bgcolor: color,
          transition: 'width 0.8s ease',
        }} />
      </Box>
    </Box>
  )
}

// ── Active Pattern Scanner ────────────────────────────────────────────────────


function FilterChip({ label, color, active, onClick }: {
  label: string; color: string; active: boolean; onClick: () => void
}) {
  const { INK3, BORDER } = usePalette()
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        cursor: 'pointer', border: 'none', outline: 'none',
        px: 1.25, py: 0.35, borderRadius: '6px', fontSize: '0.62rem', fontWeight: 700,
        bgcolor: active ? `${color}22` : 'transparent',
        color:   active ? color : INK3,
        boxShadow: active ? `0 0 0 1px ${color}45` : `0 0 0 1px ${BORDER}`,
        transition: 'all 0.15s',
        '&:hover': { bgcolor: `${color}18`, color },
      }}
    >
      {label}
    </Box>
  )
}

function PatternScanner({ data, loading, onSymbolClick }: {
  data: PatternScannerResponse | null; loading: boolean; onSymbolClick: (s: string) => void
}) {
  const { PAPER2, BORDER, INK, INK2, INK3, CYAN, INPUT_SX, TH, TD } = useTokens()
  const [filterStock,    setFilterStock]    = useState('')
  const [filterPattern,  setFilterPattern]  = useState('All')
  const [filterCats,     setFilterCats]     = useState<Set<string>>(new Set())
  const [filterStages,   setFilterStages]   = useState<Set<string>>(new Set())
  const [filterConfMin,  setFilterConfMin]  = useState(0)

  const uniquePatterns = useMemo(
    () => ['All', ...new Set(data?.items.map(i => i.pattern) ?? [])].sort((a, b) => a === 'All' ? -1 : a.localeCompare(b)),
    [data],
  )

  const rows = useMemo(() => {
    if (!data) return []
    return data.items.filter(item => {
      if (filterStock && !item.symbol.toLowerCase().includes(filterStock.toLowerCase())) return false
      if (filterPattern !== 'All' && item.pattern !== filterPattern) return false
      if (filterCats.size > 0 && !filterCats.has(item.category)) return false
      if (filterStages.size > 0 && !filterStages.has(item.stage)) return false
      if (item.confidence < filterConfMin) return false
      return true
    })
  }, [data, filterStock, filterPattern, filterCats, filterStages, filterConfMin])

  const anyFilter = filterStock || filterPattern !== 'All' || filterCats.size > 0 || filterStages.size > 0 || filterConfMin > 0

  function clearAll() {
    setFilterStock(''); setFilterPattern('All')
    setFilterCats(new Set()); setFilterStages(new Set()); setFilterConfMin(0)
  }

  function toggleCat(c: string) {
    setFilterCats(prev => { const s = new Set(prev); s.has(c) ? s.delete(c) : s.add(c); return s })
  }
  function toggleStage(s: string) {
    setFilterStages(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })
  }

  if (loading) {
    return (
      <Box sx={{ height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
        <CircularProgress size={28} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Scanning all stocks for active patterns…</Typography>
      </Box>
    )
  }
  if (!data || data.items.length === 0) {
    return <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>No patterns detected today.</Typography>
  }

  return (
    <Box>
      {/* Meta row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: CYAN, textTransform: 'uppercase' }}>
          {rows.length}{rows.length !== data.items.length ? ` / ${data.items.length}` : ''} pattern{rows.length !== 1 ? 's' : ''}
        </Typography>
        <Typography sx={{ fontSize: '0.58rem', color: INK3 }}>scanned {data.scanned_at}</Typography>
        {anyFilter && (
          <Box
            component="button"
            onClick={clearAll}
            sx={{
              ml: 'auto', cursor: 'pointer', border: 'none', background: 'none',
              fontSize: '0.65rem', fontWeight: 700, color: '#EF4444',
              '&:hover': { color: '#FCA5A5' },
            }}
          >
            Clear filters ×
          </Box>
        )}
      </Box>

      {/* Filter bar */}
      <Box sx={{
        mb: 2, p: 1.5, borderRadius: '12px',
        bgcolor: PAPER2,
        border: `1px solid ${BORDER}`,
        display: 'flex', flexDirection: 'column', gap: 1.25,
      }}>
        {/* Row 1: text + dropdown + confidence */}
        <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
          <OutlinedInput
            placeholder="Stock…"
            value={filterStock}
            onChange={e => setFilterStock(e.target.value)}
            sx={{ ...INPUT_SX, width: 110 }}
          />
          <FormControl size="small" sx={{ minWidth: 168 }}>
            <Select
              value={filterPattern}
              onChange={e => setFilterPattern(e.target.value)}
              displayEmpty
              sx={{ ...INPUT_SX, height: 28, fontSize: '0.72rem' }}
              MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
            >
              {uniquePatterns.map(p => (
                <MenuItem key={p} value={p} sx={{ fontSize: '0.72rem' }}>{p}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: '0.62rem', color: INK3, fontWeight: 700, whiteSpace: 'nowrap' }}>
              Conf ≥
            </Typography>
            <OutlinedInput
              type="number"
              value={filterConfMin || ''}
              onChange={e => setFilterConfMin(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              placeholder="0"
              sx={{ ...INPUT_SX, width: 68 }}
              inputProps={{ min: 0, max: 100 }}
            />
          </Box>
        </Box>

        {/* Row 2: category chips */}
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: INK3, mr: 0.5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Category
          </Typography>
          {Object.entries(CATEGORY_COLOR).map(([cat, color]) => (
            <FilterChip key={cat} label={cat} color={color} active={filterCats.has(cat)} onClick={() => toggleCat(cat)} />
          ))}
        </Box>

        {/* Row 3: stage chips */}
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: INK3, mr: 0.5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Stage
          </Typography>
          {Object.entries(STAGE_COLOR).map(([stage, color]) => (
            <FilterChip key={stage} label={stage} color={color} active={filterStages.has(stage)} onClick={() => toggleStage(stage)} />
          ))}
        </Box>
      </Box>

      {/* Scrollable table */}
      <TableContainer sx={{ maxHeight: 460, borderRadius: '10px', border: `1px solid ${BORDER}` }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {(['Stock', 'Pattern', 'Category', 'Stage', 'Confidence', 'Days', 'Breakout'] as const).map(h => (
                <TableCell
                  key={h}
                  sx={{ ...TH, whiteSpace: 'nowrap' }}
                >
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, borderColor: 'transparent' }}>
                  <Typography sx={{ fontSize: '0.72rem', color: INK3 }}>No rows match the current filters.</Typography>
                </TableCell>
              </TableRow>
            ) : rows.map((item, i) => {
              const catColor   = CATEGORY_COLOR[item.category] ?? '#94a3b8'
              const stageColor = STAGE_COLOR[item.stage]       ?? '#94a3b8'
              return (
                <TableRow key={i} sx={{ '&:hover': { bgcolor: `${BORDER}40` } }}>
                  <TableCell sx={{ ...TD, py: 1 }}>
                    <Box
                      component="button"
                      onClick={() => onSymbolClick(item.symbol)}
                      sx={{
                        background: 'none', border: 'none', cursor: 'pointer', p: 0,
                        fontSize: '0.78rem', fontWeight: 700,
                        fontFamily: "'IBM Plex Mono', monospace", color: CYAN,
                        '&:hover': { color: '#93C5FD', textDecoration: 'underline' },
                      }}
                    >
                      {item.symbol}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ ...TD, py: 1 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>
                      {item.pattern}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ ...TD, py: 1 }}>
                    <Chip label={item.category} size="small"
                      sx={{ bgcolor: `${catColor}15`, color: catColor, fontSize: '0.58rem', fontWeight: 700, height: 18 }} />
                  </TableCell>
                  <TableCell sx={{ ...TD, py: 1 }}>
                    <Chip label={item.stage} size="small"
                      sx={{ bgcolor: `${stageColor}18`, color: stageColor, fontSize: '0.58rem', fontWeight: 700, height: 18 }} />
                  </TableCell>
                  <TableCell sx={{ ...TD, py: 1 }}>
                    <ConfRing value={item.confidence} />
                  </TableCell>
                  <TableCell sx={{ ...TD, py: 1 }}>
                    <Typography sx={{ fontSize: '0.72rem', color: INK2 }}>{item.days_forming}d</Typography>
                  </TableCell>
                  <TableCell sx={{ ...TD, py: 1 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace", color: INK2 }}>
                      {item.breakout_level != null ? `₹${item.breakout_level.toLocaleString('en-IN')}` : '—'}
                    </Typography>
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

// ── Pattern Screener ──────────────────────────────────────────────────────────

function PatternScreener({ onSymbolClick }: { onSymbolClick: (s: string) => void }) {
  const [pattern,       setPattern]       = useState('Double Bottom')
  const [data,          setData]          = useState<PatternScreenerResponse | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [filterStock,   setFilterStock]   = useState('')
  const [filterDnaMin,  setFilterDnaMin]  = useState(0)
  const [filterSrMin,   setFilterSrMin]   = useState(0)
  const [filterConfMin, setFilterConfMin] = useState(0)

  const { PAPER2, BORDER, INK, INK2, INK3, CYAN, INPUT_SX, TH, TD } = useTokens()

  useEffect(() => {
    setLoading(true); setError(null)
    patternApi.getScreener(pattern)
      .then(setData)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [pattern])

  // reset filters when pattern changes
  useEffect(() => {
    setFilterStock(''); setFilterDnaMin(0); setFilterSrMin(0); setFilterConfMin(0)
  }, [pattern])

  const rows = useMemo(() => {
    if (!data) return []
    return data.items.filter(item => {
      if (filterStock && !item.symbol.toLowerCase().includes(filterStock.toLowerCase())) return false
      if (item.dna_score    < filterDnaMin)  return false
      if (item.success_rate < filterSrMin)   return false
      if (item.avg_confidence < filterConfMin) return false
      return true
    })
  }, [data, filterStock, filterDnaMin, filterSrMin, filterConfMin])

  const anyFilter = filterStock || filterDnaMin > 0 || filterSrMin > 0 || filterConfMin > 0
  function clearFilters() {
    setFilterStock(''); setFilterDnaMin(0); setFilterSrMin(0); setFilterConfMin(0)
  }

  return (
    <Box>
      {/* Pattern selector */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography sx={{ fontSize: '0.73rem', color: INK2, fontWeight: 600 }}>
          Stocks historically best suited for:
        </Typography>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <Select
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            sx={{ ...INPUT_SX, fontSize: '0.78rem', fontWeight: 700 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {SCREENER_PATTERNS.map(p => (
              <MenuItem key={p} value={p} sx={{ fontSize: '0.78rem' }}>{p}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {loading && (
        <Box sx={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
          <CircularProgress size={24} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Computing DNA scores for {pattern}…
          </Typography>
        </Box>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {!loading && data && data.items.length > 0 && (
        <>
          {/* Filter bar */}
          <Box sx={{
            mb: 2, p: 1.5, borderRadius: '12px',
            bgcolor: PAPER2,
            border: `1px solid ${BORDER}`,
            display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <OutlinedInput
              placeholder="Stock…"
              value={filterStock}
              onChange={e => setFilterStock(e.target.value)}
              sx={{ ...INPUT_SX, width: 110 }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography sx={{ fontSize: '0.62rem', color: INK3, fontWeight: 700 }}>DNA ≥</Typography>
              <OutlinedInput type="number" value={filterDnaMin || ''} placeholder="0"
                onChange={e => setFilterDnaMin(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                sx={{ ...INPUT_SX, width: 68 }} inputProps={{ min: 0, max: 100 }} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography sx={{ fontSize: '0.62rem', color: INK3, fontWeight: 700 }}>SR ≥</Typography>
              <OutlinedInput type="number" value={filterSrMin || ''} placeholder="0"
                onChange={e => setFilterSrMin(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                sx={{ ...INPUT_SX, width: 68 }} inputProps={{ min: 0, max: 100 }} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography sx={{ fontSize: '0.62rem', color: INK3, fontWeight: 700 }}>Conf ≥</Typography>
              <OutlinedInput type="number" value={filterConfMin || ''} placeholder="0"
                onChange={e => setFilterConfMin(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                sx={{ ...INPUT_SX, width: 68 }} inputProps={{ min: 0, max: 100 }} />
            </Box>
            {anyFilter && (
              <Box component="button" onClick={clearFilters}
                sx={{ ml: 'auto', cursor: 'pointer', border: 'none', background: 'none',
                  fontSize: '0.65rem', fontWeight: 700, color: '#EF4444', '&:hover': { color: '#FCA5A5' } }}>
                Clear ×
              </Box>
            )}
            <Typography sx={{ ml: anyFilter ? 0 : 'auto', fontSize: '0.58rem', color: INK3 }}>
              {rows.length}{rows.length !== data.items.length ? ` / ${data.items.length}` : ''} stocks
            </Typography>
          </Box>

          {/* Scrollable table */}
          <TableContainer sx={{ maxHeight: 460, borderRadius: '10px', border: `1px solid ${BORDER}` }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['#', 'Stock', 'DNA Score', 'Avg Confidence', 'Success Rate', '1M Avg', '3M Avg', 'n'].map(h => (
                    <TableCell key={h} sx={{ ...TH, py: 1, whiteSpace: 'nowrap' }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ textAlign: 'center', py: 4, borderColor: 'transparent' }}>
                      <Typography sx={{ fontSize: '0.72rem', color: INK3 }}>No rows match the current filters.</Typography>
                    </TableCell>
                  </TableRow>
                ) : rows.map((item, i) => {
                  const confColor = item.avg_confidence >= 80 ? '#22c55e' : item.avg_confidence >= 65 ? '#f59e0b' : '#64748b'
                  return (
                    <TableRow key={item.symbol} sx={{ '&:hover': { bgcolor: `${BORDER}40` } }}>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', color: INK3, fontWeight: 700 }}>#{i + 1}</Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Box component="button" onClick={() => onSymbolClick(item.symbol)}
                          sx={{ background: 'none', border: 'none', cursor: 'pointer', p: 0,
                            fontSize: '0.78rem', fontWeight: 700,
                            fontFamily: "'IBM Plex Mono', monospace", color: CYAN,
                            '&:hover': { color: '#93C5FD', textDecoration: 'underline' } }}>
                          {item.symbol}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 52, height: 5, borderRadius: 2.5, bgcolor: BORDER }}>
                            <Box sx={{ height: '100%', borderRadius: 2.5, width: `${item.dna_score}%`, bgcolor: '#8B5CF6' }} />
                          </Box>
                          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: '#8B5CF6' }}>{item.dna_score}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 40, height: 5, borderRadius: 2.5, bgcolor: BORDER }}>
                            <Box sx={{ height: '100%', borderRadius: 2.5, width: `${item.avg_confidence}%`, bgcolor: confColor }} />
                          </Box>
                          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: confColor }}>
                            {item.avg_confidence.toFixed(0)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: item.success_rate >= 60 ? '#22c55e' : item.success_rate <= 40 ? '#ef4444' : '#f59e0b' }}>
                          {item.success_rate.toFixed(0)}%
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: retColor(item.avg_fwd_21d) }}>
                          {fmt(item.avg_fwd_21d)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: retColor(item.avg_fwd_63d) }}>
                          {fmt(item.avg_fwd_63d)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', color: INK2 }}>{item.occurrences}</Typography>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {!loading && data && data.items.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
          Insufficient history to rank stocks for {pattern}.
        </Typography>
      )}
    </Box>
  )
}

// ── Confirmed Forming Screener ────────────────────────────────────────────────

function ConfirmedFormingScreener({ timeframe }: { timeframe: string }) {
  const [data, setData] = useState<ConfirmedFormingResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  const { PAPER2, BORDER, INK, INK2, CYAN, TD } = useTokens()

  // Reset when timeframe changes
  useEffect(() => { setData(null); setFetched(false) }, [timeframe])

  function load() {
    if (fetched) return
    setLoading(true)
    patternApi.getConfirmedForming(timeframe)
      .then(d => { setData(d); setFetched(true) })
      .catch(() => { setData(null); setFetched(true) })
      .finally(() => setLoading(false))
  }

  return (
    <Box>
      {/* Header row with scan button */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.6 }}>
            Stocks where a pattern <strong style={{ color: INK }}>currently forming</strong> is also their{' '}
            <strong style={{ color: '#F59E0B' }}>historically strongest</strong> pattern —
            the setup the stock has rewarded most in the past is appearing right now.
          </Typography>
        </Box>
        <Box
          component="button"
          onClick={load}
          disabled={loading}
          sx={{
            flexShrink: 0,
            px: 2.5, py: 1,
            borderRadius: '10px',
            border: '1px solid rgba(245,158,11,0.35)',
            background: loading ? 'rgba(245,158,11,0.04)' : 'rgba(245,158,11,0.08)',
            color: '#F59E0B',
            fontSize: '0.72rem',
            fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
            transition: 'all 0.15s',
            '&:hover:not(:disabled)': { background: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.55)' },
          }}
        >
          {loading ? 'Scanning…' : fetched ? 'Re-scan' : 'Run Scan'}
        </Box>
      </Box>

      {loading && (
        <Box sx={{ py: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={24} sx={{ color: '#F59E0B' }} />
          <Typography sx={{ fontSize: '0.7rem', color: INK2 }}>
            Scanning all symbols for confirmed setups…
          </Typography>
        </Box>
      )}

      {!loading && fetched && data && data.items.length === 0 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.82rem', color: INK2 }}>
            No confirmed setups found across {data.total_scanned} symbols today.
          </Typography>
        </Box>
      )}

      {!loading && data && data.items.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography sx={{ fontSize: '0.6rem', color: INK2 }}>
              {data.items.length} confirmed setup{data.items.length !== 1 ? 's' : ''} across {data.total_scanned} symbols · scanned {data.scanned_at}
            </Typography>
          </Box>

          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 680 }}>
              <TableHead>
                <TableRow>
                  {['Stock', 'Pattern', 'Stage', 'Confidence', 'DNA Score', 'Success %', 'Avg 1M', 'Avg 3M', 'R:R'].map(h => (
                    <TableCell key={h} sx={{ fontSize: '0.6rem', fontWeight: 800, color: INK2, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: `1px solid ${BORDER}`, pb: 1 }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.map((item: ConfirmedFormingItem) => {
                  const catColor = CATEGORY_COLOR[item.category] ?? '#94a3b8'
                  const stageColor = STAGE_COLOR[item.stage] ?? '#94a3b8'
                  return (
                    <TableRow key={item.symbol} sx={{ '&:hover': { background: `${BORDER}40` } }}>
                      <TableCell sx={{ ...TD, py: 1.25 }}>
                        <Link to={`/stock/${item.symbol}`} style={{ textDecoration: 'none' }}>
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, fontFamily: "'IBM Plex Mono', monospace", color: CYAN, '&:hover': { color: '#93C5FD' } }}>
                            {item.symbol}
                          </Typography>
                        </Link>
                      </TableCell>

                      <TableCell sx={{ ...TD, py: 1.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: catColor, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: INK }}>
                            {item.pattern}
                          </Typography>
                        </Box>
                        <Typography sx={{ fontSize: '0.6rem', color: catColor, mt: 0.25 }}>{item.category}</Typography>
                      </TableCell>

                      <TableCell sx={{ ...TD }}>
                        <Chip label={item.stage} size="small"
                          sx={{ bgcolor: `${stageColor}15`, color: stageColor, fontSize: '0.58rem', fontWeight: 700, height: 18 }} />
                      </TableCell>

                      <TableCell sx={{ ...TD }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: BORDER, overflow: 'hidden' }}>
                            <Box sx={{ width: `${item.confidence}%`, height: '100%', bgcolor: item.confidence >= 80 ? '#22c55e' : item.confidence >= 65 ? '#f59e0b' : '#64748b', borderRadius: 2 }} />
                          </Box>
                          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: INK2, minWidth: 28 }}>{item.confidence}%</Typography>
                        </Box>
                      </TableCell>

                      <TableCell sx={{ ...TD }}>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: '#8B5CF6' }}>{item.dna_score}</Typography>
                        <Typography sx={{ fontSize: '0.58rem', color: INK2 }}>n={item.occurrences}</Typography>
                      </TableCell>

                      <TableCell sx={{ ...TD }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: INK }}>{item.success_rate.toFixed(0)}%</Typography>
                      </TableCell>

                      <TableCell sx={{ ...TD }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: retColor(item.avg_fwd_21d) }}>
                          {fmt(item.avg_fwd_21d)}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ ...TD }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: retColor(item.avg_fwd_63d) }}>
                          {fmt(item.avg_fwd_63d)}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ ...TD }}>
                        <Typography sx={{ fontSize: '0.72rem', color: INK2 }}>{item.risk_reward}</Typography>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        </>
      )}

      {!fetched && !loading && (
        <Box sx={{ py: 4, textAlign: 'center', border: `1px dashed ${BORDER}`, borderRadius: '12px' }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK2 }}>
            Click <strong style={{ color: '#F59E0B' }}>Run Scan</strong> to screen all {'{'}48{'}'} stocks
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ── Validation Report ────────────────────────────────────────────────────────

const VERDICT_COLOR: Record<string, string> = {
  VALIDATED:         '#22c55e',
  PARTIAL:           '#f59e0b',
  UNVALIDATED:       '#ef4444',
  INSUFFICIENT_DATA: '#64748b',
}
const VERDICT_LABEL: Record<string, string> = {
  VALIDATED:         'Validated',
  PARTIAL:           'Partial',
  UNVALIDATED:       'Unvalidated',
  INSUFFICIENT_DATA: 'Insufficient Data',
}

function PassChip({ value }: { value: boolean | null }) {
  const { INK3 } = usePalette()
  if (value === null) return <Typography sx={{ fontSize: '0.65rem', color: INK3 }}>—</Typography>
  return (
    <Chip
      label={value ? 'Pass' : 'Fail'}
      size="small"
      sx={{
        bgcolor: value ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
        color: value ? '#22c55e' : '#ef4444',
        fontSize: '0.6rem', fontWeight: 800, height: 18,
      }}
    />
  )
}

function ValidationSection() {
  const [report,   setReport]   = useState<ValidationReport | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [fetched,  setFetched]  = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { PAPER2, BORDER, INK, INK2, INK3, CYAN, TD } = useTokens()

  function runValidation() {
    if (loading) return
    setLoading(true)
    setRunError(null)
    patternApi.getValidation()
      .then(r => { setReport(r); setFetched(true) })
      .catch(e => {
        setReport(null)
        setFetched(true)
        setRunError((e as Error).message ?? 'Validation run failed — check server logs.')
      })
      .finally(() => setLoading(false))
  }

  const toggle = (key: string) => setExpanded(prev => prev === key ? null : key)

  return (
    <Box>
      {/* Methodology + run button */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.7 }}>
            Four-step validation suite run against real NIFTY 50 OHLCV history.
            A pattern is only shown as <strong style={{ color: '#22c55e' }}>Validated</strong> if it passes all three measurable tests.
            Results are cached until the server restarts.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
            {[
              ['Step 1', 'Min 12 occurrences required for any DNA score'],
              ['Step 2', '3yr in-sample / 2yr out-of-sample split — OOS must stay within 20% of IS'],
              ['Step 3', 'Top DNA quintile must outperform bottom by ≥2% in OOS period'],
              ['Step 4', 'Full volume confirmation must produce higher success rate than no-volume detections'],
            ].map(([step, desc]) => (
              <Box key={step} sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: '#8B5CF6', whiteSpace: 'nowrap' }}>{step}</Typography>
                <Typography sx={{ fontSize: '0.6rem', color: INK3, lineHeight: 1.5 }}>{desc}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
        <Box
          component="button"
          onClick={runValidation}
          disabled={loading}
          sx={{
            flexShrink: 0, px: 2.5, py: 1, borderRadius: '10px',
            border: '1px solid rgba(139,92,246,0.35)',
            background: loading ? 'rgba(139,92,246,0.04)' : 'rgba(139,92,246,0.08)',
            color: '#8B5CF6', fontSize: '0.72rem', fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
            '&:hover:not(:disabled)': { background: 'rgba(139,92,246,0.14)' },
          }}
        >
          {loading ? 'Running…' : fetched ? 'Re-run' : 'Run Validation'}
        </Box>
      </Box>

      {loading && (
        <Box sx={{ py: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={24} sx={{ color: '#8B5CF6' }} />
          <Typography sx={{ fontSize: '0.7rem', color: INK3 }}>
            Running validation suite — this takes 60–180 seconds…
          </Typography>
        </Box>
      )}

      {!loading && fetched && runError && (
        <Box sx={{
          p: 2, borderRadius: '12px', mb: 2,
          background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.20)',
          borderLeft: '3px solid #EF4444',
        }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#EF4444', mb: 0.5 }}>
            Validation run failed
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: INK2, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {runError}
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: INK3, mt: 1 }}>
            Check the server logs for the full traceback. Common causes: insufficient data history, or a pattern scan error.
          </Typography>
        </Box>
      )}

      {!loading && fetched && !runError && report && report.n_symbols_sufficient === 0 && (
        <Box sx={{
          p: 2, borderRadius: '12px', mb: 2,
          background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)',
          borderLeft: '3px solid #F59E0B',
        }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#F59E0B', mb: 0.5 }}>
            Insufficient history
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: INK2, lineHeight: 1.6 }}>
            {report.n_symbols_total} stocks found but none have ≥{Math.round((report.is_bars + report.oos_bars) / 252)}yr of OHLCV history
            (need {report.is_bars + report.oos_bars} bars minimum).
            Ingest more history and re-run.
          </Typography>
        </Box>
      )}

      {!loading && fetched && !runError && report && report.n_symbols_sufficient > 0 && (
        <Box>
          {/* Meta */}
          <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
            {[
              [`${report.n_symbols_sufficient} / ${report.n_symbols_total}`, 'stocks with ≥5yr history'],
              [`${report.is_bars / 252}yr / ${report.oos_bars / 252}yr`, 'IS / OOS split'],
              [`${report.min_occurrences}`, 'min occurrences for DNA score'],
              [report.generated_at, 'generated'],
            ].map(([val, label]) => (
              <Box key={label}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: INK }}>{val}</Typography>
                <Typography sx={{ fontSize: '0.58rem', color: INK3 }}>{label}</Typography>
              </Box>
            ))}
          </Box>

          {/* Summary table */}
          <Box sx={{ mb: 2.5, overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 540 }}>
              <TableHead>
                <TableRow>
                  {['Pattern', 'Step 2 OOS', 'Step 3 Decile', 'Step 4 Calibration', 'Verdict'].map(h => (
                    <TableCell key={h} sx={{ fontSize: '0.6rem', fontWeight: 800, color: INK2, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: `1px solid ${BORDER}`, pb: 1 }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {report.summary.map((s: ValidationSummary) => (
                  <TableRow key={s.pattern} sx={{ '&:hover': { background: `${BORDER}40` } }}>
                    <TableCell sx={{ ...TD, py: 1.25 }}>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: INK }}>{s.pattern}</Typography>
                    </TableCell>
                    <TableCell sx={{ ...TD }}><PassChip value={s.step2_oos} /></TableCell>
                    <TableCell sx={{ ...TD }}><PassChip value={s.step3_decile} /></TableCell>
                    <TableCell sx={{ ...TD }}><PassChip value={s.step4_calibration} /></TableCell>
                    <TableCell sx={{ ...TD }}>
                      <Chip
                        label={VERDICT_LABEL[s.verdict]}
                        size="small"
                        sx={{
                          bgcolor: `${VERDICT_COLOR[s.verdict]}15`,
                          color: VERDICT_COLOR[s.verdict],
                          fontSize: '0.6rem', fontWeight: 800, height: 20,
                          border: `1px solid ${VERDICT_COLOR[s.verdict]}30`,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          {/* Detail sections */}
          {[
            { key: 'oos', label: 'Step 2 — Out-of-Sample Results' },
            { key: 'decile', label: 'Step 3 — Decile (Quintile) Analysis' },
            { key: 'cal', label: 'Step 4 — Confidence Calibration' },
          ].map(({ key, label }) => (
            <Box key={key} sx={{ mb: 1 }}>
              <Box
                component="button"
                onClick={() => toggle(key)}
                sx={{
                  width: '100%', textAlign: 'left', px: 2, py: 1.25,
                  borderRadius: '10px', border: `1px solid ${BORDER}`,
                  background: expanded === key ? PAPER2 : 'transparent',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK }}>{label}</Typography>
                <Typography sx={{ fontSize: '0.65rem', color: INK3 }}>{expanded === key ? '▲' : '▼'}</Typography>
              </Box>

              {expanded === key && key === 'oos' && (
                <Box sx={{ mt: 1, overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 600 }}>
                    <TableHead>
                      <TableRow>
                        {['Pattern', 'IS n', 'IS SR%', 'IS Ret 21d', 'OOS n', 'OOS SR%', 'OOS Ret 21d', 'Degradation', ''].map(h => (
                          <TableCell key={h} sx={{ fontSize: '0.58rem', fontWeight: 800, color: INK2, textTransform: 'uppercase', borderBottom: `1px solid ${BORDER}` }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.oos_results.map((r: OOSSplitResult) => (
                        <TableRow key={r.pattern}>
                          <TableCell sx={{ ...TD, fontSize: '0.75rem', fontWeight: 700, color: INK, py: 1 }}>{r.pattern}</TableCell>
                          <TableCell sx={{ ...TD, fontSize: '0.72rem', color: INK2 }}>{r.is_n}</TableCell>
                          <TableCell sx={{ ...TD, fontSize: '0.72rem', color: INK }}>{r.is_success_rate}%</TableCell>
                          <TableCell sx={{ ...TD, fontSize: '0.72rem', color: retColor(r.is_avg_ret_21d) }}>{fmt(r.is_avg_ret_21d)}</TableCell>
                          <TableCell sx={{ ...TD, fontSize: '0.72rem', color: INK2 }}>{r.oos_n}</TableCell>
                          <TableCell sx={{ ...TD, fontSize: '0.72rem', color: INK }}>{r.oos_success_rate}%</TableCell>
                          <TableCell sx={{ ...TD, fontSize: '0.72rem', color: retColor(r.oos_avg_ret_21d) }}>{fmt(r.oos_avg_ret_21d)}</TableCell>
                          <TableCell sx={{ ...TD, fontSize: '0.72rem', color: r.degradation_pct > 20 ? '#ef4444' : INK2 }}>{r.degradation_pct}%</TableCell>
                          <TableCell sx={{ ...TD }}><PassChip value={r.passes} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {expanded === key && key === 'decile' && (
                <Box sx={{ mt: 1, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {report.decile_results.map((d: DecileResult) => (
                    <Box key={d.pattern} sx={{ flex: '1 1 280px' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: INK }}>{d.pattern}</Typography>
                        <PassChip value={d.passes} />
                        <Typography sx={{ fontSize: '0.6rem', color: INK3, ml: 'auto' }}>spread {d.spread_pct > 0 ? '+' : ''}{d.spread_pct}%</Typography>
                      </Box>
                      {d.rows.map((row: DecileRow) => (
                        <Box key={row.rank} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                          <Typography sx={{ fontSize: '0.6rem', color: INK2, minWidth: 100 }}>{row.rank}</Typography>
                          <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: BORDER, overflow: 'hidden' }}>
                            <Box sx={{
                              width: `${Math.min(100, Math.abs(row.oos_avg_ret_21d) * 10)}%`,
                              height: '100%', borderRadius: 3,
                              bgcolor: row.oos_avg_ret_21d >= 0 ? '#22c55e' : '#ef4444',
                            }} />
                          </Box>
                          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: retColor(row.oos_avg_ret_21d), minWidth: 48, textAlign: 'right' }}>
                            {fmt(row.oos_avg_ret_21d)}
                          </Typography>
                          <Typography sx={{ fontSize: '0.58rem', color: INK3, minWidth: 32 }}>n={row.n_detections}</Typography>
                        </Box>
                      ))}
                    </Box>
                  ))}
                </Box>
              )}

              {expanded === key && key === 'cal' && (
                <Box sx={{ mt: 1, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {report.calibration_results.map((c: CalibrationResult) => (
                    <Box key={c.pattern} sx={{ flex: '1 1 260px' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: INK }}>{c.pattern}</Typography>
                        <PassChip value={c.passes} />
                      </Box>
                      {c.bins.map((bin: ConfBin) => (
                        <Box key={bin.label} sx={{ mb: 1 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                            <Typography sx={{ fontSize: '0.6rem', color: INK2 }}>{bin.label}</Typography>
                            <Typography sx={{ fontSize: '0.6rem', color: INK3 }}>n={bin.n}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: BORDER, overflow: 'hidden' }}>
                              <Box sx={{ width: `${bin.success_rate}%`, height: '100%', borderRadius: 3, bgcolor: '#8B5CF6' }} />
                            </Box>
                            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: INK2, minWidth: 38 }}>{bin.success_rate}%</Typography>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {!fetched && !loading && (
        <Box sx={{ py: 4, textAlign: 'center', border: `1px dashed ${BORDER}`, borderRadius: '12px' }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK2 }}>
            Click <strong style={{ color: '#8B5CF6' }}>Run Validation</strong> to evaluate the pattern engine against historical data
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: INK3, mt: 0.75 }}>
            First run takes 60–180 seconds · results are cached
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ── Pattern Formation Chart ───────────────────────────────────────────────────

function PatternFormationChart({
  ohlcv, detection,
}: {
  ohlcv: OHLCVResponse
  detection: PatternDetection
}) {
  const { PAPER2, BORDER, INK2 } = usePalette()
  const catColor = CATEGORY_COLOR[detection.category] ?? '#94a3b8'

  const options = useMemo((): Highcharts.Options => {
    const candles = ohlcv.candles
    const barsToShow = Math.min(candles.length, detection.days_forming + 80)
    const sliced = candles.slice(-barsToShow)

    const ohlcData = sliced.map(c => [
      new Date(c.date).getTime(),
      c.open, c.high, c.low, c.close,
    ])

    // Formation zone: shade the last days_forming bars
    const formationStart = sliced[Math.max(0, sliced.length - 1 - detection.days_forming)]
    const formationEnd   = sliced[sliced.length - 1]
    const bandFrom = new Date(formationStart.date).getTime()
    const bandTo   = new Date(formationEnd.date).getTime()

    // Plot lines — labels positioned inside the chart (left-aligned, just right of the line)
    const plotLines: Highcharts.YAxisPlotLinesOptions[] = []
    if (detection.support_level != null) plotLines.push({
      value: detection.support_level, color: '#22c55e', dashStyle: 'Dash', width: 1,
      label: { text: `Support`, style: { color: '#22c55e', fontSize: '9px', fontWeight: '700' }, align: 'left', x: 4, y: -4 },
    })
    if (detection.resistance_level != null) plotLines.push({
      value: detection.resistance_level, color: '#ef4444', dashStyle: 'Dash', width: 1,
      label: { text: `Resistance`, style: { color: '#ef4444', fontSize: '9px', fontWeight: '700' }, align: 'left', x: 4, y: -4 },
    })
    if (detection.breakout_level != null) plotLines.push({
      value: detection.breakout_level, color: '#60A5FA', dashStyle: 'ShortDash', width: 1.5,
      label: { text: `Breakout`, style: { color: '#60A5FA', fontSize: '9px', fontWeight: '700' }, align: 'left', x: 4, y: -4 },
    })

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 300, margin: [12, 72, 28, 8] },
      title: { text: '' },
      rangeSelector: { enabled: false },
      navigator: { enabled: false },
      scrollbar: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        ...hcTheme.xAxis,
        type: 'datetime',
        labels: { ...hcTheme.xAxis.labels, style: { ...hcTheme.xAxis.labels?.style, fontSize: '10px' } },
        plotBands: [{
          from: bandFrom, to: bandTo,
          color: `${catColor}12`,
          borderColor: `${catColor}28`,
          borderWidth: 1,
          label: {
            text: detection.pattern,
            style: { color: catColor, fontSize: '10px', fontWeight: 'bold' },
            align: 'center', verticalAlign: 'top', y: 18,
          },
        }],
      },
      yAxis: {
        ...hcTheme.yAxis,
        plotLines,
        opposite: true,
        labels: {
          align: 'right',
          x: -6,
          style: { color: INK2, fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" },
          formatter(this: Highcharts.AxisLabelsFormatterContextObject) {
            const v = this.value as number
            if (v >= 1000) return `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`
            return `₹${v}`
          },
        },
      },
      tooltip: {
        ...hcTheme.tooltip,
        formatter(this: Highcharts.TooltipFormatterContextObject) {
          const p = this.point as Highcharts.Point & { open?: number; high?: number; low?: number; close?: number }
          if (p.open == null) return false
          const d = Highcharts.dateFormat('%e %b %Y', this.x as number)
          return `<b>${d}</b><br/>O: ₹${p.open?.toLocaleString('en-IN')}&nbsp; H: ₹${p.high?.toLocaleString('en-IN')}<br/>L: ₹${p.low?.toLocaleString('en-IN')}&nbsp; C: ₹${p.close?.toLocaleString('en-IN')}`
        },
      },
      series: [{
        type: 'candlestick',
        name: ohlcv.symbol,
        data: ohlcData,
        color: '#ef4444',
        upColor: '#22c55e',
        lineColor: '#ef4444',
        upLineColor: '#22c55e',
        dataGrouping: { enabled: false },
      }] as Highcharts.SeriesOptionsType[],
    }
  }, [ohlcv, detection, catColor, INK2])

  return (
    <Box sx={{
      borderRadius: '14px', overflow: 'hidden',
      bgcolor: PAPER2,
      border: `1px solid ${BORDER}`,
    }}>
      <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 3, height: 14, borderRadius: '2px', bgcolor: catColor, flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: INK2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {detection.pattern} — Formation Chart
        </Typography>
        <Chip
          label={detection.stage}
          size="small"
          sx={{ ml: 'auto', bgcolor: `${STAGE_COLOR[detection.stage] ?? '#94a3b8'}18`, color: STAGE_COLOR[detection.stage] ?? '#94a3b8', fontSize: '0.55rem', fontWeight: 700, height: 16 }}
        />
      </Box>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}


// ── Feature 3: Market Pattern Heatmap ─────────────────────────────────────────

function HeatmapTile({ cell, onSymbolClick }: { cell: HeatmapCell; onSymbolClick: (s: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const { INK, INK2, INK3, CYAN } = usePalette()
  const catColor = CATEGORY_COLOR[cell.category] ?? '#94a3b8'

  return (
    <Box sx={{
      p: 1.75, borderRadius: '14px',
      background: expanded ? `${catColor}12` : `${catColor}08`,
      border: `1px solid ${expanded ? `${catColor}40` : `${catColor}22`}`,
      minWidth: 180, flex: '1 1 180px',
      position: 'relative', overflow: 'hidden',
      transition: 'background 0.2s, border-color 0.2s',
      cursor: 'pointer',
    }}
      onClick={() => setExpanded(e => !e)}
    >
      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, bgcolor: catColor, borderRadius: '14px 0 0 14px' }} />
      <Box sx={{ pl: 1 }}>
        {/* Header row */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
          <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: INK }}>{cell.pattern}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: '50%',
              background: `${catColor}25`, border: `1px solid ${catColor}50`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 900, color: catColor }}>{cell.count}</Typography>
            </Box>
            <Typography sx={{ fontSize: '0.65rem', color: INK3, lineHeight: 1 }}>
              {expanded ? '▲' : '▼'}
            </Typography>
          </Box>
        </Box>

        <Chip label={cell.category} size="small"
          sx={{ bgcolor: `${catColor}15`, color: catColor, fontSize: '0.55rem', fontWeight: 700, height: 16, mb: 0.75 }} />
        <Typography sx={{ fontSize: '0.6rem', color: INK3, mb: 0.75 }}>
          avg confidence: {cell.avg_confidence.toFixed(0)}%
        </Typography>

        {/* Collapsed: symbol preview */}
        {!expanded && (
          <Typography sx={{ fontSize: '0.58rem', color: CYAN, lineHeight: 1.5 }}>
            {cell.symbols.slice(0, 6).join(', ')}
            {cell.symbols.length > 6 ? ` +${cell.symbols.length - 6} more` : ''}
          </Typography>
        )}

        {/* Expanded: all symbols as clickable chips */}
        {expanded && (
          <Box
            onClick={e => e.stopPropagation()}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 0.5 }}
          >
            {cell.symbols.map(sym => (
              <Box
                key={sym}
                component="button"
                onClick={() => onSymbolClick(sym)}
                sx={{
                  background: 'none', border: `1px solid ${catColor}35`,
                  borderRadius: '6px', cursor: 'pointer',
                  px: 1, py: 0.3,
                  fontSize: '0.68rem', fontWeight: 700,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: CYAN,
                  transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                  '&:hover': {
                    bgcolor: `${catColor}20`,
                    borderColor: catColor,
                    color: '#93C5FD',
                  },
                }}
              >
                {sym}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}

function MarketPatternHeatmap({ timeframe, onSymbolClick }: {
  timeframe: string; onSymbolClick: (s: string) => void
}) {
  const { BORDER, INK2, INK3 } = usePalette()
  const [data, setData] = useState<PatternHeatmapResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    patternApi.getHeatmap(timeframe)
      .then(setData)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [timeframe])

  if (loading) {
    return (
      <Box sx={{ height: 180, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Scanning all stocks for active patterns…</Typography>
      </Box>
    )
  }

  if (error) return <Alert severity="error">{error}</Alert>

  if (!data || data.cells.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center', border: `1px dashed ${BORDER}`, borderRadius: '12px' }}>
        <Typography sx={{ fontSize: '0.78rem', color: INK2 }}>No patterns active across {data?.total_symbols ?? 0} stocks right now.</Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5 }}>
        <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#14B8A6', textTransform: 'uppercase' }}>
          {data.patterns_active} pattern{data.patterns_active !== 1 ? 's' : ''} active across {data.total_symbols} stocks
        </Typography>
        <Typography sx={{ fontSize: '0.58rem', color: INK3 }}>scanned {data.scanned_at}</Typography>
        <Typography sx={{ fontSize: '0.58rem', color: INK3, ml: 'auto' }}>click tile to expand stocks</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        {data.cells.map((cell: HeatmapCell) => (
          <HeatmapTile key={cell.pattern} cell={cell} onSymbolClick={onSymbolClick} />
        ))}
      </Box>
    </Box>
  )
}

// ── Feature 2: Breakout Tracker ────────────────────────────────────────────────

function BreakoutTracker() {
  const [data, setData] = useState<BreakoutTrackerResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [daysBack, setDaysBack] = useState(60)
  const { PAPER2, BORDER, INK, INK2, INK3, CYAN, INPUT_SX, TD } = useTokens()

  function load() {
    setLoading(true)
    patternApi.getBreakoutTracker(daysBack)
      .then(d => { setData(d); setFetched(true) })
      .catch(() => { setData(null); setFetched(true) })
      .finally(() => setLoading(false))
  }

  const STATUS_COLOR: Record<string, string> = {
    Confirmed: '#22c55e',
    Forming:   '#f59e0b',
    Failed:    '#ef4444',
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.6 }}>
            Patterns detected in the last{' '}
            <strong style={{ color: INK }}>{daysBack} trading days</strong>{' '}
            — track which confirmed, which failed, which are still forming.
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 100 }}>
          <Select
            value={daysBack}
            onChange={e => setDaysBack(Number(e.target.value))}
            sx={{ ...INPUT_SX, fontSize: '0.72rem' }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {[30, 45, 60, 90].map(v => (
              <MenuItem key={v} value={v} sx={{ fontSize: '0.72rem' }}>{v}d</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box
          component="button"
          onClick={load}
          disabled={loading}
          sx={{
            flexShrink: 0, px: 2.5, py: 1, borderRadius: '10px',
            border: '1px solid rgba(20,184,166,0.35)',
            background: loading ? 'rgba(20,184,166,0.04)' : 'rgba(20,184,166,0.08)',
            color: '#14B8A6', fontSize: '0.72rem', fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
            '&:hover:not(:disabled)': { background: 'rgba(20,184,166,0.14)', borderColor: 'rgba(20,184,166,0.55)' },
          }}
        >
          {loading ? 'Scanning…' : fetched ? 'Re-scan' : 'Run Scan'}
        </Box>
      </Box>

      {loading && (
        <Box sx={{ py: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={24} sx={{ color: '#14B8A6' }} />
          <Typography sx={{ fontSize: '0.7rem', color: INK3 }}>Scanning all symbols for recent pattern setups…</Typography>
        </Box>
      )}

      {!fetched && !loading && (
        <Box sx={{ py: 4, textAlign: 'center', border: `1px dashed ${BORDER}`, borderRadius: '12px' }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK2 }}>
            Click <strong style={{ color: '#14B8A6' }}>Run Scan</strong> to track recent pattern setups
          </Typography>
        </Box>
      )}

      {!loading && fetched && data && data.items.length === 0 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.82rem', color: INK2 }}>
            No pattern setups found in the last {data.days_back} days.
          </Typography>
        </Box>
      )}

      {!loading && data && data.items.length > 0 && (
        <>
          <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
            {(['Confirmed', 'Forming', 'Failed'] as const).map(status => {
              const cnt = data.items.filter(i => i.status === status).length
              const color = STATUS_COLOR[status]
              return (
                <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color }}>{status}</Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: INK3 }}>{cnt}</Typography>
                </Box>
              )
            })}
            <Typography sx={{ fontSize: '0.58rem', color: INK3, ml: 'auto' }}>scanned {data.scanned_at}</Typography>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow>
                  {['Symbol', 'Pattern', 'Detected', 'Days', 'Entry ₹', 'Current ₹', 'Change', 'Status'].map(h => (
                    <TableCell key={h} sx={{ fontSize: '0.6rem', fontWeight: 700, color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', borderColor: BORDER, py: 0.75 }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.map((item, i) => {
                  const catColor = CATEGORY_COLOR[item.category] ?? '#94a3b8'
                  const statusColor = STATUS_COLOR[item.status] ?? '#94a3b8'
                  return (
                    <TableRow key={i} sx={{ '&:hover': { bgcolor: `${BORDER}40` } }}>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Link to={`/stock/${item.symbol}`} style={{ textDecoration: 'none' }}>
                          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: CYAN, '&:hover': { color: '#93C5FD' } }}>
                            {item.symbol}
                          </Typography>
                        </Link>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: catColor, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: INK }}>{item.pattern}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', color: INK2 }}>{item.detected_date}</Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', color: INK2 }}>{item.days_since}d</Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace", color: INK2 }}>
                          ₹{item.entry_price.toLocaleString('en-IN')}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace", color: INK2 }}>
                          ₹{item.current_price.toLocaleString('en-IN')}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: retColor(item.change_pct) }}>
                          {fmt(item.change_pct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, py: 1 }}>
                        <Chip label={item.status} size="small"
                          sx={{ bgcolor: `${statusColor}18`, color: statusColor, fontSize: '0.58rem', fontWeight: 700, height: 18 }} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        </>
      )}
    </Box>
  )
}

// ── Feature 5: Pattern Failure Analysis ───────────────────────────────────────

function PatternFailureAnalysis() {
  const { PAPER2, BORDER, INK, INK2, INK3, CYAN, INPUT_SX, TD } = useTokens()
  const [pattern, setPattern] = useState('Double Bottom')
  const [data, setData] = useState<PatternFailureResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    setData(null)
    setFetched(false)
  }, [pattern])

  function load() {
    setLoading(true)
    patternApi.getFailures(pattern)
      .then(d => { setData(d); setFetched(true) })
      .catch(() => { setData(null); setFetched(true) })
      .finally(() => setLoading(false))
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.6 }}>
            Which stocks <strong style={{ color: '#ef4444' }}>consistently fail</strong> a given pattern —
            failing setups is as important as finding good ones.
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <Select
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            sx={{ ...INPUT_SX, fontSize: '0.78rem', fontWeight: 700 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {SCREENER_PATTERNS.map(p => (
              <MenuItem key={p} value={p} sx={{ fontSize: '0.78rem' }}>{p}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box
          component="button"
          onClick={load}
          disabled={loading}
          sx={{
            flexShrink: 0, px: 2.5, py: 1, borderRadius: '10px',
            border: '1px solid rgba(239,68,68,0.35)',
            background: loading ? 'rgba(239,68,68,0.04)' : 'rgba(239,68,68,0.08)',
            color: '#ef4444', fontSize: '0.72rem', fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
            '&:hover:not(:disabled)': { background: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.55)' },
          }}
        >
          {loading ? 'Scanning…' : fetched ? 'Re-scan' : 'Run Scan'}
        </Box>
      </Box>

      {loading && (
        <Box sx={{ py: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={24} sx={{ color: '#ef4444' }} />
          <Typography sx={{ fontSize: '0.7rem', color: INK3 }}>Analysing failure patterns across all symbols…</Typography>
        </Box>
      )}

      {!fetched && !loading && (
        <Box sx={{ py: 4, textAlign: 'center', border: `1px dashed ${BORDER}`, borderRadius: '12px' }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK2 }}>
            Select a pattern and click <strong style={{ color: '#ef4444' }}>Run Scan</strong>
          </Typography>
        </Box>
      )}

      {!loading && fetched && data && data.items.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
          No stocks with enough history ({'>'}= 6 occurrences) for {pattern}.
        </Typography>
      )}

      {!loading && data && data.items.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {['Rank', 'Stock', 'Failure Rate', 'Occurrences', 'Avg Return', 'Avg Loss', 'DNA Score'].map(h => (
                  <TableCell key={h} sx={{ color: INK3, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', borderColor: BORDER, py: 0.75 }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.map((item, i) => {
                const isHighFailure = item.failure_rate > 0.7
                return (
                  <TableRow key={item.symbol} sx={{
                    '&:hover': { bgcolor: `${BORDER}40` },
                    bgcolor: isHighFailure ? 'rgba(239,68,68,0.04)' : 'transparent',
                  }}>
                    <TableCell sx={{ ...TD, py: 1 }}>
                      <Typography sx={{ fontSize: '0.65rem', color: INK3, fontWeight: 700 }}>#{i + 1}</Typography>
                    </TableCell>
                    <TableCell sx={{ ...TD, py: 1 }}>
                      <Link to={`/stock/${item.symbol}`} style={{ textDecoration: 'none' }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: CYAN, '&:hover': { color: '#93C5FD' } }}>
                          {item.symbol}
                        </Typography>
                      </Link>
                    </TableCell>
                    <TableCell sx={{ ...TD, py: 1 }}>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: item.failure_rate > 0.7 ? '#ef4444' : item.failure_rate > 0.5 ? '#f59e0b' : INK2 }}>
                        {(item.failure_rate * 100).toFixed(0)}%
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ ...TD, py: 1 }}>
                      <Typography sx={{ fontSize: '0.65rem', color: INK2 }}>n={item.occurrences}</Typography>
                    </TableCell>
                    <TableCell sx={{ ...TD, py: 1 }}>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: retColor(item.avg_fwd_21d) }}>
                        {fmt(item.avg_fwd_21d)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ ...TD, py: 1 }}>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#ef4444' }}>
                        {item.avg_loss !== 0 ? fmt(item.avg_loss) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ ...TD, py: 1 }}>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: '#8B5CF6' }}>{item.dna_score}</Typography>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  )
}

// ── Feature 4: Regime DNA (embedded inside PatternGenome) ────────────────────

function RegimeDNA({ symbol }: { symbol: string }) {
  const [data, setData] = useState<RegimeDNAResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    patternApi.getRegimeDNA(symbol)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [symbol])

  const { BORDER, INK, INK2, INK3, TD } = useTokens()

  const REGIME_COLOR: Record<string, string> = {
    Bull:     '#22c55e',
    Sideways: '#f59e0b',
    Bear:     '#ef4444',
  }

  if (loading) {
    return (
      <Box sx={{ py: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={18} />
        <Typography sx={{ fontSize: '0.68rem', color: INK3 }}>Loading regime analysis…</Typography>
      </Box>
    )
  }

  if (!data || data.entries.length === 0) {
    return (
      <Typography sx={{ fontSize: '0.68rem', color: INK3, py: 1.5 }}>
        Insufficient data for regime-conditioned analysis.
      </Typography>
    )
  }

  return (
    <Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ color: INK3, fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', borderColor: BORDER, py: 0.75 }}>Pattern</TableCell>
              {(['Bull', 'Sideways', 'Bear'] as const).map(r => (
                <TableCell key={r} colSpan={3} align="center" sx={{ color: REGIME_COLOR[r], fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', borderColor: BORDER, py: 0.75 }}>
                  {r}
                </TableCell>
              ))}
              <TableCell sx={{ color: INK3, fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', borderColor: BORDER, py: 0.75 }}>Best</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ borderColor: BORDER, py: 0.5 }} />
              {(['Bull', 'Sideways', 'Bear'] as const).flatMap(r => ([
                <TableCell key={`${r}-n`} sx={{ color: INK3, fontSize: '0.55rem', borderColor: BORDER, py: 0.5 }}>n</TableCell>,
                <TableCell key={`${r}-sr`} sx={{ color: INK3, fontSize: '0.55rem', borderColor: BORDER, py: 0.5 }}>SR%</TableCell>,
                <TableCell key={`${r}-ret`} sx={{ color: INK3, fontSize: '0.55rem', borderColor: BORDER, py: 0.5 }}>Ret%</TableCell>,
              ]))}
              <TableCell sx={{ borderColor: BORDER, py: 0.5 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {data.entries.map((entry: RegimeDNAEntry) => {
              const buckets = { Bull: entry.bull, Sideways: entry.sideways, Bear: entry.bear }
              return (
                <TableRow key={entry.pattern} sx={{ '&:hover': { bgcolor: `${BORDER}40` } }}>
                  <TableCell sx={{ ...TD, py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CATEGORY_COLOR[entry.category] ?? '#94a3b8', flexShrink: 0 }} />
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: INK }}>{entry.pattern}</Typography>
                    </Box>
                  </TableCell>
                  {(['Bull', 'Sideways', 'Bear'] as const).flatMap(r => {
                    const bkt = buckets[r]
                    const hasData = bkt.n >= 3
                    const color = REGIME_COLOR[r]
                    return [
                      <TableCell key={`${entry.pattern}-${r}-n`} sx={{ borderColor: BORDER, py: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', color: hasData ? INK2 : INK3 }}>{bkt.n}</Typography>
                      </TableCell>,
                      <TableCell key={`${entry.pattern}-${r}-sr`} sx={{ borderColor: BORDER, py: 1 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: hasData ? 700 : 400, color: hasData ? (bkt.success_rate >= 60 ? color : INK3) : INK3 }}>
                          {hasData ? `${bkt.success_rate.toFixed(0)}%` : '—'}
                        </Typography>
                      </TableCell>,
                      <TableCell key={`${entry.pattern}-${r}-ret`} sx={{ borderColor: BORDER, py: 1 }}>
                        <Typography sx={{ fontSize: '0.65rem', color: hasData ? retColor(bkt.avg_ret_21d) : INK3 }}>
                          {hasData ? fmt(bkt.avg_ret_21d) : '—'}
                        </Typography>
                      </TableCell>,
                    ]
                  })}
                  <TableCell sx={{ borderColor: BORDER, py: 1 }}>
                    <Chip
                      label={entry.best_regime}
                      size="small"
                      sx={{ bgcolor: `${REGIME_COLOR[entry.best_regime] ?? '#94a3b8'}18`, color: REGIME_COLOR[entry.best_regime] ?? '#94a3b8', fontSize: '0.55rem', fontWeight: 700, height: 16 }}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
      <Typography sx={{ fontSize: '0.58rem', color: INK3, mt: 1.5, lineHeight: 1.6 }}>
        Regime at detection time: Bull = price {'>'} SMA200 · Bear = price {'<'} SMA50 · Sideways = between them.
        Only shown when ≥ 3 detections per bucket.
      </Typography>
    </Box>
  )
}

// ── Feature 1: Pattern History Timeline (embedded inside PatternGenome) ───────

function PatternHistoryTimeline({ symbol, timeframe }: { symbol: string; timeframe: string }) {
  const { PAPER2, BORDER, INK, INK2, INK3 } = usePalette()
  const [data, setData] = useState<PatternHistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    patternApi.getHistory(symbol, timeframe)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [symbol, timeframe])

  const OUTCOME_COLOR: Record<string, string> = {
    Win:     '#22c55e',
    Loss:    '#ef4444',
    Pending: '#64748b',
  }

  const stats = useMemo(() => {
    if (!data) return null
    const resolved = data.items.filter(i => i.outcome !== 'Pending')
    const wins = resolved.filter(i => i.outcome === 'Win').length
    const winRate = resolved.length > 0 ? Math.round(wins / resolved.length * 100) : 0
    return { total: data.items.length, resolved: resolved.length, wins, winRate }
  }, [data])

  // Group items by month
  const grouped = useMemo(() => {
    if (!data) return []
    const map: Record<string, PatternHistoryItem[]> = {}
    for (const item of data.items) {
      const key = item.date.slice(0, 7) // YYYY-MM
      if (!map[key]) map[key] = []
      map[key].push(item)
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [data])

  if (loading) {
    return (
      <Box sx={{ py: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={18} />
        <Typography sx={{ fontSize: '0.68rem', color: INK3 }}>Loading pattern history…</Typography>
      </Box>
    )
  }

  if (!data || data.items.length === 0) {
    return (
      <Typography sx={{ fontSize: '0.68rem', color: INK3, py: 1.5 }}>
        No historical detections found with sufficient forward-return data.
      </Typography>
    )
  }

  return (
    <Box>
      {/* Summary bar */}
      {stats && (
        <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: INK }}>{stats.total}</Typography>
            <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>total detections</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: '#22c55e' }}>{stats.winRate}%</Typography>
            <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>win rate (resolved)</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: INK3 }}>{stats.total - stats.resolved}</Typography>
            <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>pending</Typography>
          </Box>
        </Box>
      )}

      {/* Scrollable timeline */}
      <Box sx={{ maxHeight: 400, overflowY: 'auto', pr: 0.5 }}>
        {grouped.map(([month, monthItems]) => (
          <Box key={month} sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 0.75 }}>
              {new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </Typography>
            {monthItems.map((item, idx) => {
              const catColor = CATEGORY_COLOR[item.category] ?? '#94a3b8'
              const outcomeColor = OUTCOME_COLOR[item.outcome] ?? '#94a3b8'
              return (
                <Box key={idx} sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  py: 0.75, px: 1.25,
                  mb: 0.5, borderRadius: '10px',
                  bgcolor: PAPER2,
                  border: `1px solid ${BORDER}`,
                  '&:hover': { background: `${BORDER}60` },
                }}>
                  <Typography sx={{ fontSize: '0.6rem', color: INK3, minWidth: 72, fontFamily: "'IBM Plex Mono', monospace" }}>
                    {item.date}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: catColor, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: INK2 }}>{item.pattern}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }} />
                  <Chip
                    label={item.outcome}
                    size="small"
                    sx={{ bgcolor: `${outcomeColor}18`, color: outcomeColor, fontSize: '0.55rem', fontWeight: 700, height: 16 }}
                  />
                  {item.fwd_21d != null ? (
                    <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: retColor(item.fwd_21d), minWidth: 52, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      {fmt(item.fwd_21d)}
                    </Typography>
                  ) : (
                    <Typography sx={{ fontSize: '0.65rem', color: INK3, minWidth: 52, textAlign: 'right' }}>—</Typography>
                  )}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Pattern Genome ────────────────────────────────────────────────────────────

function PatternGenome({ symbols, timeframe, symbol, setSymbol }: {
  symbols: string[]; timeframe: string; symbol: string; setSymbol: (s: string) => void
}) {
  const { PAPER2, BORDER, INK, INK2, INK3, CYAN, INPUT_SX } = useTokens()
  const [dna, setDna] = useState<PatternDNAResponse | null>(null)
  const [active, setActive] = useState<PatternDetection[]>([])
  const [ohlcv, setOhlcv] = useState<OHLCVResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    Promise.all([
      patternApi.getDNA(symbol).catch(() => null),
      patternApi.getDetect(symbol, timeframe).catch(() => []),
      stockApi.getOHLCV(symbol).catch(() => null),
    ]).then(([dnaData, detectData, ohlcvData]) => {
      setDna(dnaData)
      setActive(detectData ?? [])
      setOhlcv(ohlcvData)
    }).finally(() => setLoading(false))
  }, [symbol, timeframe])

  const genomeColors: Record<string, string> = {
    'Bullish Reversal':    '#22c55e',
    'Bullish Continuation':'#4ade80',
    'Bearish Reversal':    '#ef4444',
    'Bearish Continuation':'#f87171',
    'Neutral':             '#f59e0b',
  }

  return (
    <Box>
      {/* Stock selector */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography sx={{ fontSize: '0.73rem', color: INK2, fontWeight: 600 }}>
          Pattern genome for:
        </Typography>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <Select
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            sx={{ ...INPUT_SX, fontSize: '0.78rem', fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {symbols.map(s => (
              <MenuItem key={s} value={s} sx={{ fontSize: '0.78rem', fontFamily: "'IBM Plex Mono', monospace" }}>{s}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Link to={`/stock/${symbol}`} style={{ textDecoration: 'none' }}>
          <Typography sx={{ fontSize: '0.72rem', color: CYAN, fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}>
            Full analysis →
          </Typography>
        </Link>
      </Box>

      {loading && (
        <Box sx={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexDirection: 'column' }}>
          <CircularProgress size={24} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Computing pattern profile…</Typography>
        </Box>
      )}

      {!loading && (
        <Box>

          {/* Top row: Forming Now cards + Chart */}
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: active.length > 0 && ohlcv ? 3 : 0 }}>

            {/* Left: Currently Forming */}
            <Box sx={{ flex: '0 0 auto', width: { xs: '100%', md: 300 } }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.14em', color: '#F59E0B', textTransform: 'uppercase', mb: 1.5 }}>
                Forming Right Now
              </Typography>

              {active.length === 0 ? (
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '1.4rem', mb: 0.5 }}>—</Typography>
                  <Typography sx={{ fontSize: '0.7rem', color: INK2 }}>
                    No chart patterns detected<br />in the current price structure
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                  {active.map((p, i) => {
                    const catColor = CATEGORY_COLOR[p.category] ?? '#94a3b8'
                    const stageColor = STAGE_COLOR[p.stage] ?? '#94a3b8'
                    return (
                      <Box key={i} sx={{
                        p: 1.75, borderRadius: '14px',
                        background: `${catColor}08`,
                        border: `1px solid ${catColor}22`,
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {/* Accent bar */}
                        <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, bgcolor: catColor, borderRadius: '14px 0 0 14px' }} />

                      <Box sx={{ pl: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: INK }}>
                            {p.pattern}
                          </Typography>
                          <ConfRing value={p.confidence} />
                        </Box>

                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
                          <Chip label={p.category} size="small"
                            sx={{ bgcolor: `${catColor}15`, color: catColor, fontSize: '0.55rem', fontWeight: 700, height: 16 }} />
                          <Chip label={p.stage} size="small"
                            sx={{ bgcolor: `${stageColor}15`, color: stageColor, fontSize: '0.55rem', fontWeight: 700, height: 16 }} />
                          <Chip label={`${p.days_forming}d forming`} size="small"
                            sx={{ bgcolor: BORDER, color: INK2, fontSize: '0.55rem', height: 16 }} />
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2 }}>
                          {p.breakout_level != null && (
                            <Box>
                              <Typography sx={{ fontSize: '0.55rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Breakout</Typography>
                              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#22c55e', fontFamily: "'IBM Plex Mono', monospace" }}>
                                ₹{p.breakout_level.toLocaleString('en-IN')}
                              </Typography>
                            </Box>
                          )}
                          {p.support_level != null && (
                            <Box>
                              <Typography sx={{ fontSize: '0.55rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Support</Typography>
                              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b', fontFamily: "'IBM Plex Mono', monospace" }}>
                                ₹{p.support_level.toLocaleString('en-IN')}
                              </Typography>
                            </Box>
                          )}
                          <Box>
                            <Typography sx={{ fontSize: '0.55rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>R:R</Typography>
                            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK2 }}>{p.risk_reward}</Typography>
                          </Box>
                        </Box>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            )}
          </Box>

            {/* Right: Formation Chart (only when pattern detected) */}
            {active.length > 0 && ohlcv && (
              <Box sx={{ flex: 1, minWidth: 300 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.14em', color: '#14B8A6', textTransform: 'uppercase', mb: 1.5 }}>
                  Pattern Formation
                </Typography>
                <PatternFormationChart ohlcv={ohlcv} detection={active[0]} />
              </Box>
            )}

          </Box>

          {/* Bottom: Historical DNA bars (always visible) */}
          <Box>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.14em', color: '#8B5CF6', textTransform: 'uppercase', mb: 1.5 }}>
              Historical DNA
            </Typography>

            {dna && dna.dna.length > 0 ? (
              <>
                {dna.best_pattern && (
                  <Box sx={{ mb: 2, p: 1.25, borderRadius: '10px', background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box>
                      <Typography sx={{ fontSize: '0.55rem', color: '#8B5CF6', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Best Pattern</Typography>
                      <Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: INK }}>{dna.best_pattern}</Typography>
                    </Box>
                    <Box sx={{ ml: 'auto', textAlign: 'right' }}>
                      <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, color: '#8B5CF6', lineHeight: 1 }}>{dna.best_score}</Typography>
                      <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>/ 100</Typography>
                    </Box>
                  </Box>
                )}

                {dna.dna.map(entry => (
                  <GenomeBar
                    key={entry.pattern}
                    label={`${entry.pattern} — ${entry.success_rate.toFixed(0)}% success · avg ${entry.avg_fwd_21d > 0 ? '+' : ''}${entry.avg_fwd_21d.toFixed(1)}% (1M) · n=${entry.occurrences}`}
                    score={entry.dna_score}
                    color={genomeColors[entry.category] ?? '#64748b'}
                  />
                ))}

                <Typography sx={{ fontSize: '0.58rem', color: INK3, mt: 2, lineHeight: 1.6 }}>
                  DNA Score = success rate × return magnitude × consistency.
                  Higher = this stock has responded more reliably to that pattern historically.
                </Typography>

                {/* Feature 4: Regime DNA */}
                <Box sx={{ mt: 3, pt: 2.5, borderTop: `1px solid ${BORDER}` }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.14em', color: '#60A5FA', textTransform: 'uppercase', mb: 1.5 }}>
                    Regime-Conditioned DNA
                  </Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: INK3, mb: 1.5, lineHeight: 1.5 }}>
                    Does this pattern work better in Bull, Sideways, or Bear markets for this stock?
                  </Typography>
                  <RegimeDNA symbol={symbol} />
                </Box>

                {/* Feature 1: Pattern History Timeline */}
                <Box sx={{ mt: 3, pt: 2.5, borderTop: `1px solid ${BORDER}` }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.14em', color: '#F59E0B', textTransform: 'uppercase', mb: 1.5 }}>
                    Pattern History Timeline
                  </Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: INK3, mb: 1.5, lineHeight: 1.5 }}>
                    Every past detection with its actual forward-return outcome.
                  </Typography>
                  <PatternHistoryTimeline symbol={symbol} timeframe={timeframe} />
                </Box>
              </>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
                Insufficient price history to compute DNA.
              </Typography>
            )}
          </Box>

        </Box>
      )}
    </Box>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PatternDNAPage() {
  const [scanner, setScanner] = useState<PatternScannerResponse | null>(null)
  const [scannerLoading, setScannerLoading] = useState(true)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [symbols, setSymbols] = useState<string[]>([])
  const [timeframe, setTimeframe] = useState<string>('daily')
  const [genomeSymbol, setGenomeSymbol] = useState<string>('RELIANCE')
  const { BG, BORDER, INK, INK2, INK3, CYAN } = usePalette()
  const { mode } = useThemeMode()

  function openInGenome(symbol: string) {
    setGenomeSymbol(symbol)
    setTimeout(() => {
      document.getElementById('pattern-genome')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  useEffect(() => {
    setScannerLoading(true)
    patternApi.getScanner(timeframe)
      .then(data => {
        setScanner(data)
        const syms = [...new Set(data.items.map(i => i.symbol))].sort()
        setSymbols(syms.length > 0 ? syms : ['RELIANCE'])
      })
      .catch(e => setScannerError((e as Error).message))
      .finally(() => setScannerLoading(false))
  }, [timeframe])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>

      <Navbar />

      <Box sx={{
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        pt: 5, pb: 4, px: { xs: 2.5, md: 5 },
      }}>
        <Box sx={{ px: 1.5, py: 0.4, borderRadius: '20px', display: 'inline-block',
          border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}10`, mb: 2 }}>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: CYAN,
            letterSpacing: '0.12em', fontFamily: "'IBM Plex Sans', sans-serif" }}>
            PATTERN RESEARCH · STATISTICAL EDGE
          </Typography>
        </Box>
        <Typography sx={{ fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 900,
          color: INK, letterSpacing: '-0.02em', lineHeight: 1.1, mb: 1,
          fontFamily: "'IBM Plex Sans Condensed', sans-serif" }}>
          Pattern <span style={{ color: CYAN }}>DNA</span>
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: INK2, maxWidth: 520,
          fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Chart pattern detection, historical validation, and regime-conditioned DNA scoring for NIFTY 50.
        </Typography>
      </Box>

      {/* Timeframe toggle */}
      <Box sx={{ px: { xs: 2.5, md: 8, lg: 12 }, pb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: INK3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Timeframe
          </Typography>
          <ToggleButtonGroup
            value={timeframe}
            exclusive
            onChange={(_e, v) => { if (v) setTimeframe(v) }}
            size="small"
            sx={{
              '& .MuiToggleButton-root': {
                px: 2, py: 0.5,
                fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em',
                color: INK3, border: `1px solid ${BORDER}`,
                textTransform: 'uppercase',
                '&.Mui-selected': { color: CYAN, bgcolor: `${CYAN}15`, borderColor: `${CYAN}40` },
              },
            }}
          >
            <ToggleButton value="daily">Daily</ToggleButton>
            <ToggleButton value="weekly">Weekly</ToggleButton>
          </ToggleButtonGroup>
          {timeframe === 'weekly' && (
            <Typography sx={{ fontSize: '0.65rem', color: INK2 }}>
              Weekly bars — structural patterns, longer timeframes
            </Typography>
          )}
      </Box>

      <Container maxWidth="xl" sx={{ pb: 6 }}>
        {scannerError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setScannerError(null)}>
            {scannerError}
          </Alert>
        )}

        {/* Active Pattern Scanner */}
        <Section title="Active Pattern Scanner" accent="#60A5FA">
          <Box mb={2}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#60A5FA', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
              Live Detection
            </Typography>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: INK, mb: 0.5 }}>
              Patterns Forming Today
            </Typography>
            <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5 }}>
              Real-time scan across all NIFTY 50 stocks — click any symbol to jump to its Pattern Genome
            </Typography>
          </Box>
          <PatternScanner data={scanner} loading={scannerLoading} onSymbolClick={openInGenome} />
        </Section>

        {/* Feature 3: Market Pattern Heatmap */}
        <Section title="Market Pattern Heatmap" accent="#14B8A6">
          <Box mb={2}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#14B8A6', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
              Market Structure
            </Typography>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: INK, mb: 0.5 }}>
              Pattern Clustering Right Now
            </Typography>
            <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5 }}>
              If 8 stocks are forming Bull Flags simultaneously, that tells you something about market structure
            </Typography>
          </Box>
          <MarketPatternHeatmap timeframe={timeframe} onSymbolClick={openInGenome} />
        </Section>

        {/* Pattern Screener */}
        <Section title="Pattern Screener" accent="#8B5CF6">
          <Box mb={2}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#8B5CF6', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
              Historical DNA
            </Typography>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: INK, mb: 0.5 }}>
              Best Stocks for Each Pattern
            </Typography>
            <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5 }}>
              Ranks stocks by how reliably they have responded to a pattern historically — success rate × return magnitude × consistency
            </Typography>
          </Box>
          <PatternScreener onSymbolClick={openInGenome} />
        </Section>

        {/* Feature 5: Pattern Failure Analysis */}
        <Section title="Pattern Failure Analysis" accent="#ef4444">
          <Box mb={2}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#ef4444', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
              Failure Intelligence
            </Typography>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: INK, mb: 0.5 }}>
              Stocks That Consistently Fail Each Pattern
            </Typography>
            <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5 }}>
              Knowing which setups to avoid is as important as knowing which ones to take
            </Typography>
          </Box>
          <PatternFailureAnalysis />
        </Section>

        {/* Confirmed Forming Screener */}
        <Section title="Confirmed Forming Setups" accent="#F59E0B">
          <Box mb={2}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#F59E0B', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
              High-Conviction Screener
            </Typography>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: INK, mb: 0.5 }}>
              Best Pattern Forming Right Now
            </Typography>
          </Box>
          <ConfirmedFormingScreener timeframe={timeframe} />
        </Section>

        {/* Feature 2: Breakout Tracker */}
        <Section title="Breakout Tracker" accent="#14B8A6">
          <Box mb={2}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#14B8A6', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
              Setup Lifecycle
            </Typography>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: INK, mb: 0.5 }}>
              Recent Setups — Confirmed, Forming, Failed
            </Typography>
            <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5 }}>
              Patterns detected in the last N trading days — track which confirmed, which failed, which are still forming
            </Typography>
          </Box>
          <BreakoutTracker />
        </Section>

        {/* Validation Report */}
        <Section title="Validation Report" accent="#8B5CF6">
          <Box mb={2}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#8B5CF6', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
              Evidence-Based QA
            </Typography>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: INK, mb: 0.5 }}>
              Does the Pattern Engine Actually Work?
            </Typography>
            <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5 }}>
              Four-step validation against 5 years of NIFTY 50 daily OHLCV.
              A pattern earns "Validated" only when it passes all measurable tests.
            </Typography>
          </Box>
          <ValidationSection />
        </Section>

        {/* Pattern Genome */}
        <Box id="pattern-genome" sx={{ scrollMarginTop: '72px' }}>
          <Section title="Pattern Genome" accent="#14B8A6">
            <Box mb={2}>
              <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.18em', color: '#14B8A6', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
                Stock Fingerprint
              </Typography>
              <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em', color: INK, mb: 0.5 }}>
                Unique Pattern Behavioral Profile
              </Typography>
              <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5 }}>
                Each stock develops unique characteristics — see which patterns this stock responds to best and worst
              </Typography>
            </Box>
            {symbols.length > 0
              ? <PatternGenome symbols={symbols} timeframe={timeframe} symbol={genomeSymbol} setSymbol={setGenomeSymbol} />
              : <Box sx={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CircularProgress size={20} />
                </Box>
            }
          </Section>
        </Box>
      </Container>
      <Footer />
    </Box>
  )
}
