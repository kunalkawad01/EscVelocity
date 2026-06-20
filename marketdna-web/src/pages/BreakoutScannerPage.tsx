import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Typography } from '@mui/material'
import FilterChip from '../components/shared/FilterChip'
import SearchBox from '../components/shared/SearchBox'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { breakoutApi } from '../api/breakoutApi'
import type { BreakoutRow } from '../api/breakoutApi'

ModuleRegistry.registerModules([AllCommunityModule])

// ── IST market hours helper ───────────────────────────────────────────────────
function getISTDate(): Date {
  const now = new Date()
  // Convert to IST (UTC+5:30)
  return new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60000)
}

function isMarketOpen(): boolean {
  const ist = getISTDate()
  const day = ist.getDay()            // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false
  const h = ist.getHours(), m = ist.getMinutes()
  const mins = h * 60 + m
  return mins >= 9 * 60 + 15 && mins < 15 * 60 + 30
}

// ── Cell renderer helpers ─────────────────────────────────────────────────────
type P<T = unknown> = ICellRendererParams<BreakoutRow, T>

const fmt = (v: number | null | undefined, dp = 0) =>
  v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: dp })

function TickerRenderer({ data }: P) {
  if (!data) return null
  const up = data.change_pct >= 0
  const color = up ? '#22c55e' : '#ef4444'
  return (
    <div style={{ lineHeight: 1.3, paddingTop: 6 }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '0.8rem', color: 'var(--bk-ink)' }}>
        {data.symbol}
      </div>
      <div style={{ fontSize: '0.65rem', marginTop: 2, color }}>
        {up ? '+' : ''}{data.change_pct.toFixed(2)}%
      </div>
    </div>
  )
}

function LTPRenderer({ data }: P) {
  if (!data) return null
  return (
    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.8rem', fontWeight: 600, color: 'var(--bk-ink)' }}>
      {fmt(data.live_price, 2)}
    </div>
  )
}

function ScoreRenderer({ data }: P) {
  if (!data) return null
  const s = data.score
  const color = s >= 7 ? '#22c55e' : s >= 4 ? '#fbbf24' : s >= 1 ? 'var(--bk-cyan)' : 'var(--bk-ink3)'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '2px 8px', borderRadius: 5,
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', fontWeight: 700, color,
    }}>
      {s}/9
    </div>
  )
}

function SparklineRenderer({ data }: P) {
  if (!data?.closes_20?.length) return null
  const prices = data.closes_20
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const W = 100, H = 34
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W
    const y = H - ((p - min) / range) * (H - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const isUp = prices[prices.length - 1] >= prices[0]
  const color = isUp ? '#22c55e' : '#ef4444'
  const fillId = `sf-${data.symbol}`
  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${H} ${pts} ${W},${H}`}
        fill={`url(#${fillId})`}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={parseFloat(pts.split(' ').pop()!.split(',')[0])}
        cy={parseFloat(pts.split(' ').pop()!.split(',')[1])}
        r={2.5}
        fill={color}
      />
    </svg>
  )
}

function DaySparkRenderer({ data }: P) {
  if (!data?.day_spark?.length) {
    return <span style={{ fontSize: '0.65rem', color: 'var(--bk-ink3)' }}>building…</span>
  }
  const prices = data.day_spark
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const W = 100, H = 34
  const pts = prices.map((p, i) => {
    const x = (i / Math.max(prices.length - 1, 1)) * W
    const y = H - ((p - min) / range) * (H - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const isUp = prices[prices.length - 1] >= prices[0]
  const color = isUp ? '#22c55e' : '#ef4444'
  const fillId = `ds-${data.symbol}`
  const lastPt = pts.split(' ').pop()!.split(',')
  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${fillId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={parseFloat(lastPt[0])} cy={parseFloat(lastPt[1])} r={2.5} fill={color} />
    </svg>
  )
}

function mkLevelRenderer(crossedField: keyof BreakoutRow) {
  return function LevelRenderer({ value, data }: P<number | null>) {
    if (!data) return null
    const crossed = data[crossedField] as boolean
    const color = crossed ? '#22c55e' : 'var(--bk-ink3)'
    return (
      <div style={{ lineHeight: 1.3, paddingTop: 5 }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', color: 'var(--bk-ink2)' }}>
          {value == null ? '—' : fmt(value, 0)}
        </div>
        {value != null && (
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color, marginTop: 1 }}>
            {crossed ? '↑ ABOVE' : '↓ BELOW'}
          </div>
        )}
      </div>
    )
  }
}

// ── Column definitions ────────────────────────────────────────────────────────
const COL_DEFS: ColDef<BreakoutRow>[] = [
  { field: 'symbol',     headerName: 'Ticker',    width: 140, pinned: 'left', cellRenderer: TickerRenderer, sortable: true },
  { field: 'live_price', headerName: 'LTP',       width: 105, cellRenderer: LTPRenderer, sortable: true },
  { field: 'closes_20', headerName: '20D Trend',  width: 120, cellRenderer: SparklineRenderer, sortable: false },
  { field: 'day_spark', headerName: 'Today',      width: 120, cellRenderer: DaySparkRenderer,  sortable: false },
  { field: 'score',      headerName: 'Score',     width: 82,  cellRenderer: ScoreRenderer, sort: 'desc', sortable: true },
  { field: 'high_1d',   headerName: '1D High',   width: 100, cellRenderer: mkLevelRenderer('crossed_1d'),  sortable: true },
  { field: 'high_2d',   headerName: '2D High',   width: 100, cellRenderer: mkLevelRenderer('crossed_2d'),  sortable: true },
  { field: 'high_3d',   headerName: '3D High',   width: 100, cellRenderer: mkLevelRenderer('crossed_3d'),  sortable: true },
  { field: 'high_4d',   headerName: '4D High',   width: 100, cellRenderer: mkLevelRenderer('crossed_4d'),  sortable: true },
  { field: 'high_5d',   headerName: '5D High',   width: 100, cellRenderer: mkLevelRenderer('crossed_5d'),  sortable: true },
  { field: 'high_10d',  headerName: '10D High',  width: 105, cellRenderer: mkLevelRenderer('crossed_10d'), sortable: true },
  { field: 'sma20',     headerName: 'SMA 20',    width: 100, cellRenderer: mkLevelRenderer('above_sma20'),  sortable: true },
  { field: 'sma50',     headerName: 'SMA 50',    width: 100, cellRenderer: mkLevelRenderer('above_sma50'),  sortable: true },
  { field: 'sma200',    headerName: 'SMA 200',   width: 105, cellRenderer: mkLevelRenderer('above_sma200'), sortable: true },
]

const DEFAULT_COL: ColDef = {
  resizable: true,
  suppressMovable: false,
  headerClass: 'bk-header',
  rowDrag: false,
}

const REFRESH_SEC = 10

export default function BreakoutScannerPage() {
  const navigate = useNavigate()
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BORDER, BG, PAPER, PAPER2 } = usePalette()

  const [rows, setRows]           = useState<BreakoutRow[]>([])
  const [asOf, setAsOf]           = useState('')
  const [kiteOk, setKiteOk]       = useState(true)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [countdown, setCountdown] = useState(REFRESH_SEC)
  const [filter, setFilter]       = useState<'all' | 'any' | 'strong'>('all')
  const [minScore, setMinScore]   = useState(0)
  const [symSearch, setSymSearch] = useState('')

  const fetchScan = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await breakoutApi.getScan()
      setRows(data.rows)
      setAsOf(data.as_of)
      setKiteOk(data.kite_live)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount + every 10s (stops after 3:30 PM IST)
  useEffect(() => {
    fetchScan()
    const id = setInterval(() => {
      if (isMarketOpen()) fetchScan()
    }, REFRESH_SEC * 1000)
    return () => clearInterval(id)
  }, [fetchScan])

  // Visual countdown tick — freezes when market is closed
  useEffect(() => {
    const id = setInterval(() =>
      setCountdown(c => isMarketOpen() ? (c <= 1 ? REFRESH_SEC : c - 1) : c)
    , 1000)
    return () => clearInterval(id)
  }, [])

  const rowData = useMemo(() => {
    let r = rows
    if (filter === 'any')    r = r.filter(x => x.score > 0)
    if (filter === 'strong') r = r.filter(x => x.score >= 5)
    if (minScore > 0)        r = r.filter(x => x.score >= minScore)
    if (symSearch)           r = r.filter(x => x.symbol.toUpperCase().includes(symSearch.toUpperCase()))
    return r
  }, [rows, filter, minScore, symSearch])

  const gridTheme = useMemo(() =>
    themeQuartz.withParams({
      backgroundColor: PAPER,
      foregroundColor: INK,
      borderColor: BORDER,
      headerBackgroundColor: PAPER2,
      headerTextColor: INK3,
      rowHoverColor: `${CYAN}07`,
      selectedRowBackgroundColor: `${CYAN}12`,
      fontFamily: "'IBM Plex Sans', sans-serif",
      fontSize: 12,
    }), [PAPER, PAPER2, INK, INK3, CYAN, BORDER])

  const cssVars = {
    '--bk-ink':    INK,
    '--bk-ink2':   INK2,
    '--bk-ink3':   INK3,
    '--bk-cyan':   CYAN,
    '--bk-border': BORDER,
    '--ag-odd-row-background-color': PAPER2,
  } as React.CSSProperties

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  const breakoutCount = rows.filter(r => r.score > 0).length

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{ background: heroBg, px: { xs: 2, md: 5 }, pt: 4, pb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Box sx={{
            px: 1.5, py: 0.35, borderRadius: 1,
            bgcolor: loading ? `${CYAN}18` : `#22c55e18`,
            border: `1px solid ${loading ? CYAN : '#22c55e'}30`,
            display: 'flex', alignItems: 'center', gap: 0.75,
          }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%',
              bgcolor: loading ? CYAN : '#22c55e',
              animation: 'pulse 1.6s ease-in-out infinite',
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
            }} />
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: loading ? CYAN : '#22c55e', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.1em' }}>
              {loading ? 'FETCHING' : 'LIVE'}
            </Typography>
          </Box>
          {!kiteOk && (
            <Box sx={{ px: 1.5, py: 0.35, borderRadius: 1, bgcolor: '#fbbf2418', border: '1px solid #fbbf2430' }}>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: '#fbbf24', fontFamily: "'IBM Plex Mono', monospace" }}>
                KITE OFFLINE
              </Typography>
            </Box>
          )}
          {!isMarketOpen() && (
            <Box sx={{ px: 1.5, py: 0.35, borderRadius: 1, bgcolor: `${INK3}18`, border: `1px solid ${INK3}40` }}>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: INK3, fontFamily: "'IBM Plex Mono', monospace" }}>
                MARKET CLOSED
              </Typography>
            </Box>
          )}
        </Box>

        <Typography sx={{ fontSize: { xs: '1.6rem', md: '2rem' }, fontWeight: 900, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1, mb: 0.5, fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Breakout <Box component="span" sx={{ color: CYAN }}>Scanner</Box>
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', color: INK3, mb: 2, fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Live price vs 1D–10D highs &amp; 20/50/200 SMAs · {rowData.length} symbols · {breakoutCount} breaking out
        </Typography>

        {/* Filter bar */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <FilterChip label={`All (${rows.length})`}                        value="all"    current={filter} onChange={v => setFilter(v as typeof filter)} />
          <FilterChip label={`Breakouts (${rows.filter(r => r.score > 0).length})`} value="any" current={filter} onChange={v => setFilter(v as typeof filter)} accent="#22c55e" dot="#22c55e" />
          <FilterChip label={`Strong 5+ (${rows.filter(r => r.score >= 5).length})`} value="strong" current={filter} onChange={v => setFilter(v as typeof filter)} accent="#f59e0b" dot="#f59e0b" />
          <SearchBox value={symSearch} onChange={setSymSearch} placeholder="Symbol…" width={120} />

          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: '0.7rem', color: INK3, fontFamily: "'IBM Plex Mono', monospace" }}>
              {isMarketOpen()
                ? <>Refresh in <Box component="span" sx={{ color: countdown <= 3 ? '#fbbf24' : CYAN, fontWeight: 700 }}>{countdown}s</Box></>
                : <Box component="span" sx={{ color: INK3 }}>Paused — market closed</Box>
              }
            </Typography>
            {asOf && (
              <Typography sx={{ fontSize: '0.65rem', color: INK3, fontFamily: "'IBM Plex Mono', monospace" }}>
                · {asOf.replace('T', ' ')}
              </Typography>
            )}
          </Box>
        </Box>

        {error && (
          <Typography sx={{ fontSize: '0.75rem', color: '#ef4444', mt: 1 }}>{error}</Typography>
        )}
      </Box>

      {/* Grid */}
      <Box sx={{ flex: 1, px: { xs: 1, md: 3 }, pb: 3 }}>
        <Box
          style={{ ...cssVars, height: 'calc(100vh - 320px)', minHeight: 400, borderRadius: 12, overflow: 'hidden', border: `1px solid ${BORDER}` }}
        >
          <AgGridReact<BreakoutRow>
            theme={gridTheme}
            rowData={rowData}
            columnDefs={COL_DEFS}
            defaultColDef={DEFAULT_COL}
            rowHeight={48}
            headerHeight={36}
            suppressCellFocus
            animateRows={false}
            onRowClicked={e => e.data && navigate(`/stock/${e.data.symbol}`)}
          />
        </Box>
      </Box>

      <Footer />
    </Box>
  )
}
