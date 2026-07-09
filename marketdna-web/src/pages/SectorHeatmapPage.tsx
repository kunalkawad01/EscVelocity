import { useState, useEffect, useMemo, useCallback } from 'react'
import { Box, Typography, CircularProgress, Tooltip } from '@mui/material'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { sectorHeatmapApi } from '../api/sectorHeatmapApi'
import {
  SectorHeatmapResponse, SectorHeatmapEntry, StockHeatmapEntry,
} from '../types/sector_heatmap'

// ─── Constants ────────────────────────────────────────────────────────────────

const TFS = ['1d', '5d', '1m', '3m', '6m', '1y', '2y'] as const
type TF = typeof TFS[number]

const TF_LABELS: Record<TF, string> = {
  '1d': '1D', '5d': '5D', '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', '2y': '2Y',
}

// NSE cash market hours: 9:15–15:30 IST, Mon–Fri
function isMarketOpenIST(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = ist.getDay()
  if (day === 0 || day === 6) return false
  const mins = ist.getHours() * 60 + ist.getMinutes()
  return mins >= 555 && mins <= 930
}

const UNIVERSES = ['nifty50', 'nifty200', 'nifty500', 'fno'] as const
type Universe = typeof UNIVERSES[number]

const UNIVERSE_LABELS: Record<Universe, string> = {
  nifty50: 'N50', nifty200: 'N200', nifty500: 'N500', fno: 'F&O',
}

const SORT_OPTIONS = ['momentum', '1d', '1m', '3m', 'breadth'] as const
type SortKey = typeof SORT_OPTIONS[number]

const MOMENTUM_WEIGHTS: Record<TF, number> = {
  '1d': 0.05, '5d': 0.08, '1m': 0.12, '3m': 0.15, '6m': 0.18, '1y': 0.20, '2y': 0.22,
}

// Grid template: name | momentum | breadth | 7 TF cells
const COL = '176px 84px 74px repeat(7, 90px)'

// ─── Colour helpers ────────────────────────────────────────────────────────────

function heatBg(ret: number): string {
  if (ret > 5)  return 'rgba(34,197,94,0.18)'
  if (ret > 1)  return 'rgba(34,197,94,0.08)'
  if (ret > -1) return 'transparent'
  if (ret > -5) return 'rgba(239,68,68,0.08)'
  return 'rgba(239,68,68,0.18)'
}

function retColor(ret: number): string {
  return ret > 0 ? '#22c55e' : ret < 0 ? '#ef4444' : '#888'
}

function breadthFill(v: number): string {
  const r = Math.round(255 * (1 - v))
  const g = Math.round(197 * v)
  return `rgb(${r},${g},68)`
}

// ─── SparkLine ────────────────────────────────────────────────────────────────

function SparkLine({ series, positive }: { series: number[]; positive: boolean }) {
  const W = 72, H = 36, P = 3
  if (!series || series.length < 2) {
    return <Box sx={{ width: W, height: H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Box sx={{ width: 24, height: 1, bgcolor: '#444' }} />
    </Box>
  }
  const iW = W - 2 * P
  const iH = H - 2 * P
  const min = Math.min(...series)
  const max = Math.max(...series)
  const range = max - min || 1
  const pts = series.map((v, i) => ({
    x: P + (i / (series.length - 1)) * iW,
    y: P + iH - ((v - min) / range) * iH,
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${(P + iH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(P + iH).toFixed(1)} Z`
  const color = positive ? '#22c55e' : '#ef4444'
  const fill  = positive ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'
  const last  = pts[pts.length - 1]
  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <path d={area} fill={fill} stroke="none" />
      <path d={line} stroke={color} strokeWidth={1.3} fill="none" />
      <circle cx={last.x} cy={last.y} r={2.2} fill={color} />
    </svg>
  )
}

// ─── BreadthBar ───────────────────────────────────────────────────────────────

function BreadthBar({ value }: { value: number }) {
  const { CYAN } = usePalette()
  return (
    <Tooltip title={`${Math.round(value * 100)}% stocks positive`} placement="top">
      <Box sx={{ width: 64, height: 6, bgcolor: `${CYAN}22`, borderRadius: 1, overflow: 'hidden', cursor: 'default' }}>
        <Box sx={{
          width: `${value * 100}%`,
          height: '100%',
          bgcolor: breadthFill(value),
          borderRadius: 1,
          transition: 'width 0.4s',
        }} />
      </Box>
    </Tooltip>
  )
}

// ─── Week52Bar ────────────────────────────────────────────────────────────────

function Week52Bar({ low, high, current }: { low: number; high: number; current: number }) {
  const { CYAN } = usePalette()
  const pos = high > low ? ((current - low) / (high - low)) : 0.5
  const pct = Math.min(Math.max(pos, 0), 1)
  return (
    <Tooltip title={`52W L:${low.toFixed(0)} H:${high.toFixed(0)} Now:${current.toFixed(0)}`} placement="top">
      <Box sx={{ position: 'relative', width: 60, height: 4, bgcolor: `${CYAN}22`, borderRadius: 1, cursor: 'default' }}>
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: `${pct * 56}px`,
          width: 4,
          height: 4,
          bgcolor: '#d4a017',
          borderRadius: 0.5,
        }} />
      </Box>
    </Tooltip>
  )
}

// ─── RS Arrow ─────────────────────────────────────────────────────────────────

function RsArrow({ rs }: { rs: number }) {
  if (rs > 1)  return <Typography sx={{ fontSize: '0.72rem', color: '#22c55e', fontWeight: 700 }}>↑</Typography>
  if (rs < -1) return <Typography sx={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 700 }}>↓</Typography>
  return <Typography sx={{ fontSize: '0.72rem', color: '#888' }}>→</Typography>
}

// ─── TF Cell ──────────────────────────────────────────────────────────────────

function TfCell({ series, ret }: { series: number[]; ret: number }) {
  const MONO = { fontFamily: "'IBM Plex Mono', monospace" }
  return (
    <Box sx={{
      bgcolor: heatBg(ret),
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.25,
      py: 0.5,
      px: 0.25,
      borderRight: '1px solid',
      borderColor: 'divider',
    }}>
      <SparkLine series={series} positive={ret >= 0} />
      <Typography sx={{
        ...MONO,
        fontSize: '0.63rem',
        fontWeight: 600,
        color: retColor(ret),
        lineHeight: 1,
      }}>
        {ret > 0 ? '+' : ''}{ret.toFixed(1)}%
      </Typography>
    </Box>
  )
}

// ─── Header row ───────────────────────────────────────────────────────────────

function HeaderRow({ INK3, PAPER2 }: { INK3: string; PAPER2: string }) {
  const MONO = { fontFamily: "'IBM Plex Mono', monospace" }
  const cell = {
    fontSize: '0.6rem',
    fontWeight: 800,
    color: INK3,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    ...MONO,
  } as const
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: COL,
      bgcolor: PAPER2,
      borderBottom: '2px solid',
      borderColor: 'divider',
      position: 'sticky',
      top: 0,
      zIndex: 2,
    }}>
      <Box sx={{ px: 1.5, py: 0.75, display: 'flex', alignItems: 'center' }}>
        <Typography sx={cell}>Sector / Stock</Typography>
      </Box>
      <Box sx={{ px: 1, py: 0.75, display: 'flex', alignItems: 'center' }}>
        <Typography sx={cell}>Momentum</Typography>
      </Box>
      <Box sx={{ px: 1, py: 0.75, display: 'flex', alignItems: 'center' }}>
        <Typography sx={cell}>Breadth</Typography>
      </Box>
      {TFS.map(tf => (
        <Box key={tf} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 0.75, borderLeft: '1px solid', borderColor: 'divider' }}>
          <Typography sx={cell}>{TF_LABELS[tf]}</Typography>
        </Box>
      ))}
    </Box>
  )
}

// ─── Sector Row ───────────────────────────────────────────────────────────────

function SectorRow({
  sector, rank, expanded, onToggle,
}: {
  sector: SectorHeatmapEntry
  rank: number
  expanded: boolean
  onToggle: () => void
}) {
  const { INK, INK2, INK3 } = usePalette()
  const MONO = { fontFamily: "'IBM Plex Mono', monospace" }
  const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" }
  const isTop3 = rank <= 3
  const ms = sector.momentum_score

  return (
    <Box
      onClick={onToggle}
      sx={{
        display: 'grid',
        gridTemplateColumns: COL,
        cursor: 'pointer',
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
        transition: 'background-color 0.15s',
      }}
    >
      {/* Name */}
      <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 3, height: 18, borderRadius: 1, bgcolor: sector.color, flexShrink: 0 }} />
        <Typography sx={{ ...SANS, fontSize: '0.78rem', fontWeight: 700, color: INK, lineHeight: 1.2 }}>
          {expanded ? '▾' : '▸'} {sector.name}
        </Typography>
      </Box>

      {/* Momentum */}
      <Box sx={{ px: 1, py: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: retColor(ms) }}>
          {ms > 0 ? '+' : ''}{ms.toFixed(2)}
        </Typography>
        {isTop3 && (
          <Typography sx={{ fontSize: '0.6rem', color: '#d4a017' }}>★</Typography>
        )}
      </Box>

      {/* Breadth */}
      <Box sx={{ px: 1, py: 1, display: 'flex', alignItems: 'center' }}>
        <BreadthBar value={sector.breadth['1m'] ?? 0} />
      </Box>

      {/* TF cells */}
      {TFS.map(tf => (
        <TfCell key={tf} series={sector.series[tf] ?? []} ret={sector.returns[tf] ?? 0} />
      ))}
    </Box>
  )
}

// ─── Stock Row ────────────────────────────────────────────────────────────────

function StockRow({
  stock, niftyRet1m,
}: {
  stock: StockHeatmapEntry
  niftyRet1m: number
}) {
  const { INK, INK2, INK3, PAPER2 } = usePalette()
  const MONO = { fontFamily: "'IBM Plex Mono', monospace" }
  const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" }
  const rs1m = (stock.returns['1m'] ?? 0) - niftyRet1m

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: COL,
      borderBottom: '1px solid',
      borderColor: 'divider',
      bgcolor: 'background.paper',
      opacity: 0.95,
    }}>
      {/* Name */}
      <Box sx={{ pl: 3.5, pr: 1, py: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
          <Typography sx={{ ...MONO, fontSize: '0.7rem', fontWeight: 700, color: INK, lineHeight: 1 }}>
            {stock.symbol}
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.63rem', color: INK3, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stock.name}
          </Typography>
        </Box>
        {stock.is_fno && (
          <Typography sx={{ ...MONO, fontSize: '0.55rem', color: '#d4a017', bgcolor: 'rgba(212,160,23,0.12)', px: 0.5, borderRadius: 0.5, lineHeight: 1.6, flexShrink: 0 }}>
            F&O
          </Typography>
        )}
      </Box>

      {/* Momentum (52W bar + RS arrow) */}
      <Box sx={{ px: 1, py: 0.75, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5, justifyContent: 'center' }}>
        <Week52Bar {...stock.week52} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <RsArrow rs={rs1m} />
          <Typography sx={{ ...MONO, fontSize: '0.62rem', color: retColor(rs1m) }}>
            {rs1m > 0 ? '+' : ''}{rs1m.toFixed(1)}%
          </Typography>
        </Box>
      </Box>

      {/* Breadth placeholder (empty for stock rows) */}
      <Box sx={{ px: 1, py: 0.75 }} />

      {/* TF cells */}
      {TFS.map(tf => (
        <TfCell key={tf} series={stock.series[tf] ?? []} ret={stock.returns[tf] ?? 0} />
      ))}
    </Box>
  )
}

// ─── Universe Tabs ────────────────────────────────────────────────────────────

function UniverseTabs({
  value, onChange, CYAN, INK3,
}: {
  value: Universe
  onChange: (u: Universe) => void
  CYAN: string
  INK3: string
}) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {UNIVERSES.map(u => {
        const active = u === value
        return (
          <Box
            key={u}
            onClick={() => onChange(u)}
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              cursor: 'pointer',
              border: '1px solid',
              borderColor: active ? CYAN : 'divider',
              bgcolor: active ? `${CYAN}18` : 'transparent',
              transition: 'all 0.15s',
              '&:hover': { borderColor: CYAN },
            }}
          >
            <Typography sx={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '0.7rem',
              fontWeight: 700,
              color: active ? CYAN : INK3,
            }}>
              {UNIVERSE_LABELS[u]}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Sort Bar ─────────────────────────────────────────────────────────────────

function SortBar({
  value, onChange, INK3, CYAN,
}: {
  value: SortKey
  onChange: (s: SortKey) => void
  INK3: string
  CYAN: string
}) {
  const labels: Record<SortKey, string> = {
    momentum: 'Momentum', '1d': '1D', '1m': '1M', '3m': '3M', breadth: 'Breadth',
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography sx={{ fontSize: '0.68rem', color: INK3, fontFamily: "'IBM Plex Sans', sans-serif" }}>
        Sort by
      </Typography>
      {SORT_OPTIONS.map(s => {
        const active = s === value
        return (
          <Box
            key={s}
            onClick={() => onChange(s)}
            sx={{
              px: 1.25,
              py: 0.35,
              borderRadius: 1,
              cursor: 'pointer',
              bgcolor: active ? `${CYAN}20` : 'transparent',
              border: '1px solid',
              borderColor: active ? CYAN : 'divider',
              transition: 'all 0.15s',
              '&:hover': { borderColor: CYAN },
            }}
          >
            <Typography sx={{
              fontFamily: "'IBM Plex Sans', sans-serif",
              fontSize: '0.68rem',
              fontWeight: active ? 700 : 500,
              color: active ? CYAN : INK3,
            }}>
              {labels[s]}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Sort logic ───────────────────────────────────────────────────────────────

function sortSectors(sectors: SectorHeatmapEntry[], by: SortKey): SectorHeatmapEntry[] {
  return [...sectors].sort((a, b) => {
    if (by === 'momentum') return b.momentum_score - a.momentum_score
    if (by === 'breadth')  return (b.breadth['1m'] ?? 0) - (a.breadth['1m'] ?? 0)
    return (b.returns[by] ?? 0) - (a.returns[by] ?? 0)
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SectorHeatmapPage() {
  const { INK, INK2, INK3, CYAN, BG, PAPER, PAPER2, BORDER } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()

  const [universe, setUniverse] = useState<Universe>('nifty500')
  const [sort, setSort]         = useState<SortKey>('momentum')
  const [data, setData]         = useState<SectorHeatmapResponse | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const fetchData = useCallback(async (u: Universe, { background = false } = {}) => {
    if (!background) setLoading(true)
    setError(null)
    try {
      const result = await sectorHeatmapApi.getHeatmap(u)
      setData(result)
    } catch (e: any) {
      if (!background) setError(e.message || 'Failed to load heatmap')
    } finally {
      if (!background) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(universe)
    const id = setInterval(() => {
      if (isMarketOpenIST()) fetchData(universe, { background: true })
    }, 60_000)
    return () => clearInterval(id)
  }, [universe, fetchData])

  const handleUniverseChange = (u: Universe) => {
    setUniverse(u)
    setExpanded({})
  }

  const sortedSectors = useMemo(
    () => (data ? sortSectors(data.sectors, sort) : []),
    [data, sort],
  )

  const niftyRet1m = data?.nifty_returns['1m'] ?? 0

  const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" }
  const MONO = { fontFamily: "'IBM Plex Mono', monospace" }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        pt: 10,
        pb: 4,
        px: { xs: 2, md: 4 },
      }}>
        {/* Eyebrow */}
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', gap: 1,
          border: `1px solid ${CYAN}44`, borderRadius: 2,
          px: 1.5, py: 0.4, mb: 2,
          bgcolor: `${CYAN}0A`,
        }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN, animation: 'pulse 2s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } } }} />
          <Typography sx={{ ...MONO, fontSize: '0.65rem', color: CYAN, fontWeight: 700, letterSpacing: '0.1em' }}>
            SECTOR INTELLIGENCE
          </Typography>
        </Box>

        <Typography variant="h4" sx={{ ...SANS, fontWeight: 300, color: INK, mb: 0.5, lineHeight: 1.15 }}>
          Sector <Box component="span" sx={{ fontWeight: 800 }}>Heatmap</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.85rem', color: INK3, mb: 3, maxWidth: 520 }}>
          Performance grid across 7 timeframes — drill into any sector to see per-stock breakdowns, 52W range, and relative strength.
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <UniverseTabs value={universe} onChange={handleUniverseChange} CYAN={CYAN} INK3={INK3} />
          {data && (
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>
              as of {new Date(data.as_of).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Main content */}
      <Box sx={{ px: { xs: 1, md: 4 }, pb: 6 }}>

        {/* Nifty baseline strip */}
        {data && (
          <Box sx={{
            display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center',
            px: 2, py: 1.25, mb: 2,
            bgcolor: PAPER, borderRadius: 2, border: '1px solid', borderColor: BORDER,
          }}>
            <Typography sx={{ ...SANS, fontSize: '0.7rem', fontWeight: 700, color: INK3, mr: 0.5 }}>
              NIFTY 50
            </Typography>
            {TFS.map(tf => (
              <Box key={tf} sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline' }}>
                <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>{TF_LABELS[tf]}</Typography>
                <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: retColor(data.nifty_returns[tf] ?? 0) }}>
                  {(data.nifty_returns[tf] ?? 0) > 0 ? '+' : ''}{(data.nifty_returns[tf] ?? 0).toFixed(1)}%
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {/* Sort bar */}
        <Box sx={{ mb: 1.5 }}>
          <SortBar value={sort} onChange={setSort} INK3={INK3} CYAN={CYAN} />
        </Box>

        {/* Grid card */}
        <Box sx={{ ...CARD, p: 0, overflow: 'hidden' }}>

          {/* Loading */}
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 8 }}>
              <CircularProgress size={22} sx={{ color: CYAN }} />
              <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3 }}>
                Computing sector returns…
              </Typography>
            </Box>
          )}

          {/* Error */}
          {error && !loading && (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography sx={{ ...SANS, fontSize: '0.85rem', color: '#ef4444', mb: 1 }}>{error}</Typography>
              <Box
                onClick={() => fetchData(universe)}
                sx={{ display: 'inline-block', px: 2, py: 0.75, border: `1px solid ${CYAN}`, borderRadius: 1, cursor: 'pointer' }}
              >
                <Typography sx={{ ...MONO, fontSize: '0.72rem', color: CYAN }}>Retry</Typography>
              </Box>
            </Box>
          )}

          {/* Data grid */}
          {!loading && !error && data && (
            <Box sx={{ overflowX: 'auto' }}>
              <Box sx={{ minWidth: 980 }}>
                <HeaderRow INK3={INK3} PAPER2={PAPER2} />

                {sortedSectors.map((sector, idx) => (
                  <Box key={sector.name}>
                    <SectorRow
                      sector={sector}
                      rank={idx + 1}
                      expanded={!!expanded[sector.name]}
                      onToggle={() => setExpanded(prev => ({ ...prev, [sector.name]: !prev[sector.name] }))}
                    />
                    {expanded[sector.name] && sector.stocks.map(stock => (
                      <StockRow key={stock.symbol} stock={stock} niftyRet1m={niftyRet1m} />
                    ))}
                  </Box>
                ))}

                {sortedSectors.length === 0 && (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <Typography sx={{ ...SANS, fontSize: '0.82rem', color: INK3 }}>No sectors found for this universe.</Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Box>

        {/* Legend */}
        <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', mt: 2, px: 0.5 }}>
          {[
            { label: '>+5%', bg: 'rgba(34,197,94,0.18)' },
            { label: '+1–5%', bg: 'rgba(34,197,94,0.08)' },
            { label: '±1%', bg: 'transparent', border: '1px solid #444' },
            { label: '-1–5%', bg: 'rgba(239,68,68,0.08)' },
            { label: '<-5%', bg: 'rgba(239,68,68,0.18)' },
          ].map(({ label, bg, border }) => (
            <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 14, height: 14, bgcolor: bg, border: border ?? '1px solid transparent', borderRadius: 0.5 }} />
              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>{label}</Typography>
            </Box>
          ))}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: '0.6rem', color: '#d4a017' }}>★</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>Top-3 momentum</Typography>
          </Box>
        </Box>
      </Box>

      <Footer />
    </Box>
  )
}
