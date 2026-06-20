/**
 * DataViz Analytics Sections — 9 new chart sections for the DataViz page.
 * All palette values are consumed via hooks inside each component function.
 */
import { useState, useMemo, useCallback } from 'react'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import {
  Box, Typography, LinearProgress,
  Select, MenuItem, OutlinedInput,
} from '@mui/material'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import SymbolAutocomplete from '../components/shared/SymbolAutocomplete'
import SectionHead from '../components/shared/SectionHead'
import { datavizApi } from '../api/datavizApi'
import type {
  HistogramResponse,
  VolTermStructureResponse,
  CrossVolResponse,
  RiskAdjResponse,
  CalendarResponse,
  MultiSMAResponse,
  ADResponse,
  CorrMatrixResponse,
  AlphaBetaResponse,
} from '../types/dataviz'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const
const WIN     = '#22c55e'
const LOSS    = '#ef4444'

function ChartInfo({ what, rationale, use: howToUse }: { what: string; rationale: string; use: string }) {
  const { INK3, PAPER2, BORDER } = usePalette()
  return (
    <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
      <Typography sx={{ fontSize: '0.68rem', color: INK3, lineHeight: 1.75, ...JAKARTA }}>
        <Box component="span" sx={{ fontWeight: 700, color: '#8b5cf6' }}>What · </Box>{what}
        {'   '}
        <Box component="span" sx={{ fontWeight: 700, color: '#06b6d4' }}>Rationale · </Box>{rationale}
        {'   '}
        <Box component="span" sx={{ fontWeight: 700, color: '#22c55e' }}>Use · </Box>{howToUse}
      </Typography>
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

function ErrorBox({ msg }: { msg: string }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', mb: 2 }}>
      <Typography sx={{ fontSize: '0.72rem', color: LOSS }}>{msg}</Typography>
    </Box>
  )
}

function EmptyState({ msg }: { msg: string }) {
  const { INK3 } = usePalette()
  return (
    <Box sx={{ textAlign: 'center', py: 6 }}>
      <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>{msg}</Typography>
    </Box>
  )
}

function LoadBar() {
  const { BORDER, CYAN } = usePalette()
  return (
    <LinearProgress sx={{
      borderRadius: 1, mb: 2, bgcolor: BORDER,
      '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
    }} />
  )
}

// Helper: dark-mode-aware chart colours
function useChartColors() {
  const { mode } = useThemeMode()
  const isDark = mode === 'dark'
  return {
    isDark,
    grid:    isDark ? '#1E3055' : '#D1DCEA',
    label:   isDark ? '#7A90B4' : '#8696AC',
    surface: isDark ? '#0B1429' : '#FFFFFF',
    text:    isDark ? '#E4EDFF' : '#0B1829',
  }
}


const SNAP_HORIZONS = [
  { value: 'ret_1d', label: '1 Day' }, { value: 'ret_5d', label: '1 Week' },
  { value: 'ret_20d', label: '1 Month' }, { value: 'ret_50d', label: '2½ Month' },
  { value: 'ret_1y', label: '1 Year' }, { value: 'ret_3y', label: '3 Year' },
  { value: 'cagr_1y', label: 'CAGR 1Y' }, { value: 'cagr_3y', label: 'CAGR 3Y' },
]

const SCATTER_HORIZONS = [
  { value: '1w', label: '1 Week' }, { value: '1m', label: '1 Month' },
  { value: '3m', label: '3 Month' }, { value: '1y', label: '1 Year' },
  { value: '3y', label: '3 Year' },
]

const AB_HORIZONS = [
  { value: 'ret_1d', label: 'Daily' },
  { value: 'ret_5d', label: 'Weekly' },
  { value: 'ret_20d', label: 'Monthly' },
]

const LOOKBACK_OPTIONS = [
  { value: 63, label: '3 Months' },
  { value: 126, label: '6 Months' },
  { value: 252, label: '1 Year' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - i)

// ─── 1. Return Distribution Histogram ─────────────────────────────────────────

export function HistogramSection() {
  const { CARD, INPUT_SX, BORDER, CYAN, PAPER2, INK, INK3 } = useTokens()
  const { grid, label, surface, text } = useChartColors()
  const [horizon, setHorizon] = useState('ret_1d')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<HistogramResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getHistogram(horizon)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [horizon])

  const options = useMemo((): Highcharts.Options => ({
    chart: { type: 'column', height: 340, backgroundColor: 'transparent', style: { fontFamily: "'IBM Plex Sans', sans-serif" }, animation: { duration: 300 } },
    title: { text: '' }, credits: { enabled: false }, navigation: { buttonOptions: { enabled: false } },
    xAxis: {
      categories: data?.buckets.map(b => `${(b.center * 100).toFixed(1)}%`) ?? [],
      lineColor: grid, tickColor: grid,
      labels: { rotation: -60, style: { color: label, fontFamily: "'IBM Plex Mono',monospace", fontSize: '9px' } },
    },
    yAxis: { title: { text: 'Count', style: { color: label, fontSize: '11px' } }, gridLineColor: grid, labels: { style: { color: label, fontSize: '11px' } } },
    tooltip: {
      backgroundColor: surface, borderColor: grid, borderWidth: 1, shadow: false,
      style: { color: text, fontSize: '12px', fontFamily: "'IBM Plex Sans', sans-serif" },
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const b = data?.buckets[this.point.index]
        return b ? `<b>${(b.center * 100).toFixed(2)}%</b><br/>Count: <b>${b.count}</b>` : ''
      },
    },
    legend: { enabled: false },
    plotOptions: { column: { borderRadius: 2, borderWidth: 0, groupPadding: 0, pointPadding: 0 } },
    series: [{
      type: 'column',
      name: 'Stocks',
      data: data?.buckets.map(b => ({ y: b.count, color: b.center >= 0 ? `${WIN}CC` : `${LOSS}CC` })) ?? [],
    }],
  }), [data, grid, label, surface, text])

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Return Distribution Histogram" accent="#f97316" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center' }}>
          <Select value={horizon} onChange={e => setHorizon(e.target.value)}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
            {SNAP_HORIZONS.map(h => <MenuItem key={h.value} value={h.value} sx={{ fontSize: '0.72rem', color: INK }}>{h.label}</MenuItem>)}
          </Select>
          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>
      <ChartInfo
        what="Bell curve of all stocks' returns on the selected horizon — shape of the market's opportunity set."
        rationale="Skewness and kurtosis reveal market character better than averages. A fat right tail means more outlier winners than losers."
        use="Right-skewed → tilt towards longs. Wide histogram (high dispersion) → stock picking beats indexing. Narrow/symmetric → macro/factor driven."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <StatChip label="Mean" value={`${(data.stats.mean * 100).toFixed(2)}%`} color={data.stats.mean >= 0 ? WIN : LOSS} />
            <StatChip label="Median" value={`${(data.stats.median * 100).toFixed(2)}%`} color={data.stats.median >= 0 ? WIN : LOSS} />
            <StatChip label="Std Dev" value={`${(data.stats.std * 100).toFixed(2)}%`} />
            <StatChip label="Skewness" value={`${data.stats.skew.toFixed(2)}`} color={data.stats.skew > 0 ? WIN : LOSS} />
            <StatChip label="Best" value={`${(data.stats.max_val * 100).toFixed(2)}%`} color={WIN} />
            <StatChip label="Worst" value={`${(data.stats.min_val * 100).toFixed(2)}%`} color={LOSS} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>
          <HighchartsReact highcharts={Highcharts} options={options} />
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Select a return horizon and click Load Chart to see the cross-sectional distribution." />}
    </Box>
  )
}

// ─── 2. Volatility Term Structure ─────────────────────────────────────────────

export function VolTermStructureSection() {
  const { CARD, INPUT_SX, BORDER, CYAN, PAPER2, INK, INK3 } = useTokens()
  const { grid, label, surface, text } = useChartColors()
  const [symbol, setSymbol] = useState('RELIANCE')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<VolTermStructureResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getVolTermStructure(symbol)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [symbol])

  const options = useMemo((): Highcharts.Options => ({
    chart: { type: 'line', height: 300, backgroundColor: 'transparent', style: { fontFamily: "'IBM Plex Sans', sans-serif" }, animation: { duration: 300 } },
    title: { text: '' }, credits: { enabled: false }, navigation: { buttonOptions: { enabled: false } },
    xAxis: {
      categories: data?.points.map(p => p.label) ?? [],
      lineColor: grid, tickColor: grid,
      labels: { style: { color: label, fontFamily: "'IBM Plex Mono',monospace", fontSize: '11px' } },
    },
    yAxis: {
      title: { text: 'Annualised Vol (%)', style: { color: label, fontSize: '11px' } },
      gridLineColor: grid,
      labels: { format: '{value}%', style: { color: label, fontSize: '11px' } },
    },
    tooltip: {
      backgroundColor: surface, borderColor: grid, borderWidth: 1, shadow: false,
      style: { color: text, fontSize: '12px' },
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        return `<b>${this.x}</b><br/>Vol: <b>${(this.y as number).toFixed(2)}%</b>`
      },
    },
    legend: { enabled: false },
    plotOptions: { line: { lineWidth: 2.5, marker: { radius: 5, enabled: true } } },
    series: [{
      type: 'line',
      name: 'Vol',
      color: CYAN,
      data: data?.points.map(p => p.std_pct) ?? [],
    }],
  }), [data, CYAN, grid, label, surface, text])

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Volatility Term Structure" accent="#06b6d4" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center' }}>
          <SymbolAutocomplete value={symbol} onChange={setSymbol} minWidth={160} />
          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>
      <ChartInfo
        what="A stock's rolling std deviation from 5-day to 3-year horizon, plotted as a curve — the vol term structure."
        rationale="Normal markets show upward-sloping curves (longer horizon = more uncertainty). Inverted curves signal acute near-term stress."
        use="Inverted (short-term vol > long-term) → reduce size or buy protection. Flat and low → vol is cheap across all horizons."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <StatChip label="Symbol" value={data.symbol} />
            <StatChip label="Short (5d)" value={data.points[0] ? `${data.points[0].std_pct.toFixed(2)}%` : '—'} />
            <StatChip label="Long (3Y)" value={data.points[data.points.length - 1] ? `${data.points[data.points.length - 1].std_pct.toFixed(2)}%` : '—'} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>
          <HighchartsReact highcharts={Highcharts} options={options} />
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Select a symbol and click Load Chart to see its volatility term structure." />}
    </Box>
  )
}

// ─── 3. Cross-Sectional Volatility ────────────────────────────────────────────

export function CrossVolSection() {
  const { CARD, BORDER, CYAN, PAPER2, INK3 } = useTokens()
  const { grid, label, surface, text } = useChartColors()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<CrossVolResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getCrossVol()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [])

  const options = useMemo((): Highcharts.Options => ({
    chart: { type: 'area', height: 320, backgroundColor: 'transparent', style: { fontFamily: "'IBM Plex Sans', sans-serif" }, animation: { duration: 300 } },
    title: { text: '' }, credits: { enabled: false }, navigation: { buttonOptions: { enabled: false } },
    xAxis: { type: 'datetime', lineColor: grid, tickColor: grid, labels: { style: { color: label, fontFamily: "'IBM Plex Mono',monospace", fontSize: '10px' } } },
    yAxis: {
      title: { text: 'Cross-Sectional Vol (%)', style: { color: label, fontSize: '11px' } },
      gridLineColor: grid, min: 0,
      labels: { format: '{value}%', style: { color: label, fontSize: '11px' } },
    },
    tooltip: {
      backgroundColor: surface, borderColor: grid, borderWidth: 1, shadow: false,
      style: { color: text, fontSize: '12px' },
      shared: true,
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const d = new Date(this.x as number).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        return this.points?.map(p => `${p.series.name}: <b>${(p.y as number).toFixed(2)}%</b>`).join('<br/>') ?? `<b>${d}</b>`
      },
    },
    legend: { enabled: true, itemStyle: { color: label, fontSize: '11px', fontFamily: "'IBM Plex Sans', sans-serif" } },
    plotOptions: {
      area: {
        lineWidth: 1.5,
        marker: { enabled: false },
        fillOpacity: 0.15,
      },
    },
    series: [
      {
        type: 'area', name: 'Cross-Vol',
        color: '#f97316',
        data: data?.data.map(d => [Date.parse(d.week_date), d.cross_vol_pct]) ?? [],
      },
      {
        type: 'line', name: 'Cross-Mean',
        color: CYAN, lineWidth: 1,
        marker: { enabled: false },
        data: data?.data.map(d => [Date.parse(d.week_date), d.cross_mean_pct]) ?? [],
      },
    ],
  }), [data, CYAN, grid, label, surface, text])

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Cross-Sectional Volatility" accent="#f97316" />
        <Box sx={{ ml: 'auto' }}><RunBtn onClick={load} loading={loading} label="Load Chart" /></Box>
      </Box>
      <ChartInfo
        what="Weekly time series of how dispersed stock returns are from each other — the standard deviation across all stocks on each day."
        rationale="High dispersion = wide spread between winners and losers = alpha-generating environment. Low dispersion = everything moves together."
        use="High cross-vol → concentrate in high-conviction ideas, stock selection pays off. Low cross-vol → reduce single-stock bets, factor/index exposure dominates."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <StatChip label="Latest Cross-Vol" value={data.data.length ? `${data.data[data.data.length - 1].cross_vol_pct.toFixed(2)}%` : '—'} />
            <StatChip label="Weeks" value={`${data.data.length}`} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>
          <Box sx={{ '.highcharts-container': { width: '100% !important' } }}>
            <HighchartsReact highcharts={Highcharts} options={options} />
          </Box>
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Click Load Chart to see weekly cross-sectional volatility across all stocks." />}
    </Box>
  )
}

// ─── 4. Risk-Adjusted Return Ranking ──────────────────────────────────────────

export function RiskAdjRankingSection() {
  const { CARD, INPUT_SX, BORDER, CYAN, PAPER2, INK, INK3 } = useTokens()
  const { grid, label, surface, text, isDark } = useChartColors()
  const [horizon, setHorizon] = useState('1m')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<RiskAdjResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getRiskAdjRanking(horizon)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [horizon])

  // Show top 25 and bottom 25
  const top25    = data?.data.slice(0, 25)  ?? []
  const bottom25 = data?.data.slice(-25).reverse() ?? []
  const combined = [...top25, ...bottom25]

  const options = useMemo((): Highcharts.Options => ({
    chart: { type: 'bar', height: 560, backgroundColor: 'transparent', style: { fontFamily: "'IBM Plex Sans', sans-serif" }, animation: { duration: 300 } },
    title: { text: '' }, credits: { enabled: false }, navigation: { buttonOptions: { enabled: false } },
    xAxis: {
      categories: combined.map(p => p.symbol),
      lineColor: grid, tickColor: grid,
      labels: { style: { color: label, fontFamily: "'IBM Plex Mono',monospace", fontSize: '10px' } },
    },
    yAxis: {
      title: { text: 'Return / Std Dev (Sharpe proxy)', style: { color: label, fontSize: '11px' } },
      gridLineColor: grid,
      plotLines: [{ value: 0, color: isDark ? '#4B607A' : '#8696AC', width: 1, zIndex: 5 }],
      labels: { style: { color: label, fontSize: '11px' } },
    },
    tooltip: {
      backgroundColor: surface, borderColor: grid, borderWidth: 1, shadow: false,
      style: { color: text, fontSize: '12px' },
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const p = combined[this.point.index]
        if (!p) return ''
        return `<b style="font-family:'IBM Plex Mono',monospace">${p.symbol}</b> (#${p.rank})<br/>` +
               `Return: <b>${(p.ret * 100).toFixed(2)}%</b><br/>` +
               `Std: <b>${(p.std * 100).toFixed(2)}%</b><br/>` +
               `Score: <b>${p.score.toFixed(3)}</b>`
      },
    },
    legend: { enabled: false },
    plotOptions: { bar: { borderRadius: 3, borderWidth: 0, groupPadding: 0.05, pointPadding: 0.02 } },
    series: [{
      type: 'bar',
      name: 'Risk-Adj Score',
      data: combined.map(p => ({ y: p.score, color: p.score >= 0 ? `${WIN}CC` : `${LOSS}CC` })),
    }],
  }), [combined, grid, label, surface, text, isDark])

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Risk-Adjusted Return Ranking" accent="#a855f7" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center' }}>
          <Select value={horizon} onChange={e => setHorizon(e.target.value)}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
            {SCATTER_HORIZONS.map(h => <MenuItem key={h.value} value={h.value} sx={{ fontSize: '0.72rem', color: INK }}>{h.label}</MenuItem>)}
          </Select>
          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>
      <ChartInfo
        what="All stocks ranked by return-to-volatility ratio (Sharpe proxy) at the selected horizon — top 25 and bottom 25 shown."
        rationale="Raw returns ignore risk taken. A stock up 15% with 10% vol is superior to one up 20% with 40% vol."
        use="Pre-screen for portfolio construction using top-ranked stocks. Confirm with regime alignment before entry. Avoid bottom-ranked regardless of narrative."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <StatChip label="Universe" value={`${data.data.length} stocks`} />
            <StatChip label="Best Score" value={data.data[0]?.score.toFixed(3) ?? '—'} color={WIN} />
            <StatChip label="Worst Score" value={data.data[data.data.length - 1]?.score.toFixed(3) ?? '—'} color={LOSS} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>
          <Box sx={{ '.highcharts-container': { width: '100% !important' } }}>
            <HighchartsReact highcharts={Highcharts} options={options} />
          </Box>
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Select a horizon and click Load Chart to rank all stocks by risk-adjusted return." />}
    </Box>
  )
}

// ─── 5. Calendar Heatmap ──────────────────────────────────────────────────────

function calColor(ret: number): string {
  const intensity = Math.min(Math.abs(ret) / 4, 1)
  const alpha = 0.2 + intensity * 0.75
  return ret > 0 ? `rgba(34,197,94,${alpha.toFixed(2)})` : `rgba(239,68,68,${alpha.toFixed(2)})`
}

function CalendarGrid({ data }: { data: CalendarResponse }) {
  const { INK3, BORDER } = usePalette()
  const { mode } = useThemeMode()
  const isDark = mode === 'dark'

  const retMap = useMemo(() => new Map(data.data.map(d => [d.date, d.ret_pct])), [data])
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const DAY_HEADERS = ['M','T','W','T','F','S','S']

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
      {MONTHS.map((monthName, m) => {
        const firstDay = new Date(data.year, m, 1)
        const daysInMonth = new Date(data.year, m + 1, 0).getDate()
        // dayOfWeek: 0=Sun…6=Sat, convert to Mon=0
        const offset = (firstDay.getDay() + 6) % 7

        const cells: (number | null)[] = [
          ...Array(offset).fill(null),
          ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
        ]
        // pad to full weeks
        while (cells.length % 7 !== 0) cells.push(null)

        return (
          <Box key={m} sx={{ minWidth: 110 }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: INK3, mb: 0.5, ...JAKARTA }}>{monthName}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 13px)', gap: '2px' }}>
              {DAY_HEADERS.map((d, i) => (
                <Box key={i} sx={{ width: 13, textAlign: 'center', fontSize: '0.5rem', color: INK3, fontFamily: "'IBM Plex Sans', sans-serif" }}>{d}</Box>
              ))}
              {cells.map((day, i) => {
                if (day === null) return <Box key={i} sx={{ width: 13, height: 13 }} />
                const dateStr = `${data.year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const ret = retMap.get(dateStr)
                return (
                  <Box
                    key={i}
                    title={ret !== undefined ? `${dateStr}: ${ret > 0 ? '+' : ''}${ret.toFixed(2)}%` : dateStr}
                    sx={{
                      width: 13, height: 13, borderRadius: '2px',
                      bgcolor: ret !== undefined ? calColor(ret) : (isDark ? '#1E3055' : '#E8EFF7'),
                      border: `1px solid ${BORDER}20`,
                      cursor: 'default',
                    }}
                  />
                )
              })}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export function CalendarSection() {
  const { CARD, INPUT_SX, BORDER, PAPER2, INK, INK3 } = useTokens()
  const [symbol, setSymbol] = useState('RELIANCE')
  const [year,   setYear]   = useState(CURRENT_YEAR - 1)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<CalendarResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getCalendar(symbol, year)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [symbol, year])

  const positiveDays = data?.data.filter(d => d.ret_pct > 0).length ?? 0
  const totalDays    = data?.data.length ?? 0

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Calendar Return Heatmap" accent="#ec4899" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <SymbolAutocomplete value={symbol} onChange={setSymbol} minWidth={160} />
          <Select value={year} onChange={e => setYear(Number(e.target.value))}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 90, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
            {YEAR_OPTIONS.map(y => <MenuItem key={y} value={y} sx={{ fontSize: '0.72rem', color: INK, ...MONO }}>{y}</MenuItem>)}
          </Select>
          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>
      <ChartInfo
        what="Daily returns displayed as a colour-coded calendar grid across a full year — green for positive days, red for negative."
        rationale="Humans spot patterns in 2D faster than in tables. Seasonality, earnings impacts, and macro events cluster visually."
        use="Green clusters in specific months reveal seasonal edges. Red streaks during result weeks signal earnings risk. Compare across years to confirm patterns."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatChip label="Symbol" value={data.symbol} />
            <StatChip label="Year" value={`${data.year}`} />
            <StatChip label="Trading Days" value={`${totalDays}`} />
            <StatChip label="Positive Days" value={totalDays ? `${positiveDays} (${((positiveDays / totalDays) * 100).toFixed(0)}%)` : '—'} color={WIN} />
            {/* Intensity legend */}
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
              {['−4%','−2%','0','2%','4%'].map((lbl, i) => (
                <Box key={i} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                  <Box sx={{ width: 13, height: 13, borderRadius: '2px', bgcolor: i === 2 ? 'transparent' : (i < 2 ? calColor(-(5 - i * 2)) : calColor((i - 2) * 2)) }} />
                  <Typography sx={{ fontSize: '0.5rem', color: INK3, ...JAKARTA }}>{lbl}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <CalendarGrid data={data} />
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Select a symbol and year, then click Load Chart to view the daily return calendar." />}
    </Box>
  )
}

// ─── 6. Multi-SMA Breadth Overlay ─────────────────────────────────────────────

export function MultiSMASection() {
  const { CARD, BORDER, PAPER2, INK3 } = useTokens()
  const { grid, label, surface, text } = useChartColors()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<MultiSMAResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getMultiSMA()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [])

  const latest = data?.data[data.data.length - 1]

  const options = useMemo((): Highcharts.Options => ({
    chart: { type: 'line', height: 360, backgroundColor: 'transparent', style: { fontFamily: "'IBM Plex Sans', sans-serif" }, animation: { duration: 300 } },
    title: { text: '' }, credits: { enabled: false }, navigation: { buttonOptions: { enabled: false } },
    xAxis: { type: 'datetime', lineColor: grid, tickColor: grid, labels: { style: { color: label, fontFamily: "'IBM Plex Mono',monospace", fontSize: '10px' } } },
    yAxis: {
      title: { text: '% Stocks Above SMA', style: { color: label, fontSize: '11px' } },
      gridLineColor: grid, min: 0, max: 100,
      plotLines: [
        { value: 80, color: '#22c55e50', width: 1, dashStyle: 'Dash', label: { text: '80%', style: { color: label, fontSize: '10px' } } },
        { value: 50, color: '#ffffff30', width: 1, dashStyle: 'Dash', label: { text: '50%', style: { color: label, fontSize: '10px' } } },
        { value: 20, color: '#ef444450', width: 1, dashStyle: 'Dash', label: { text: '20%', style: { color: label, fontSize: '10px' } } },
      ],
      labels: { format: '{value}%', style: { color: label, fontSize: '11px' } },
    },
    tooltip: {
      backgroundColor: surface, borderColor: grid, borderWidth: 1, shadow: false,
      style: { color: text, fontSize: '12px' }, shared: true,
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const d = new Date(this.x as number).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        const lines = this.points?.map(p => `<span style="color:${p.color as string}">●</span> ${p.series.name}: <b>${(p.y as number).toFixed(1)}%</b>`) ?? []
        return `<b>${d}</b><br/>${lines.join('<br/>')}`
      },
    },
    legend: { enabled: true, itemStyle: { color: label, fontSize: '11px', fontFamily: "'IBM Plex Sans', sans-serif" } },
    plotOptions: { line: { lineWidth: 2, marker: { enabled: false, states: { hover: { enabled: true, radius: 3 } } } } },
    series: [
      { type: 'line', name: '% > 20 SMA', color: '#fbbf24', data: data?.data.map(d => [Date.parse(d.week_date), d.pct_above_20]) ?? [] },
      { type: 'line', name: '% > 50 SMA', color: '#06b6d4', data: data?.data.map(d => [Date.parse(d.week_date), d.pct_above_50]) ?? [] },
      { type: 'line', name: '% > 200 SMA', color: '#22c55e', data: data?.data.map(d => [Date.parse(d.week_date), d.pct_above_200]) ?? [] },
    ],
  }), [data, grid, label, surface, text])

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Multi-SMA Breadth Overlay" accent="#fbbf24" />
        <Box sx={{ ml: 'auto' }}><RunBtn onClick={load} loading={loading} label="Load Chart" /></Box>
      </Box>
      <ChartInfo
        what="Three breadth lines on one chart: % stocks above their 20, 50, and 200-day SMA — weekly."
        rationale="20-SMA breadth leads market turns; 200-SMA breadth lags and confirms. Divergences between the three lines reveal regime transitions."
        use="All three > 60% = confirmed bull. 20-SMA line falling while 200-SMA holds = early distribution. All three < 30% = capitulation zone, potential reversal."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <StatChip label="% > 20 SMA" value={latest ? `${latest.pct_above_20}%` : '—'} color="#fbbf24" />
            <StatChip label="% > 50 SMA" value={latest ? `${latest.pct_above_50}%` : '—'} color="#06b6d4" />
            <StatChip label="% > 200 SMA" value={latest ? `${latest.pct_above_200}%` : '—'} color="#22c55e" />
            <StatChip label="Universe" value={latest ? `${latest.total_symbols} stocks` : '—'} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>
          <Box sx={{ '.highcharts-container': { width: '100% !important' } }}>
            <HighchartsReact highcharts={Highcharts} options={options} />
          </Box>
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Click Load Chart to see the three-layer SMA breadth trend." />}
    </Box>
  )
}

// ─── 7. Advance-Decline Line ──────────────────────────────────────────────────

export function ADLineSection() {
  const { CARD, BORDER, CYAN, PAPER2, INK3 } = useTokens()
  const { grid, label, surface, text } = useChartColors()
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<ADResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getAdvanceDecline()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [])

  const latest = data?.data[data.data.length - 1]

  const options = useMemo((): Highcharts.Options => ({
    chart: { type: 'area', height: 340, backgroundColor: 'transparent', style: { fontFamily: "'IBM Plex Sans', sans-serif" }, animation: { duration: 300 } },
    title: { text: '' }, credits: { enabled: false }, navigation: { buttonOptions: { enabled: false } },
    xAxis: { type: 'datetime', lineColor: grid, tickColor: grid, labels: { style: { color: label, fontFamily: "'IBM Plex Mono',monospace", fontSize: '10px' } } },
    yAxis: {
      title: { text: 'Cumulative A-D Line', style: { color: label, fontSize: '11px' } },
      gridLineColor: grid,
      labels: { style: { color: label, fontSize: '11px' } },
    },
    tooltip: {
      backgroundColor: surface, borderColor: grid, borderWidth: 1, shadow: false,
      style: { color: text, fontSize: '12px' },
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const d = new Date(this.x as number).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        const idx = data?.data.findIndex(p => Date.parse(p.week_date) === (this.x as number))
        const pt = idx !== undefined && idx >= 0 ? data?.data[idx] : null
        return pt
          ? `<b>${d}</b><br/>A-D Line: <b>${pt.cumulative}</b><br/>Adv: <b>${pt.advancers}</b>  Dec: <b>${pt.decliners}</b>`
          : `<b>${d}</b>`
      },
    },
    legend: { enabled: false },
    plotOptions: {
      area: {
        lineWidth: 2,
        color: CYAN,
        fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, `${CYAN}40`], [1, `${CYAN}00`]] },
        marker: { enabled: false },
        negativeFillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, `${LOSS}00`], [1, `${LOSS}40`]] },
      },
    },
    series: [{
      type: 'area',
      name: 'A-D Cumulative',
      data: data?.data.map(d => [Date.parse(d.week_date), d.cumulative]) ?? [],
    }],
  }), [data, CYAN, grid, label, surface, text])

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Advance-Decline Line" accent="#06b6d4" />
        <Box sx={{ ml: 'auto' }}><RunBtn onClick={load} loading={loading} label="Load Chart" /></Box>
      </Box>
      <ChartInfo
        what="Cumulative weekly sum of advancers minus decliners — the internal health of the market independent of index levels."
        rationale="Indexes can rise on a few mega-cap stocks while the broad market deteriorates. The A-D line reveals true participation."
        use="Divergence: index at new highs but A-D line falling = warning, reduce risk. A-D breakout alongside index = broad confirmation, sustainable move."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <StatChip label="Latest A-D" value={latest ? `${latest.cumulative > 0 ? '+' : ''}${latest.cumulative}` : '—'} color={latest && latest.cumulative >= 0 ? WIN : LOSS} />
            <StatChip label="Advancers" value={latest ? `${latest.advancers}` : '—'} color={WIN} />
            <StatChip label="Decliners" value={latest ? `${latest.decliners}` : '—'} color={LOSS} />
            <StatChip label="Weeks" value={`${data.data.length}`} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of}</Typography>
            </Box>
          </Box>
          <Box sx={{ '.highcharts-container': { width: '100% !important' } }}>
            <HighchartsReact highcharts={Highcharts} options={options} />
          </Box>
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Click Load Chart to see the cumulative Advance-Decline breadth line." />}
    </Box>
  )
}

// ─── 8. Correlation Matrix ────────────────────────────────────────────────────

function corrColor(v: number): string {
  if (v >= 0.99) return 'rgba(100,100,100,0.3)'   // diagonal self-correlation
  if (v > 0) return `rgba(34,197,94,${Math.min(v, 1).toFixed(2)})`
  return `rgba(239,68,68,${Math.min(Math.abs(v), 1).toFixed(2)})`
}

export function CorrMatrixSection() {
  const { CARD, INPUT_SX, BORDER, PAPER2, INK, INK3 } = useTokens()
  const [horizon,  setHorizon]  = useState('ret_1d')
  const [lookback, setLookback] = useState(252)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [data,     setData]     = useState<CorrMatrixResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getCorrMatrix(horizon, lookback)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [horizon, lookback])

  const n = data?.symbols.length ?? 0
  const cellSize = n > 0 ? Math.max(10, Math.min(18, Math.floor(560 / n))) : 14

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Return Correlation Matrix" accent="#f43f5e" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <Select value={horizon} onChange={e => setHorizon(e.target.value)}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
            {AB_HORIZONS.map(h => <MenuItem key={h.value} value={h.value} sx={{ fontSize: '0.72rem', color: INK }}>{h.label}</MenuItem>)}
          </Select>
          <Select value={lookback} onChange={e => setLookback(Number(e.target.value))}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 110, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
            {LOOKBACK_OPTIONS.map(o => <MenuItem key={o.value} value={o.value} sx={{ fontSize: '0.72rem', color: INK }}>{o.label}</MenuItem>)}
          </Select>
          <RunBtn onClick={load} loading={loading} label="Load Matrix" />
        </Box>
      </Box>
      <ChartInfo
        what="Pairwise return correlations for all stocks in the universe — green = positive co-movement, red = inverse, intensity = magnitude."
        rationale="Sector labels are imprecise proxies for diversification. Actual return correlations reveal true co-movement that sectors hide."
        use="Build portfolios from low-correlation clusters (pale cells). Avoid concentrating in high-correlation pairs (dark green) even across different sectors."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && data.matrix.length > 0 && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatChip label="Symbols" value={`${n}`} />
            <StatChip label="Lookback" value={`${lookback}d`} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
              {([[-0.8,'Strong Neg'],[-0.4,'Weak Neg'],[0,'Neutral'],[0.4,'Weak Pos'],[0.8,'Strong Pos']] as [number, string][]).map(([v, lbl]) => (
                <Box key={lbl} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                  <Box sx={{ width: 14, height: 14, borderRadius: '2px', bgcolor: corrColor(v) }} />
                  <Typography sx={{ fontSize: '0.48rem', color: INK3, ...JAKARTA, textAlign: 'center' }}>{lbl}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
          {/* Symbol labels row */}
          <Box sx={{ display: 'flex', gap: 0, pl: `${cellSize + 2}px`, mb: '2px', overflowX: 'auto' }}>
            {data.symbols.map(s => (
              <Box key={s} sx={{ width: cellSize, flexShrink: 0, overflow: 'hidden' }}>
                <Typography sx={{ fontSize: '0.45rem', color: INK3, writingMode: 'vertical-rl', transform: 'rotate(180deg)', lineHeight: 1, ...MONO }}>{s}</Typography>
              </Box>
            ))}
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            {data.matrix.map((row, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 0, alignItems: 'center', mb: '2px' }}>
                <Typography sx={{ width: cellSize, fontSize: '0.45rem', color: INK3, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', ...MONO }}>{data.symbols[i]}</Typography>
                {row.map((val, j) => (
                  <Box
                    key={j}
                    title={`${data.symbols[i]} × ${data.symbols[j]}: ${val.toFixed(2)}`}
                    sx={{ width: cellSize, height: cellSize, flexShrink: 0, bgcolor: corrColor(val), borderRadius: '1px', ml: '2px' }}
                  />
                ))}
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: '0.6rem', color: INK3, mt: 1, ...JAKARTA }}>As of {data.as_of}</Typography>
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Select horizon and lookback, then click Load Matrix to compute pairwise correlations." />}
    </Box>
  )
}

// ─── 9. Alpha-Beta Scatter ────────────────────────────────────────────────────

export function AlphaBetaSection() {
  const { CARD, INPUT_SX, BORDER, CYAN, PAPER2, INK, INK3 } = useTokens()
  const { grid, label, surface, text, isDark } = useChartColors()
  const [horizon,  setHorizon]  = useState('ret_1d')
  const [lookback, setLookback] = useState(252)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [data,     setData]     = useState<AlphaBetaResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await datavizApi.getAlphaBeta(horizon, lookback)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [horizon, lookback])

  const medianBeta = useMemo(() => {
    if (!data?.points.length) return 1
    const betas = [...data.points].map(p => p.beta).sort((a, b) => a - b)
    const mid = Math.floor(betas.length / 2)
    return betas.length % 2 !== 0 ? betas[mid] : (betas[mid - 1] + betas[mid]) / 2
  }, [data])

  const options = useMemo((): Highcharts.Options => ({
    chart: { type: 'scatter', height: 420, backgroundColor: 'transparent', style: { fontFamily: "'IBM Plex Sans', sans-serif" }, animation: { duration: 300 } },
    title: { text: '' }, credits: { enabled: false }, navigation: { buttonOptions: { enabled: false } },
    xAxis: {
      title: { text: 'Beta (market sensitivity)', style: { color: label, fontSize: '11px' } },
      lineColor: grid, tickColor: grid, gridLineColor: grid, gridLineWidth: 1,
      labels: { style: { color: label, fontFamily: "'IBM Plex Mono',monospace", fontSize: '10px' } },
      plotLines: [
        { value: 0, color: isDark ? '#4B607A' : '#8696AC', width: 1, zIndex: 5 },
        { value: medianBeta, color: `${CYAN}60`, width: 1.5, dashStyle: 'Dash',
          label: { text: `Med β ${medianBeta.toFixed(2)}`, style: { color: label, fontSize: '10px' } } },
      ],
    },
    yAxis: {
      title: { text: 'Alpha % p.a. (vs equal-weight proxy)', style: { color: label, fontSize: '11px' } },
      gridLineColor: grid,
      labels: { format: '{value}%', style: { color: label, fontFamily: "'IBM Plex Mono',monospace", fontSize: '11px' } },
      plotLines: [{ value: 0, color: isDark ? '#4B607A' : '#8696AC', width: 1, zIndex: 5 }],
    },
    tooltip: {
      backgroundColor: surface, borderColor: grid, borderWidth: 1, shadow: false,
      style: { color: text, fontSize: '12px' },
      formatter(this: Highcharts.TooltipFormatterContextObject) {
        const found = data?.points.find(p => Math.abs(p.beta - (this.x as number)) < 0.0001 && Math.abs(p.alpha - (this.y as number)) < 0.01)
        return found
          ? `<b style="font-family:'IBM Plex Mono',monospace">${found.symbol}</b><br/>` +
            `Alpha: <b>${found.alpha.toFixed(1)}% p.a.</b><br/>` +
            `Beta: <b>${found.beta.toFixed(3)}</b><br/>` +
            `R²: <b>${found.r_squared.toFixed(3)}</b>`
          : `Beta: ${(this.x as number).toFixed(3)}, Alpha: ${(this.y as number).toFixed(1)}%`
      },
    },
    legend: { enabled: false },
    plotOptions: { scatter: { marker: { radius: 5, symbol: 'circle', states: { hover: { enabled: true, lineColor: isDark ? '#fff' : '#000', lineWidth: 1 } } } } },
    series: [{
      type: 'scatter',
      name: 'Stocks',
      data: data?.points.map(p => ({
        x: p.beta,
        y: p.alpha,
        name: p.symbol,
        color: p.alpha >= 0 ? `${WIN}CC` : `${LOSS}CC`,
      })) ?? [],
    }],
  }), [data, medianBeta, CYAN, grid, label, surface, text, isDark])

  const topAlpha    = data?.points[0]
  const bottomAlpha = data?.points[data.points.length - 1]
  const highAlphaLowBeta = data?.points.filter(p => p.alpha > 0 && p.beta < medianBeta).length ?? 0

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <SectionHead title="Alpha-Beta Scatter" accent="#10b981" />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
          <Select value={horizon} onChange={e => setHorizon(e.target.value)}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
            {AB_HORIZONS.map(h => <MenuItem key={h.value} value={h.value} sx={{ fontSize: '0.72rem', color: INK }}>{h.label}</MenuItem>)}
          </Select>
          <Select value={lookback} onChange={e => setLookback(Number(e.target.value))}
            input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
            sx={{ minWidth: 110, ...INPUT_SX, bgcolor: PAPER2 }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
            {LOOKBACK_OPTIONS.map(o => <MenuItem key={o.value} value={o.value} sx={{ fontSize: '0.72rem', color: INK }}>{o.label}</MenuItem>)}
          </Select>
          <RunBtn onClick={load} loading={loading} label="Load Chart" />
        </Box>
      </Box>
      <ChartInfo
        what="Each stock plotted by beta (market sensitivity, X-axis) and annualised alpha (excess return vs equal-weight proxy, Y-axis)."
        rationale="Beta is the market risk you're taking. Alpha is what the stock adds beyond that exposure. High alpha at low beta is the holy grail."
        use="Upper-left (low beta, positive alpha) = defensive compounders — best risk/reward. Upper-right = high-beta outperformers. Avoid any stock with negative alpha."
      />
      {loading && <LoadBar />}
      {error && <ErrorBox msg={error} />}
      {data && !error && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <StatChip label="Best Alpha" value={topAlpha ? `${topAlpha.symbol} ${topAlpha.alpha.toFixed(1)}%` : '—'} color={WIN} />
            <StatChip label="Worst Alpha" value={bottomAlpha ? `${bottomAlpha.symbol} ${bottomAlpha.alpha.toFixed(1)}%` : '—'} color={LOSS} />
            <StatChip label="Low-β Positive-α" value={`${highAlphaLowBeta} stocks`} color={WIN} />
            <StatChip label="Symbols" value={`${data.points.length}`} />
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of {data.as_of} · {lookback}d lookback</Typography>
            </Box>
          </Box>
          <Box sx={{ '.highcharts-container': { width: '100% !important' } }}>
            <HighchartsReact highcharts={Highcharts} options={options} />
          </Box>
        </>
      )}
      {!data && !loading && !error && <EmptyState msg="Select horizon and lookback, then click Load Chart to plot alpha vs beta for all stocks." />}
    </Box>
  )
}
