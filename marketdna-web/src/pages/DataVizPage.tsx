import { useState, useMemo, useCallback } from 'react'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import {
  Box, Typography, LinearProgress, Grid,
  Select, MenuItem, OutlinedInput,
} from '@mui/material'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import SymbolAutocomplete from '../components/shared/SymbolAutocomplete'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { datavizApi } from '../api/datavizApi'
import type { ReturnSnapshotResponse, ReturnHistoryResponse, ScatterResponse, Above200WeeklyResponse } from '../types/dataviz'
import {
  HistogramSection, VolTermStructureSection, CrossVolSection,
  RiskAdjRankingSection, CalendarSection, MultiSMASection,
  ADLineSection, CorrMatrixSection, AlphaBetaSection,
} from './DataVizAnalyticsSections'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const

// ─── Horizon options ──────────────────────────────────────────────────────────

const HORIZONS = [
  { value: 'ret_1d',   label: '1 Day'     },
  { value: 'ret_5d',   label: '1 Week'    },
  { value: 'ret_20d',  label: '1 Month'   },
  { value: 'ret_50d',  label: '2½ Month'  },
  { value: 'ret_1y',   label: '1 Year'    },
  { value: 'ret_2y',   label: '2 Year'    },
  { value: 'ret_3y',   label: '3 Year'    },
  { value: 'cagr_1y',  label: 'CAGR 1Y'  },
  { value: 'cagr_2y',  label: 'CAGR 2Y'  },
  { value: 'cagr_3y',  label: 'CAGR 3Y'  },
  { value: 'cagr_5y',  label: 'CAGR 5Y'  },
]

const TOP_N_OPTIONS = [10, 20, 30, 50]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WIN  = '#22c55e'
const LOSS = '#ef4444'

function fmt(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function horizonLabel(h: string): string {
  return HORIZONS.find(x => x.value === h)?.label ?? h
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: '2px', bgcolor: accent, flexShrink: 0, boxShadow: `0 0 8px ${accent}80` }} />
      <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: INK, letterSpacing: '0.02em', ...JAKARTA }}>{title}</Typography>
      {meta && <Typography sx={{ fontSize: '0.62rem', color: INK3, ml: 'auto', ...JAKARTA }}>{meta}</Typography>}
    </Box>
  )
}

function RunBtn({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  const { CYAN } = usePalette()
  return (
    <Box component="button" onClick={onClick} disabled={loading} sx={{
      px: 2.5, py: 0.875, borderRadius: '10px', fontSize: '0.78rem', fontWeight: 700,
      cursor: loading ? 'wait' : 'pointer',
      background: `linear-gradient(135deg, ${CYAN}, #0078A8)`,
      color: '#fff', border: 'none', opacity: loading ? 0.6 : 1,
      letterSpacing: '0.06em', boxShadow: `0 0 16px ${CYAN}40`,
      '&:hover:not(:disabled)': { boxShadow: `0 0 24px ${CYAN}70`, transform: 'translateY(-1px)' },
      transition: 'all 0.15s', ...JAKARTA,
    }}>
      {loading ? 'Loading…' : label}
    </Box>
  )
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  const { INK, INK3, PAPER2, BORDER } = usePalette()
  return (
    <Box sx={{ px: 2, py: 1.25, borderRadius: '12px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
      <Typography sx={{ fontSize: '0.6rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase', ...JAKARTA }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: color ?? INK, ...MONO }}>{value}</Typography>
    </Box>
  )
}

// ─── Snapshot bar chart ───────────────────────────────────────────────────────

function SnapshotChart({ data, horizon }: { data: ReturnSnapshotResponse; horizon: string }) {
  const { mode } = useThemeMode()

  const isDark       = mode === 'dark'
  const gridColor    = isDark ? '#1E3055' : '#D1DCEA'
  const labelColor   = isDark ? '#7A90B4' : '#8696AC'
  const surfaceColor = isDark ? '#0B1429' : '#FFFFFF'
  const textColor    = isDark ? '#E4EDFF' : '#0B1829'

  // losers: most negative first → winners: most positive last
  const combined = useMemo(() => {
    const losers  = [...data.losers].sort((a, b) => a.value - b.value)   // most negative first
    const winners = [...data.winners].sort((a, b) => a.value - b.value)  // least positive first
    return [...losers, ...winners]
  }, [data])

  const options = useMemo((): Highcharts.Options => ({
    chart: {
      type: 'column',
      height: 420,
      backgroundColor: 'transparent',
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
      animation: { duration: 300 },
    },
    title: { text: '' },
    credits: { enabled: false },
    navigation: { buttonOptions: { enabled: false } },
    xAxis: {
      categories: combined.map(b => b.symbol),
      lineColor: gridColor,
      tickColor: gridColor,
      labels: {
        rotation: -60,
        style: { color: labelColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px' },
      },
    },
    yAxis: {
      title: { text: `${horizonLabel(horizon)} Return (%)`, style: { color: labelColor, fontSize: '11px' } },
      gridLineColor: gridColor,
      lineColor: gridColor,
      labels: {
        format: '{value}%',
        style: { color: labelColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' },
      },
      plotLines: [{
        value: 0,
        color: isDark ? '#4B607A' : '#8696AC',
        width: 1,
        zIndex: 5,
      }],
    },
    tooltip: {
      backgroundColor: surfaceColor,
      borderColor: isDark ? '#1E3055' : '#D1DCEA',
      borderWidth: 1,
      shadow: false,
      style: { color: textColor, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '12px' },
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const v = this.y as number
        const col = v >= 0 ? WIN : LOSS
        return `<b style="font-family:'IBM Plex Mono',monospace">${this.x}</b><br/>` +
               `<span style="color:${col};font-weight:700">${fmt(v)}</span>`
      },
    },
    legend: { enabled: false },
    plotOptions: {
      column: {
        borderRadius: 3,
        borderWidth: 0,
        groupPadding: 0.05,
        pointPadding: 0.02,
      },
    },
    series: [{
      type: 'column',
      name: horizonLabel(horizon),
      data: combined.map(b => ({
        y: b.value,
        color: b.value >= 0 ? WIN : LOSS,
      })),
    }],
  }), [combined, horizon, isDark, gridColor, labelColor, surfaceColor, textColor])

  return (
    <Box sx={{ mt: 1, '.highcharts-container': { width: '100% !important' } }}>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── History bar chart ────────────────────────────────────────────────────────

function HistoryChart({ data, metric }: { data: ReturnHistoryResponse; metric: string }) {
  const { mode } = useThemeMode()

  const isDark = mode === 'dark'
  const gridColor  = isDark ? '#1E3055' : '#D1DCEA'
  const labelColor = isDark ? '#7A90B4' : '#8696AC'
  const surfaceColor = isDark ? '#0B1429' : '#FFFFFF'
  const textColor    = isDark ? '#E4EDFF' : '#0B1829'

  const options = useMemo((): Highcharts.Options => ({
    chart: {
      type: 'column',
      height: 380,
      backgroundColor: 'transparent',
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
      animation: { duration: 300 },
    },
    title: { text: '' },
    credits: { enabled: false },
    navigation: { buttonOptions: { enabled: false } },
    xAxis: {
      type: 'datetime',
      lineColor: gridColor,
      tickColor: gridColor,
      labels: {
        style: { color: labelColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px' },
      },
    },
    yAxis: {
      title: { text: `${horizonLabel(metric)} Return (%)`, style: { color: labelColor, fontSize: '11px' } },
      gridLineColor: gridColor,
      labels: {
        format: '{value}%',
        style: { color: labelColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' },
      },
      plotLines: [{
        value: 0,
        color: isDark ? '#4B607A' : '#8696AC',
        width: 1,
        zIndex: 5,
      }],
    },
    tooltip: {
      backgroundColor: surfaceColor,
      borderColor: isDark ? '#1E3055' : '#D1DCEA',
      borderWidth: 1,
      shadow: false,
      style: { color: textColor, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '12px' },
      xDateFormat: '%d %b %Y',
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const v = this.y as number
        const col = v >= 0 ? WIN : LOSS
        const d = new Date(this.x as number)
        const ds = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        return `<b>${ds}</b><br/><span style="color:${col};font-weight:700">${fmt(v)}</span>`
      },
    },
    legend: { enabled: false },
    plotOptions: {
      column: {
        borderRadius: 2,
        borderWidth: 0,
        groupPadding: 0,
        pointPadding: 0.05,
        maxPointWidth: 8,
      },
    },
    series: [{
      type: 'column',
      name: metric,
      data: data.data.map(d => ({
        x: Date.parse(d.date),
        y: d.value,
        color: d.value >= 0 ? WIN : LOSS,
      })),
    }],
  }), [data, metric, isDark, gridColor, labelColor, surfaceColor, textColor])

  return (
    <Box sx={{ mt: 1, '.highcharts-container': { width: '100% !important' } }}>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── Cross-sectional snapshot section ────────────────────────────────────────

function SnapshotSection() {
  const { CARD, INPUT_SX, BORDER, CYAN, PAPER2, INK, INK2, INK3 } = useTokens()
  const [horizon,  setHorizon]  = useState('ret_1d')
  const [topN,     setTopN]     = useState(30)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [data,     setData]     = useState<ReturnSnapshotResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await datavizApi.getSnapshot(horizon, topN)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [horizon, topN])

  const pctPositive = data
    ? ((data.stats.n_positive / data.stats.n_symbols) * 100).toFixed(1)
    : null

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <SectionHead title="Cross-Sectional Returns" accent="#6366f1" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Horizon picker */}
          <Select
            value={horizon}
            onChange={e => setHorizon(e.target.value)}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {HORIZONS.map(h => (
              <MenuItem key={h.value} value={h.value} sx={{ fontSize: '0.72rem', color: INK }}>{h.label}</MenuItem>
            ))}
          </Select>

          {/* Top N picker */}
          <Select
            value={topN}
            onChange={e => setTopN(Number(e.target.value))}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 80, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {TOP_N_OPTIONS.map(n => (
              <MenuItem key={n} value={n} sx={{ fontSize: '0.72rem', color: INK }}>Top {n}</MenuItem>
            ))}
          </Select>

          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>

      {loading && (
        <LinearProgress sx={{
          borderRadius: 1, mb: 2, bgcolor: BORDER,
          '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
        }} />
      )}

      {error && (
        <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', mb: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</Typography>
        </Box>
      )}

      {data && !error && (
        <>
          {/* Stats strip */}
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
            <StatChip label="Universe" value={`${data.stats.n_symbols} stocks`} />
            <StatChip label="Advancing" value={`${data.stats.n_positive} (${pctPositive}%)`} color={WIN} />
            <StatChip label="Declining" value={`${data.stats.n_negative}`} color={LOSS} />
            <StatChip label="Avg Return" value={fmt(data.stats.avg)} color={data.stats.avg >= 0 ? WIN : LOSS} />
            <StatChip label="Median" value={fmt(data.stats.median)} color={data.stats.median >= 0 ? WIN : LOSS} />
            <StatChip label="Best" value={fmt(data.stats.max_val)} color={WIN} />
            <StatChip label="Worst" value={fmt(data.stats.min_val)} color={LOSS} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>

          {/* Winner / Loser legend */}
          <Box sx={{ display: 'flex', gap: 2, mb: 1.5, alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: LOSS }} />
              <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>
                Bottom {topN} losers (left)
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: WIN }} />
              <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>
                Top {topN} winners (right)
              </Typography>
            </Box>
          </Box>

          <SnapshotChart data={data} horizon={horizon} />
        </>
      )}

      {!data && !loading && !error && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>
            Select a return horizon and click Load Chart to see the cross-sectional distribution.
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Symbol history section ───────────────────────────────────────────────────

function HistorySection() {
  const { CARD, INPUT_SX, BORDER, CYAN, PAPER2, INK, INK2, INK3 } = useTokens()
  const [symbol,  setSymbol]  = useState('RELIANCE')
  const [metric,  setMetric]  = useState('ret_1d')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<ReturnHistoryResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await datavizApi.getHistory(symbol, metric)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [symbol, metric])

  const positiveCount = data?.data.filter(d => d.value >= 0).length ?? 0
  const totalCount    = data?.data.length ?? 0
  const winRate       = totalCount > 0 ? ((positiveCount / totalCount) * 100).toFixed(1) : null

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <SectionHead title="Symbol Return History" accent="#f59e0b" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Symbol picker */}
          <SymbolAutocomplete value={symbol} onChange={setSymbol} minWidth={160} />

          {/* Metric picker */}
          <Select
            value={metric}
            onChange={e => setMetric(e.target.value)}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {HORIZONS.map(h => (
              <MenuItem key={h.value} value={h.value} sx={{ fontSize: '0.72rem', color: INK }}>{h.label}</MenuItem>
            ))}
          </Select>

          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>

      {loading && (
        <LinearProgress sx={{
          borderRadius: 1, mb: 2, bgcolor: BORDER,
          '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
        }} />
      )}

      {error && (
        <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', mb: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</Typography>
        </Box>
      )}

      {data && !error && (
        <>
          {/* Stats strip */}
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatChip label="Symbol" value={data.symbol} />
            <StatChip label="Metric" value={horizonLabel(data.metric)} />
            <StatChip label="Data Points" value={`${data.data.length}`} />
            {winRate && (
              <StatChip label="Positive Days" value={`${winRate}%`} color={parseFloat(winRate) >= 50 ? WIN : LOSS} />
            )}
          </Box>

          <HistoryChart data={data} metric={metric} />
        </>
      )}

      {!data && !loading && !error && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>
            Select a symbol and return metric, then click Load Chart to view history.
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Scatter chart ────────────────────────────────────────────────────────────

const SCATTER_HORIZONS = [
  { value: '1w', label: '1 Week'  },
  { value: '1m', label: '1 Month' },
  { value: '3m', label: '3 Month' },
  { value: '1y', label: '1 Year'  },
  { value: '3y', label: '3 Year'  },
]

function ScatterChart({ data }: { data: ScatterResponse }) {
  const { mode } = useThemeMode()

  const isDark       = mode === 'dark'
  const gridColor    = isDark ? '#1E3055' : '#D1DCEA'
  const labelColor   = isDark ? '#7A90B4' : '#8696AC'
  const surfaceColor = isDark ? '#0B1429' : '#FFFFFF'
  const textColor    = isDark ? '#E4EDFF' : '#0B1829'

  const options = useMemo((): Highcharts.Options => ({
    chart: {
      type: 'scatter',
      height: 440,
      backgroundColor: 'transparent',
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
      animation: { duration: 300 },
    },
    title: { text: '' },
    credits: { enabled: false },
    navigation: { buttonOptions: { enabled: false } },
    xAxis: {
      title: { text: 'Return (%)', style: { color: labelColor, fontSize: '11px' } },
      lineColor: gridColor,
      tickColor: gridColor,
      gridLineColor: gridColor,
      gridLineWidth: 1,
      labels: {
        format: '{value}%',
        style: { color: labelColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px' },
      },
      plotLines: [{
        value: data.stats.median_ret,
        color: isDark ? '#6366f180' : '#6366f160',
        width: 1.5,
        dashStyle: 'Dash',
        zIndex: 5,
        label: {
          text: `Med Ret ${data.stats.median_ret.toFixed(2)}%`,
          style: { color: labelColor, fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" },
          align: 'right',
          y: 12,
        },
      }],
    },
    yAxis: {
      title: { text: 'Std Deviation (%)', style: { color: labelColor, fontSize: '11px' } },
      gridLineColor: gridColor,
      labels: {
        format: '{value}%',
        style: { color: labelColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' },
      },
      plotLines: [{
        value: data.stats.median_std,
        color: isDark ? '#f59e0b80' : '#f59e0b60',
        width: 1.5,
        dashStyle: 'Dash',
        zIndex: 5,
        label: {
          text: `Med Std ${data.stats.median_std.toFixed(2)}%`,
          style: { color: labelColor, fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" },
          x: 4,
        },
      }],
    },
    tooltip: {
      backgroundColor: surfaceColor,
      borderColor: isDark ? '#1E3055' : '#D1DCEA',
      borderWidth: 1,
      shadow: false,
      style: { color: textColor, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '12px' },
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const pt = this.point as Highcharts.Point
        const ret = this.x as number
        const std = this.y as number
        const retColor = ret >= 0 ? WIN : LOSS
        return `<b style="font-family:'IBM Plex Mono',monospace">${pt.name}</b><br/>` +
               `Return: <span style="color:${retColor};font-weight:700">${fmt(ret)}</span><br/>` +
               `Std Dev: <span style="font-weight:600">${std.toFixed(2)}%</span>`
      },
    },
    legend: { enabled: false },
    plotOptions: {
      scatter: {
        marker: { radius: 5, symbol: 'circle', states: { hover: { enabled: true, lineColor: isDark ? '#fff' : '#000', lineWidth: 1 } } },
      },
    },
    series: [{
      type: 'scatter',
      name: 'Stocks',
      data: data.points.map(p => ({
        x: p.ret,
        y: p.std,
        name: p.symbol,
        color: p.ret >= 0 ? `${WIN}CC` : `${LOSS}CC`,
      })),
    }],
  }), [data, isDark, gridColor, labelColor, surfaceColor, textColor])

  return (
    <Box sx={{ mt: 1, '.highcharts-container': { width: '100% !important' } }}>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── Above-200 area chart ─────────────────────────────────────────────────────

function Above200Chart({ data, mode: viewMode }: { data: Above200WeeklyResponse; mode: 'pct' | 'count' }) {
  const { mode } = useThemeMode()
  const { CYAN } = usePalette()

  const isDark       = mode === 'dark'
  const gridColor    = isDark ? '#1E3055' : '#D1DCEA'
  const labelColor   = isDark ? '#7A90B4' : '#8696AC'
  const surfaceColor = isDark ? '#0B1429' : '#FFFFFF'
  const textColor    = isDark ? '#E4EDFF' : '#0B1829'

  const isPct = viewMode === 'pct'

  const options = useMemo((): Highcharts.Options => ({
    chart: {
      type: 'area',
      height: 380,
      backgroundColor: 'transparent',
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
      animation: { duration: 300 },
    },
    title: { text: '' },
    credits: { enabled: false },
    navigation: { buttonOptions: { enabled: false } },
    xAxis: {
      type: 'datetime',
      lineColor: gridColor,
      tickColor: gridColor,
      labels: {
        style: { color: labelColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px' },
      },
    },
    yAxis: {
      title: { text: isPct ? 'Stocks Above 200 SMA (%)' : 'Count of Stocks Above 200 SMA', style: { color: labelColor, fontSize: '11px' } },
      gridLineColor: gridColor,
      min: 0,
      max: isPct ? 100 : undefined,
      labels: {
        format: isPct ? '{value}%' : '{value}',
        style: { color: labelColor, fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' },
      },
      plotLines: isPct ? [
        { value: 80, color: '#22c55e60', width: 1, dashStyle: 'Dash' as const, label: { text: '80%', style: { color: labelColor, fontSize: '10px' } } },
        { value: 50, color: isDark ? '#4B607A' : '#8696AC', width: 1, dashStyle: 'Dash' as const, label: { text: '50%', style: { color: labelColor, fontSize: '10px' } } },
        { value: 20, color: '#ef444460', width: 1, dashStyle: 'Dash' as const, label: { text: '20%', style: { color: labelColor, fontSize: '10px' } } },
      ] : [],
    },
    tooltip: {
      backgroundColor: surfaceColor,
      borderColor: isDark ? '#1E3055' : '#D1DCEA',
      borderWidth: 1,
      shadow: false,
      style: { color: textColor, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '12px' },
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const d = new Date(this.x as number)
        const ds = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        const v = this.y as number
        return `<b>${ds}</b><br/>${isPct ? `${v.toFixed(1)}%` : `${v} stocks`}`
      },
    },
    legend: { enabled: false },
    plotOptions: {
      area: {
        lineWidth: 2,
        marker: { enabled: false, states: { hover: { enabled: true, radius: 4 } } },
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, `${CYAN}50`],
            [1, `${CYAN}00`],
          ],
        },
      },
    },
    series: [{
      type: 'area',
      name: isPct ? '% Above 200 SMA' : 'Count Above 200 SMA',
      color: CYAN,
      data: data.data.map(d => ({
        x: Date.parse(d.week_date),
        y: isPct ? d.pct_above_200 : d.n_above_200,
      })),
    }],
  }), [data, isPct, isDark, CYAN, gridColor, labelColor, surfaceColor, textColor])

  return (
    <Box sx={{ mt: 1, '.highcharts-container': { width: '100% !important' } }}>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── Scatter section ──────────────────────────────────────────────────────────

function ScatterSection() {
  const { CARD, INPUT_SX, BORDER, CYAN, PAPER2, INK, INK3 } = useTokens()
  const [horizon, setHorizon] = useState('1m')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<ScatterResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await datavizApi.getScatter(horizon)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [horizon])

  const QUADRANTS = data ? [
    { label: 'Sweet Spot',  desc: 'High Return · Low Vol',  count: data.stats.n_high_ret_low_vol,  color: WIN,       corner: 'Top-Left'  },
    { label: 'Momentum',    desc: 'High Return · High Vol', count: data.stats.n_high_ret_high_vol, color: '#22c55e99', corner: 'Top-Right' },
    { label: 'Defensive',   desc: 'Low Return · Low Vol',   count: data.stats.n_low_ret_low_vol,   color: '#fbbf24', corner: 'Bot-Left'  },
    { label: 'Avoid',       desc: 'Low Return · High Vol',  count: data.stats.n_low_ret_high_vol,  color: LOSS,      corner: 'Bot-Right' },
  ] : []

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <SectionHead title="Return vs Volatility Scatter" accent="#10b981" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            value={horizon}
            onChange={e => setHorizon(e.target.value)}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {SCATTER_HORIZONS.map(h => (
              <MenuItem key={h.value} value={h.value} sx={{ fontSize: '0.72rem', color: INK }}>{h.label}</MenuItem>
            ))}
          </Select>
          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>

      {loading && (
        <LinearProgress sx={{
          borderRadius: 1, mb: 2, bgcolor: BORDER,
          '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
        }} />
      )}

      {error && (
        <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', mb: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</Typography>
        </Box>
      )}

      {data && !error && (
        <>
          {/* Quadrant stats strip */}
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {QUADRANTS.map(q => (
              <Box key={q.label} sx={{ px: 2, py: 1.25, borderRadius: '12px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, minWidth: 110 }}>
                <Typography sx={{ fontSize: '0.6rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase', ...JAKARTA }}>{q.label}</Typography>
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: q.color, ...MONO }}>{q.count}</Typography>
                <Typography sx={{ fontSize: '0.58rem', color: INK3, ...JAKARTA, mt: 0.25 }}>{q.desc}</Typography>
              </Box>
            ))}
            <StatChip label="Universe" value={`${data.stats.n_symbols} stocks`} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>

          {/* Legend */}
          <Box sx={{ display: 'flex', gap: 2, mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: WIN }} />
              <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>Positive return</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: LOSS }} />
              <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>Negative return</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 24, height: 2, bgcolor: '#6366f1', borderRadius: 1 }} />
              <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>Median return (vertical)</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 24, height: 2, bgcolor: '#f59e0b', borderRadius: 1 }} />
              <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>Median std dev (horizontal)</Typography>
            </Box>
          </Box>

          <ScatterChart data={data} />
        </>
      )}

      {!data && !loading && !error && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>
            Select a horizon and click Load Chart to plot return vs volatility for all symbols.
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Above-200 section ───────────────────────────────────────────────────────

function Above200Section() {
  const { CARD, BORDER, CYAN, INK, INK3 } = useTokens()
  const [viewMode, setViewMode] = useState<'pct' | 'count'>('pct')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [data,     setData]     = useState<Above200WeeklyResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await datavizApi.getAbove200Weekly()
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  const latest = data?.data[data.data.length - 1] ?? null

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <SectionHead title="Stocks Above 200 SMA — Weekly" accent="#8b5cf6" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* % / Count toggle */}
          {(['pct', 'count'] as const).map(m => (
            <Box
              key={m}
              component="button"
              onClick={() => setViewMode(m)}
              sx={{
                px: 1.5, py: 0.625, borderRadius: '8px', fontSize: '0.72rem', fontWeight: 700,
                cursor: 'pointer', border: `1px solid ${viewMode === m ? CYAN : BORDER}`,
                bgcolor: viewMode === m ? `${CYAN}18` : 'transparent',
                color: viewMode === m ? CYAN : INK3,
                ...JAKARTA, transition: 'all 0.15s',
              }}
            >
              {m === 'pct' ? '% View' : 'Count View'}
            </Box>
          ))}
          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>

      {loading && (
        <LinearProgress sx={{
          borderRadius: 1, mb: 2, bgcolor: BORDER,
          '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
        }} />
      )}

      {error && (
        <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', mb: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</Typography>
        </Box>
      )}

      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
            <StatChip label="Latest Week" value={latest?.week_date ?? '—'} />
            <StatChip label="Above 200 SMA" value={latest ? `${latest.n_above_200} / ${latest.total_symbols}` : '—'} color={CYAN} />
            <StatChip
              label="% Above"
              value={latest ? `${latest.pct_above_200}%` : '—'}
              color={latest ? (latest.pct_above_200 >= 50 ? '#22c55e' : '#ef4444') : undefined}
            />
            <StatChip label="Weeks of Data" value={`${data.data.length}`} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>
          <Above200Chart data={data} mode={viewMode} />
        </>
      )}

      {!data && !loading && !error && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>
            Click Load Chart to see the weekly breadth trend of stocks above their 200-day SMA.
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DataVizPage() {
  const { BG, BORDER, CYAN, INK, INK2, INK3 } = usePalette()
  const { mode } = useThemeMode()

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        <Box sx={{
          position: 'absolute', top: -100, right: '8%',
          width: 480, height: 380, borderRadius: '50%',
          background: `radial-gradient(ellipse, ${CYAN}10 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />
        <Box sx={{
          position: 'absolute', bottom: -40, left: '6%',
          width: 280, height: 280, borderRadius: '50%',
          background: `radial-gradient(ellipse, #6366f115 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 5, md: 8 }, position: 'relative' }}>
          {/* Tag */}
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5,
            px: 1.5, py: 0.5, borderRadius: '20px',
            border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D`,
          }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN,
              animation: 'hpulse 2s ease-in-out infinite',
              '@keyframes hpulse': { '0%,100%': { boxShadow: `0 0 4px ${CYAN}` }, '50%': { boxShadow: `0 0 14px ${CYAN}` } },
            }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Returns Intelligence · NSE 500
            </Typography>
          </Box>

          {/* Title */}
          <Typography sx={{
            ...JAKARTA, fontWeight: 800, color: INK, letterSpacing: '-0.03em',
            fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' }, lineHeight: 1.1, mb: 1.5,
          }}>
            Returns{' '}
            <Box component="span" sx={{ color: CYAN, textShadow: `0 0 32px ${CYAN}70` }}>
              Visualiser
            </Box>
          </Typography>

          <Typography sx={{ ...JAKARTA, fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, mb: 4, maxWidth: 520 }}>
            Cross-sectional return distribution across 500 NSE stocks — ranked, coloured, and dated.
            Switch horizons from 1 day to 5-year CAGR. Drill into any symbol's full return history.
          </Typography>

          {/* Quick stats */}
          <Box sx={{ pt: 3, borderTop: `1px solid ${BORDER}`, display: 'flex', gap: { xs: 3, md: 6 }, flexWrap: 'wrap' }}>
            {[
              { val: '500',  label: 'NSE symbols' },
              { val: '11',   label: 'Return horizons' },
              { val: '~150ms', label: 'API response' },
              { val: '6yr',  label: 'History depth' },
            ].map(s => (
              <Box key={s.label}>
                <Typography sx={{ ...MONO, fontSize: '1.35rem', fontWeight: 800, color: CYAN, lineHeight: 1 }}>{s.val}</Typography>
                <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3, mt: 0.375 }}>{s.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Content */}
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2.5, md: 8, lg: 12 }, py: 4 }}>
        <SnapshotSection />
        <HistorySection />
        <ScatterSection />
        <Above200Section />
        <HistogramSection />
        <VolTermStructureSection />
        <CrossVolSection />
        <RiskAdjRankingSection />
        <CalendarSection />
        <MultiSMASection />
        <ADLineSection />
        <CorrMatrixSection />
        <AlphaBetaSection />
      </Box>
      <Footer />
    </Box>
  )
}
