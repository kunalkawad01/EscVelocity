import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Grid, Typography } from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { liveApi } from '../api/liveApi'
import type { StockIntelligenceResponse, StockChartResponse } from '../types/live'

export type { StockIntelligenceResponse }

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

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

function SectionHead({ title, accent, meta }: { title: ReactNode; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ ...SANS, fontSize: '0.82rem', fontWeight: 800, color: INK }}>{title}</Typography>
      {meta && <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, ml: 'auto' }}>{meta}</Typography>}
    </Box>
  )
}

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

function TransparencyDrawer({ formula, interpret, conclusion }: {
  formula: string
  interpret: string
  conclusion: string
}) {
  const [open, setOpen] = useState(false)
  const { INK3, BORDER, CYAN } = usePalette()
  return (
    <Box sx={{ mt: 1.25, pt: 0.75, borderTop: `1px solid ${BORDER}` }}>
      <Box
        onClick={() => setOpen(v => !v)}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', '&:hover': { opacity: 0.75 } }}
      >
        <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.52rem', color: INK3, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          How is this calculated?
        </Typography>
        <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>{open ? '▲' : '▼'}</Typography>
      </Box>
      {open && (
        <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          {([
            { label: 'Formula',        text: formula,    color: CYAN      },
            { label: 'Interpretation', text: interpret,  color: '#f59e0b' },
            { label: 'Conclusion',     text: conclusion, color: '#22c55e' },
          ] as { label: string; text: string; color: string }[]).map(({ label, text, color }) => (
            <Box key={label} sx={{ px: 0.875, py: 0.6, borderRadius: 1, bgcolor: `${color}08`, borderLeft: `2px solid ${color}` }}>
              <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.5rem', color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.3 }}>
                {label}
              </Typography>
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.6rem', color: INK3, lineHeight: 1.5 }}>
                {text}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

export function StockIntelligenceCard({
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
                    <TransparencyDrawer
                      formula="Score = Trend (0–25) + Momentum (0–25) + RS (0–25) + Vol Quality (0–25). Trend: +10 if Price > VWAP, +5 if > SMA20, +6 if > SMA50, +4 if > SMA200. Momentum & RS: avg rank percentile across timeframes × 25. Vol: min(25, max(2, round(vol_ratio × direction_weight × 10)))."
                      interpret="80–100 = Strong — all dimensions healthy. 60–79 = Moderate. 40–59 = Mixed — check sub-scores. Below 40 = Broad weakness. Sub-scores are independent and additive: a stock can score high on trend but low on RS, pinpointing the specific risk."
                      conclusion={`${healthScore.total}/100. ${healthScore.total >= 65 ? 'Broad strength — signals have higher reliability.' : healthScore.total >= 40 ? `Mixed. Weakest sub-score: ${[['Trend', healthScore.trend], ['Momentum', healthScore.momentum], ['RS', healthScore.rs], ['Volume', healthScore.vol]].sort((a, b) => (a[1] as number) - (b[1] as number))[0][0]} (${[['Trend', healthScore.trend], ['Momentum', healthScore.momentum], ['RS', healthScore.rs], ['Volume', healthScore.vol]].sort((a, b) => (a[1] as number) - (b[1] as number))[0][1]}/25). Address this before entering.` : 'Broad weakness across all dimensions — elevated entry risk.'}`}
                    />
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
                    <TransparencyDrawer
                      formula="Score = count of true conditions: (1) Price > VWAP, (2) Price > SMA20, (3) Price > SMA50, (4) Price > SMA200. Each SMA represents a progressively longer trend horizon — 20d (short), 50d (medium), 200d (long-term institutional)."
                      interpret="4/4 = Strong Uptrend. 3/4 = Uptrend. 2/4 = Mixed/Consolidating. 1/4 = Downtrend. 0/4 = Strong Downtrend. VWAP is intraday only; SMA alignment is the more durable signal. Stocks above all 4 levels historically show lower entry risk."
                      conclusion={`${trendScore}/4 conditions pass — ${trendLabel}. ${trendScore === 4 ? 'Price is above VWAP and all three key moving averages. Structural trend is fully aligned.' : trendScore === 0 ? 'Price is below VWAP and all SMAs. Any rally into these levels is a resistance zone, not a breakout.' : `Passes ${trendScore} of 4. Failing conditions act as overhead resistance for long entries.`}`}
                    />
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
                        <TransparencyDrawer
                          formula="Position% = (LTP − 52W Low) / (52W High − 52W Low) × 100. From High% = (LTP − High) / High × 100. From Low% = (LTP − Low) / Low × 100. All computed from the rolling 52-week window of daily closing prices."
                          interpret="0–10% = Near yearly low (watch for reversal). 10–90% = Mid-range. 90–100% = Near yearly high (momentum zone, breakout potential). Stocks in the top decile of their yearly range in strong markets tend to continue higher; in weak markets this is an exit zone."
                          conclusion={data.high_52w != null && data.low_52w != null ? `At ${pct52w.toFixed(0)}% of yearly range — ${near52wHigh ? `within striking distance of the 52W high (₹${data.high_52w.toLocaleString('en-IN')}). Breakout watch.` : near52wLow ? `hovering near the 52W low (₹${data.low_52w.toLocaleString('en-IN')}). Mean reversion risk is elevated.` : 'mid-range. No extreme reading on either end.'}` : 'Insufficient 52W data to draw conclusions.'}
                        />
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
                    <TransparencyDrawer
                      formula="For each timeframe (1d, 1w, 1m, 3m, 6m, 1y): rank this stock's return vs all universe stocks (U bar) and all sector stocks (S bar). Bar fill = 1 − rank/total, so a full bar = rank #1. RS Health Score = avg sector rank percentile across timeframes × 25."
                      interpret="U (Universe) = performance vs all NSE stocks. S (Sector) = performance vs same-sector peers. Top-third (green) = outperforming. Middle-third (amber) = in-line. Bottom-third (red) = underperforming. Consistent outperformance across multiple timeframes signals genuine institutional accumulation."
                      conclusion={`Sector rank: #${secRank} of ${secTotal}${data.sector ? ` in ${data.sector}` : ''} — ${rsLabel}. ${secPct <= 0.25 ? 'Top-quartile performer — relative strength is a key tailwind.' : secPct <= 0.5 ? 'Second-quartile performer — moderate RS, acceptable for positional entries.' : 'Underperforming its sector peers. Prefer sector leaders unless catalyst-driven.'}`}
                    />
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
                    <TransparencyDrawer
                      formula="Today's Return = (Close − Prev Close) / Prev Close × 100. Momentum Score = avg universe rank percentile across 1d/1w/1m/3m × 25. Multi-TF bars show absolute return_pct for each period, ranked against all stocks in the universe."
                      interpret="> +2% = Strong Up. +0.5 to +2% = Moderate Up. −0.5 to +0.5% = Flat. −2 to −0.5% = Moderate Down. < −2% = Strong Down. Single-day momentum is noisy — alignment across 1d/1w/1m reduces false signals significantly."
                      conclusion={`Today: ${data.return_pct > 0 ? '+' : ''}${data.return_pct.toFixed(2)}% — ${momLabel}. Score: ${healthScore.momentum}/25. ${healthScore.momentum >= 18 ? 'Strong multi-timeframe momentum alignment — trend has broad support.' : healthScore.momentum >= 10 ? 'Moderate momentum — directional but not accelerating.' : 'Weak or mixed momentum across timeframes — avoid chasing.'}`}
                    />
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
                    <TransparencyDrawer
                      formula="Vol Ratio = Today's Volume / 20-Day Average Volume. Score = min(25, max(2, round(ratio × weight × 10))). Direction weight: 1.0 if return > 0, 0.7 if return 0 to −3%, 0.4 if return < −3%. Penalises high volume on strongly negative days."
                      interpret="> 2x = Spike (institutional activity). 1.3–2x = High. 0.5–1.3x = Normal. < 0.5x = Low (disinterest). High volume on a positive day = buying conviction. High volume on a negative day = distribution or stop-loss cascade. Volume without price movement = accumulation or absorption."
                      conclusion={`${volRatio.toFixed(1)}x average — ${volLabel}. ${volRatio > 1.5 ? ret1d > 0 ? 'High volume on an up day: buying conviction. Increases reliability of the bullish signal.' : 'High volume on a down day: selling pressure or distribution. Reduce position sizing.' : volRatio < 0.7 ? 'Below-average volume: lack of conviction. Avoid breakout trades — moves on low volume fade frequently.' : 'Volume is within normal range. No strong conviction signal either way.'}`}
                    />
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
                    <TransparencyDrawer
                      formula="Drawdown(t) = (Price(t) − RunningMax(Price[0..t])) / RunningMax(Price[0..t]) × 100. Always ≤ 0. RunningMax is the highest close within the window. 1W/1M/3M/1Y values show the maximum % decline from peak within each lookback window."
                      interpret="0 to −5% = Minor dip. −5 to −10% = Pullback. −10 to −20% = Correction. −20 to −30% = Bear phase. > −30% = Deep bear. Shallow drawdown + rapid recovery = high-quality compounding stock. Deep drawdown + slow recovery = value trap risk."
                      conclusion={`1M drawdown: ${data.drawdown_1m.toFixed(1)}%. 1Y drawdown: ${data.drawdown_1y.toFixed(1)}%. ${Math.abs(data.drawdown_1m) < 5 ? 'Shallow 1M drawdown — price is holding near recent highs. Positive for trend continuation.' : Math.abs(data.drawdown_1m) < 15 ? 'Moderate correction from 1M peak. Assess whether key support has held.' : 'Significant 1M drawdown. Risk/reward for fresh longs is impaired until drawdown narrows.'}`}
                    />
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
                    <TransparencyDrawer
                      formula="Resistance = SMAs above LTP, sorted ascending (nearest first). Support = SMAs below LTP, sorted descending (nearest first). Fallback order: SMA20 → SMA50 → SMA200 → 52W High/Low → LTP ±5%/±10%. SMA values come from 20-day closing price averages."
                      interpret="Each level is a zone where price previously found buyers/sellers. SMAs act as dynamic support/resistance because institutional algorithms place orders near them. A clean break above Resistance 1 on volume = bullish structural shift. A close below Support 1 = exit signal for longs."
                      conclusion={`LTP ₹${data.ltp.toLocaleString('en-IN')}. Nearest resistance: ₹${res1.toLocaleString('en-IN', { maximumFractionDigits: 1 })} (${((res1 - data.ltp) / data.ltp * 100).toFixed(1)}% away). Nearest support: ₹${sup1.toLocaleString('en-IN', { maximumFractionDigits: 1 })} (${((data.ltp - sup1) / data.ltp * 100).toFixed(1)}% below). ${(res1 - data.ltp) / data.ltp < 0.03 ? 'Very close to resistance — reduce size or wait for confirmed breakout.' : (data.ltp - sup1) / data.ltp < 0.02 ? 'Sitting on support — strong risk/reward for longs with tight stop.' : 'Price in mid-zone between support and resistance.'}`}
                    />
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
                    <TransparencyDrawer
                      formula="Each bullet is derived from a specific computed value: (1) Trend bullet ← trendScore count. (2) RS bullet ← secRank/secTotal. (3) 52W position ← pct52w = (LTP − Low52W) / (High52W − Low52W) × 100. (4) Volume bullet ← volRatio vs 20D avg. (5) Pattern bullet ← most recent pattern from /api/patterns/{symbol}/history."
                      interpret="▲ = bullish signal. ▼ = bearish signal. ◆ = neutral / mixed. These bullets are not a recommendation — they are a factual summary of the model's computed outputs. Read all bullets together; conflicting signals reduce conviction and suggest waiting for clarity."
                      conclusion={`${bullets.filter(b => b.type === 'bull').length} bullish, ${bullets.filter(b => b.type === 'bear').length} bearish, ${bullets.filter(b => b.type === 'neutral').length} neutral signals. ${bullets.filter(b => b.type === 'bull').length > bullets.filter(b => b.type === 'bear').length ? 'Balance of signals favours the long side.' : bullets.filter(b => b.type === 'bear').length > bullets.filter(b => b.type === 'bull').length ? 'Balance of signals favours caution.' : 'Signals are evenly split — no strong directional edge. Wait for a clearer setup.'}`}
                    />
                  </Box>
                </Grid>
              </Grid>
            </Grid>

            {/* ════ Right zone (3 cols) ════ */}
            <Grid item xs={12} lg={3}>

              {/* Action */}
              <Box sx={{ ...iCard(biasColor), mb: 2, height: 'auto' }}>
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
                <Box sx={{ ...iCard('#8b5cf6'), mb: 2, height: 'auto' }}>
                  <SectionHead title="BEST INDICATOR" accent="#8b5cf6" />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75, minWidth: 0 }}>
                    <Typography sx={{ ...MONO, fontSize: '0.7rem', fontWeight: 700, color: INK, flex: 1, mr: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{edgeData.best_indicator}</Typography>
                    {edgeData.grade && (
                      <Box sx={{ px: 0.75, py: 0.2, borderRadius: 0.75, bgcolor: '#22c55e14', border: '1px solid #22c55e30', flexShrink: 0 }}>
                        <Typography sx={{ ...MONO, fontSize: '0.58rem', color: '#22c55e', fontWeight: 700 }}>{edgeData.grade}</Typography>
                      </Box>
                    )}
                  </Box>
                  {edgeData.best_setup && (
                    <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, mb: 0.75, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{edgeData.best_setup}</Typography>
                  )}
                  {Array.isArray(edgeData.current_signals) && edgeData.current_signals.length > 0 && (
                    <Box sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: `${CYAN}10`, border: `1px solid ${CYAN}25` }}>
                      <Typography sx={{ ...MONO, fontSize: '0.62rem', color: CYAN, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Active: {edgeData.current_signals[0].signal_label}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}

              {/* Best Pattern Now */}
              <Box sx={{ ...iCard('#22c55e'), height: 'auto' }}>
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

