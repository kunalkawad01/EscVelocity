import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Grid, Typography } from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { liveApi } from '../api/liveApi'
import type {
  SectorPoint,
  SectorDrillDownResponse,
  StockIntelligenceResponse,
  StockChartResponse,
  WhyNowCard,
  ConstituentPoint,
  SectorProgressionPoint,
} from '../types/live'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const REFRESH_MS = 5000

// ── IST helpers ───────────────────────────────────────────────────────────────
function istNow(): Date {
  const n = new Date()
  return new Date(n.getTime() + (n.getTimezoneOffset() + 330) * 60000)
}
function isMarketOpen(): boolean {
  const d = istNow(); const day = d.getDay()
  if (day === 0 || day === 6) return false
  const mins = d.getHours() * 60 + d.getMinutes()
  return mins >= 555 && mins < 930   // 9:15 – 15:30 IST
}

// ── Tiny sparkline SVG ────────────────────────────────────────────────────────
function Spark({ data, w = 80, h = 28, color, full }: { data: number[]; w?: number; h?: number; color: string; full?: boolean }) {
  if (data.length < 2) return null
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const vbW = full ? 120 : w
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * vbW
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const fillId = `sp-${Math.random().toString(36).slice(2)}`
  return (
    <svg
      width={full ? '100%' : w}
      height={h}
      viewBox={full ? `0 0 ${vbW} ${h}` : undefined}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${vbW},${h}`} fill={`url(#${fillId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

// ── Live badge ────────────────────────────────────────────────────────────────
function LiveBadge({ loading, kiteOk }: { loading: boolean; kiteOk: boolean }) {
  const { CYAN } = usePalette()
  const color = loading ? CYAN : kiteOk ? '#22c55e' : '#fbbf24'
  const label = loading ? 'FETCHING' : kiteOk ? 'LIVE' : 'KITE OFFLINE'
  return (
    <Box sx={{
      px: 1.5, py: 0.35, borderRadius: 1,
      bgcolor: `${color}18`, border: `1px solid ${color}30`,
      display: 'inline-flex', alignItems: 'center', gap: 0.75,
    }}>
      <Box sx={{
        width: 6, height: 6, borderRadius: '50%', bgcolor: color,
        animation: 'pulse 1.6s ease-in-out infinite',
        '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
      }} />
      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color, letterSpacing: '0.1em' }}>
        {label}
      </Typography>
    </Box>
  )
}

// ── Section heading ───────────────────────────────────────────────────────────
function SectionHead({ title, accent, meta }: { title: React.ReactNode; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ ...SANS, fontSize: '0.82rem', fontWeight: 800, color: INK }}>{title}</Typography>
      {meta && <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, ml: 'auto' }}>{meta}</Typography>}
    </Box>
  )
}

// ── Layer 1 — Sector Scatter ──────────────────────────────────────────────────
function SectorScatterMap({
  sectors,
  niftyReturn,
  onSectorClick,
  selectedSector,
}: {
  sectors: SectorPoint[]
  niftyReturn: number
  onSectorClick: (sector: string) => void
  selectedSector: string | null
}) {
  const { PAPER, INK, INK2, INK3, BORDER, CYAN } = usePalette()
  const { mode } = useThemeMode()
  const chartRef = useRef<HighchartsReact.RefObject>(null)

  const options = useMemo((): Highcharts.Options => {
    const pts = sectors.map(s => ({
      x: s.atr_pct,
      y: s.return_pct,
      name: s.sector,
      selected: s.sector === selectedSector,
      color: s.return_pct > 0.1 ? '#22c55e' : s.return_pct < -0.1 ? '#ef4444' : '#94a3b8',
      marker: {
        radius: s.sector === selectedSector ? 11 : 8,
        lineWidth: s.sector === selectedSector ? 2 : 0,
        lineColor: CYAN,
      },
    }))

    const midX = pts.length ? pts.reduce((a, b) => a + b.x, 0) / pts.length : 1

    return {
      chart: {
        type: 'scatter',
        backgroundColor: 'transparent',
        style: { fontFamily: "'IBM Plex Sans', sans-serif" },
        animation: false,
        height: 320,
        events: {
          click: function () { /* deselect */ },
        },
      },
      title: { text: '' },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        title: { text: 'ATR %', style: { color: INK3, fontSize: '0.7rem' } },
        gridLineColor: BORDER,
        lineColor: BORDER,
        tickColor: BORDER,
        labels: { style: { color: INK3, fontSize: '0.65rem' }, format: '{value:.1f}%' },
        plotLines: [{
          value: midX,
          color: BORDER,
          dashStyle: 'Dash',
          width: 1,
          zIndex: 2,
        }],
      },
      yAxis: {
        title: { text: 'Return %', style: { color: INK3, fontSize: '0.7rem' } },
        gridLineColor: BORDER,
        labels: { style: { color: INK3, fontSize: '0.65rem' }, format: '{value:.1f}%' },
        plotLines: [{
          value: 0,
          color: mode === 'dark' ? '#ffffff30' : '#00000025',
          width: 1.5,
          zIndex: 3,
        }, {
          value: niftyReturn,
          color: `${CYAN}60`,
          dashStyle: 'Dot',
          width: 1,
          zIndex: 3,
          label: {
            text: `Nifty ${niftyReturn > 0 ? '+' : ''}${niftyReturn.toFixed(2)}%`,
            style: { color: CYAN, fontSize: '0.6rem' },
          },
        }],
      },
      tooltip: {
        backgroundColor: mode === 'dark' ? '#0B1020' : '#FAFAF7',
        borderColor: BORDER,
        style: { color: INK, fontSize: '0.72rem', fontFamily: "'IBM Plex Sans', sans-serif" },
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          const pt = this.point as Highcharts.Point & { name: string }
          const ret = (this.y as number) ?? 0
          const atr = (this.x as number) ?? 0
          return `<b>${pt.name}</b><br/>Return: ${ret > 0 ? '+' : ''}${ret.toFixed(2)}%<br/>ATR: ${atr.toFixed(2)}%`
        },
      },
      plotOptions: {
        scatter: {
          dataLabels: {
            enabled: true,
            format: '{point.name}',
            style: { color: INK2, fontSize: '0.6rem', fontWeight: '600', textOutline: 'none' },
            y: -12,
          },
          cursor: 'pointer',
          point: {
            events: {
              click: function (this: Highcharts.Point & { name: string }) {
                onSectorClick(this.name)
              },
            },
          },
        },
      },
      annotations: [],
      series: [{
        type: 'scatter',
        data: pts,
      }],
    }
  }, [sectors, niftyReturn, selectedSector, PAPER, INK, INK2, INK3, BORDER, CYAN, mode, onSectorClick])

  return (
    <Box>
      {/* Quadrant labels */}
      <Box sx={{ position: 'relative' }}>
        <HighchartsReact ref={chartRef} highcharts={Highcharts} options={options} />
        {/* Quadrant annotation overlay */}
        <Box sx={{
          position: 'absolute', top: 18, left: '55%', pointerEvents: 'none',
          fontSize: '0.58rem', color: '#22c55e80', fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 700, letterSpacing: '0.05em',
        }}>
          Q1 TRENDING LONG ↗
        </Box>
        <Box sx={{
          position: 'absolute', top: 18, left: '8%', pointerEvents: 'none',
          fontSize: '0.58rem', color: '#22c55e60', fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 700,
        }}>
          Q2 QUIET STRENGTH
        </Box>
        <Box sx={{
          position: 'absolute', bottom: 36, left: '8%', pointerEvents: 'none',
          fontSize: '0.58rem', color: '#ef444460', fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 700,
        }}>
          Q3 QUIET WEAKNESS
        </Box>
        <Box sx={{
          position: 'absolute', bottom: 36, left: '55%', pointerEvents: 'none',
          fontSize: '0.58rem', color: '#ef444480', fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 700, letterSpacing: '0.05em',
        }}>
          Q4 TRENDING SHORT ↘
        </Box>
      </Box>

      {/* Sector chips row */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
        {sectors.map(s => {
          const color = s.return_pct > 0.1 ? '#22c55e' : s.return_pct < -0.1 ? '#ef4444' : '#94a3b8'
          const sel = s.sector === selectedSector
          return (
            <Box
              key={s.sector}
              onClick={() => onSectorClick(s.sector)}
              sx={{
                px: 1.25, py: 0.4, borderRadius: 1, cursor: 'pointer',
                bgcolor: sel ? `${color}20` : `${color}0A`,
                border: `1px solid ${sel ? color : color + '40'}`,
                transition: 'all 0.15s',
                '&:hover': { bgcolor: `${color}18`, borderColor: color },
              }}
            >
              <Typography sx={{
                ...MONO, fontSize: '0.65rem', fontWeight: sel ? 700 : 500,
                color,
              }}>
                {s.sector}
                <Box component="span" sx={{ ml: 0.75, opacity: 0.8 }}>
                  {s.return_pct > 0 ? '+' : ''}{s.return_pct.toFixed(2)}%
                </Box>
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ── All-Sectors Return Progression (Layer 1, right panel) ────────────────────
const SECTOR_COLORS: Record<string, string> = {
  Banking:        '#3b82f6',
  Finance:        '#6366f1',
  IT:             '#22c55e',
  Energy:         '#f97316',
  Auto:           '#ef4444',
  Pharma:         '#8b5cf6',
  FMCG:           '#ec4899',
  Metals:         '#64748b',
  Infrastructure: '#f59e0b',
  Telecom:        '#14b8a6',
  Consumer:       '#84cc16',
}

function AllSectorsProgressionChart({
  progressions,
  source,
  tradeDate,
  selectedSector,
  onSectorClick,
}: {
  progressions: Record<string, { time: string; return_pct: number }[]>
  source: 'live' | '15min_kite' | 'none'
  tradeDate: string
  selectedSector: string | null
  onSectorClick: (sector: string) => void
}) {
  const { INK, INK3, BORDER } = usePalette()
  const { mode } = useThemeMode()

  const sectors = Object.keys(progressions)
  const is15min = source === '15min_kite'

  // Use time axis from the sector with most data points
  const timeAxis = useMemo(() => {
    if (!sectors.length) return []
    const longest = sectors.reduce((a, b) =>
      (progressions[a]?.length ?? 0) >= (progressions[b]?.length ?? 0) ? a : b
    )
    return (progressions[longest] ?? []).map(p => p.time)
  }, [progressions, sectors])

  const options = useMemo((): Highcharts.Options => {
    const series: Highcharts.SeriesOptionsType[] = sectors.map(sector => {
      const color = SECTOR_COLORS[sector] ?? '#94a3b8'
      const isSelected = sector === selectedSector
      const data = (progressions[sector] ?? []).map(p => p.return_pct)
      return {
        type: 'line',
        name: sector,
        data,
        color,
        lineWidth: isSelected ? 2.5 : 1.2,
        opacity: selectedSector && !isSelected ? 0.35 : 1,
        marker: { enabled: false },
        states: { hover: { lineWidth: 2.5 } },
        events: {
          click: function () { onSectorClick(sector) },
        },
      } as Highcharts.SeriesLineOptions
    })

    return {
      chart: {
        backgroundColor: 'transparent',
        animation: false,
        height: 310,
        style: { fontFamily: "'IBM Plex Sans', sans-serif" },
        events: {
          click: function (this: Highcharts.Chart, e: Highcharts.PointerEventObject) {
            const pt = (this as unknown as { hoverPoint?: Highcharts.Point & { series?: { name: string } } }).hoverPoint
            if (pt?.series?.name) onSectorClick(pt.series.name)
          },
        },
      },
      title: { text: '' },
      credits: { enabled: false },
      xAxis: {
        categories: timeAxis,
        labels: {
          style: { color: INK3, fontSize: '0.55rem', fontFamily: "'IBM Plex Mono', monospace" },
          step: Math.max(1, Math.floor(timeAxis.length / 7)),
        },
        gridLineColor: BORDER,
        lineColor: BORDER,
        tickColor: BORDER,
      },
      yAxis: {
        title: { text: '' },
        gridLineColor: BORDER,
        labels: { style: { color: INK3, fontSize: '0.58rem' }, format: '{value:.1f}%' },
        plotLines: [{
          value: 0,
          color: mode === 'dark' ? '#ffffff30' : '#00000025',
          width: 1.5,
          zIndex: 3,
        }],
      },
      legend: {
        enabled: true,
        layout: 'horizontal',
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: { color: INK3, fontSize: '0.58rem', fontWeight: '500', cursor: 'pointer' },
        itemHoverStyle: { color: INK },
      },
      tooltip: {
        shared: true,
        backgroundColor: mode === 'dark' ? '#0B1020' : '#FAFAF7',
        borderColor: BORDER,
        style: { color: INK, fontSize: '0.68rem', fontFamily: "'IBM Plex Sans', sans-serif" },
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          const pts = (this.points ?? [])
            .slice()
            .sort((a, b) => (b.y as number) - (a.y as number))
          let html = `<span style="font-size:0.6rem;color:#94a3b8">${this.x}</span><br/>`
          pts.forEach(pt => {
            const ret = pt.y as number
            const col = ret >= 0 ? '#22c55e' : '#ef4444'
            html += `<span style="color:${pt.color}">●</span> ${pt.series.name}: `
            html += `<b style="color:${col}">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</b><br/>`
          })
          return html
        },
      },
      plotOptions: {
        line: { cursor: 'pointer' },
        series: { animation: false },
      },
      series,
    }
  }, [progressions, timeAxis, selectedSector, sectors, INK, INK3, BORDER, mode, onSectorClick])

  if (source === 'none' || sectors.length === 0) {
    return (
      <Box sx={{ height: 310, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK3 }}>Loading sector data…</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, opacity: 0.6 }}>
          {isMarketOpen() ? 'Accumulating live ticks…' : 'Fetching 15-min Kite history…'}
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        {is15min ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#f59e0b' }} />
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: '#f59e0b' }}>
              15-MIN · {tradeDate} · From 9:15 Open
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e',
              animation: 'pulse 1.6s ease-in-out infinite',
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
            }} />
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: '#22c55e' }}>LIVE · 5-sec ticks</Typography>
          </Box>
        )}
        <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3, ml: 'auto' }}>
          Click line or legend to drill down
        </Typography>
      </Box>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ── Stocks Return Progression (Layer 2 Panel 2) ──────────────────────────────
const STOCK_LINE_COLORS = [
  '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#64748b', '#0ea5e9',
]

function StocksProgressionChart({
  progressions,
  source = 'live',
  selectedStock,
  onStockClick,
}: {
  progressions: Record<string, { time: string; return_pct: number }[]>
  source?: 'live' | '15min_kite'
  selectedStock: string | null
  onStockClick: (symbol: string) => void
}) {
  const { INK, INK3, BORDER } = usePalette()
  const { mode } = useThemeMode()

  const symbols = Object.keys(progressions)
  const is15min = source === '15min_kite'

  const timeAxis = useMemo(() => {
    if (!symbols.length) return []
    const longest = symbols.reduce((a, b) =>
      (progressions[a]?.length ?? 0) >= (progressions[b]?.length ?? 0) ? a : b
    )
    return (progressions[longest] ?? []).map(p => p.time)
  }, [progressions, symbols])

  const options = useMemo((): Highcharts.Options => {
    const series: Highcharts.SeriesOptionsType[] = symbols.map((sym, idx) => {
      const color = STOCK_LINE_COLORS[idx % STOCK_LINE_COLORS.length]
      const isSelected = sym === selectedStock
      return {
        type: 'line',
        name: sym,
        data: (progressions[sym] ?? []).map(p => p.return_pct),
        color,
        lineWidth: isSelected ? 2.5 : 1.2,
        opacity: selectedStock && !isSelected ? 0.3 : 1,
        marker: { enabled: false },
        states: { hover: { lineWidth: 2.5 } },
        events: { click: function () { onStockClick(sym) } },
      } as Highcharts.SeriesLineOptions
    })

    return {
      chart: {
        backgroundColor: 'transparent',
        animation: false,
        height: 260,
        style: { fontFamily: "'IBM Plex Sans', sans-serif" },
      },
      title: { text: '' },
      credits: { enabled: false },
      xAxis: {
        categories: timeAxis,
        labels: {
          style: { color: INK3, fontSize: '0.55rem', fontFamily: "'IBM Plex Mono', monospace" },
          step: Math.max(1, Math.floor(timeAxis.length / 7)),
        },
        gridLineColor: BORDER,
        lineColor: BORDER,
        tickColor: BORDER,
      },
      yAxis: {
        title: { text: '' },
        gridLineColor: BORDER,
        labels: { style: { color: INK3, fontSize: '0.58rem' }, format: '{value:.1f}%' },
        plotLines: [{
          value: 0,
          color: mode === 'dark' ? '#ffffff30' : '#00000025',
          width: 1.5,
          zIndex: 3,
        }],
      },
      legend: {
        enabled: true,
        layout: 'horizontal',
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: { color: INK3, fontSize: '0.58rem', fontWeight: '500', cursor: 'pointer' },
        itemHoverStyle: { color: INK },
      },
      tooltip: {
        shared: true,
        backgroundColor: mode === 'dark' ? '#0B1020' : '#FAFAF7',
        borderColor: BORDER,
        style: { color: INK, fontSize: '0.68rem', fontFamily: "'IBM Plex Sans', sans-serif" },
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          const pts = (this.points ?? []).slice().sort((a, b) => (b.y as number) - (a.y as number))
          let html = `<span style="font-size:0.6rem;color:#94a3b8">${this.x}</span><br/>`
          pts.forEach(pt => {
            const ret = pt.y as number
            const col = ret >= 0 ? '#22c55e' : '#ef4444'
            html += `<span style="color:${pt.color}">●</span> ${pt.series.name}: `
            html += `<b style="color:${col}">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</b><br/>`
          })
          return html
        },
      },
      plotOptions: {
        line: { cursor: 'pointer' },
        series: { animation: false },
      },
      series,
    }
  }, [progressions, timeAxis, selectedStock, symbols, INK, INK3, BORDER, mode, onStockClick])

  if (!symbols.length) {
    return (
      <Box sx={{ height: 260, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK3 }}>No stock data yet</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, opacity: 0.6 }}>
          {isMarketOpen() ? 'Accumulating live ticks…' : 'Fetching 15-min Kite history…'}
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        {is15min ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#f59e0b' }} />
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: '#f59e0b' }}>15-MIN · From 9:15 Open</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e',
              animation: 'pulse 1.6s ease-in-out infinite',
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
            }} />
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: '#22c55e' }}>LIVE · 5-sec ticks</Typography>
          </Box>
        )}
        <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3, ml: 'auto' }}>
          Click line to select stock
        </Typography>
      </Box>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ── Constituent scatter (Layer 2 Panel 1) ─────────────────────────────────────
function ConstituentScatter({
  data,
  onStockClick,
}: {
  data: ConstituentPoint[]
  onStockClick: (symbol: string) => void
}) {
  const { INK, INK2, INK3, BORDER, CYAN } = usePalette()
  const { mode } = useThemeMode()

  const options = useMemo((): Highcharts.Options => ({
    chart: {
      type: 'scatter',
      backgroundColor: 'transparent',
      animation: false,
      height: 220,
    },
    title: { text: '' },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      title: { text: 'ATR %', style: { color: INK3, fontSize: '0.65rem' } },
      gridLineColor: BORDER,
      lineColor: BORDER,
      tickColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.6rem' }, format: '{value:.1f}%' },
    },
    yAxis: {
      title: { text: 'Return %', style: { color: INK3, fontSize: '0.65rem' } },
      gridLineColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.6rem' }, format: '{value:.1f}%' },
      plotLines: [{ value: 0, color: BORDER, width: 1, zIndex: 3 }],
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0B1020' : '#FAFAF7',
      borderColor: BORDER,
      style: { color: INK, fontSize: '0.7rem', fontFamily: "'IBM Plex Sans', sans-serif" },
      formatter: function (this: Highcharts.TooltipFormatterContextObject) {
        const pt = this.point as Highcharts.Point & { name: string }
        const ret = (this.y as number) ?? 0
        const atr = (this.x as number) ?? 0
        return `<b>${pt.name}</b><br/>Return: ${ret > 0 ? '+' : ''}${ret.toFixed(2)}%<br/>ATR: ${atr.toFixed(2)}%`
      },
    },
    plotOptions: {
      scatter: {
        dataLabels: {
          enabled: true,
          format: '{point.name}',
          style: { color: INK2, fontSize: '0.55rem', fontWeight: '600', textOutline: 'none' },
          y: -9,
        },
        cursor: 'pointer',
        point: {
          events: {
            click: function (this: Highcharts.Point & { name: string }) {
              onStockClick(this.name)
            },
          },
        },
      },
    },
    series: [{
      type: 'scatter',
      data: data.map(c => ({
        x: c.atr_pct,
        y: c.return_pct,
        name: c.symbol,
        color: c.return_pct > 0 ? '#22c55e' : '#ef4444',
        marker: { radius: 7 },
      })),
    }],
  }), [data, INK, INK2, INK3, BORDER, CYAN, mode, onStockClick])

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Intraday progression chart ────────────────────────────────────────────────
function IntradayChart({
  progression,
  source = 'live',
}: {
  progression: SectorDrillDownResponse['intraday_progression']
  source?: 'live' | '15min_kite'
}) {
  const { INK3, BORDER, CYAN } = usePalette()
  const { mode } = useThemeMode()

  const is15min = source === '15min_kite'

  const opts = useMemo((): Highcharts.Options => ({
    chart: { backgroundColor: 'transparent', animation: false, height: 200 },
    title: { text: '' },
    credits: { enabled: false },
    legend: {
      enabled: true,
      itemStyle: { color: INK3, fontSize: '0.65rem', fontWeight: '500' },
    },
    xAxis: {
      categories: progression.map(p => p.time),
      labels: {
        style: { color: INK3, fontSize: '0.58rem', fontFamily: "'IBM Plex Mono', monospace" },
        step: Math.max(1, Math.floor(progression.length / 8)),
      },
      gridLineColor: BORDER,
      lineColor: BORDER,
      tickColor: BORDER,
    },
    yAxis: {
      title: { text: '' },
      gridLineColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.6rem' }, format: '{value:.2f}%' },
      plotLines: [{
        value: 0,
        color: mode === 'dark' ? '#ffffff30' : '#00000020',
        width: 1.5,
        zIndex: 3,
        label: is15min
          ? { text: '09:15 Open', style: { color: INK3, fontSize: '0.55rem' }, align: 'right', x: -4 }
          : undefined,
      }],
    },
    tooltip: {
      shared: true,
      backgroundColor: mode === 'dark' ? '#0B1020' : '#FAFAF7',
      borderColor: BORDER,
      style: { color: INK3, fontSize: '0.7rem', fontFamily: "'IBM Plex Sans', sans-serif" },
      formatter: function (this: Highcharts.TooltipFormatterContextObject) {
        const pts = this.points ?? []
        const time = (this.x as string) ?? ''
        let html = `<span style="font-size:0.6rem;color:#94a3b8">${time}</span><br/>`
        pts.forEach(pt => {
          const col = (pt.y as number) >= 0 ? '#22c55e' : '#ef4444'
          html += `<span style="color:${pt.color}">${pt.series.name}</span>: `
          html += `<b style="color:${col}">${(pt.y as number) >= 0 ? '+' : ''}${(pt.y as number).toFixed(2)}%</b><br/>`
        })
        return html
      },
    },
    series: [
      {
        type: 'area',
        name: 'Sector',
        data: progression.map(p => p.sector_return),
        color: CYAN,
        lineWidth: 2,
        fillColor: `${CYAN}12`,
        marker: { enabled: false },
        threshold: 0,
        negativeColor: '#ef4444',
        negativeFillColor: '#ef444412',
      },
      ...(is15min ? [] : [{
        type: 'line' as const,
        name: 'Nifty',
        data: progression.map(p => p.nifty_return),
        color: '#94a3b8',
        lineWidth: 1,
        dashStyle: 'Dash' as const,
        marker: { enabled: false },
      }]),
    ],
  }), [progression, source, INK3, BORDER, CYAN, mode, is15min])

  return (
    <Box>
      {is15min && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#f59e0b' }} />
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: '#f59e0b' }}>
            15-MIN KITE · 9:15 AM → 3:30 PM · Returns from open
          </Typography>
        </Box>
      )}
      <HighchartsReact highcharts={Highcharts} options={opts} />
    </Box>
  )
}

// ── Correlation chart (Layer 2 Panel 4) ──────────────────────────────────────
function CorrelationChart({
  times,
  values,
  current,
}: {
  times: string[]
  values: number[]
  current: number
}) {
  const { INK3, BORDER } = usePalette()
  const { mode } = useThemeMode()
  const color = current > 0.7 ? '#f59e0b' : current > 0.4 ? '#60a5fa' : '#22c55e'

  const opts = useMemo((): Highcharts.Options => ({
    chart: { backgroundColor: 'transparent', animation: false, height: 150 },
    title: { text: '' },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      categories: times,
      labels: { style: { color: INK3, fontSize: '0.55rem' }, step: Math.max(1, Math.floor(times.length / 6)) },
      gridLineColor: BORDER,
      lineColor: BORDER,
      tickColor: BORDER,
    },
    yAxis: {
      min: -1, max: 1,
      title: { text: '' },
      gridLineColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.6rem' }, format: '{value:.2f}' },
      plotLines: [
        { value: 0.7, color: '#f59e0b40', width: 1, dashStyle: 'Dash' },
        { value: 0.4, color: '#60a5fa40', width: 1, dashStyle: 'Dot' },
      ],
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0B1020' : '#FAFAF7',
      style: { color: INK3, fontSize: '0.7rem', fontFamily: "'IBM Plex Sans', sans-serif" },
      formatter: function (this: Highcharts.TooltipFormatterContextObject) {
        return `Correlation: ${(this.y ?? 0).toFixed(3)}`
      },
    },
    series: [{
      type: 'line',
      data: values,
      color,
      lineWidth: 2,
      marker: { enabled: false },
    }],
  }), [times, values, color, INK3, BORDER, mode])

  return <HighchartsReact highcharts={Highcharts} options={opts} />
}

// ── Layer 2 — Sector Drill-Down ───────────────────────────────────────────────
function SectorDrillDown({
  data,
  onStockClick,
  selectedStock,
}: {
  data: SectorDrillDownResponse
  onStockClick: (symbol: string) => void
  selectedStock: string | null
}) {
  const { INK, INK2, INK3, BORDER, PAPER2 } = usePalette()
  const { CARD } = useTokens()

  const retColor = data.return_pct > 0 ? '#22c55e' : data.return_pct < 0 ? '#ef4444' : '#94a3b8'
  const corrColor = data.current_correlation > 0.7 ? '#f59e0b' : data.current_correlation > 0.4 ? '#60a5fa' : '#22c55e'
  const stockProg = data.stock_progressions ?? {}

  return (
    <Box sx={{ mt: 2.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ ...SANS, fontSize: '1rem', fontWeight: 800, color: INK }}>
          {data.sector}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: '0.75rem', color: retColor, fontWeight: 700 }}>
            {data.return_pct > 0 ? '+' : ''}{data.return_pct.toFixed(2)}%
          </Typography>
          {data.short_bias && (
            <Box sx={{
              px: 1, py: 0.25, borderRadius: 1,
              bgcolor: '#ef444415', border: '1px solid #ef444430',
            }}>
              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: '#ef4444', fontWeight: 700 }}>
                SHORT BIAS
              </Typography>
            </Box>
          )}
          <Typography sx={{ ...MONO, fontSize: '0.68rem', color: corrColor }}>
            Corr {data.current_correlation.toFixed(2)}
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={2}>
        {/* Panel 1 — Constituent scatter */}
        <Grid item xs={12} md={6}>
          <Box sx={{ ...CARD, p: 2 }}>
            <SectionHead title="Constituent Scatter" accent="#6366f1" />
            <ConstituentScatter data={data.constituents} onStockClick={onStockClick} />
          </Box>
        </Grid>

        {/* Panel 2 — Stocks Return Progression */}
        <Grid item xs={12} md={6}>
          <Box sx={{ ...CARD, p: 2, height: '100%' }}>
            <SectionHead title="Stocks Return Progression" accent="#22c55e" meta={`${Object.keys(stockProg).length} stocks`} />
            <StocksProgressionChart
              progressions={stockProg}
              source={data.intraday_progression_source as 'live' | '15min_kite'}
              selectedStock={selectedStock}
              onStockClick={onStockClick}
            />
          </Box>
        </Grid>

        {/* Panel 3 — Mini charts (md=8) + Intra-Sector Correlation (md=4) */}
        <Grid item xs={12} md={8}>
          <Box sx={{ ...CARD, p: 2 }}>
            <SectionHead title="Constituent Mini-Charts" accent="#f59e0b" meta={`${data.mini_charts.length} stocks`} />
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 1 }}>
              {data.mini_charts.map(mc => {
                const col = mc.return_pct > 0 ? '#22c55e' : '#ef4444'
                const isSel = mc.symbol === selectedStock
                return (
                  <Box
                    key={mc.symbol}
                    onClick={() => onStockClick(mc.symbol)}
                    sx={{
                      p: 1.25, borderRadius: 1.5, cursor: 'pointer',
                      bgcolor: PAPER2,
                      border: `1px solid ${isSel ? col : BORDER}`,
                      transition: 'all 0.15s',
                      '&:hover': { borderColor: col, bgcolor: `${col}08` },
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Typography sx={{ ...MONO, fontSize: '0.68rem', fontWeight: 700, color: INK }}>
                        {mc.symbol}
                      </Typography>
                      <Typography sx={{ ...MONO, fontSize: '0.62rem', color: col, fontWeight: 700 }}>
                        {mc.return_pct > 0 ? '+' : ''}{mc.return_pct.toFixed(2)}%
                      </Typography>
                    </Box>
                    <Spark data={mc.sparkline} color={col} w={100} h={24} />
                    <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK2, mt: 0.5 }}>
                      ₹{mc.ltp.toLocaleString('en-IN')}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          </Box>
        </Grid>

        {/* Panel 4 — Intra-Sector Correlation (compact, md=4) */}
        <Grid item xs={12} md={4}>
          <Box sx={{ ...CARD, p: 2, height: '100%' }}>
            <SectionHead title="Intra-Sector Correlation" accent="#8b5cf6" />
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ ...SANS, fontSize: '0.72rem', color: corrColor, fontWeight: 700 }}>
                {data.current_correlation.toFixed(3)}
                <Box component="span" sx={{ color: INK3, fontWeight: 400, ml: 1 }}>
                  {data.current_correlation > 0.7
                    ? '— High'
                    : data.current_correlation > 0.4
                    ? '— Moderate'
                    : '— Low (divergence)'}
                </Box>
              </Typography>
            </Box>
            {data.correlation_history.length > 2 ? (
              <CorrelationChart
                times={data.correlation_times}
                values={data.correlation_history}
                current={data.current_correlation}
              />
            ) : (
              <Box sx={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>
                  Building history…
                </Typography>
              </Box>
            )}
            <Box sx={{ mt: 1.5, p: 1.25, bgcolor: PAPER2, borderRadius: 1.5, border: `1px solid ${BORDER}` }}>
              <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, lineHeight: 1.6 }}>
                {data.current_correlation > 0.7 && data.return_pct < 0
                  ? '↓ High corr + falling = systematic short'
                  : data.current_correlation > 0.7 && data.return_pct > 0
                  ? '↑ High corr + rising = systematic long'
                  : '⇅ Low corr = divergence opportunities'}
              </Typography>
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  )
}

// ── Health Score gauge SVG ───────────────────────────────────────────────────
function HealthGauge({ score }: { score: number }) {
  const { BORDER } = usePalette()
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'
  const R = 48, cx = 64, cy = 58
  const pct = Math.min(Math.max(score / 100, 0.001), 0.999)
  const ex = cx + R * Math.cos((1 - pct) * Math.PI)
  const ey = cy - R * Math.sin((1 - pct) * Math.PI)
  return (
    <Box sx={{ textAlign: 'center' }}>
      <svg width={128} height={68} style={{ display: 'block', margin: '0 auto' }}>
        <path d={`M${cx-R} ${cy} A${R} ${R} 0 0 0 ${cx+R} ${cy}`}
          fill="none" stroke={BORDER} strokeWidth={9} strokeLinecap="round" />
        <path d={`M${cx-R} ${cy} A${R} ${R} 0 0 0 ${ex.toFixed(2)} ${ey.toFixed(2)}`}
          fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
        <text x={cx} y={cy+2} textAnchor="middle" fill={color}
          fontSize="21" fontWeight="900" fontFamily="IBM Plex Mono,monospace">{score}</text>
        <text x={cx} y={cy+16} textAnchor="middle" fill="#94a3b8"
          fontSize="8" fontFamily="IBM Plex Sans,sans-serif">/100</text>
      </svg>
    </Box>
  )
}

// ── Multi-TF price mini-charts (inside Layer 3) ───────────────────────────────
function TFCard({ label, closes }: { label: string; closes: number[] }) {
  const { INK, INK3, BORDER, PAPER2 } = usePalette()

  if (closes.length < 2) {
    return (
      <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: 1.5, p: 1, textAlign: 'center' }}>
        <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: INK3, mb: 0.75 }}>{label}</Typography>
        <Box sx={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>–</Typography>
        </Box>
      </Box>
    )
  }

  const first = closes[0], last = closes[closes.length - 1]
  const ret = (last - first) / first * 100
  const color = ret >= 0 ? '#22c55e' : '#ef4444'

  return (
    <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: 1.5, p: 1, '&:hover': { borderColor: color } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: INK3 }}>{label}</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color }}>
          {ret >= 0 ? '+' : ''}{ret.toFixed(1)}%
        </Typography>
      </Box>
      <Spark data={closes} color={color} h={52} full />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography sx={{ ...MONO, fontSize: '0.52rem', color: INK3 }}>₹{first.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.52rem', color, fontWeight: 700 }}>₹{last.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</Typography>
      </Box>
    </Box>
  )
}

function MultiTFRow({ intraday, chartData }: { intraday: number[]; chartData: StockChartResponse | null }) {
  const allCloses = useMemo(() => {
    if (!chartData) return []
    return chartData.bars.map(b => b.c).filter((c): c is number => c != null && c > 0)
  }, [chartData])

  const specs = [
    { label: '1D',  closes: intraday },
    { label: '1M',  closes: allCloses.slice(-21) },
    { label: '3M',  closes: allCloses.slice(-63) },
    { label: '6M',  closes: allCloses.slice(-126) },
    { label: '1Y',  closes: allCloses.slice(-252) },
    { label: '5Y',  closes: allCloses },
  ]

  return (
    <Grid container spacing={1} sx={{ mb: 2.5 }}>
      {specs.map(({ label, closes }) => (
        <Grid item xs={4} sm={2} key={label}>
          <TFCard label={label} closes={closes} />
        </Grid>
      ))}
    </Grid>
  )
}

// ── Layer 3 — Stock Intelligence Card (comprehensive) ─────────────────────────
const TF_RANGES = ['5D', '1M', '3M', '6M', '1Y'] as const
type TFRange = typeof TF_RANGES[number]
const TF_DAYS: Record<TFRange, number> = { '5D': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 252 }
const TF_KEYS = ['1d', '1w', '1m', '3m', '6m', '1y'] as const

function rankColor(rank: number | null, total: number): string {
  if (!rank) return '#94a3b8'
  const pct = rank / total
  return pct <= 0.33 ? '#22c55e' : pct >= 0.67 ? '#ef4444' : '#f59e0b'
}

function StockIntelligenceCard({
  data,
  onClose,
}: {
  data: StockIntelligenceResponse
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { INK, INK2, INK3, BORDER, CYAN, PAPER2 } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()

  const [chartData, setChartData] = useState<StockChartResponse | null>(null)
  const [chartLoading, setChartLoading] = useState(true)
  const [tfRange, setTfRange] = useState<TFRange>('3M')
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [edgeData, setEdgeData] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [dnaData, setDnaData] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [patternData, setPatternData] = useState<any>(null)

  useEffect(() => {
    setChartLoading(true)
    setChartData(null)
    setEdgeData(null)
    setDnaData(null)
    setPatternData(null)

    liveApi.getStockChart(data.symbol).then(setChartData).catch(() => {}).finally(() => setChartLoading(false))
    fetch(`/api/indicators/${data.symbol}/edge`).then(r => r.ok ? r.json() : null).then(setEdgeData).catch(() => {})
    fetch(`/api/patterns/${data.symbol}/dna`).then(r => r.ok ? r.json() : null).then(setDnaData).catch(() => {})
    fetch(`/api/patterns/${data.symbol}/history`).then(r => r.ok ? r.json() : null).then(setPatternData).catch(() => {})
  }, [data.symbol])

  const chartBars = useMemo(() => {
    if (!chartData) return []
    const n = TF_DAYS[tfRange]
    return chartData.bars.slice(-n)
  }, [chartData, tfRange])

  const ohlcOptions = useMemo((): Highcharts.Options => {
    const ohlc  = chartBars.map(b => [new Date(b.t).getTime(), b.o, b.h, b.l, b.c])
    const close = chartBars.map(b => [new Date(b.t).getTime(), b.c])
    const vol   = chartBars.map(b => [new Date(b.t).getTime(), b.v])
    const s20   = chartBars.filter(b => b.sma20  != null).map(b => [new Date(b.t).getTime(), b.sma20])
    const s50   = chartBars.filter(b => b.sma50  != null).map(b => [new Date(b.t).getTime(), b.sma50])
    const s200  = chartBars.filter(b => b.sma200 != null).map(b => [new Date(b.t).getTime(), b.sma200])

    const isCandle = chartType === 'candlestick'
    const priceFormatter = isCandle
      ? function (this: Highcharts.TooltipFormatterContextObject) {
          const pt = this.point as Highcharts.Point & { open?: number; high?: number; low?: number; close?: number }
          if (pt.open != null) {
            const date = new Date(this.x as number).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
            const ret = pt.close != null && pt.open != null ? ((pt.close - pt.open) / pt.open * 100).toFixed(2) : '—'
            const col = pt.close != null && pt.open != null && pt.close >= pt.open ? '#22c55e' : '#ef4444'
            return `<span style="font-size:0.65rem;color:#94a3b8">${date}</span><br/>` +
              `<b style="color:${col}">O</b> ₹${pt.open?.toFixed(2)} &nbsp; ` +
              `<b style="color:${col}">H</b> ₹${pt.high?.toFixed(2)} &nbsp; ` +
              `<b style="color:${col}">L</b> ₹${pt.low?.toFixed(2)} &nbsp; ` +
              `<b style="color:${col}">C</b> ₹${pt.close?.toFixed(2)} &nbsp; ` +
              `<span style="color:${col}">${ret}%</span>`
          }
          return false
        }
      : function (this: Highcharts.TooltipFormatterContextObject) {
          const date = new Date(this.x as number).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          return `<span style="font-size:0.65rem;color:#94a3b8">${date}</span><br/>` +
            `<b style="color:${CYAN}">₹${(this.y as number).toFixed(2)}</b>`
        }

    return {
      chart: { backgroundColor: 'transparent', style: { fontFamily: "'IBM Plex Sans', sans-serif" }, animation: false, height: 340 },
      title: { text: '' },
      credits: { enabled: false },
      rangeSelector: { enabled: false },
      navigator: { enabled: false },
      scrollbar: { enabled: false },
      xAxis: {
        type: 'datetime',
        lineColor: BORDER, tickColor: BORDER, gridLineColor: BORDER,
        labels: { style: { color: INK3, fontSize: '0.6rem', fontFamily: "'IBM Plex Mono', monospace" } },
        crosshair: { color: `${CYAN}55`, dashStyle: 'Dash' },
      },
      yAxis: [
        {
          lineColor: BORDER, gridLineColor: BORDER, height: '70%',
          labels: { style: { color: INK3, fontSize: '0.6rem', fontFamily: "'IBM Plex Mono', monospace" }, format: '₹{value:.0f}', align: 'right', x: -4 },
          crosshair: { color: `${CYAN}30`, dashStyle: 'Dash' },
        },
        {
          lineColor: BORDER, gridLineColor: `${BORDER}50`, top: '73%', height: '25%', offset: 0,
          labels: { style: { color: INK3, fontSize: '0.55rem' }, format: '{value}', align: 'right', x: -4 },
        },
      ],
      tooltip: {
        split: false, shared: false,
        backgroundColor: mode === 'dark' ? '#0B1020' : '#FAFAF7',
        borderColor: BORDER,
        style: { color: INK, fontSize: '0.7rem', fontFamily: "'IBM Plex Sans', sans-serif" },
        formatter: priceFormatter,
      },
      plotOptions: {
        candlestick: { color: '#ef4444', upColor: '#22c55e', lineColor: '#ef4444', upLineColor: '#22c55e' },
        area: { fillOpacity: 0.08, threshold: null },
        series: { animation: false },
      },
      legend: {
        enabled: true,
        itemStyle: { color: INK3, fontSize: '0.6rem', fontWeight: '500', fontFamily: "'IBM Plex Sans', sans-serif" },
      },
      series: [
        isCandle
          ? { type: 'candlestick', name: data.symbol, data: ohlc, yAxis: 0 }
          : { type: 'area', name: data.symbol, data: close, yAxis: 0, color: CYAN, lineWidth: 1.5, fillColor: `${CYAN}12`, marker: { enabled: false } },
        { type: 'column', name: 'Volume', data: vol, yAxis: 1, color: `${CYAN}28`, borderWidth: 0, showInLegend: false },
        { type: 'line', name: 'SMA 20',  data: s20,  yAxis: 0, color: '#f59e0b', lineWidth: 1.5, marker: { enabled: false } },
        { type: 'line', name: 'SMA 50',  data: s50,  yAxis: 0, color: '#3b82f6', lineWidth: 1.5, marker: { enabled: false } },
        { type: 'line', name: 'SMA 200', data: s200, yAxis: 0, color: '#6366f1', lineWidth: 2,   marker: { enabled: false }, dashStyle: 'ShortDash' },
      ],
    }
  }, [chartBars, chartType, BORDER, INK, INK3, CYAN, mode, data.symbol])

  const ddOptions = useMemo((): Highcharts.Options => {
    const ddData = chartBars.map(b => [new Date(b.t).getTime(), b.dd])
    return {
      chart: { backgroundColor: 'transparent', animation: false, height: 100 },
      title: { text: '' },
      credits: { enabled: false },
      xAxis: {
        type: 'datetime', lineColor: BORDER, tickColor: BORDER, gridLineColor: `${BORDER}60`,
        labels: { style: { color: INK3, fontSize: '0.55rem', fontFamily: "'IBM Plex Mono', monospace" } },
      },
      yAxis: {
        lineColor: BORDER, gridLineColor: `${BORDER}60`, max: 0,
        labels: { style: { color: INK3, fontSize: '0.55rem' }, format: '{value:.0f}%' },
        title: { text: '' },
      },
      tooltip: {
        backgroundColor: mode === 'dark' ? '#0B1020' : '#FAFAF7',
        borderColor: BORDER,
        style: { color: INK, fontSize: '0.68rem' },
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          const d = new Date(this.x as number).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
          return `${d}: <b>${(this.y as number).toFixed(2)}%</b>`
        },
      },
      plotOptions: {
        area: { fillOpacity: 0.18, lineWidth: 1.5, marker: { enabled: false }, threshold: 0 },
        series: { animation: false },
      },
      legend: { enabled: false },
      series: [{ type: 'area', name: 'Drawdown', data: ddData, color: '#ef4444', fillColor: '#ef444420' }],
    }
  }, [chartBars, BORDER, INK, INK3, mode])

  const biasColor = data.bias === 'long' ? '#22c55e' : data.bias === 'short' ? '#ef4444' : '#94a3b8'
  const retColor  = data.return_pct > 0 ? '#22c55e' : '#ef4444'

  // Best recent pattern from history
  const bestPattern = useMemo(() => {
    const items = patternData?.items
    if (!Array.isArray(items) || items.length === 0) return null
    return items[0]
  }, [patternData])

  return (
    <Box sx={{ ...CARD, p: 2.5, mt: 2.5 }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: '1.15rem', fontWeight: 900, color: INK }}>{data.symbol}</Typography>
          <Box sx={{ px: 1.25, py: 0.3, borderRadius: 1, bgcolor: `${biasColor}15`, border: `1px solid ${biasColor}40` }}>
            <Typography sx={{ ...MONO, fontSize: '0.68rem', fontWeight: 800, color: biasColor }}>
              {data.bias === 'long' ? '🟢 LONG' : data.bias === 'short' ? '🔴 SHORT' : '⚪ NEUTRAL'}
            </Typography>
          </Box>
          <Typography sx={{ ...MONO, fontSize: '0.95rem', fontWeight: 700, color: INK }}>₹{data.ltp.toLocaleString('en-IN')}</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 700, color: retColor }}>
            {data.return_pct > 0 ? '+' : ''}{data.return_pct.toFixed(2)}%
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Box component="button" onClick={() => navigate(`/stock/${data.symbol}`)} sx={{
            px: 1.25, py: 0.5, borderRadius: 1, cursor: 'pointer',
            bgcolor: `${CYAN}15`, border: `1px solid ${CYAN}40`,
            ...MONO, fontSize: '0.65rem', color: CYAN, fontWeight: 700,
            '&:hover': { bgcolor: `${CYAN}25` },
          }}>Full Research →</Box>
          <Box component="button" onClick={onClose} sx={{
            px: 1, py: 0.5, borderRadius: 1, cursor: 'pointer',
            bgcolor: 'transparent', border: `1px solid ${BORDER}`,
            ...MONO, fontSize: '0.65rem', color: INK3,
            '&:hover': { color: INK, borderColor: INK3 },
          }}>✕</Box>
        </Box>
      </Box>

      <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2 }}>{data.bias_rationale}</Typography>

      {/* ── Range selector + chart-type toggle ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, flexWrap: 'wrap' }}>
        {TF_RANGES.map(tf => (
          <Box key={tf} onClick={() => setTfRange(tf)} sx={{
            px: 1.25, py: 0.3, borderRadius: 1, cursor: 'pointer',
            bgcolor: tfRange === tf ? `${CYAN}22` : 'transparent',
            border: `1px solid ${tfRange === tf ? CYAN : BORDER}`,
            transition: 'all 0.12s',
          }}>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', fontWeight: 700, color: tfRange === tf ? CYAN : INK3 }}>{tf}</Typography>
          </Box>
        ))}

        {/* candlestick / line toggle */}
        <Box sx={{ display: 'flex', borderRadius: 1, overflow: 'hidden', border: `1px solid ${BORDER}`, ml: 0.5 }}>
          {(['candlestick', 'line'] as const).map(ct => (
            <Box key={ct} onClick={() => setChartType(ct)} sx={{
              px: 1.1, py: 0.3, cursor: 'pointer',
              bgcolor: chartType === ct ? `${CYAN}22` : 'transparent',
              borderRight: ct === 'candlestick' ? `1px solid ${BORDER}` : 'none',
              transition: 'background 0.12s',
            }}>
              <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: chartType === ct ? CYAN : INK3 }}>
                {ct === 'candlestick' ? '📊 Candle' : '📈 Line'}
              </Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
          {[{ label: 'SMA20', color: '#f59e0b' }, { label: 'SMA50', color: '#3b82f6' }, { label: 'SMA200', color: '#6366f1' }].map(s => (
            <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
              <Box sx={{ width: 16, height: 2, bgcolor: s.color, borderRadius: 1 }} />
              <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>{s.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── Highstock Chart ── */}
      <Box sx={{ bgcolor: PAPER2, borderRadius: 2, p: 1, mb: 2.5, border: `1px solid ${BORDER}` }}>
        {chartLoading ? (
          <Box sx={{ height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK3 }}>Loading chart…</Typography>
          </Box>
        ) : chartBars.length > 0 ? (
          <HighchartsReact highcharts={Highcharts} constructorType="stockChart" options={ohlcOptions} immutable={false} />
        ) : (
          <Box sx={{ height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK3 }}>No chart data</Typography>
          </Box>
        )}
      </Box>

      {/* ── Multi-TF price row ── */}
      <MultiTFRow intraday={data.sparkline_intraday} chartData={chartData} />

      {/* ── Intelligence Dashboard ── */}
      {(() => {
        const rf = chartData?.ranks_tf ?? {}
        const bars20 = chartData ? chartData.bars.slice(-21) : []
        const lastBar = bars20.length ? bars20[bars20.length - 1] : null
        const lastVol = lastBar?.v ?? 0
        const prevBars = bars20.slice(0, -1)
        const avgVol = prevBars.length ? prevBars.reduce((s, b) => s + b.v, 0) / prevBars.length : lastVol || 1
        const volRatio = avgVol > 0 ? lastVol / avgVol : 1
        const ret1d = rf['1d']?.return_pct ?? data.return_pct

        const hTrend = (data.above_vwap ? 10 : 0) + (data.sma.above_sma20 ? 5 : 0) + (data.sma.above_sma50 ? 6 : 0) + (data.sma.above_sma200 ? 4 : 0)
        const tfKeys4 = ['1d','1w','1m','3m'] as const
        const momPcts = tfKeys4.map(tf => rf[tf]).filter(Boolean).map(r => r.universe_rank != null ? (1 - r.universe_rank / r.universe_total) : 0.5)
        const hMom = momPcts.length ? Math.max(2, Math.round(momPcts.reduce((a, b) => a + b) / momPcts.length * 25)) : 12
        const tfKeys6 = ['1d','1w','1m','3m','6m','1y'] as const
        const secPcts6 = tfKeys6.map(tf => rf[tf]).filter(Boolean).map(r => r.sector_rank != null ? (1 - r.sector_rank / r.sector_total) : 0.5)
        const hRs = secPcts6.length ? Math.max(2, Math.round(secPcts6.reduce((a, b) => a + b) / secPcts6.length * 25)) : 12
        const hVol = Math.min(25, Math.max(2, Math.round(volRatio * (ret1d > 0 ? 1 : ret1d < -3 ? 0.4 : 0.7) * 10)))
        const healthScore = { trend: hTrend, momentum: hMom, rs: hRs, vol: hVol, total: Math.min(100, hTrend + hMom + hRs + hVol) }

        const trendScore = [data.above_vwap, data.sma.above_sma20, data.sma.above_sma50, data.sma.above_sma200].filter(Boolean).length
        const trendLabel = trendScore === 4 ? 'Strong Uptrend' : trendScore === 3 ? 'Uptrend' : trendScore === 2 ? 'Mixed' : trendScore === 1 ? 'Downtrend' : 'Strong Downtrend'
        const trendColor = trendScore >= 3 ? '#22c55e' : trendScore >= 2 ? '#f59e0b' : '#ef4444'

        const range52 = (data.high_52w ?? 0) - (data.low_52w ?? 0)
        const pct52w = range52 > 0 ? Math.min(98, Math.max(2, (data.ltp - (data.low_52w ?? 0)) / range52 * 100)) : 50
        const near52wLow = pct52w < 10
        const near52wHigh = pct52w > 90

        const volLabel = volRatio > 2 ? 'Spike' : volRatio > 1.3 ? 'High' : volRatio < 0.5 ? 'Low' : 'Normal'
        const volTrend = volRatio > 1.5 ? 'Increasing' : volRatio < 0.7 ? 'Decreasing' : 'Stable'
        const volRatioColor = volRatio > 1.5 ? (ret1d > 0 ? '#22c55e' : '#ef4444') : '#f59e0b'

        const momLabel = ret1d > 2 ? 'Strong Up' : ret1d > 0.5 ? 'Moderate Up' : ret1d < -2 ? 'Strong Down' : ret1d < -0.5 ? 'Moderate Down' : 'Flat'
        const momLabelColor = ret1d > 0 ? '#22c55e' : ret1d < 0 ? '#ef4444' : '#94a3b8'

        const secRank = data.sector_rank ?? 1
        const secTotal = data.sector_total ?? 1
        const secPct = secTotal > 0 ? secRank / secTotal : 0.5
        const rsLabel = secPct <= 0.25 ? 'Strong' : secPct <= 0.5 ? 'Moderate' : secPct <= 0.75 ? 'Weak' : 'Very Weak'
        const rsLabelColor = secPct <= 0.25 ? '#22c55e' : secPct <= 0.5 ? '#f59e0b' : '#ef4444'

        const smasAbove = ([data.sma.sma20, data.sma.sma50, data.sma.sma200] as (number|null)[])
          .filter((v): v is number => v != null && v > data.ltp).sort((a, b) => a - b)
        const smasBelow = ([data.sma.sma20, data.sma.sma50, data.sma.sma200] as (number|null)[])
          .filter((v): v is number => v != null && v < data.ltp).sort((a, b) => b - a)
        const res1 = smasAbove[0] ?? (data.high_52w != null && data.high_52w > data.ltp ? data.high_52w : data.ltp * 1.05)
        const res2 = smasAbove[1] ?? (data.high_52w != null && data.high_52w > res1 ? data.high_52w : data.ltp * 1.10)
        const sup1 = smasBelow[0] ?? (data.low_52w != null && data.low_52w < data.ltp ? data.low_52w : data.ltp * 0.95)
        const sup2 = data.low_52w != null && data.low_52w < sup1 ? data.low_52w : sup1 * 0.95

        const keyLevels = [
          { label: 'Resistance 2', val: res2, color: '#ef444470', bold: false },
          { label: 'Resistance 1', val: res1, color: '#f97316',   bold: false },
          { label: 'Current LTP',  val: data.ltp, color: retColor, bold: true  },
          { label: 'Support 1',    val: sup1, color: '#22c55e',   bold: false },
          { label: 'Support 2',    val: sup2, color: '#22c55e70', bold: false },
        ]

        const bullets: Array<{ text: string; type: 'bull' | 'bear' | 'neutral' }> = [
          trendScore <= 1
            ? { text: 'Stock is in strong downtrend — all SMAs pointing down', type: 'bear' }
            : trendScore >= 3
            ? { text: 'Stock is in strong uptrend — above key moving averages', type: 'bull' }
            : { text: 'Mixed trend — consolidating between moving averages', type: 'neutral' },
          { text: `Ranked #${secRank} of ${secTotal} in sector${data.sector ? ` (${data.sector})` : ''}`, type: secPct < 0.5 ? 'bull' : 'bear' },
          near52wLow
            ? { text: `Near 52-week low — only ${pct52w.toFixed(0)}% from bottom of range`, type: 'bear' }
            : near52wHigh
            ? { text: `Near 52-week high — strong momentum at ${pct52w.toFixed(0)}% of range`, type: 'bull' }
            : { text: `Mid-range position — ${pct52w.toFixed(0)}% through 52-week price range`, type: 'neutral' },
          volRatio > 1.5
            ? { text: `${volLabel} volume (${volRatio.toFixed(1)}x avg) — ${ret1d < 0 ? 'selling' : 'buying'} conviction`, type: ret1d < 0 ? 'bear' : 'bull' }
            : { text: `Normal volume (${volRatio.toFixed(1)}x average) — no strong conviction signal`, type: 'neutral' },
          ...(bestPattern ? [{ text: `${bestPattern.pattern} detected — ${bestPattern.outcome ?? 'pending'}`, type: (bestPattern.outcome === 'Win' ? 'bull' : bestPattern.outcome === 'Loss' ? 'bear' : 'neutral') as 'bull' | 'bear' | 'neutral' }] : []),
        ]

        const iCard = (accent: string) => ({
          bgcolor: PAPER2, borderRadius: 1.5, p: 1.5,
          border: `1px solid ${BORDER}`,
          borderTop: `2px solid ${accent}`,
          height: '100%',
        })

        return (
          <Grid container spacing={2}>

            {/* ════ Left zone (9 cols) ════ */}
            <Grid item xs={12} lg={9}>

              {/* Row A: Health Score | Trend Structure | 52W Range */}
              <Grid container spacing={2} sx={{ mb: 2 }}>

                <Grid item xs={12} md={4}>
                  <Box sx={iCard('#3b82f6')}>
                    <SectionHead title="HEALTH SCORE" accent="#3b82f6" />
                    <HealthGauge score={healthScore.total} />
                    <Box sx={{ mt: 0.5 }}>
                      {[
                        { label: 'Trend Structure',   val: healthScore.trend,    max: 25 },
                        { label: 'Momentum',          val: healthScore.momentum, max: 25 },
                        { label: 'Relative Strength', val: healthScore.rs,       max: 25 },
                        { label: 'Volume Quality',    val: healthScore.vol,      max: 25 },
                      ].map(row => (
                        <Box key={row.label} sx={{ mb: 0.65 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.2 }}>
                            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3 }}>{row.label}</Typography>
                            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK, fontWeight: 600 }}>{row.val}/{row.max}</Typography>
                          </Box>
                          <Box sx={{ height: 3, borderRadius: 2, bgcolor: BORDER, overflow: 'hidden' }}>
                            <Box sx={{ width: `${(row.val / row.max) * 100}%`, height: '100%', bgcolor: row.val / row.max > 0.67 ? '#22c55e' : row.val / row.max > 0.33 ? '#f59e0b' : '#ef4444', borderRadius: 2 }} />
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Box sx={iCard('#f59e0b')}>
                    <SectionHead title="TREND STRUCTURE" accent="#f59e0b" />
                    {[
                      { label: 'Price > VWAP',    pass: data.above_vwap,        val: data.vwap != null          ? `₹${data.vwap.toLocaleString('en-IN')}`       : '—' },
                      { label: 'Price > SMA 20',  pass: data.sma.above_sma20,   val: data.sma.sma20 != null    ? `₹${data.sma.sma20.toLocaleString('en-IN')}`   : '—' },
                      { label: 'Price > SMA 50',  pass: data.sma.above_sma50,   val: data.sma.sma50 != null    ? `₹${data.sma.sma50.toLocaleString('en-IN')}`   : '—' },
                      { label: 'Price > SMA 200', pass: data.sma.above_sma200,  val: data.sma.sma200 != null   ? `₹${data.sma.sma200.toLocaleString('en-IN')}`  : '—' },
                    ].map(row => (
                      <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Box sx={{
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                            bgcolor: row.pass ? '#22c55e18' : '#ef444418',
                            border: `1px solid ${row.pass ? '#22c55e50' : '#ef444450'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Typography sx={{ fontSize: '0.58rem', color: row.pass ? '#22c55e' : '#ef4444', lineHeight: 1 }}>{row.pass ? '✓' : '✗'}</Typography>
                          </Box>
                          <Typography sx={{ ...SANS, fontSize: '0.64rem', color: INK2 }}>{row.label}</Typography>
                        </Box>
                        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: row.pass ? '#22c55e' : '#ef4444' }}>{row.val}</Typography>
                      </Box>
                    ))}
                    <Box sx={{ mt: 0.5, pt: 1, borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3 }}>Trend Score</Typography>
                      <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 800, color: trendColor }}>{trendScore}/4</Typography>
                    </Box>
                    <Box sx={{ mt: 0.75, px: 1, py: 0.4, borderRadius: 1, bgcolor: `${trendColor}14`, border: `1px solid ${trendColor}35`, textAlign: 'center' }}>
                      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: trendColor }}>{trendLabel}</Typography>
                    </Box>
                  </Box>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Box sx={iCard('#8b5cf6')}>
                    <SectionHead title="52-WEEK RANGE" accent="#8b5cf6" />
                    {data.high_52w != null && data.low_52w != null ? (
                      <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.25 }}>
                          <Box>
                            <Typography sx={{ ...MONO, fontSize: '0.54rem', color: INK3 }}>52W Low</Typography>
                            <Typography sx={{ ...MONO, fontSize: '0.73rem', fontWeight: 700, color: '#ef4444' }}>₹{data.low_52w.toLocaleString('en-IN')}</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography sx={{ ...MONO, fontSize: '0.54rem', color: INK3 }}>52W High</Typography>
                            <Typography sx={{ ...MONO, fontSize: '0.73rem', fontWeight: 700, color: '#22c55e' }}>₹{data.high_52w.toLocaleString('en-IN')}</Typography>
                          </Box>
                        </Box>
                        <Box sx={{ position: 'relative', mb: 1.75, mt: 0.25 }}>
                          <Box sx={{ height: 6, borderRadius: 3, background: 'linear-gradient(90deg, #ef444440 0%, #f59e0b40 50%, #22c55e40 100%)' }} />
                          <Box sx={{
                            position: 'absolute', top: -2, left: `${pct52w}%`, transform: 'translateX(-50%)',
                            width: 10, height: 10, borderRadius: '50%',
                            bgcolor: retColor, border: `2px solid ${PAPER2}`, boxShadow: `0 0 0 1px ${retColor}`,
                          }} />
                        </Box>
                        {[
                          { label: 'Current Price',    val: `₹${data.ltp.toLocaleString('en-IN')}`,                                           color: retColor  },
                          { label: 'Position in Range',val: `${pct52w.toFixed(0)}%`,                                                          color: pct52w < 20 ? '#ef4444' : pct52w > 80 ? '#22c55e' : '#f59e0b' },
                          { label: 'From 52W High',    val: data.pct_from_52w_high != null ? `${data.pct_from_52w_high.toFixed(1)}%`  : '—',  color: INK3      },
                          { label: 'From 52W Low',     val: data.pct_from_52w_low  != null ? `+${data.pct_from_52w_low.toFixed(1)}%` : '—',   color: INK3      },
                        ].map(row => (
                          <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.3 }}>
                            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3 }}>{row.label}</Typography>
                            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 600, color: row.color }}>{row.val}</Typography>
                          </Box>
                        ))}
                        {(near52wLow || near52wHigh) && (
                          <Box sx={{ mt: 1, px: 1, py: 0.4, borderRadius: 1, bgcolor: near52wHigh ? '#22c55e14' : '#f59e0b14', border: `1px solid ${near52wHigh ? '#22c55e35' : '#f59e0b35'}`, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography sx={{ fontSize: '0.68rem' }}>{near52wHigh ? '🎯' : '⚠'}</Typography>
                            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: near52wHigh ? '#22c55e' : '#f59e0b' }}>
                              {near52wHigh ? 'Near 52-week high' : 'Near 52-week low'}
                            </Typography>
                          </Box>
                        )}
                      </>
                    ) : (
                      <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3 }}>No 52W data</Typography>
                    )}
                  </Box>
                </Grid>
              </Grid>

              {/* Row B: Relative Strength | Momentum | Volume */}
              <Grid container spacing={2} sx={{ mb: 2 }}>

                <Grid item xs={12} md={4}>
                  <Box sx={iCard('#22c55e')}>
                    <SectionHead title="RELATIVE STRENGTH" accent="#22c55e" meta={data.sector ?? undefined} />
                    {chartLoading ? (
                      <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3 }}>Loading…</Typography>
                    ) : chartData ? (
                      TF_KEYS.map(tf => {
                        const r = chartData.ranks_tf[tf]
                        if (!r) return null
                        const uPct = r.universe_rank != null ? (1 - r.universe_rank / r.universe_total) : 0
                        const sPct = r.sector_rank != null ? (1 - r.sector_rank / r.sector_total) : 0
                        const uCol = rankColor(r.universe_rank, r.universe_total)
                        const sCol = rankColor(r.sector_rank, r.sector_total)
                        const ret = r.return_pct
                        const rCol = ret != null ? (ret > 0 ? '#22c55e' : '#ef4444') : INK3
                        return (
                          <Box key={tf} sx={{ mb: 1 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.25 }}>
                              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', minWidth: 26 }}>{tf}</Typography>
                              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: rCol, fontWeight: 600 }}>
                                {ret != null ? `${ret > 0 ? '+' : ''}${ret.toFixed(1)}%` : '—'}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                              <Typography sx={{ ...MONO, fontSize: '0.5rem', color: INK3, minWidth: 10 }}>U</Typography>
                              <Box sx={{ flex: 1, height: 3, bgcolor: BORDER, borderRadius: 2, overflow: 'hidden' }}>
                                <Box sx={{ width: `${uPct * 100}%`, height: '100%', bgcolor: uCol, borderRadius: 2 }} />
                              </Box>
                              <Typography sx={{ ...MONO, fontSize: '0.5rem', color: uCol, minWidth: 38, textAlign: 'right' }}>
                                {r.universe_rank ? `#${r.universe_rank}/${r.universe_total}` : '—'}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.2 }}>
                              <Typography sx={{ ...MONO, fontSize: '0.5rem', color: INK3, minWidth: 10 }}>S</Typography>
                              <Box sx={{ flex: 1, height: 3, bgcolor: BORDER, borderRadius: 2, overflow: 'hidden' }}>
                                <Box sx={{ width: `${sPct * 100}%`, height: '100%', bgcolor: sCol, borderRadius: 2 }} />
                              </Box>
                              <Typography sx={{ ...MONO, fontSize: '0.5rem', color: sCol, minWidth: 38, textAlign: 'right' }}>
                                {r.sector_rank ? `#${r.sector_rank}/${r.sector_total}` : '—'}
                              </Typography>
                            </Box>
                          </Box>
                        )
                      })
                    ) : (
                      <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3 }}>No data</Typography>
                    )}
                  </Box>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Box sx={iCard('#3b82f6')}>
                    <SectionHead title="MOMENTUM" accent="#3b82f6" />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Box>
                        <Typography sx={{ ...MONO, fontSize: '1.4rem', fontWeight: 900, color: retColor, lineHeight: 1 }}>
                          {data.return_pct > 0 ? '+' : ''}{data.return_pct.toFixed(2)}%
                        </Typography>
                        <Typography sx={{ ...MONO, fontSize: '0.54rem', color: INK3 }}>Today's Return</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography sx={{ ...MONO, fontSize: '0.66rem', fontWeight: 700, color: momLabelColor }}>{momLabel}</Typography>
                        <Typography sx={{ ...MONO, fontSize: '0.55rem', color: INK3 }}>Score: {healthScore.momentum}/25</Typography>
                      </Box>
                    </Box>
                    <Spark data={data.sparkline_20d.slice().reverse()} color={retColor} h={52} full />
                    <Box sx={{ mt: 1, pt: 0.75, borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 0.5 }}>
                      {TF_KEYS.slice(0, 5).map(tf => {
                        const r = chartData?.ranks_tf[tf]
                        const ret = r?.return_pct
                        const col = ret != null ? (ret > 0 ? '#22c55e' : '#ef4444') : INK3
                        return (
                          <Box key={tf} sx={{ flex: 1, textAlign: 'center' }}>
                            <Typography sx={{ ...MONO, fontSize: '0.5rem', color: INK3 }}>{tf.toUpperCase()}</Typography>
                            <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: 700, color: col }}>
                              {ret != null ? `${ret > 0 ? '+' : ''}${ret.toFixed(1)}%` : '—'}
                            </Typography>
                          </Box>
                        )
                      })}
                    </Box>
                  </Box>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Box sx={iCard('#ec4899')}>
                    <SectionHead title="VOLUME ANALYSIS" accent="#ec4899" />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Box>
                        <Typography sx={{ ...MONO, fontSize: '1.4rem', fontWeight: 900, color: volRatioColor, lineHeight: 1 }}>
                          {volRatio.toFixed(1)}x
                        </Typography>
                        <Typography sx={{ ...MONO, fontSize: '0.54rem', color: INK3 }}>vs 20D Average</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Box sx={{ px: 0.75, py: 0.25, borderRadius: 1, bgcolor: `${volRatioColor}18`, border: `1px solid ${volRatioColor}40` }}>
                          <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: volRatioColor }}>{volLabel}</Typography>
                        </Box>
                        <Typography sx={{ ...MONO, fontSize: '0.55rem', color: INK3, mt: 0.4 }}>Score: {healthScore.vol}/25</Typography>
                      </Box>
                    </Box>
                    {bars20.length > 0 && (
                      <Spark data={bars20.map(b => b.v)} color={volRatioColor} h={52} full />
                    )}
                    <Box sx={{ mt: 1, pt: 0.75, borderTop: `1px solid ${BORDER}` }}>
                      {[
                        { label: 'Today',    val: lastVol > 0 ? `${(lastVol / 1_000_000).toFixed(2)}M` : '—' },
                        { label: 'Avg (20D)',val: avgVol > 0  ? `${(avgVol  / 1_000_000).toFixed(2)}M` : '—' },
                        { label: 'Trend',    val: volTrend },
                      ].map(row => (
                        <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                          <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3 }}>{row.label}</Typography>
                          <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 600, color: INK }}>{row.val}</Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Grid>
              </Grid>

              {/* Row C: Drawdown + 4 mini panels */}
              <Grid container spacing={2} sx={{ mb: 2 }}>

                <Grid item xs={12} md={4}>
                  <Box sx={iCard('#ef4444')}>
                    <SectionHead title="DRAWDOWN ANALYSIS" accent="#ef4444" meta={tfRange} />
                    <Grid container spacing={1.5} sx={{ mb: 1 }}>
                      {[
                        { label: '1W', val: data.drawdown_1w },
                        { label: '1M', val: data.drawdown_1m },
                        { label: '3M', val: data.drawdown_3m },
                        { label: '1Y', val: data.drawdown_1y },
                      ].map(row => (
                        <Grid item xs={6} key={row.label}>
                          <Typography sx={{ ...MONO, fontSize: '0.54rem', color: INK3 }}>{row.label} Drawdown</Typography>
                          <Typography sx={{ ...MONO, fontSize: '0.88rem', fontWeight: 800, color: '#ef4444', lineHeight: 1.3 }}>
                            {row.val.toFixed(1)}%
                          </Typography>
                        </Grid>
                      ))}
                    </Grid>
                    {chartBars.length > 0 && (
                      <HighchartsReact highcharts={Highcharts} options={ddOptions} />
                    )}
                  </Box>
                </Grid>

                {[
                  {
                    title: 'RS TREND 1M',        label: rsLabel,   color: rsLabelColor,
                    data:  data.sparkline_20d.slice().reverse(),    text: '',
                  },
                  {
                    title: 'PRICE MOMENTUM 1M',  label: momLabel,  color: momLabelColor,
                    data:  data.sparkline_20d.slice().reverse(),    text: '',
                  },
                  {
                    title: 'VOLUME TREND 1M',    label: volLabel,  color: volRatioColor,
                    data:  bars20.map(b => b.v),                    text: '',
                  },
                  {
                    title: 'INDICATOR EDGE',
                    label: edgeData?.grade ?? '—',
                    color: !edgeData?.grade ? INK3 : (edgeData.grade === 'A+' || edgeData.grade === 'A') ? '#22c55e' : edgeData.grade === 'B' ? '#f59e0b' : '#ef4444',
                    data:  [] as number[],
                    text:  edgeData?.best_indicator ?? 'Loading…',
                  },
                ].map(panel => (
                  <Grid item xs={6} md={2} key={panel.title}>
                    <Box sx={{ bgcolor: PAPER2, p: 1.25, borderRadius: 1.5, border: `1px solid ${BORDER}`, borderTop: `2px solid ${panel.color}`, height: '100%' }}>
                      <Typography sx={{ ...MONO, fontSize: '0.5rem', color: INK3, letterSpacing: '0.07em', mb: 0.5 }}>{panel.title}</Typography>
                      <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: panel.color, mb: 0.5 }}>{panel.label}</Typography>
                      {panel.data.length > 1
                        ? <Spark data={panel.data} color={panel.color} h={40} full />
                        : panel.text
                        ? <Typography sx={{ ...SANS, fontSize: '0.58rem', color: INK2, mt: 0.25, lineHeight: 1.4 }}>{panel.text}</Typography>
                        : null
                      }
                    </Box>
                  </Grid>
                ))}
              </Grid>

              {/* Row D: Key Levels | Conclusion */}
              <Grid container spacing={2}>

                <Grid item xs={12} md={6}>
                  <Box sx={iCard('#64748b')}>
                    <SectionHead title="KEY PRICE LEVELS" accent="#64748b" />
                    {keyLevels.map((lev, i) => {
                      const isLTP = lev.bold
                      return (
                        <Box key={i} sx={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          py: 0.5, px: 0.75, borderRadius: 1, mb: 0.4,
                          bgcolor: isLTP ? `${retColor}12` : 'transparent',
                          border: `1px solid ${isLTP ? `${retColor}30` : 'transparent'}`,
                        }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Box sx={{ width: 8, height: 2, bgcolor: lev.color, borderRadius: 1 }} />
                            <Typography sx={{ ...SANS, fontSize: isLTP ? '0.65rem' : '0.62rem', color: isLTP ? INK : INK3, fontWeight: isLTP ? 600 : 400 }}>{lev.label}</Typography>
                          </Box>
                          <Typography sx={{ ...MONO, fontSize: isLTP ? '0.72rem' : '0.65rem', fontWeight: isLTP ? 800 : 600, color: lev.color }}>
                            ₹{lev.val.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                          </Typography>
                        </Box>
                      )
                    })}
                  </Box>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Box sx={iCard('#6366f1')}>
                    <SectionHead title="CONCLUSION" accent="#6366f1" />
                    {bullets.map((b, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 0.75, mb: 0.8, alignItems: 'flex-start' }}>
                        <Typography sx={{ fontSize: '0.62rem', mt: 0.1, flexShrink: 0, color: b.type === 'bull' ? '#22c55e' : b.type === 'bear' ? '#ef4444' : '#94a3b8' }}>
                          {b.type === 'bull' ? '▲' : b.type === 'bear' ? '▼' : '◆'}
                        </Typography>
                        <Typography sx={{ ...SANS, fontSize: '0.64rem', color: INK2, lineHeight: 1.55 }}>{b.text}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Grid>
              </Grid>
            </Grid>

            {/* ════ Right zone (3 cols) ════ */}
            <Grid item xs={12} lg={3}>

              {/* Action */}
              <Box sx={{ ...iCard(biasColor), mb: 2 }}>
                <SectionHead title="ACTION" accent={biasColor} />
                <Box sx={{ textAlign: 'center', mb: 1.5 }}>
                  <Box sx={{ display: 'inline-block', px: 1.5, py: 0.6, borderRadius: 1.5, bgcolor: `${biasColor}18`, border: `1px solid ${biasColor}50` }}>
                    <Typography sx={{ ...MONO, fontSize: '0.85rem', fontWeight: 900, color: biasColor }}>
                      {data.bias === 'long' ? '🟢 GO LONG' : data.bias === 'short' ? '🔴 AVOID' : '⚪ WAIT'}
                    </Typography>
                  </Box>
                </Box>
                <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, mb: 1.5, lineHeight: 1.55 }}>{data.bias_rationale}</Typography>
                <Box sx={{ mb: 1.5 }}>
                  {[
                    { label: 'Trend',  value: trendLabel,                       color: trendColor     },
                    { label: 'RS',     value: rsLabel,                           color: rsLabelColor   },
                    { label: 'Volume', value: `${volLabel} (${volRatio.toFixed(1)}x)`, color: volRatioColor },
                  ].map(row => (
                    <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4, borderBottom: `1px solid ${BORDER}` }}>
                      <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3 }}>{row.label}</Typography>
                      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: row.color }}>{row.value}</Typography>
                    </Box>
                  ))}
                </Box>
                <Typography sx={{ ...SANS, fontSize: '0.58rem', color: INK3, mb: 0.75, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Conditions to Watch</Typography>
                {[
                  { label: 'Close above VWAP',     done: data.above_vwap        },
                  { label: 'SMA20 alignment',       done: data.sma.above_sma20   },
                  { label: 'Volume confirmation',   done: volRatio > 1           },
                  { label: 'Top-half sector rank',  done: secPct <= 0.5          },
                ].map(item => (
                  <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.55 }}>
                    <Box sx={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      bgcolor: item.done ? '#22c55e18' : '#ef444418',
                      border: `1px solid ${item.done ? '#22c55e50' : '#ef444450'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Typography sx={{ fontSize: '0.5rem', color: item.done ? '#22c55e' : '#ef4444', lineHeight: 1 }}>{item.done ? '✓' : '✗'}</Typography>
                    </Box>
                    <Typography sx={{ ...SANS, fontSize: '0.6rem', color: item.done ? INK : INK3 }}>{item.label}</Typography>
                  </Box>
                ))}
              </Box>

              {/* Best Indicator */}
              {edgeData && (
                <Box sx={{ ...iCard('#8b5cf6'), mb: 2 }}>
                  <SectionHead title="BEST INDICATOR" accent="#8b5cf6" />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75 }}>
                    <Typography sx={{ ...MONO, fontSize: '0.7rem', fontWeight: 700, color: INK, flex: 1, mr: 0.5 }}>{edgeData.best_indicator}</Typography>
                    {edgeData.grade && (
                      <Box sx={{ px: 0.75, py: 0.2, borderRadius: 0.75, bgcolor: '#22c55e14', border: '1px solid #22c55e30', flexShrink: 0 }}>
                        <Typography sx={{ ...MONO, fontSize: '0.58rem', color: '#22c55e', fontWeight: 700 }}>{edgeData.grade}</Typography>
                      </Box>
                    )}
                  </Box>
                  {edgeData.best_setup && (
                    <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, mb: 0.75, lineHeight: 1.45 }}>{edgeData.best_setup}</Typography>
                  )}
                  {Array.isArray(edgeData.current_signals) && edgeData.current_signals.length > 0 && (
                    <Box sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: `${CYAN}10`, border: `1px solid ${CYAN}25` }}>
                      <Typography sx={{ ...MONO, fontSize: '0.62rem', color: CYAN }}>
                        Active: {edgeData.current_signals[0].signal ?? edgeData.current_signals[0].name}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}

              {/* Best Pattern Now */}
              <Box sx={iCard('#22c55e')}>
                <SectionHead title="BEST PATTERN NOW" accent="#22c55e" />
                {patternData ? (
                  bestPattern ? (
                    <>
                      <Box sx={{
                        px: 1.25, py: 0.75, borderRadius: 1.5, mb: 1,
                        bgcolor: bestPattern.outcome === 'Win' ? '#22c55e10' : bestPattern.outcome === 'Loss' ? '#ef444410' : `${CYAN}10`,
                        border: `1px solid ${bestPattern.outcome === 'Win' ? '#22c55e30' : bestPattern.outcome === 'Loss' ? '#ef444430' : `${CYAN}30`}`,
                      }}>
                        <Typography sx={{ ...MONO, fontSize: '0.68rem', fontWeight: 700, color: INK, mb: 0.25 }}>{bestPattern.pattern}</Typography>
                        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                          <Typography sx={{ ...SANS, fontSize: '0.58rem', color: INK3 }}>{bestPattern.date}</Typography>
                          <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 600, color: bestPattern.outcome === 'Win' ? '#22c55e' : bestPattern.outcome === 'Loss' ? '#ef4444' : '#f59e0b' }}>
                            {bestPattern.outcome}
                          </Typography>
                        </Box>
                      </Box>
                      {dnaData && Array.isArray(dnaData.dna) && dnaData.dna.slice(0, 3).map((p: { pattern: string; success_rate: number; occurrences: number }) => (
                        <Box key={p.pattern} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                          <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mr: 0.5 }}>{p.pattern}</Typography>
                          <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: 600, color: p.success_rate > 60 ? '#22c55e' : p.success_rate < 45 ? '#ef4444' : '#f59e0b', flexShrink: 0 }}>
                            {p.success_rate?.toFixed(0)}% WR
                          </Typography>
                        </Box>
                      ))}
                    </>
                  ) : (
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3 }}>No recent patterns</Typography>
                  )
                ) : (
                  <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3 }}>Loading…</Typography>
                )}
              </Box>

            </Grid>
          </Grid>
        )
      })()}
    </Box>
  )
}

// ── Layer 4 — Why Now Card ────────────────────────────────────────────────────
function WhyNowCardView({ card }: { card: WhyNowCard }) {
  const navigate = useNavigate()
  const { INK, INK2, INK3, BORDER, PAPER2 } = usePalette()
  const { CARD } = useTokens()
  const [expanded, setExpanded] = useState(false)

  const isLong = card.direction === 'long'
  const color  = isLong ? '#22c55e' : '#ef4444'
  const bgCol  = isLong ? '#22c55e08' : '#ef444408'
  const dirTag = isLong ? '🟢 LONG' : '🔴 SHORT'

  return (
    <Box sx={{
      ...CARD,
      borderLeft: `3px solid ${color}`,
      mb: 1.5,
      overflow: 'hidden',
      bgcolor: bgCol,
    }}>
      {/* Compact header */}
      <Box
        sx={{ p: 1.5, cursor: 'pointer', '&:hover': { bgcolor: `${color}08` } }}
        onClick={() => setExpanded(e => !e)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', fontWeight: 800, color }}>
              {dirTag}
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: INK }}>
              {card.symbol}
            </Typography>
            <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>
              {card.signal_type}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>
              {card.time}
            </Typography>
            <Box sx={{
              px: 0.75, py: 0.2, borderRadius: 0.75,
              bgcolor: `${color}20`, border: `1px solid ${color}40`,
            }}>
              <Typography sx={{ ...MONO, fontSize: '0.62rem', color, fontWeight: 700 }}>
                {card.risk_reward}:1 R:R
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '0.6rem', color: INK3 }}>
              {expanded ? '▲' : '▼'}
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.5 }}>
          {card.what_happening}
        </Typography>
      </Box>

      {/* Expanded detail */}
      {expanded && (
        <Box sx={{ px: 1.5, pb: 1.5, borderTop: `1px solid ${BORDER}` }}>
          <Box sx={{ mt: 1.5, mb: 1 }}>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3, mb: 0.5, letterSpacing: '0.08em' }}>
              WHY IT MATTERS
            </Typography>
            <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.6 }}>
              {card.why_matters}
            </Typography>
          </Box>

          <Grid container spacing={1} sx={{ mb: 1.5 }}>
            <Grid item xs={6}>
              <Box sx={{ bgcolor: PAPER2, borderRadius: 1, p: 1, border: `1px solid ${BORDER}` }}>
                <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3, mb: 0.5 }}>CONFIRM</Typography>
                <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK2, lineHeight: 1.5 }}>
                  {card.confirm_trigger}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={6}>
              <Box sx={{ bgcolor: PAPER2, borderRadius: 1, p: 1, border: `1px solid ${BORDER}` }}>
                <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3, mb: 0.5 }}>INVALIDATE</Typography>
                <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK2, lineHeight: 1.5 }}>
                  {card.invalidate_trigger}
                </Typography>
              </Box>
            </Grid>
          </Grid>

          {/* Trade structure */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { label: 'Entry', value: `₹${card.entry}` },
              { label: 'Target', value: `₹${card.target}`, sub: `+${card.target_pct.toFixed(1)}%`, color: '#22c55e' },
              { label: 'Stop', value: `₹${card.stop}`, sub: `-${card.stop_pct.toFixed(1)}%`, color: '#ef4444' },
            ].map(f => (
              <Box key={f.label} sx={{ bgcolor: PAPER2, borderRadius: 1, p: 1, border: `1px solid ${BORDER}`, minWidth: 90 }}>
                <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>{f.label}</Typography>
                <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 700, color: f.color || INK }}>
                  {f.value}
                </Typography>
                {f.sub && (
                  <Typography sx={{ ...MONO, fontSize: '0.6rem', color: f.color }}>
                    {f.sub}
                  </Typography>
                )}
              </Box>
            ))}
            <Box
              component="button"
              onClick={() => navigate(`/stock/${card.symbol}`)}
              sx={{
                ml: 'auto', px: 1.25, py: 0.5, borderRadius: 1, cursor: 'pointer',
                bgcolor: `${color}15`, border: `1px solid ${color}40`,
                ...MONO, fontSize: '0.65rem', color, fontWeight: 700,
                '&:hover': { bgcolor: `${color}25` },
              }}
            >
              Analyse →
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LiveTradingPage() {
  const { INK, INK3, BG, BORDER, CYAN, PAPER } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()

  // Layer 1 state
  const [sectors, setSectors]     = useState<SectorPoint[]>([])
  const [niftyRet, setNiftyRet]   = useState(0)
  const [asOf, setAsOf]           = useState('')
  const [kiteOk, setKiteOk]       = useState(true)
  const [dataMode, setDataMode]   = useState<'live' | 'eod_fallback'>('live')
  const [scatterLoading, setScatterLoading] = useState(false)
  const [scatterErr, setScatterErr]         = useState('')

  // All-sector progressions state
  const [sectorProgressions, setSectorProgressions] = useState<Record<string, SectorProgressionPoint[]>>({})
  const [progressionSource, setProgressionSource]   = useState<'live' | '15min_kite' | 'none'>('none')
  const [progressionDate, setProgressionDate]       = useState('')

  // Layer 2 state
  const [selectedSector, setSelectedSector]   = useState<string | null>(null)
  const [drillDown, setDrillDown]             = useState<SectorDrillDownResponse | null>(null)
  const [drillLoading, setDrillLoading]       = useState(false)

  // Layer 3 state
  const [selectedStock, setSelectedStock]         = useState<string | null>(null)
  const [stockData, setStockData]                 = useState<StockIntelligenceResponse | null>(null)
  const [stockLoading, setStockLoading]           = useState(false)

  // Layer 4 state
  const [signals, setSignals]     = useState<WhyNowCard[]>([])
  const [sigCount, setSigCount]   = useState(0)
  const [sigLoading, setSigLoading] = useState(false)

  const [countdown, setCountdown] = useState(REFRESH_MS / 1000)

  // ── Fetch Layer 1 ─────────────────────────────────────────────────────────
  const fetchSectors = useCallback(async () => {
    setScatterLoading(true)
    setScatterErr('')
    try {
      const d = await liveApi.getSectors()
      setSectors(d.sectors)
      setNiftyRet(d.nifty_return)
      setAsOf(d.as_of)
      setKiteOk(d.kite_live)
      setDataMode(d.data_mode)
    } catch (e) {
      setScatterErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setScatterLoading(false)
    }
  }, [])

  const fetchProgressions = useCallback(async () => {
    try {
      const d = await liveApi.getSectorProgressions()
      setSectorProgressions(d.progressions)
      setProgressionSource(d.source)
      setProgressionDate(d.trade_date)
    } catch { /* keep stale */ }
  }, [])

  // ── Fetch Layer 2 ─────────────────────────────────────────────────────────
  const fetchDrillDown = useCallback(async (sector: string) => {
    setDrillLoading(true)
    try {
      const d = await liveApi.getSectorDetail(sector)
      setDrillDown(d)
    } catch { /* keep stale */ } finally {
      setDrillLoading(false)
    }
  }, [])

  // ── Fetch Layer 3 ─────────────────────────────────────────────────────────
  const fetchStock = useCallback(async (symbol: string) => {
    setStockLoading(true)
    try {
      const d = await liveApi.getStockIntelligence(symbol)
      setStockData(d)
    } catch { /* keep stale */ } finally {
      setStockLoading(false)
    }
  }, [])

  // ── Fetch Layer 4 ─────────────────────────────────────────────────────────
  const fetchSignals = useCallback(async () => {
    setSigLoading(true)
    try {
      const d = await liveApi.getSignals()
      setSignals(d.signals)
      setSigCount(d.signal_count)
    } catch { /* keep stale */ } finally {
      setSigLoading(false)
    }
  }, [])

  // ── Sector click handler ──────────────────────────────────────────────────
  const handleSectorClick = useCallback((sector: string) => {
    setSelectedSector(sector)
    setSelectedStock(null)
    setStockData(null)
    fetchDrillDown(sector)
  }, [fetchDrillDown])

  // ── Stock click handler ───────────────────────────────────────────────────
  const handleStockClick = useCallback((symbol: string) => {
    setSelectedStock(symbol)
    fetchStock(symbol)
  }, [fetchStock])

  // ── Auto-refresh every 5 s ────────────────────────────────────────────────
  useEffect(() => {
    fetchSectors()
    fetchSignals()
    fetchProgressions()
    const id = setInterval(() => {
      fetchSectors()           // always refresh scatter (shows EOD data when closed)
      if (isMarketOpen()) {
        fetchSignals()
        fetchProgressions()    // live: refresh every 5s; closed: cached, instant
        if (selectedSector) fetchDrillDown(selectedSector)
        if (selectedStock) fetchStock(selectedStock)
      }
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchSectors, fetchSignals, fetchDrillDown, fetchStock, fetchProgressions, selectedSector, selectedStock])

  // ── Countdown tick ────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() =>
      setCountdown(c => isMarketOpen() ? (c <= 1 ? REFRESH_MS / 1000 : c - 1) : c)
    , 1000)
    return () => clearInterval(id)
  }, [])

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      {/* ── Hero ── */}
      <Box sx={{ background: heroBg, px: { xs: 2, md: 5 }, pt: 4, pb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
          <LiveBadge loading={scatterLoading} kiteOk={kiteOk} />
          {!isMarketOpen() && (
            <Box sx={{ px: 1.5, py: 0.35, borderRadius: 1, bgcolor: `${INK3}18`, border: `1px solid ${INK3}40` }}>
              <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: INK3, letterSpacing: '0.1em' }}>
                MARKET CLOSED
              </Typography>
            </Box>
          )}
          {dataMode === 'eod_fallback' && (
            <Box sx={{ px: 1.5, py: 0.35, borderRadius: 1, bgcolor: '#f59e0b18', border: '1px solid #f59e0b40' }}>
              <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: '#f59e0b', letterSpacing: '0.1em' }}>
                EOD DATA — 3:30 PM CLOSE
              </Typography>
            </Box>
          )}
        </Box>

        <Typography sx={{
          ...SANS, fontSize: { xs: '1.6rem', md: '2rem' },
          fontWeight: 900, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1, mb: 0.5,
        }}>
          Sector & Stock{' '}
          <Box component="span" sx={{ color: CYAN }}>Intelligence</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, mb: 1.5 }}>
          4-layer live market intelligence · NSE/BSE · Long &amp; Short signals · Refreshes every 5 seconds
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {asOf && (
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>
              Updated {asOf.replace('T', ' ')}
            </Typography>
          )}
          <Typography sx={{ ...MONO, fontSize: '0.7rem', color: INK3 }}>
            {isMarketOpen()
              ? <>Refresh in <Box component="span" sx={{ color: countdown <= 3 ? '#f59e0b' : CYAN, fontWeight: 700 }}>{countdown}s</Box></>
              : 'Paused — market closed'
            }
          </Typography>
          {sigCount > 0 && (
            <Box sx={{ px: 1.25, py: 0.3, borderRadius: 1, bgcolor: '#f59e0b15', border: '1px solid #f59e0b30' }}>
              <Typography sx={{ ...MONO, fontSize: '0.65rem', color: '#f59e0b', fontWeight: 700 }}>
                {sigCount} SIGNAL{sigCount !== 1 ? 'S' : ''} ACTIVE
              </Typography>
            </Box>
          )}
        </Box>
        {scatterErr && (
          <Typography sx={{ ...SANS, fontSize: '0.75rem', color: '#ef4444', mt: 0.75 }}>{scatterErr}</Typography>
        )}
      </Box>

      {/* ── Main content ── */}
      <Box sx={{ flex: 1, px: { xs: 2, md: 5 }, py: 3 }}>

        {/* ── Layer 1 row: Sector Scatter + All-Sector Return Progression ── */}
        <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
          <Grid item xs={12} lg={6}>
            <Box sx={{ ...CARD, p: 2.5 }}>
              <SectionHead
                title={<>Layer 1 — <Box component="span" sx={{ color: CYAN }}>Sector Scatter</Box></>}
                accent={CYAN}
                meta={`${sectors.length} sectors`}
              />
              {sectors.length === 0 && !scatterLoading ? (
                <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3 }}>Loading sectors…</Typography>
                </Box>
              ) : (
                <SectorScatterMap
                  sectors={sectors}
                  niftyReturn={niftyRet}
                  onSectorClick={handleSectorClick}
                  selectedSector={selectedSector}
                />
              )}
            </Box>
          </Grid>

          <Grid item xs={12} lg={6}>
            <Box sx={{ ...CARD, p: 2.5, height: '100%' }}>
              <SectionHead title="Sector Return Progression" accent="#22c55e" meta="All sectors" />
              <AllSectorsProgressionChart
                progressions={sectorProgressions}
                source={progressionSource}
                tradeDate={progressionDate}
                selectedSector={selectedSector}
                onSectorClick={handleSectorClick}
              />
            </Box>
          </Grid>
        </Grid>

        {/* ── Layer 2 — Sector Drill-Down ── */}
        {selectedSector && (
          <Box sx={{ ...CARD, p: 2.5, mb: 2.5 }}>
            <SectionHead
              title={<>Layer 2 — <Box component="span" sx={{ color: '#6366f1' }}>Sector Drill-Down</Box></>}
              accent="#6366f1"
              meta={drillLoading ? 'Loading…' : selectedSector}
            />
            {drillDown ? (
              <SectorDrillDown data={drillDown} onStockClick={handleStockClick} selectedStock={selectedStock} />
            ) : drillLoading ? (
              <Box sx={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3 }}>
                  Loading {selectedSector}…
                </Typography>
              </Box>
            ) : null}
          </Box>
        )}

        {/* ── Layer 3 — Stock Intelligence ── */}
        {selectedStock && (
          <Box sx={{ ...CARD, p: 2.5, mb: 2.5 }}>
            <SectionHead
              title={<>Layer 3 — <Box component="span" sx={{ color: '#22c55e' }}>Stock Intelligence</Box></>}
              accent="#22c55e"
              meta={stockLoading ? 'Loading…' : selectedStock}
            />
            {stockData ? (
              <StockIntelligenceCard data={stockData} onClose={() => { setSelectedStock(null); setStockData(null) }} />
            ) : stockLoading ? (
              <Box sx={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3 }}>
                  Loading {selectedStock}…
                </Typography>
              </Box>
            ) : null}
          </Box>
        )}

        {/* ── Layer 4 — Breakthrough Signals (full-width, bottom) ── */}
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={8}>
            <Box sx={{ ...CARD, p: 2.5 }}>
              <SectionHead
                title={<>Layer 4 — <Box component="span" sx={{ color: '#f59e0b' }}>Breakthrough Signals</Box></>}
                accent="#f59e0b"
                meta={sigLoading ? 'Scanning…' : `${signals.length} signal${signals.length !== 1 ? 's' : ''}`}
              />

              <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
                {[
                  { color: '#22c55e', label: 'Long signal' },
                  { color: '#ef4444', label: 'Short signal' },
                ].map(l => (
                  <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: l.color }} />
                    <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>{l.label}</Typography>
                  </Box>
                ))}
                <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3, ml: 'auto' }}>
                  Min R:R ≥ 1.5
                </Typography>
              </Box>

              {signals.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ ...SANS, fontSize: '0.85rem', color: INK3, mb: 0.75 }}>
                    No breakthrough signals firing
                  </Typography>
                  <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, opacity: 0.6 }}>
                    {isMarketOpen()
                      ? 'Scanning all sectors every 5 seconds…'
                      : 'Market closed — signals resume at 9:15 AM IST'
                    }
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 1.5 }}>
                  {signals.map(card => (
                    <WhyNowCardView key={card.id} card={card} />
                  ))}
                </Box>
              )}
            </Box>
          </Grid>

          <Grid item xs={12} lg={4}>
            <Box sx={{ ...CARD, p: 2 }}>
              <SectionHead title="Signal Priority" accent="#94a3b8" />
              {[
                { p: 1, label: '52-Week High/Low + Volume', note: 'Structural — highest conviction' },
                { p: 2, label: 'Consolidation Break/Down', note: 'ATR compression + range breach' },
                { p: 5, label: 'VWAP Reclaim/Rejection', note: 'Intraday — needs confirming signal' },
              ].map(r => (
                <Box key={r.p} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, mb: 1 }}>
                  <Box sx={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    bgcolor: `${CYAN}20`, border: `1px solid ${CYAN}40`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography sx={{ ...MONO, fontSize: '0.58rem', color: CYAN, fontWeight: 800 }}>
                      {r.p}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK, fontWeight: 600 }}>
                      {r.label}
                    </Typography>
                    <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>
                      {r.note}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>

      </Box>

      <Footer />
    </Box>
  )
}
