import { useState, useEffect, useMemo } from 'react'
import {
  Box, Typography, Grid, Select, MenuItem, CircularProgress,
  Alert, Table, TableBody, TableCell, TableHead, TableRow, Tooltip,
} from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { druckenmillerApi } from '../api/druckenmillerApi'
import type { ROC2ScanResult, ROC2ScanItem, ROC2StockResult, ROC2Phase } from '../types/druckenmiller_roc'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// ── Phase metadata ────────────────────────────────────────────────────────────

const PHASE_META: Record<ROC2Phase, { label: string; color: string; bg: string; short: string }> = {
  early_bottom:     { label: 'Early Bottom',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   short: 'EB'  },
  strong_uptrend:   { label: 'Strong Uptrend',  color: '#00C8FF', bg: 'rgba(0,200,255,0.12)',  short: 'SU'  },
  top_inflection:   { label: 'Top Inflection',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', short: 'TI'  },
  strong_downtrend: { label: 'Strong Downtrend',color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   short: 'SD'  },
  neutral:          { label: 'Neutral',          color: '#64748b', bg: 'rgba(100,116,139,0.1)',  short: 'N'   },
}

const pct = (v: number | null) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`

const score = (v: number) =>
  `${v >= 0 ? '+' : ''}${v.toFixed(1)}`

// ── Phase chip ────────────────────────────────────────────────────────────────

function PhaseChip({ phase, size = 'sm' }: { phase: ROC2Phase; size?: 'sm' | 'xs' }) {
  const m = PHASE_META[phase]
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center',
      px: size === 'xs' ? 0.75 : 1, py: size === 'xs' ? 0.25 : 0.375,
      borderRadius: '6px', border: `1px solid ${m.color}40`,
      bgcolor: m.bg,
      ...MONO, fontSize: size === 'xs' ? '0.6rem' : '0.65rem',
      fontWeight: 700, color: m.color, whiteSpace: 'nowrap', letterSpacing: '0.04em',
    }}>
      {size === 'xs' ? m.short : m.label}
    </Box>
  )
}

// ── Price sparkline (SVG) ─────────────────────────────────────────────────────

function PriceSparkline({ data, phase }: { data: number[]; phase: ROC2Phase }) {
  if (data.length < 2) return null
  const W = 56, H = 22, PAD = 1
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => {
      const x = PAD + (i / (data.length - 1)) * (W - PAD * 2)
      const y = PAD + (1 - (v - min) / range) * (H - PAD * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const up = data[data.length - 1] >= data[0]
  const color = phase === 'early_bottom' ? '#22c55e'
    : phase === 'strong_uptrend' ? '#00C8FF'
    : phase === 'top_inflection' ? '#fbbf24'
    : phase === 'strong_downtrend' ? '#ef4444'
    : up ? '#22c55e' : '#ef4444'
  return (
    <svg width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Lead count dots ───────────────────────────────────────────────────────────

function LeadDots({ count }: { count: number }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <Box key={i} sx={{
          width: 6, height: 6, borderRadius: '50%',
          bgcolor: i < count ? '#22c55e' : 'rgba(100,116,139,0.3)',
        }} />
      ))}
    </Box>
  )
}

// ── Scan row ──────────────────────────────────────────────────────────────────

function ScanRow({
  item, selected, onClick,
}: { item: ROC2ScanItem; selected: boolean; onClick: () => void }) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const { TD } = useTokens()

  const roc2Color = (v: number | null) =>
    v == null ? INK3 : v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : INK3

  return (
    <TableRow
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        transition: 'background 0.1s',
        bgcolor: selected ? `${CYAN}14` : 'transparent',
        '&:hover': { bgcolor: selected ? `${CYAN}20` : PAPER2 },
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <TableCell sx={{ ...TD, borderColor: BORDER, py: '6px !important' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box>
            <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 700, color: INK, lineHeight: 1.2 }}>
              {item.symbol}
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3, lineHeight: 1.2 }}>
              ₹{item.close.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </Typography>
          </Box>
          <PriceSparkline data={item.sparkline} phase={item.phase} />
        </Box>
      </TableCell>
      <TableCell sx={{ ...TD, borderColor: BORDER }}>
        <PhaseChip phase={item.phase} size="xs" />
      </TableCell>
      <TableCell sx={{ ...TD, borderColor: BORDER }}>
        <Typography sx={{ ...MONO, fontSize: '0.72rem', color: roc2Color(item.roc_intermediate) }}>
          {pct(item.roc_intermediate)}
        </Typography>
      </TableCell>
      <TableCell sx={{ ...TD, borderColor: BORDER }}>
        <Typography sx={{ ...MONO, fontSize: '0.72rem', color: roc2Color(item.roc2_intermediate) }}>
          {item.roc2_intermediate != null ? (item.roc2_intermediate >= 0 ? '+' : '') + (item.roc2_intermediate * 100).toFixed(2) + '%' : '—'}
        </Typography>
      </TableCell>
      <TableCell sx={{ ...TD, borderColor: BORDER }}>
        <LeadDots count={item.lead_count} />
      </TableCell>
      <TableCell sx={{ ...TD, borderColor: BORDER }}>
        <Typography sx={{
          ...MONO, fontSize: '0.72rem', fontWeight: 700,
          color: item.composite >= 20 ? '#22c55e' : item.composite <= -20 ? '#ef4444' : INK2,
        }}>
          {score(item.composite)}
        </Typography>
      </TableCell>
    </TableRow>
  )
}

// ── Timeframe card ────────────────────────────────────────────────────────────

function TimeframeCard({
  label, roc, roc2, phase,
}: { label: string; roc: number | null; roc2: number | null; phase: string }) {
  const { INK, INK2, INK3, PAPER, BORDER } = usePalette()
  const isEarlyBottom = phase === 'early_bottom'
  const roc2Color = roc2 == null ? INK3 : roc2 > 0 ? '#22c55e' : '#ef4444'

  return (
    <Box sx={{
      p: 2, borderRadius: '12px',
      bgcolor: PAPER,
      border: isEarlyBottom ? '1px solid #22c55e66' : `1px solid ${BORDER}`,
      boxShadow: isEarlyBottom ? '0 0 12px rgba(34,197,94,0.1)' : 'none',
    }}>
      <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 600, color: INK3, textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1.5 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>ROC (momentum)</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.875rem', fontWeight: 700, color: roc != null && roc > 0 ? '#22c55e' : roc != null && roc < 0 ? '#ef4444' : INK2 }}>
            {pct(roc)}
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>ROC² (acceleration)</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.875rem', fontWeight: 700, color: roc2Color }}>
            {roc2 != null ? (roc2 >= 0 ? '+' : '') + (roc2 * 100).toFixed(3) + '%' : '—'}
          </Typography>
        </Box>
        {isEarlyBottom && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderRadius: '6px', bgcolor: '#22c55e14', border: '1px solid #22c55e40' }}>
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: '#22c55e', fontWeight: 700 }}>
              ▲ DRUCKENMILLER SIGNAL
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── ROC² chart ────────────────────────────────────────────────────────────────

function ROC2Chart({ result }: { result: ROC2StockResult }) {
  const { mode } = useThemeMode()
  const { INK, INK3, PAPER, BORDER, CYAN } = usePalette()
  const dark = mode === 'dark'

  const { closeSeries, roc2Series, volRoc2Series } = useMemo(() => {
    const cs: [number, number][] = []
    const r2: [number, number][] = []
    const vr: [number, number][] = []

    for (const pt of result.history) {
      const ts = new Date(pt.date).getTime()
      cs.push([ts, pt.close])
      if (pt.roc2 != null) r2.push([ts, +(pt.roc2 * 100).toFixed(4)])
      if (pt.vol_roc2 != null) vr.push([ts, +(pt.vol_roc2 * 100).toFixed(4)])
    }
    return { closeSeries: cs, roc2Series: r2, volRoc2Series: vr }
  }, [result])

  const options: Highcharts.Options = {
    chart: {
      backgroundColor: 'transparent',
      animation: false,
      height: 380,
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
    },
    credits: { enabled: false },
    navigator: { enabled: false },
    scrollbar: { enabled: false },
    rangeSelector: { enabled: false },
    legend: {
      enabled: true,
      itemStyle: { color: INK3, fontSize: '0.65rem', fontWeight: '400' },
      itemHoverStyle: { color: INK },
    },
    xAxis: {
      type: 'datetime',
      lineColor: BORDER, tickColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.6rem' }, ...MONO },
      crosshair: { color: `${CYAN}40`, dashStyle: 'Dash' },
    },
    yAxis: [
      {
        // Price
        title: { text: null },
        labels: {
          style: { color: INK3, fontSize: '0.6rem' }, ...MONO,
          formatter() { return '₹' + (this.value as number).toLocaleString('en-IN', { maximumFractionDigits: 0 }) },
        },
        gridLineColor: `${BORDER}60`,
        height: '55%', top: '0%', offset: 0,
      },
      {
        // ROC²
        title: { text: null },
        labels: {
          style: { color: INK3, fontSize: '0.6rem' }, ...MONO,
          formatter() { return (this.value as number).toFixed(1) + '%' },
        },
        gridLineColor: `${BORDER}60`,
        plotLines: [{ value: 0, color: `${BORDER}CC`, width: 1, dashStyle: 'Solid' }],
        height: '20%', top: '60%', offset: 0,
      },
      {
        // Volume ROC²
        title: { text: null },
        labels: {
          style: { color: INK3, fontSize: '0.6rem' }, ...MONO,
          formatter() { return (this.value as number).toFixed(1) + '%' },
        },
        gridLineColor: `${BORDER}60`,
        plotLines: [{ value: 0, color: `${BORDER}CC`, width: 1, dashStyle: 'Solid' }],
        height: '15%', top: '83%', offset: 0,
      },
    ],
    tooltip: {
      shared: true,
      backgroundColor: dark ? '#0F1C3A' : '#FFFFFF',
      borderColor: BORDER,
      style: { color: INK, fontSize: '0.7rem', fontFamily: "'IBM Plex Mono', monospace" },
      xDateFormat: '%d %b %Y',
    },
    series: [
      {
        type: 'line',
        name: 'Close',
        data: closeSeries,
        yAxis: 0,
        color: CYAN,
        lineWidth: 1.5,
        marker: { enabled: false },
        tooltip: { valuePrefix: '₹', valueDecimals: 2 },
      },
      {
        type: 'column',
        name: 'ROC² (63d mom)',
        data: roc2Series,
        yAxis: 1,
        color: '#22c55e',
        negativeColor: '#ef4444',
        pointPadding: 0,
        groupPadding: 0,
        tooltip: { valueSuffix: '%', valueDecimals: 3 },
      },
      {
        type: 'column',
        name: 'Vol ROC²',
        data: volRoc2Series,
        yAxis: 2,
        color: '#60a5fa',
        negativeColor: '#f97316',
        pointPadding: 0,
        groupPadding: 0,
        tooltip: { valueSuffix: '%', valueDecimals: 3 },
      },
    ],
  }

  return (
    <Box sx={{ '& .highcharts-background': { fill: 'transparent' } }}>
      <HighchartsReact highcharts={Highcharts} constructorType="stockChart" options={options} />
    </Box>
  )
}

// ── ROC vs ROC² comparison chart ─────────────────────────────────────────────

type TF = 'short' | 'intermediate' | 'long'

const TF_META: Record<TF, { label: string; rocLabel: string; roc2Label: string }> = {
  short:        { label: 'Short',        rocLabel: 'ROC (21d)',  roc2Label: 'ROC² (Δ5d)'  },
  intermediate: { label: 'Intermediate', rocLabel: 'ROC (63d)',  roc2Label: 'ROC² (Δ21d)' },
  long:         { label: 'Long',         rocLabel: 'ROC (126d)', roc2Label: 'ROC² (Δ42d)' },
}

function ROCvsROC2Chart({ result }: { result: ROC2StockResult }) {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const dark = mode === 'dark'

  const [tf, setTf] = useState<TF>('intermediate')
  const meta = TF_META[tf]

  const { rocSeries, roc2Series, earlyBottomBands } = useMemo(() => {
    const roc: [number, number][] = []
    const roc2: [number, number][] = []
    const bands: Highcharts.XAxisPlotBandsOptions[] = []
    let bandStart: number | null = null

    for (const pt of result.history) {
      const ts = new Date(pt.date).getTime()

      const rocVal  = tf === 'short' ? pt.roc_short  : tf === 'long' ? pt.roc_long  : pt.roc
      const roc2Val = tf === 'short' ? pt.roc2_short : tf === 'long' ? pt.roc2_long : pt.roc2

      if (rocVal  != null) roc.push([ts,  +(rocVal  * 100).toFixed(3)])
      if (roc2Val != null) roc2.push([ts, +(roc2Val * 100).toFixed(3)])

      // Early Bottom zone: roc < 0 AND roc2 > 0 for this timeframe
      const isEB = rocVal != null && roc2Val != null && rocVal < 0 && roc2Val > 0
      if (isEB && bandStart === null) bandStart = ts
      if (!isEB && bandStart !== null) {
        bands.push({ from: bandStart, to: ts, color: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.3)', borderWidth: 1 })
        bandStart = null
      }
    }
    if (bandStart !== null && result.history.length) {
      const last = new Date(result.history[result.history.length - 1].date).getTime()
      bands.push({ from: bandStart, to: last, color: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.3)', borderWidth: 1 })
    }

    return { rocSeries: roc, roc2Series: roc2, earlyBottomBands: bands }
  }, [result, tf])

  const options: Highcharts.Options = {
    chart: {
      type: 'line',
      backgroundColor: 'transparent',
      animation: false,
      height: 220,
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
      marginRight: 60,
    },
    credits: { enabled: false },
    title: { text: undefined },
    legend: {
      enabled: true,
      align: 'left',
      verticalAlign: 'top',
      itemStyle: { color: INK3, fontSize: '0.62rem', fontWeight: '400', ...MONO },
      itemHoverStyle: { color: INK },
      symbolHeight: 6, symbolRadius: 0, squareSymbol: false,
    },
    xAxis: {
      type: 'datetime',
      lineColor: BORDER, tickColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.58rem', ...MONO } },
      crosshair: { color: `${CYAN}40`, dashStyle: 'Dash' },
      plotBands: earlyBottomBands,
    },
    yAxis: [
      {
        title: { text: 'ROC %', style: { color: INK3, fontSize: '0.58rem' }, margin: 4 },
        labels: {
          style: { color: INK3, fontSize: '0.58rem', ...MONO },
          formatter() { return (this.value as number).toFixed(0) + '%' },
        },
        gridLineColor: `${BORDER}50`,
        plotLines: [{ value: 0, color: BORDER, width: 1, zIndex: 2 }],
      },
      {
        title: { text: 'ROC² %', style: { color: INK3, fontSize: '0.58rem' }, margin: 4 },
        labels: {
          style: { color: INK3, fontSize: '0.58rem', ...MONO },
          formatter() { return (this.value as number).toFixed(2) + '%' },
        },
        gridLineColor: 'transparent',
        plotLines: [{ value: 0, color: '#22c55e60', width: 1.5, dashStyle: 'Dot', zIndex: 3 }],
        opposite: true,
      },
    ],
    tooltip: {
      shared: true,
      backgroundColor: dark ? '#0F1C3A' : '#FFFFFF',
      borderColor: BORDER,
      style: { color: INK, fontSize: '0.68rem', ...MONO },
      xDateFormat: '%d %b %Y',
    },
    series: [
      {
        type: 'line',
        name: meta.rocLabel,
        data: rocSeries,
        yAxis: 0,
        color: CYAN,
        lineWidth: 1.5,
        marker: { enabled: false },
        tooltip: { valueSuffix: '%', valueDecimals: 2 },
        zIndex: 2,
      },
      {
        type: 'line',
        name: meta.roc2Label,
        data: roc2Series,
        yAxis: 1,
        color: '#22c55e',
        negativeColor: '#ef4444',
        lineWidth: 1.5,
        marker: { enabled: false },
        tooltip: { valueSuffix: '%', valueDecimals: 3 },
        zIndex: 3,
      },
    ],
  }

  return (
    <Box>
      {/* Header row with toggle */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 3, height: 14, borderRadius: 2, bgcolor: '#22c55e' }} />
          <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK }}>
            ROC vs ROC²
          </Typography>
        </Box>
        {/* Timeframe toggle pills */}
        <Box sx={{ display: 'flex', gap: 0.5, ml: 0.5 }}>
          {(['short', 'intermediate', 'long'] as TF[]).map(t => (
            <Box
              key={t}
              onClick={() => setTf(t)}
              sx={{
                px: 1.25, py: 0.35, borderRadius: '6px', cursor: 'pointer',
                border: `1px solid ${tf === t ? CYAN : BORDER}`,
                bgcolor: tf === t ? `${CYAN}18` : 'transparent',
                transition: 'all 0.12s',
                '&:hover': { borderColor: CYAN, bgcolor: `${CYAN}10` },
              }}
            >
              <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: tf === t ? CYAN : INK3 }}>
                {TF_META[t].label}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3 }}>
          green band = Early Bottom zone
        </Typography>
      </Box>

      <Box sx={{ '& .highcharts-background': { fill: 'transparent' } }}>
        <HighchartsReact highcharts={Highcharts} options={options} />
      </Box>
    </Box>
  )
}

// ── Stock detail panel ────────────────────────────────────────────────────────

function StockDetail({ symbol }: { symbol: string }) {
  const { INK, INK2, INK3, PAPER, BORDER, CYAN, BG } = usePalette()
  const { CARD } = useTokens()
  const [data, setData] = useState<ROC2StockResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setErr(null)
    druckenmillerApi.getStock(symbol)
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
      <CircularProgress size={32} sx={{ color: CYAN }} />
    </Box>
  )
  if (err) return <Alert severity="error" sx={{ mt: 2 }}>{err}</Alert>
  if (!data) return null

  const m = PHASE_META[data.phase]

  // Derive phase interpretation
  const interp: Record<ROC2Phase, string> = {
    early_bottom: 'ROC is negative but ROC² has turned positive — the rate of decline is decelerating. This is the Druckenmiller leading signal: the stock may bottom 12–18 months before fundamentals recover.',
    strong_uptrend: 'Both ROC and ROC² are positive — momentum is accelerating upward. Trend-following is rewarded; watch for ROC² rollover as a warning.',
    top_inflection: 'ROC is positive but ROC² has turned negative — the uptrend is losing speed. A top inflection precedes a trend reversal; reduce exposure if ROC² stays negative for 2+ weeks.',
    strong_downtrend: 'Both ROC and ROC² are negative — momentum is accelerating downward. Avoid new long entries; wait for ROC² to turn positive before considering bottom signals.',
    neutral: 'No clear directional bias. ROC is near zero, indicating the stock is range-bound. Wait for a phase change before committing capital.',
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2.5 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: INK }}>
              {data.symbol}
            </Typography>
            <PhaseChip phase={data.phase} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '6px', bgcolor: `${CYAN}14`, border: `1px solid ${CYAN}40` }}>
              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: CYAN, fontWeight: 700 }}>
                LEAD {data.lead_count}/3
              </Typography>
            </Box>
          </Box>
          <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>
            ₹{data.close.toLocaleString('en-IN', { maximumFractionDigits: 2 })} · Score {score(data.composite)} · {data.date}
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto', textAlign: 'right' }}>
          <Typography sx={{ ...MONO, fontSize: '1.5rem', fontWeight: 800, color: m.color }}>
            {score(data.composite)}
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            composite
          </Typography>
        </Box>
      </Box>

      {/* Phase interpretation */}
      <Box sx={{
        p: 2, borderRadius: '12px', mb: 2,
        bgcolor: m.bg, border: `1px solid ${m.color}40`,
      }}>
        <Typography sx={{ ...SANS, fontSize: '0.75rem', color: m.color, fontWeight: 600, mb: 0.5 }}>
          {m.label}
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.6 }}>
          {interp[data.phase]}
        </Typography>
      </Box>

      {/* Three timeframe cards */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2.5 }}>
        {[
          {
            label: 'Short  (21d ROC · 5d ROC²)',
            roc: data.roc_short, roc2: data.roc2_short,
            phase: data.roc_short != null && data.roc_short < 0 && data.roc2_short != null && data.roc2_short > 0 ? 'early_bottom' : 'neutral',
          },
          {
            label: 'Intermediate  (63d ROC · 21d ROC²)',
            roc: data.roc_intermediate, roc2: data.roc2_intermediate,
            phase: data.phase,
          },
          {
            label: 'Long  (126d ROC · 42d ROC²)',
            roc: data.roc_long, roc2: data.roc2_long,
            phase: data.roc_long != null && data.roc_long < 0 && data.roc2_long != null && data.roc2_long > 0 ? 'early_bottom' : 'neutral',
          },
        ].map(tf => (
          <TimeframeCard key={tf.label} label={tf.label} roc={tf.roc} roc2={tf.roc2} phase={tf.phase} />
        ))}
      </Box>

      {/* ROC vs ROC² comparison chart */}
      <Box sx={{ mb: 2.5 }}>
        <ROCvsROC2Chart result={data} />
      </Box>

      {/* Volume ROC² */}
      {data.vol_roc2 != null && (
        <Box sx={{ p: 1.5, borderRadius: '10px', mb: 2.5, bgcolor: PAPER, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box>
            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.25 }}>
              Volume ROC²
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.875rem', fontWeight: 700, color: data.vol_roc2 > 0 ? '#60a5fa' : '#f97316' }}>
              {(data.vol_roc2 >= 0 ? '+' : '') + (data.vol_roc2 * 100).toFixed(3)}%
            </Typography>
          </Box>
          <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, lineHeight: 1.5 }}>
            {data.vol_roc2 > 0
              ? 'Volume momentum is improving — buyers are becoming more active. Positive Vol ROC² alongside price Early Bottom is a high-conviction confirmation.'
              : 'Volume momentum is declining. Price ROC² signal without volume confirmation has lower reliability.'}
          </Typography>
        </Box>
      )}

      {/* Chart */}
      <ROC2Chart result={data} />
    </Box>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PHASE_FILTERS: Array<{ value: ROC2Phase | 'all'; label: string }> = [
  { value: 'all',             label: 'All Phases'     },
  { value: 'early_bottom',    label: 'Early Bottom'   },
  { value: 'strong_uptrend',  label: 'Strong Uptrend' },
  { value: 'top_inflection',  label: 'Top Inflection' },
  { value: 'strong_downtrend',label: 'Downtrend'      },
  { value: 'neutral',         label: 'Neutral'        },
]

export default function DruckenmillerROCPage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, PAPER, PAPER2, BORDER, BG, CYAN } = usePalette()
  const { CARD, TH, TD } = useTokens()

  const [scan, setScan] = useState<ROC2ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [phaseFilter, setPhaseFilter] = useState<ROC2Phase | 'all'>('all')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    druckenmillerApi.getScan()
      .then(d => { setScan(d); if (d.stocks.length) setSelected(d.stocks[0].symbol) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!scan) return []
    return phaseFilter === 'all' ? scan.stocks : scan.stocks.filter(s => s.phase === phaseFilter)
  }, [scan, phaseFilter])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, display: 'flex', flexDirection: 'column' }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        px: { xs: 2, md: 6 }, pt: 5, pb: 4,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5, borderRadius: '6px', border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}10`, mb: 1.5 }}>
          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: CYAN, animation: 'pulse 2s ease-in-out infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } } }} />
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: CYAN, letterSpacing: '0.12em', fontWeight: 700 }}>
            DRUCKENMILLER ROC²
          </Typography>
        </Box>

        <Typography sx={{ ...SANS, fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, color: INK, lineHeight: 1.15, mb: 0.75 }}>
          Rate of Change <Box component="span" sx={{ color: CYAN }}>Squared</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.875rem', color: INK3, maxWidth: 560, lineHeight: 1.6, mb: 2 }}>
          "Because it used second derivative rate of change, these things will often bottom a year to a year and a
          half before the fundamentals." — Stan Druckenmiller
        </Typography>

        {/* Market summary */}
        {scan && (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {[
              { label: 'Early Bottom',    count: scan.early_bottom_count,    color: '#22c55e' },
              { label: 'Strong Uptrend',  count: scan.strong_uptrend_count,  color: CYAN      },
              { label: 'Top Inflection',  count: scan.top_inflection_count,  color: '#fbbf24' },
              { label: 'Downtrend',       count: scan.strong_downtrend_count,color: '#ef4444' },
            ].map(s => (
              <Box
                key={s.label}
                onClick={() => setPhaseFilter(
                  phaseFilter === (s.label === 'Downtrend' ? 'strong_downtrend' : s.label.toLowerCase().replace(' ', '_') as ROC2Phase)
                    ? 'all'
                    : (s.label === 'Downtrend' ? 'strong_downtrend' : s.label.toLowerCase().replace(' ', '_') as ROC2Phase)
                )}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75,
                  borderRadius: '8px', bgcolor: `${s.color}12`, border: `1px solid ${s.color}40`,
                  cursor: 'pointer', transition: 'all 0.15s',
                  '&:hover': { bgcolor: `${s.color}20` },
                }}
              >
                <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: s.color }}>{s.count}</Typography>
                <Typography sx={{ ...SANS, fontSize: '0.65rem', color: s.color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, px: { xs: 2, md: 6 }, py: 4 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress sx={{ color: CYAN }} />
          </Box>
        )}
        {err && <Alert severity="error">{err}</Alert>}

        {scan && (
          <Grid container spacing={2.5}>
            {/* Left: scanner */}
            <Grid item xs={12} lg={5}>
              <Box sx={{ ...CARD, p: 0, overflow: 'hidden' }}>
                {/* Filter bar */}
                <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                    Phase
                  </Typography>
                  <Select
                    value={phaseFilter}
                    onChange={e => setPhaseFilter(e.target.value as ROC2Phase | 'all')}
                    size="small"
                    sx={{
                      fontSize: '0.75rem', color: INK, height: 28,
                      ...SANS,
                      '& .MuiOutlinedInput-notchedOutline': { borderColor: BORDER },
                      '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: CYAN },
                      '& .MuiSelect-icon': { color: INK3 },
                    }}
                    MenuProps={{ PaperProps: { sx: { bgcolor: PAPER, border: `1px solid ${BORDER}` } } }}
                  >
                    {PHASE_FILTERS.map(f => (
                      <MenuItem key={f.value} value={f.value} sx={{ fontSize: '0.75rem', color: INK, ...SANS }}>
                        {f.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3, ml: 'auto' }}>
                    {filtered.length} stocks
                  </Typography>
                </Box>

                {/* Table */}
                <Box sx={{ maxHeight: 540, overflowY: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: BORDER, borderRadius: 2 } }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        {['Symbol', 'Phase', 'ROC', 'ROC²', 'Lead', 'Score'].map(h => (
                          <TableCell key={h} sx={{ ...TH, bgcolor: PAPER2 }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filtered.map(item => (
                        <ScanRow
                          key={item.symbol}
                          item={item}
                          selected={selected === item.symbol}
                          onClick={() => setSelected(item.symbol)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            </Grid>

            {/* Right: detail */}
            <Grid item xs={12} lg={7}>
              <Box sx={{ ...CARD }}>
                {selected
                  ? <StockDetail symbol={selected} />
                  : (
                    <Box sx={{ py: 8, textAlign: 'center' }}>
                      <Typography sx={{ ...SANS, color: INK3, fontSize: '0.875rem' }}>
                        Select a stock from the scanner to view ROC² analysis
                      </Typography>
                    </Box>
                  )
                }
              </Box>
            </Grid>
          </Grid>
        )}

        {/* Method card */}
        {scan && (
          <Box sx={{ ...CARD, mt: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: CYAN }} />
              <Typography sx={{ ...SANS, fontSize: '0.82rem', fontWeight: 800, color: INK }}>
                How ROC² Works
              </Typography>
            </Box>
            <Grid container spacing={3}>
              {[
                {
                  title: 'ROC (1st derivative)',
                  formula: 'ROC = (price[t] / price[t-63]) − 1',
                  desc: 'Measures the 63-day price momentum — positive when price is higher than 63 days ago, negative when lower. The sign tells you the direction of the trend.',
                  color: CYAN,
                },
                {
                  title: 'ROC² (2nd derivative)',
                  formula: 'ROC² = ROC[t] − ROC[t-21]',
                  desc: 'Measures the change in momentum over the last 21 bars. ROC² > 0 means momentum is improving, even if it is still negative. This is the Druckenmiller leading indicator.',
                  color: '#22c55e',
                },
                {
                  title: 'Early Bottom Signal',
                  formula: 'ROC < 0  AND  ROC² > 0',
                  desc: 'The stock is still below its 63-day level (ROC < 0) but the rate of decline is slowing (ROC² > 0). Historically leads trend reversal by 6–18 months.',
                  color: '#22c55e',
                },
                {
                  title: 'Lead Count (0–3)',
                  formula: 'Count of timeframes where ROC² > 0',
                  desc: 'Counts how many of the three timeframes (short/intermediate/long) have positive ROC². Lead count = 3 is highest conviction — improvement confirmed across all horizons.',
                  color: '#fbbf24',
                },
              ].map(item => (
                <Grid key={item.title} item xs={12} sm={6} lg={3}>
                  <Box sx={{ p: 2, borderRadius: '10px', bgcolor: PAPER2, height: '100%' }}>
                    <Typography sx={{ ...SANS, fontSize: '0.7rem', fontWeight: 700, color: item.color, mb: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {item.title}
                    </Typography>
                    <Box sx={{ p: 1, borderRadius: '6px', bgcolor: `${item.color}10`, border: `1px solid ${item.color}30`, mb: 1.25 }}>
                      <Typography sx={{ ...MONO, fontSize: '0.65rem', color: item.color }}>
                        {item.formula}
                      </Typography>
                    </Box>
                    <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.6 }}>
                      {item.desc}
                    </Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}
      </Box>

      <Footer />
    </Box>
  )
}
