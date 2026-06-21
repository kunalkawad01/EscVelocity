import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Grid, IconButton, Tooltip, Typography } from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { intradayApi, liveApi } from '../api/liveApi'
import { StockIntelligenceCard } from '../components/StockIntelligenceCard'
import type { StockIntelligenceResponse } from '../types/live'
import type { IntradayReturnsResponse, IntradaySymbol, NormHistoryResponse, Category } from '../types/intraday_race'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const REFRESH_MS = 60_000

const CAT_COLOR: Record<Category, string> = {
  top: '#1D9E75',
  rec: '#378ADD',
  dec: '#D85A30',
  bot: '#E24B4A',
  neu: '#888780',
}
const CAT_LABEL: Record<Category, string> = {
  top: 'Top Performers',
  rec: 'Recovering',
  dec: 'Declining',
  bot: 'Laggards',
  neu: 'Neutral',
}

const REPLAY_FRAMES = ['15:25', '15:26', '15:27', '15:28', '15:29', '15:30']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(v: number, dp = 2): string {
  return (v >= 0 ? '+' : '') + v.toFixed(dp) + '%'
}
function fmtRet(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}
function retColor(v: number): string {
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#94a3b8'
}

// ── Live badge ────────────────────────────────────────────────────────────────
function StatusBadge({ marketOpen, dataMode, loading }: { marketOpen: boolean; dataMode: string; loading: boolean }) {
  const { CYAN } = usePalette()
  const color = loading ? CYAN : marketOpen ? '#22c55e' : dataMode === 'eod_fallback' ? '#fbbf24' : '#94a3b8'
  const label = loading ? 'FETCHING' : marketOpen ? 'LIVE' : dataMode === 'snapshot' ? 'REPLAY' : 'MARKET CLOSED'
  return (
    <Box sx={{
      px: 1.5, py: 0.35, borderRadius: 1,
      bgcolor: `${color}18`, border: `1px solid ${color}30`,
      display: 'inline-flex', alignItems: 'center', gap: 0.75,
    }}>
      <Box sx={{
        width: 6, height: 6, borderRadius: '50%', bgcolor: color,
        animation: loading || marketOpen ? 'pulse 1.6s ease-in-out infinite' : 'none',
        '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
      }} />
      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color, letterSpacing: '0.1em' }}>
        {label}
      </Typography>
    </Box>
  )
}

// ── Section heading ───────────────────────────────────────────────────────────
function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ ...SANS, fontSize: '0.82rem', fontWeight: 800, color: INK }}>{title}</Typography>
      {meta && <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, ml: 'auto' }}>{meta}</Typography>}
    </Box>
  )
}

// ── Module 1: Bar Race Panel ──────────────────────────────────────────────────
function BarPanel({
  title,
  accent,
  items,
  valueKey,
  showDiff,
  diffDown,
  emptyLine1,
  emptyLine2,
  onSelect,
}: {
  title: string
  accent: string
  items: Array<{ symbol: string; value: number; displayPct?: number; rankNum?: number; color: string; diff?: number; category: Category }>
  valueKey: string
  showDiff?: boolean
  diffDown?: boolean   // true for decliners (shows ↓), false/undefined for recoverers (shows ↑)
  emptyLine1?: string
  emptyLine2?: string
  onSelect?: (symbol: string) => void
}) {
  const { INK, INK3 } = usePalette()
  const { CARD } = useTokens()
  const maxVal = Math.max(...items.map(i => Math.abs(i.value)), 0.01)

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead title={title} accent={accent} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {items.slice(0, 10).map((item, idx) => (
          <Box
            key={item.symbol}
            onClick={() => onSelect?.(item.symbol)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: onSelect ? 'pointer' : 'default', borderRadius: 1, px: 0.5, '&:hover': onSelect ? { bgcolor: `${item.color}12` } : {} }}
          >
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3, width: 16, textAlign: 'right', flexShrink: 0 }}>
              {idx + 1}
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.7rem', fontWeight: 700, color: INK, width: 72, flexShrink: 0 }}>
              {item.symbol}
            </Typography>
            <Box sx={{ flex: 1, position: 'relative', height: 16 }}>
              <Box sx={{
                position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                height: 10, borderRadius: 1,
                width: `${(Math.abs(item.value) / maxVal) * 100}%`,
                bgcolor: item.color,
                transition: 'width 0.6s ease',
                minWidth: 2,
              }} />
            </Box>
            <Typography sx={{ ...MONO, fontSize: '0.68rem', color: item.color, width: 52, textAlign: 'right', flexShrink: 0 }}>
              {item.displayPct !== undefined ? fmtRet(item.displayPct) : valueKey === 'diff' ? `+${item.value}` : fmtRet(item.value)}
            </Typography>
            {item.rankNum !== undefined && (
              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, width: 36, textAlign: 'right', flexShrink: 0 }}>
                #{item.rankNum}
              </Typography>
            )}
            {showDiff && item.diff !== undefined && (
              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: item.color, width: 44, textAlign: 'right', flexShrink: 0 }}>
                {diffDown ? '↓' : '↑'}{item.diff}
              </Typography>
            )}
          </Box>
        ))}
        {items.length === 0 && (
          <Box sx={{ py: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3, textAlign: 'center' }}>
              {emptyLine1 ?? 'No data'}
            </Typography>
            {emptyLine2 && (
              <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, textAlign: 'center' }}>
                {emptyLine2}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Module 2: ATR Scatter ─────────────────────────────────────────────────────
function AtrScatterChart({ symbols, marketOpen }: { symbols: IntradaySymbol[]; marketOpen: boolean }) {
  const { PAPER, INK, INK2, INK3, BORDER, CYAN } = usePalette()
  const { CARD } = useTokens()
  const chartRef = useRef<HighchartsReact.RefObject>(null)

  const atr2Available = useMemo(() => symbols.some(s => s.atr2 > 0), [symbols])

  const medianAtr = useMemo(() => {
    const atrs = symbols.map(s => s.atr2).filter(a => a > 0).sort((a, b) => a - b)
    if (!atrs.length) return 0
    const mid = Math.floor(atrs.length / 2)
    return atrs.length % 2 ? atrs[mid] : (atrs[mid - 1] + atrs[mid]) / 2
  }, [symbols])

  const options = useMemo((): Highcharts.Options => {
    const byCat: Record<Category, Highcharts.PointOptionsObject[]> = {
      top: [], rec: [], dec: [], bot: [], neu: [],
    }
    for (const s of symbols) {
      byCat[s.category as Category].push({
        x: s.atr2,
        y: s.return_pct,
        name: s.symbol,
      })
    }
    const seriesList: Highcharts.SeriesOptionsType[] = (
      ['top', 'rec', 'dec', 'bot', 'neu'] as Category[]
    ).map(cat => ({
      type: 'scatter' as const,
      name: CAT_LABEL[cat],
      color: CAT_COLOR[cat],
      marker: {
        radius: cat === 'neu' ? 4 : 6,
        symbol: 'circle',
        fillColor: CAT_COLOR[cat] + (cat === 'neu' ? '55' : 'cc'),
        lineColor: CAT_COLOR[cat],
        lineWidth: 1,
      },
      data: byCat[cat],
    }))

    return {
      chart: {
        type: 'scatter',
        backgroundColor: 'transparent',
        style: { fontFamily: "'IBM Plex Sans', sans-serif" },
        height: 340,
        animation: false,
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        enabled: true,
        itemStyle: { color: INK2, fontSize: '0.7rem', fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: '400' },
        itemHoverStyle: { color: INK },
        backgroundColor: 'transparent',
        borderWidth: 0,
      },
      xAxis: {
        title: { text: 'ATR(2)', style: { color: INK3, fontSize: '0.7rem' } },
        labels: { style: { color: INK3, fontSize: '0.65rem', fontFamily: "'IBM Plex Mono', monospace" } },
        gridLineColor: BORDER + '55',
        lineColor: BORDER,
        tickColor: BORDER,
        plotLines: medianAtr > 0 ? [{
          value: medianAtr,
          dashStyle: 'Dash',
          color: INK3 + '88',
          width: 1,
          label: { text: 'med ATR', style: { color: INK3, fontSize: '0.6rem' } },
        }] : [],
      },
      yAxis: {
        title: { text: 'Return %', style: { color: INK3, fontSize: '0.7rem' } },
        labels: { style: { color: INK3, fontSize: '0.65rem', fontFamily: "'IBM Plex Mono', monospace" } },
        gridLineColor: BORDER + '55',
        plotLines: [{
          value: 0,
          dashStyle: 'Dash',
          color: INK3 + '88',
          width: 1,
        }],
      },
      tooltip: {
        backgroundColor: PAPER + 'ee',
        borderColor: BORDER,
        style: { color: INK, fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace" },
        formatter() {
          const p = this.point as { name?: string; x: number; y: number }
          return `<b>${p.name ?? ''}</b><br/>
            Return: ${fmtRet(p.y)}<br/>
            ATR(2): ${p.x.toFixed(4)}`
        },
      },
      plotOptions: {
        scatter: { animation: false },
      },
      series: seriesList,
    }
  }, [symbols, medianAtr, PAPER, INK, INK2, INK3, BORDER, CYAN])

  if (!atr2Available) {
    return (
      <Box sx={{ ...CARD, p: 2 }}>
        <SectionHead title="Return vs ATR(2) Scatter" accent="#a78bfa" />
        <Box sx={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <Typography sx={{ ...MONO, fontSize: '0.7rem', color: INK3 }}>
            {marketOpen ? 'Accumulating intraday tick data…' : 'ATR(2) available during market hours only'}
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>
            {marketOpen ? 'Needs 3+ minute-candles per stock. Refresh in 3–4 minutes.' : 'Market hours: Mon–Fri 09:15–15:30 IST'}
          </Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead title="Return vs ATR(2) Scatter" accent="#a78bfa" meta="ATR(2) from intraday minute candles" />
      <HighchartsReact highcharts={Highcharts} options={options} ref={chartRef} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1, px: 0.5 }}>
        {[
          { label: 'Low ATR · High Return', note: 'Steady outperformers', corner: 'top-left' },
          { label: 'High ATR · High Return', note: 'Strong movers', corner: 'top-right' },
          { label: 'Low ATR · Low Return', note: 'Quiet laggards', corner: 'bottom-left' },
          { label: 'High ATR · Low Return', note: 'Volatile decliners', corner: 'bottom-right' },
        ].map(q => (
          <Box key={q.corner} sx={{ flex: '1 1 140px' }}>
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: '#94a3b8' }}>{q.label}</Typography>
            <Typography sx={{ ...SANS, fontSize: '0.65rem', color: '#64748b' }}>{q.note}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Module 3: Normalised Return Progression (SVG multi-line) ─────────────────
function NormReturnChart({ history, marketOpen }: { history: NormHistoryResponse | null; marketOpen: boolean }) {
  const { PAPER, INK, INK2, INK3, BORDER } = usePalette()
  const { CARD } = useTokens()
  const [hovered, setHovered] = useState<string | null>(null)

  // Detect replay mode: times start after 15:00 (closing 10-min window from Kite)
  const isReplayWindow = history && history.times.length > 0 && history.times[0] >= '15:00'

  if (!history || !history.times.length) {
    return (
      <Box sx={{ ...CARD, p: 2 }}>
        <SectionHead title="Normalised Return from 9:15 Open" accent="#f59e0b" />
        <Box sx={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <Typography sx={{ ...MONO, fontSize: '0.7rem', color: INK3 }}>
            {marketOpen ? 'Waiting for first 9:15 tick…' : 'Replay data loading…'}
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>
            {marketOpen ? 'Chart builds from the 09:15 baseline.' : 'Fetching closing 10-min progression from Kite'}
          </Typography>
        </Box>
      </Box>
    )
  }

  const { times, series, categories } = history
  const W = 800, H = 260, PAD = { l: 44, r: 60, t: 12, b: 32 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  // Y range across all series
  let yMin = 0, yMax = 0
  for (const pts of Object.values(series)) {
    for (const v of pts) {
      if (v < yMin) yMin = v
      if (v > yMax) yMax = v
    }
  }
  const pad = Math.max((yMax - yMin) * 0.1, 0.5)
  yMin -= pad; yMax += pad
  const yRange = yMax - yMin

  const toX = (i: number) => PAD.l + (i / Math.max(times.length - 1, 1)) * innerW
  const toY = (v: number) => PAD.t + (1 - (v - yMin) / yRange) * innerH

  // Y-axis ticks
  const yTicks: number[] = []
  const tickStep = Math.ceil((yMax - yMin) / 5 * 10) / 10
  for (let t = Math.ceil(yMin / tickStep) * tickStep; t <= yMax; t = +(t + tickStep).toFixed(2)) {
    yTicks.push(t)
  }

  // X-axis: for short replay windows (≤20 points) show every tick; else show per-hour
  const xLabels: Array<{ i: number; label: string }> = []
  if (times.length <= 20) {
    times.forEach((t, i) => xLabels.push({ i, label: t }))
  } else {
    const seen = new Set<string>()
    times.forEach((t, i) => {
      const h = t.split(':')[0]
      if (!seen.has(h)) { seen.add(h); xLabels.push({ i, label: t }) }
    })
  }

  const syms = Object.keys(series)

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead
        title={isReplayWindow ? 'Closing 10-min Progression (15:20–15:30)' : 'Normalised Return from 9:15 Open'}
        accent="#f59e0b"
        meta={`${syms.length} stocks · baseline = 0%`}
      />
      <Box sx={{ overflowX: 'auto' }}>
        <svg
          width="100%" viewBox={`0 0 ${W} ${H}`}
          style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace" }}
        >
          {/* Gridlines */}
          {yTicks.map(t => (
            <line key={t} x1={PAD.l} x2={W - PAD.r} y1={toY(t)} y2={toY(t)}
              stroke={BORDER} strokeWidth={0.5} strokeDasharray={t === 0 ? '4 4' : '2 4'} />
          ))}
          {/* Y labels */}
          {yTicks.map(t => (
            <text key={t} x={PAD.l - 5} y={toY(t) + 4} textAnchor="end"
              fontSize="9" fill={INK3}>{t >= 0 ? '+' : ''}{t.toFixed(1)}%</text>
          ))}
          {/* Zero line emphasis */}
          {yMin < 0 && yMax > 0 && (
            <line x1={PAD.l} x2={W - PAD.r} y1={toY(0)} y2={toY(0)}
              stroke={INK3} strokeWidth={1} strokeDasharray="4 4" />
          )}
          {/* X labels */}
          {xLabels.map(({ i, label }) => (
            <text key={label} x={toX(i)} y={H - 4} textAnchor="middle"
              fontSize="9" fill={INK3}>{label}</text>
          ))}
          {/* Lines — neu behind, categories in front */}
          {['neu', 'dec', 'rec', 'bot', 'top'].map(cat =>
            syms
              .filter(s => categories[s] === cat)
              .map(sym => {
                const pts = series[sym]
                if (!pts || pts.length < 2) return null
                const isCat = cat !== 'neu'
                const isHov = hovered === sym
                const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
                return (
                  <path
                    key={sym}
                    d={d}
                    fill="none"
                    stroke={CAT_COLOR[cat as Category]}
                    strokeWidth={isHov ? 2.5 : isCat ? 1.5 : 0.8}
                    strokeOpacity={isHov ? 1 : isCat ? 0.7 : 0.18}
                    style={{ cursor: 'pointer', transition: 'stroke-opacity 0.2s' }}
                    onMouseEnter={() => setHovered(sym)}
                    onMouseLeave={() => setHovered(null)}
                  />
                )
              })
          )}
          {/* Hovered label at end of line */}
          {hovered && series[hovered] && (() => {
            const pts = series[hovered]
            const last = pts[pts.length - 1]
            const cat = (categories[hovered] ?? 'neu') as Category
            return (
              <text
                x={toX(pts.length - 1) + 4} y={toY(last) + 4}
                fontSize="9" fill={CAT_COLOR[cat]} fontWeight="700"
              >
                {hovered} {fmtRet(last)}
              </text>
            )
          })()}
          {/* Baseline label */}
          <text x={PAD.l} y={toY(0) - 5} fontSize="8" fill={INK3}>
            {isReplayWindow ? '0% = prev close' : '0% baseline (9:15)'}
          </text>
        </svg>
      </Box>
      {/* Category legend */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
        {(['top', 'rec', 'dec', 'bot', 'neu'] as Category[]).map(cat => (
          <Box key={cat} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 20, height: 2, bgcolor: CAT_COLOR[cat], borderRadius: 1 }} />
            <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>{CAT_LABEL[cat]}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Tiny sparkline SVG (last 30 norm_return ticks) ────────────────────────────
function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const pts = data.slice(-30)
  if (pts.length < 2) return <Box sx={{ height: 24 }} />
  const min = Math.min(...pts), max = Math.max(...pts)
  const range = max - min || 0.01
  const W = 64, H = 20
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * W)
  const ys = pts.map(v => H - ((v - min) / range) * (H - 4) - 2)
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.2} />
    </svg>
  )
}

// ── Module 4: Mini Sparkline Grid ─────────────────────────────────────────────
function MiniGrid({ symbols, history }: { symbols: IntradaySymbol[]; history: NormHistoryResponse | null }) {
  const { INK, INK3, BORDER } = usePalette()
  const { CARD } = useTokens()

  const rows: Array<{ label: string; cats: Category[]; accent: string; syms: IntradaySymbol[] }> = [
    { label: 'Top Performers', cats: ['top'], accent: CAT_COLOR.top, syms: [] },
    { label: 'Recovering', cats: ['rec'], accent: CAT_COLOR.rec, syms: [] },
    { label: 'Declining', cats: ['dec'], accent: CAT_COLOR.dec, syms: [] },
    { label: 'Laggards', cats: ['bot'], accent: CAT_COLOR.bot, syms: [] },
  ]
  for (const s of symbols) {
    const row = rows.find(r => r.cats.includes(s.category as Category))
    if (row) row.syms.push(s)
  }

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead title="Stock Pulse Grid" accent="#e879f9" meta="Last 30 ticks · normalized from 9:15" />
      {rows.map(row => (
        <Box key={row.label} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Box sx={{ width: 3, height: 12, bgcolor: row.accent, borderRadius: 1 }} />
            <Typography sx={{ ...SANS, fontSize: '0.7rem', fontWeight: 700, color: row.accent }}>
              {row.label}
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, ml: 0.5 }}>
              {row.syms.length} stocks
            </Typography>
          </Box>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
            gap: 0.75,
          }}>
            {row.syms.map(s => {
              const normPts = history?.series?.[s.symbol] ?? []
              const retC = retColor(s.return_pct)
              return (
                <Box key={s.symbol} sx={{
                  p: '6px 8px',
                  borderRadius: '8px',
                  border: `1px solid ${row.accent}40`,
                  borderTop: `2px solid ${row.accent}`,
                  bgcolor: `${row.accent}06`,
                }}>
                  <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: INK, lineHeight: 1 }}>
                    {s.symbol}
                  </Typography>
                  <Typography sx={{ ...MONO, fontSize: '0.65rem', color: retC, lineHeight: 1.2 }}>
                    {fmtRet(s.return_pct)}
                  </Typography>
                  <MiniSpark data={normPts} color={row.accent} />
                </Box>
              )
            })}
            {row.syms.length === 0 && (
              <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3 }}>—</Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// ── Replay controls (market closed) ──────────────────────────────────────────
function ReplayBar({
  frameIdx,
  playing,
  hasReplayed,
  onPlay,
  onNext,
  onReset,
}: {
  frameIdx: number
  playing: boolean
  hasReplayed: boolean
  onPlay: () => void
  onNext: () => void
  onReset: () => void
}) {
  const { PAPER2, INK, INK2, INK3, BORDER, CYAN } = usePalette()
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
      px: 2, py: 1, borderRadius: 2, border: `1px solid ${BORDER}`,
      bgcolor: `${CYAN}08`,
    }}>
      <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>REPLAY</Typography>
      {REPLAY_FRAMES.map((f, i) => (
        <Box key={f} sx={{
          px: 1, py: 0.25, borderRadius: 1,
          bgcolor: i === frameIdx ? CYAN + '25' : 'transparent',
          border: `1px solid ${i === frameIdx ? CYAN : BORDER}`,
        }}>
          <Typography sx={{ ...MONO, fontSize: '0.65rem', color: i === frameIdx ? CYAN : INK3 }}>{f}</Typography>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
        <Box
          onClick={playing ? undefined : onPlay}
          sx={{
            px: 1.5, py: 0.4, borderRadius: 1, cursor: playing ? 'default' : 'pointer',
            bgcolor: playing ? BORDER : `${CYAN}22`, border: `1px solid ${playing ? BORDER : CYAN}`,
          }}
        >
          <Typography sx={{ ...MONO, fontSize: '0.65rem', color: playing ? INK3 : CYAN }}>
            {playing ? '▶ Playing' : hasReplayed ? '▶ Replay again' : '▶ Play replay'}
          </Typography>
        </Box>
        {!playing && frameIdx >= 0 && frameIdx < REPLAY_FRAMES.length - 1 && (
          <Box onClick={onNext} sx={{ px: 1.5, py: 0.4, borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK2 }}>Next →</Typography>
          </Box>
        )}
        {frameIdx >= 0 && (
          <Box onClick={onReset} sx={{ px: 1.5, py: 0.4, borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>✕ Live</Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IntradayRacePage() {
  const { BG, PAPER, PAPER2, INK, INK2, INK3, BORDER, CYAN } = usePalette()
  const { mode } = useThemeMode()
  const { CARD } = useTokens()

  const [data, setData] = useState<IntradayReturnsResponse | null>(null)
  const [history, setHistory] = useState<NormHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Replay state
  const [replayFrame, setReplayFrame] = useState(-1)          // -1 = not replaying
  const [replayData, setReplayData] = useState<IntradayReturnsResponse | null>(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [hasReplayed, setHasReplayed] = useState(false)       // true once user starts replay
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoFrozeRef = useRef(false)                          // prevent re-triggering auto-freeze

  // Stock Intelligence panel state
  const [selectedStock, setSelectedStock] = useState<string | null>(null)
  const [stockData, setStockData] = useState<StockIntelligenceResponse | null>(null)
  const [stockLoading, setStockLoading] = useState(false)

  const display = replayData ?? data
  const isMarketOpen = data?.market_open ?? false             // use raw data, not frozen snapshot

  // ── Fetch live data ─────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    // Fetch independently — a norm-history failure must not kill the returns data
    const [retResult, histResult] = await Promise.allSettled([
      intradayApi.getReturns(),
      intradayApi.getNormHistory(),
    ])
    if (retResult.status === 'fulfilled') {
      setData(retResult.value)
      setError(null)
    } else {
      setError(retResult.reason instanceof Error ? retResult.reason.message : 'Returns fetch failed')
    }
    if (histResult.status === 'fulfilled') {
      setHistory(histResult.value)
    }
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  // ── Auto-freeze to 15:30 snapshot when market is closed ─────────────────────
  // Spec: "Freeze all modules to 15:30 snapshot" when market is closed.
  // Runs once after the first successful data load; replay cache built on backend.
  useEffect(() => {
    if (!data || data.market_open || loading || autoFrozeRef.current) return
    autoFrozeRef.current = true
    intradayApi.getSnapshot(REPLAY_FRAMES[REPLAY_FRAMES.length - 1])
      .then(snap => {
        if (snap.symbols.length > 0) {
          setReplayData(snap)
          setReplayFrame(REPLAY_FRAMES.length - 1)
        }
      })
      .catch(() => { /* keep raw data if replay unavailable */ })
  }, [data, loading])

  // ── Replay logic ────────────────────────────────────────────────────────────
  const stopReplay = useCallback(() => {
    if (replayTimerRef.current) clearInterval(replayTimerRef.current)
    setReplayPlaying(false)
  }, [])

  const loadReplayFrame = useCallback(async (frameIdx: number) => {
    if (frameIdx < 0 || frameIdx >= REPLAY_FRAMES.length) { stopReplay(); return }
    try {
      const snap = await intradayApi.getSnapshot(REPLAY_FRAMES[frameIdx])
      setReplayData(snap)
      setReplayFrame(frameIdx)
    } catch {/* keep previous */ }
  }, [stopReplay])

  const startReplay = useCallback(() => {
    setHasReplayed(true)
    setReplayPlaying(true)
    setReplayFrame(0)
    loadReplayFrame(0)
    let frame = 0
    replayTimerRef.current = setInterval(async () => {
      frame++
      if (frame >= REPLAY_FRAMES.length) {
        stopReplay()
        return
      }
      loadReplayFrame(frame)
    }, 5000)   // 5s per frame for demo cadence (spec: 60s per frame for production)
  }, [loadReplayFrame, stopReplay])

  const resetReplay = useCallback(() => {
    stopReplay()
    setHasReplayed(false)
    setReplayFrame(-1)
    setReplayData(null)
    autoFrozeRef.current = false   // allow re-freeze on next data load
  }, [stopReplay])

  useEffect(() => () => stopReplay(), [stopReplay])

  // ── Stock Intelligence panel ─────────────────────────────────────────────────
  const handleSelectStock = useCallback(async (symbol: string) => {
    setSelectedStock(symbol)
    setStockData(null)
    setStockLoading(true)
    try {
      const d = await liveApi.getStockIntelligence(symbol)
      setStockData(d)
    } catch {/* ignore */}
    setStockLoading(false)
  }, [])

  // ── Derive Bar Race panels from display data ─────────────────────────────────
  const symbols = display?.symbols ?? []

  const panelTop = useMemo(() =>
    symbols
      .filter(s => s.category === 'top')
      .slice(0, 10)
      .map(s => ({ symbol: s.symbol, value: s.return_pct, color: CAT_COLOR.top, category: s.category })),
    [symbols])

  const panelBot = useMemo(() =>
    [...symbols]
      .filter(s => s.category === 'bot')
      .sort((a, b) => a.return_pct - b.return_pct)
      .slice(0, 10)
      .map(s => ({ symbol: s.symbol, value: s.return_pct, color: CAT_COLOR.bot, category: s.category })),
    [symbols])

  const panelDec = useMemo(() =>
    symbols
      .filter(s => s.category === 'dec')
      // rank > prev_rank for decliners → bar width = places dropped; text = return % + current rank
      .map(s => ({ symbol: s.symbol, value: s.rank - s.prev_rank, displayPct: s.return_pct, rankNum: s.rank, color: CAT_COLOR.dec, diff: s.rank - s.prev_rank, category: s.category }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    [symbols])

  const panelRec = useMemo(() =>
    symbols
      .filter(s => s.category === 'rec')
      // rank < prev_rank for recoverers → bar width = places gained; text = return % + current rank
      .map(s => ({ symbol: s.symbol, value: s.prev_rank - s.rank, displayPct: s.return_pct, rankNum: s.rank, color: CAT_COLOR.rec, diff: s.prev_rank - s.rank, category: s.category }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    [symbols])

  // ── Render ──────────────────────────────────────────────────────────────────
  const heroGrad = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{ background: heroGrad, pt: { xs: 10, md: 12 }, pb: 5, px: { xs: 2, md: 5 } }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Box sx={{
              px: 1.5, py: 0.35, borderRadius: 1,
              bgcolor: `${CYAN}15`, border: `1px solid ${CYAN}30`,
            }}>
              <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: CYAN, letterSpacing: '0.1em' }}>
                INTRADAY INTELLIGENCE
              </Typography>
            </Box>
            <StatusBadge
              marketOpen={isMarketOpen}
              dataMode={display?.data_mode ?? 'eod_fallback'}
              loading={loading}
            />
          </Box>

          <Typography sx={{
            ...SANS, fontSize: { xs: '2rem', md: '2.8rem' }, fontWeight: 900,
            color: INK, letterSpacing: '-0.03em', lineHeight: 1.05, mb: 1,
          }}>
            Race Intelligence
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.9rem', color: INK2, maxWidth: 520 }}>
            Real-time stock-level race: bar rankings, ATR scatter, normalized return progression,
            and pulse grid — all normalized to the 9:15 open. Refreshes every 60 seconds.
          </Typography>

          {lastRefresh && (
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3, mt: 1.5 }}>
              Last updated: {lastRefresh.toLocaleTimeString()} · {symbols.length} stocks
            </Typography>
          )}
          {error && (
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: '#ef4444', mt: 1 }}>
              {error}
            </Typography>
          )}

          {/* Replay bar (market closed) */}
          {!isMarketOpen && !loading && (
            <Box sx={{ mt: 2 }}>
              <ReplayBar
                frameIdx={replayFrame}
                playing={replayPlaying}
                hasReplayed={hasReplayed}
                onPlay={startReplay}
                onNext={() => loadReplayFrame(replayFrame + 1)}
                onReset={resetReplay}
              />
            </Box>
          )}
        </Box>
      </Box>

      {/* Content */}
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2, md: 5 }, pb: 6 }}>

        {/* Module 1 — Bar Race */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: '#6366f1' }} />
            <Typography sx={{ ...SANS, fontSize: '0.9rem', fontWeight: 800, color: INK }}>
              Module 1 — Bar Race
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>
              rank by intraday return %
            </Typography>
          </Box>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <BarPanel
                title="Top 10 Performers"
                accent={CAT_COLOR.top}
                items={panelTop}
                valueKey="return_pct"
                onSelect={handleSelectStock}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <BarPanel
                title="Bottom 10 Laggards"
                accent={CAT_COLOR.bot}
                items={panelBot}
                valueKey="return_pct"
                onSelect={handleSelectStock}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <BarPanel
                title="Rank Decliners"
                accent={CAT_COLOR.dec}
                items={panelDec}
                valueKey="diff"
                showDiff
                diffDown
                onSelect={handleSelectStock}
                emptyLine1={
                  isMarketOpen
                    ? 'No rank drops yet'
                    : !replayData
                      ? 'Loading replay…'
                      : replayData.replay_source === 'eod'
                        ? 'No closing-min data (EOD replay)'
                        : 'No rank drops in closing 5 min'
                }
                emptyLine2={
                  isMarketOpen
                    ? 'Updates each 60s refresh'
                    : !replayData
                      ? 'Fetching Kite closing candles'
                      : replayData.replay_source === 'eod'
                        ? 'Live only — needs Kite session during market hours'
                        : 'Stocks held or improved rank 15:25–15:30'
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <BarPanel
                title="Rank Recoverers"
                accent={CAT_COLOR.rec}
                items={panelRec}
                valueKey="diff"
                showDiff
                onSelect={handleSelectStock}
                emptyLine1={
                  isMarketOpen
                    ? 'No rank gains yet'
                    : !replayData
                      ? 'Loading replay…'
                      : replayData.replay_source === 'eod'
                        ? 'No closing-min data (EOD replay)'
                        : 'No rank gains in closing 5 min'
                }
                emptyLine2={
                  isMarketOpen
                    ? 'Updates each 60s refresh'
                    : !replayData
                      ? 'Fetching Kite closing candles'
                      : replayData.replay_source === 'eod'
                        ? 'Live only — needs Kite session during market hours'
                        : 'Stocks held or declined rank 15:25–15:30'
                }
              />
            </Grid>
          </Grid>
        </Box>

        {/* Stock Intelligence Panel — shown when user clicks any stock */}
        {selectedStock && (
          <Box sx={{ mb: 3 }}>
            {stockData ? (
              <StockIntelligenceCard
                data={stockData}
                onClose={() => { setSelectedStock(null); setStockData(null) }}
              />
            ) : (
              <Box sx={{ ...CARD, p: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.75rem', color: INK3 }}>
                  {stockLoading ? `Loading ${selectedStock}…` : `No data for ${selectedStock}`}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Module 2 — ATR Scatter */}
        <Box sx={{ mb: 3 }}>
          <AtrScatterChart symbols={symbols} marketOpen={isMarketOpen} />
        </Box>

        {/* Module 3 — Norm Return Progression */}
        <Box sx={{ mb: 3 }}>
          <NormReturnChart history={history} marketOpen={isMarketOpen} />
        </Box>

        {/* Module 4 — Mini Sparkline Grid */}
        <Box sx={{ mb: 3 }}>
          <MiniGrid symbols={symbols} history={history} />
        </Box>
      </Box>

      <Footer />
    </Box>
  )
}
