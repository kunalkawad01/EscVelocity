import { useState, useEffect, useMemo, Fragment } from 'react'
import { useParams } from 'react-router-dom'
import {
  Box, Typography, Select, MenuItem, Stack, CircularProgress, Alert,
} from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts/highstock'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import DrawdownSection from '../components/stock/DrawdownSection'
import { stockApi } from '../api/stockApi'
import { stockEdaApi } from '../api/stockEdaApi'
import { hcTheme } from '../theme'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import type { OHLCVResponse, ReturnsResponse, DrawdownResponse, StockSummary, YearlyReturn } from '../types/stock'
import type {
  VolatilitySeriesResponse, DrawdownHistoryResponse, SeasonalityResponse,
  GapsResponse, VolumeProfileResponse, AutocorrelationResponse,
  ExtremeDaysResponse, ExtremeDay, BenchmarkComparisonResponse,
} from '../types/stockEda'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

const NAV_H = 86
const GREEN = '#22c55e'
const RED = '#ef4444'

function pct(v: number, digits = 2): string { return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` }
function signColor(v: number): string { return v >= 0 ? GREEN : RED }

// ─── Section index ──────────────────────────────────────────────────────────

const SECTION_INDEX = [
  { id: 'eda-price',      label: 'Price & Volume',  accent: '#3B82F6' },
  { id: 'eda-returns',    label: 'Return Dist.',    accent: '#22C55E' },
  { id: 'eda-vol',        label: 'Volatility',      accent: '#F59E0B' },
  { id: 'eda-drawdown',   label: 'Drawdown',        accent: '#EF4444' },
  { id: 'eda-seasonal',   label: 'Seasonality',     accent: '#A855F7' },
  { id: 'eda-gaps',       label: 'Gaps',            accent: '#14B8A6' },
  { id: 'eda-volprofile', label: 'Volume Profile',  accent: '#3B82F6' },
  { id: 'eda-acf',        label: 'Autocorrelation', accent: '#F59E0B' },
  { id: 'eda-extreme',    label: 'Extreme Days',    accent: '#EF4444' },
  { id: 'eda-benchmark',  label: 'Benchmark',       accent: '#22C55E' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

// ─── Shared bits ──────────────────────────────────────────────────────────────

function Section({ id, title, accent, num, children }: {
  id: string; title: string; accent?: string; num: number; children: React.ReactNode
}) {
  const { PAPER2, BORDER, INK2, INK3, CYAN } = usePalette()
  const { CARD } = useTokens()
  const sectionAccent = accent ?? CYAN
  return (
    <Box id={id} sx={{ ...CARD, mb: 3, overflow: 'hidden', scrollMarginTop: NAV_H + 10 }}>
      <Box sx={{ height: '2px', background: `linear-gradient(90deg, ${sectionAccent} 0%, ${sectionAccent}60 40%, transparent 100%)` }} />
      <Box sx={{ px: { xs: 3, md: 4 }, py: 1.5, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 2, bgcolor: PAPER2 }}>
        <Typography sx={{ ...MONO, fontSize: '0.6875rem', color: INK3, minWidth: 24, userSelect: 'none', fontWeight: 600 }}>
          {num.toString().padStart(2, '0')}
        </Typography>
        <Box sx={{ width: 2, height: 16, bgcolor: sectionAccent, opacity: 0.85, flexShrink: 0 }} />
        <Typography sx={{ ...COND, fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.12em', color: INK2, textTransform: 'uppercase', flex: 1 }}>
          {title}
        </Typography>
      </Box>
      <Box sx={{ px: { xs: 3, md: 4 }, py: 3 }}>{children}</Box>
    </Box>
  )
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  const { INK, INK3, PAPER2, BORDER } = usePalette()
  return (
    <Box sx={{ px: 1.5, py: 1, bgcolor: PAPER2, border: `1px solid ${BORDER}`, minWidth: 100 }}>
      <Typography sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: INK3, mb: 0.25 }}>
        {label}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '1rem', fontWeight: 800, color: color ?? INK }}>{value}</Typography>
    </Box>
  )
}

function LoadingBox() {
  const { CYAN } = usePalette()
  return (
    <Box sx={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress size={28} sx={{ color: CYAN }} />
    </Box>
  )
}

// ─── 1. Price & Volume ──────────────────────────────────────────────────────

function PriceVolumeSection({ ohlcv, loading }: { ohlcv: OHLCVResponse | null; loading: boolean }) {
  const { INK3 } = usePalette()

  const options = useMemo((): Highcharts.Options => {
    if (!ohlcv?.candles.length) return {}
    const candles = ohlcv.candles.map(c => [new Date(c.date).getTime(), c.open, c.high, c.low, c.close])
    const vols = ohlcv.candles.map(c => [new Date(c.date).getTime(), c.volume])
    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 420 },
      rangeSelector: { enabled: false },
      navigator: { enabled: false },
      scrollbar: { enabled: false },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, type: 'datetime' },
      yAxis: [
        { ...hcTheme.yAxis, height: '68%' },
        { ...hcTheme.yAxis, top: '72%', height: '28%', offset: 0 },
      ],
      series: [
        { type: 'candlestick', name: ohlcv.symbol, data: candles, yAxis: 0, color: RED, upColor: GREEN, lineColor: RED, upLineColor: GREEN },
        { type: 'column', name: 'Volume', data: vols, yAxis: 1, color: `${INK3}80` },
      ],
      legend: { enabled: false },
    }
  }, [ohlcv, INK3])

  if (loading) return <LoadingBox />
  if (!ohlcv?.candles.length) return null
  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ─── 2. Return Distribution ─────────────────────────────────────────────────

function ReturnDistributionSection({ returns, loading }: { returns: ReturnsResponse | null; loading: boolean }) {
  const { INK3, CYAN } = usePalette()
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily')

  const hist = tab === 'daily' ? returns?.daily_histogram : returns?.monthly_histogram
  const stats = tab === 'daily' ? returns?.daily_stats : returns?.monthly_stats

  const options = useMemo((): Highcharts.Options => {
    if (!hist?.length) return {}
    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, type: 'column', height: 300 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, categories: hist.map(b => b.bin_start.toFixed(1)), labels: { ...hcTheme.xAxis.labels, rotation: -45 } },
      yAxis: { ...hcTheme.yAxis, title: { text: 'Frequency' } },
      legend: { enabled: false },
      plotOptions: { column: { borderWidth: 0, pointPadding: 0.02, groupPadding: 0.02 } },
      series: [{
        type: 'column', name: 'Count',
        data: hist.map(b => ({ y: b.count, color: b.bin_start >= 0 ? GREEN : RED })),
      }],
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: any) {
          const b = hist[this.point.index]
          return `<b>${b.bin_start.toFixed(2)}% to ${b.bin_end.toFixed(2)}%</b><br/>${b.count} days`
        },
      },
    }
  }, [hist])

  if (loading) return <LoadingBox />
  if (!returns) return null

  return (
    <Box>
      <Stack direction="row" spacing={1} mb={2}>
        {(['daily', 'monthly'] as const).map(t => (
          <Box key={t} onClick={() => setTab(t)} sx={{
            px: 1.5, py: 0.5, cursor: 'pointer', borderRadius: 1,
            bgcolor: tab === t ? `${CYAN}18` : 'transparent',
            border: `1px solid ${tab === t ? CYAN : 'transparent'}`,
          }}>
            <Typography sx={{ ...SANS, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: tab === t ? CYAN : INK3 }}>
              {t}
            </Typography>
          </Box>
        ))}
      </Stack>
      {stats && (
        <Stack direction="row" spacing={1.5} flexWrap="wrap" mb={2}>
          <StatChip label="Mean" value={pct(stats.mean)} color={signColor(stats.mean)} />
          <StatChip label="Median" value={pct(stats.median)} color={signColor(stats.median)} />
          <StatChip label="Std Dev" value={`${stats.std.toFixed(2)}%`} />
          <StatChip label="P5" value={pct(stats.p5)} color={RED} />
          <StatChip label="P95" value={pct(stats.p95)} color={GREEN} />
          <StatChip label="Max" value={pct(stats.max_val)} color={GREEN} />
          <StatChip label="Min" value={pct(stats.min_val)} color={RED} />
        </Stack>
      )}
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── 3. Volatility Clustering ───────────────────────────────────────────────

function VolatilityClusteringSection({ vol, loading }: { vol: VolatilitySeriesResponse | null; loading: boolean }) {
  const { INK3 } = usePalette()

  const mainOptions = useMemo((): Highcharts.Options => {
    if (!vol?.series.length) return {}
    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, type: 'area', height: 260 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, type: 'datetime' },
      yAxis: { ...hcTheme.yAxis, title: { text: 'Realized Vol (ann. %)' }, min: 0 },
      legend: { enabled: false },
      series: [{
        type: 'area', name: '20D Realized Vol',
        data: vol.series.map(p => [new Date(p.date).getTime(), p.realized_vol_20d]),
        color: '#f59e0b', lineWidth: 1.5, marker: { enabled: false },
        fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(245,158,11,0.30)'], [1, 'rgba(245,158,11,0.02)']] },
      }],
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: any) { return `<b>${Highcharts.dateFormat('%b %d, %Y', this.x)}</b><br/>Realized Vol: <b>${this.y.toFixed(2)}%</b>` },
      },
    }
  }, [vol])

  const vovOptions = useMemo((): Highcharts.Options => {
    if (!vol?.series.length) return {}
    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, type: 'line', height: 110 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, type: 'datetime', labels: { enabled: false } },
      yAxis: { ...hcTheme.yAxis, title: { text: '' }, labels: { ...hcTheme.yAxis.labels, style: { fontSize: '9px' } } },
      legend: { enabled: false },
      series: [{
        type: 'line', name: 'Vol of Vol',
        data: vol.series.map(p => [new Date(p.date).getTime(), p.vol_of_vol_20d]),
        color: '#a855f7', lineWidth: 1, marker: { enabled: false },
      }],
      tooltip: { ...hcTheme.tooltip, formatter: function (this: any) { return `Vol of Vol: <b>${this.y.toFixed(2)}</b>` } },
    }
  }, [vol])

  if (loading) return <LoadingBox />
  if (!vol) return null

  return (
    <Box>
      <Stack direction="row" spacing={1.5} mb={2}>
        <StatChip label="Current Vol (ann.)" value={`${vol.current_vol.toFixed(1)}%`} color="#f59e0b" />
        <StatChip label="Vol Percentile" value={`${vol.vol_percentile.toFixed(0)}th`} color={vol.vol_percentile >= 70 ? RED : vol.vol_percentile <= 30 ? GREEN : '#f59e0b'} />
      </Stack>
      <HighchartsReact highcharts={Highcharts} options={mainOptions} />
      <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3, mt: 1, mb: 0.5 }}>
        Vol-of-vol — how unstable volatility itself is
      </Typography>
      <HighchartsReact highcharts={Highcharts} options={vovOptions} />
    </Box>
  )
}

// ─── 4. Worst Drawdowns table (chart itself reuses stock/DrawdownSection) ────

function WorstDrawdownsTable({ data, loading }: { data: DrawdownHistoryResponse | null; loading: boolean }) {
  const { INK2, INK3, BORDER } = usePalette()
  const { TH, TD } = useTokens()

  if (loading) return <LoadingBox />
  if (!data?.episodes.length) return null

  return (
    <Box sx={{ mt: 3, overflowX: 'auto' }}>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.14em', color: INK3, textTransform: 'uppercase', mb: 1.5 }}>
        Worst {data.episodes.length} Drawdown Episodes
      </Typography>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
        <Box component="thead"><Box component="tr">
          {['Peak', 'Trough', 'Recovered', 'Depth', 'Duration', 'Recovery'].map(h => (
            <Box key={h} component="th" sx={{ ...TH, textAlign: 'left' }}>{h}</Box>
          ))}
        </Box></Box>
        <Box component="tbody">
          {data.episodes.map((e, i) => (
            <Box component="tr" key={i} sx={{ borderBottom: `1px solid ${BORDER}` }}>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.75rem', color: INK2 }}>{e.start_date}</Box>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.75rem', color: INK2 }}>{e.trough_date}</Box>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.75rem', color: e.recovery_date ? GREEN : INK3 }}>
                {e.recovery_date ?? 'Ongoing'}
              </Box>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.8rem', fontWeight: 700, color: RED }}>{e.depth_pct.toFixed(1)}%</Box>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.75rem', color: INK2 }}>{e.duration_days}d</Box>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.75rem', color: INK2 }}>{e.recovery_days != null ? `${e.recovery_days}d` : '—'}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ─── 5. Seasonality ─────────────────────────────────────────────────────────

function SeasonalityHeatmapSection({ data, yearly, loading }: {
  data: SeasonalityResponse | null; yearly: YearlyReturn[]; loading: boolean
}) {
  const { INK2, INK3, BORDER, PAPER2 } = usePalette()

  const cellMap = useMemo(() => {
    const m = new Map<string, { avg: number; n: number }>()
    data?.grid.forEach(c => m.set(`${c.month}-${c.day_of_week}`, { avg: c.avg_return_pct, n: c.n }))
    return m
  }, [data])

  const maxAbs = useMemo(() => {
    if (!data?.grid.length) return 1
    return Math.max(0.1, ...data.grid.map(c => Math.abs(c.avg_return_pct)))
  }, [data])

  if (loading) return <LoadingBox />
  if (!data?.grid.length) return null

  return (
    <Box>
      <Stack direction="row" spacing={1.5} mb={2.5}>
        <StatChip label="Best Month" value={MONTHS[data.best_month - 1]} color={GREEN} />
        <StatChip label="Worst Month" value={MONTHS[data.worst_month - 1]} color={RED} />
      </Stack>

      <Box sx={{ overflowX: 'auto', mb: 3 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '60px repeat(12, 1fr)', gap: '2px', minWidth: 640 }}>
          <Box />
          {MONTHS.map(m => (
            <Typography key={m} sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 700, color: INK3, textAlign: 'center' }}>{m}</Typography>
          ))}
          {DOWS.map((dow, dowIdx) => (
            <Fragment key={dow}>
              <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 700, color: INK3, display: 'flex', alignItems: 'center' }}>{dow}</Typography>
              {MONTHS.map((_, mIdx) => {
                const cell = cellMap.get(`${mIdx + 1}-${dowIdx}`)
                const intensity = cell ? Math.min(1, Math.abs(cell.avg) / maxAbs) : 0
                const color = cell ? (cell.avg >= 0 ? GREEN : RED) : BORDER
                const alphaHex = Math.round(20 + intensity * 60).toString(16).padStart(2, '0')
                return (
                  <Box
                    key={`${mIdx}-${dowIdx}`}
                    title={cell ? `${MONTHS[mIdx]} ${dow}: ${pct(cell.avg)} avg (n=${cell.n})` : 'No data'}
                    sx={{
                      height: 28, borderRadius: '3px',
                      bgcolor: cell ? `${color}${alphaHex}` : PAPER2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {cell && (
                      <Typography sx={{ ...MONO, fontSize: '0.58rem', color: intensity > 0.4 ? '#fff' : INK2 }}>
                        {cell.avg.toFixed(1)}
                      </Typography>
                    )}
                  </Box>
                )
              })}
            </Fragment>
          ))}
        </Box>
      </Box>

      {yearly.length > 0 && (
        <>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.14em', color: INK3, textTransform: 'uppercase', mb: 1.5 }}>
            Yearly Returns
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap">
            {yearly.map(y => (
              <Box key={y.period} sx={{ px: 1.25, py: 1, bgcolor: PAPER2, border: `1px solid ${BORDER}`, minWidth: 70, textAlign: 'center' }}>
                <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3 }}>{y.period}</Typography>
                <Typography sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 700, color: signColor(y.return_pct) }}>{pct(y.return_pct, 1)}</Typography>
              </Box>
            ))}
          </Stack>
        </>
      )}
    </Box>
  )
}

// ─── 6. Gap Analysis ────────────────────────────────────────────────────────

function GapAnalysisSection({ data, loading }: { data: GapsResponse | null; loading: boolean }) {
  const options = useMemo((): Highcharts.Options => {
    if (!data?.buckets.length) return {}
    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, type: 'column', height: 280 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, categories: data.buckets.map(b => b.label) },
      yAxis: { ...hcTheme.yAxis, title: { text: 'Fill Rate %' }, max: 100 },
      legend: { enabled: false },
      series: [{ type: 'column', name: 'Fill Rate', data: data.buckets.map(b => b.fill_rate_pct), color: '#14b8a6' }],
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: any) {
          const b = data.buckets[this.point.index]
          return `<b>${b.label} gap</b><br/>${b.count} occurrences<br/>Fill rate: <b>${b.fill_rate_pct.toFixed(1)}%</b>`
        },
      },
    }
  }, [data])

  if (loading) return <LoadingBox />
  if (!data) return null

  return (
    <Box>
      <Stack direction="row" spacing={1.5} mb={2}>
        <StatChip label="Overall Fill Rate" value={`${data.overall_fill_rate_pct.toFixed(1)}%`} color="#14b8a6" />
        <StatChip label="Total Gap Days" value={`${data.points.length}`} />
      </Stack>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── 7. Volume Profile ──────────────────────────────────────────────────────

function VolumeProfileSection({ data, loading }: { data: VolumeProfileResponse | null; loading: boolean }) {
  const options = useMemo((): Highcharts.Options => {
    if (!data?.bins.length) return {}
    const pocIdx = data.bins.findIndex(b => data.point_of_control >= b.price_low && data.point_of_control <= b.price_high)
    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, type: 'bar', height: 420 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, categories: data.bins.map(b => `${b.price_low.toFixed(0)}-${b.price_high.toFixed(0)}`) },
      yAxis: { ...hcTheme.yAxis, title: { text: 'Volume' } },
      legend: { enabled: false },
      series: [{
        type: 'bar', name: 'Volume',
        data: data.bins.map((b, i) => ({ y: b.volume, color: i === pocIdx ? '#f59e0b' : '#3b82f6' })),
      }],
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: any) {
          const b = data.bins[this.point.index]
          const pocNote = this.point.index === pocIdx ? '<br/><i>Point of Control</i>' : ''
          return `<b>₹${b.price_low.toFixed(1)} – ₹${b.price_high.toFixed(1)}</b><br/>Volume: <b>${b.volume.toLocaleString('en-IN')}</b>${pocNote}`
        },
      },
    }
  }, [data])

  if (loading) return <LoadingBox />
  if (!data) return null

  return (
    <Box>
      <Stack direction="row" spacing={1.5} mb={2}>
        <StatChip label="Point of Control" value={`₹${data.point_of_control.toFixed(1)}`} color="#f59e0b" />
        <StatChip label="Lookback" value={`${data.lookback_bars} bars`} />
      </Stack>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── 8. Autocorrelation ─────────────────────────────────────────────────────

function AutocorrelationSection({ data, loading }: { data: AutocorrelationResponse | null; loading: boolean }) {
  const { INK2, INK3 } = usePalette()

  const options = useMemo((): Highcharts.Options => {
    if (!data?.acf.length) return {}
    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, type: 'column', height: 300 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, categories: data.acf.map(p => `${p.lag}`), title: { text: 'Lag (days)' } },
      yAxis: {
        ...hcTheme.yAxis, title: { text: 'ACF' },
        plotLines: [
          { value: data.significance_band, color: '#f59e0b', dashStyle: 'Dash', width: 1 },
          { value: -data.significance_band, color: '#f59e0b', dashStyle: 'Dash', width: 1 },
          { value: 0, color: INK3, width: 1 },
        ],
      },
      legend: { enabled: false },
      series: [{
        type: 'column', name: 'ACF',
        data: data.acf.map(p => ({ y: p.value, color: Math.abs(p.value) > data.significance_band ? '#a855f7' : INK3 })),
      }],
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: any) {
          const p = data.acf[this.point.index]
          const sig = Math.abs(p.value) > data.significance_band ? ' — significant' : ''
          return `<b>Lag ${p.lag}</b><br/>ACF: <b>${p.value.toFixed(3)}</b>${sig}`
        },
      },
    }
  }, [data, INK3])

  if (loading) return <LoadingBox />
  if (!data) return null

  return (
    <Box>
      <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, mb: 2, lineHeight: 1.5 }}>
        Correlation between today's return and the return N days earlier. Bars beyond the dashed ±{data.significance_band.toFixed(3)} band
        are statistically significant at 95% confidence — everything else is noise.
      </Typography>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── 9. Extreme Days ────────────────────────────────────────────────────────

function ExtremeDaysSection({ data, loading }: { data: ExtremeDaysResponse | null; loading: boolean }) {
  const { INK2, INK3, BORDER } = usePalette()
  const { TH, TD } = useTokens()

  if (loading) return <LoadingBox />
  if (!data) return null

  const renderTable = (rows: ExtremeDay[], accent: string, title: string) => (
    <Box sx={{ flex: 1, minWidth: 280 }}>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.14em', color: accent, textTransform: 'uppercase', mb: 1.5 }}>
        {title}
      </Typography>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
        <Box component="thead"><Box component="tr">
          {['Date', 'Return', 'Vol Ratio'].map(h => (
            <Box key={h} component="th" sx={{ ...TH, textAlign: h === 'Date' ? 'left' : 'right' }}>{h}</Box>
          ))}
        </Box></Box>
        <Box component="tbody">
          {rows.map(r => (
            <Box component="tr" key={r.date} sx={{ borderBottom: `1px solid ${BORDER}` }}>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.72rem', color: INK2 }}>{r.date}</Box>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.78rem', fontWeight: 700, color: signColor(r.return_pct), textAlign: 'right' }}>
                {pct(r.return_pct)}
              </Box>
              <Box component="td" sx={{ ...TD, ...MONO, fontSize: '0.72rem', color: INK3, textAlign: 'right' }}>{r.volume_ratio.toFixed(1)}x</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
      {renderTable(data.best, GREEN, 'Best 15 Days')}
      {renderTable(data.worst, RED, 'Worst 15 Days')}
    </Stack>
  )
}

// ─── 10. Benchmark Comparison ───────────────────────────────────────────────

function BenchmarkComparisonSection({ data, loading }: { data: BenchmarkComparisonResponse | null; loading: boolean }) {
  const { CYAN } = usePalette()

  const options = useMemo((): Highcharts.Options => {
    if (!data?.days.length) return {}
    const cats = data.days.map(d => d.date.slice(5))
    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, type: 'column', height: 340 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, categories: cats },
      yAxis: { ...hcTheme.yAxis, title: { text: 'Daily Return %' } },
      legend: { enabled: true, itemStyle: hcTheme.legend.itemStyle },
      plotOptions: { column: { borderWidth: 0, groupPadding: 0.12, pointPadding: 0.05 } },
      series: [
        { type: 'column', name: data.symbol, data: data.days.map(d => d.stock_return_pct), color: CYAN },
        { type: 'column', name: data.sector_name ?? 'Sector', data: data.days.map(d => d.sector_return_pct), color: '#a855f7' },
        { type: 'column', name: 'Nifty 50', data: data.days.map(d => d.nifty50_return_pct), color: '#3b82f6' },
        { type: 'column', name: 'Nifty 200', data: data.days.map(d => d.nifty200_return_pct), color: '#14b8a6' },
        { type: 'column', name: 'Nifty 500', data: data.days.map(d => d.nifty500_return_pct), color: '#f59e0b' },
      ],
      tooltip: {
        ...hcTheme.tooltip, shared: true,
        formatter: function (this: any) {
          const pts = this.points ?? []
          let s = `<b>${this.x}</b><br/>`
          pts.forEach((p: any) => { s += `${p.series.name}: <b>${p.y >= 0 ? '+' : ''}${p.y.toFixed(2)}%</b><br/>` })
          return s
        },
      },
    }
  }, [data, CYAN])

  if (loading) return <LoadingBox />
  if (!data?.days.length) return null

  const outperformDays = data.days.filter(d => d.stock_return_pct > d.nifty50_return_pct).length

  return (
    <Box>
      <Stack direction="row" spacing={1.5} mb={2} flexWrap="wrap">
        <StatChip label="vs Nifty 50" value={`${outperformDays}/${data.days.length} days`} color={outperformDays >= 3 ? GREEN : RED} />
        {data.sector_name && <StatChip label="Sector" value={data.sector_name} />}
      </Stack>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

// ─── Page data shape ────────────────────────────────────────────────────────

interface EdaData {
  summary: StockSummary | null
  ohlcv: OHLCVResponse | null
  returns: ReturnsResponse | null
  drawdown: DrawdownResponse | null
  volSeries: VolatilitySeriesResponse | null
  ddHistory: DrawdownHistoryResponse | null
  seasonality: SeasonalityResponse | null
  gaps: GapsResponse | null
  volProfile: VolumeProfileResponse | null
  acf: AutocorrelationResponse | null
  extremeDays: ExtremeDaysResponse | null
  benchmark: BenchmarkComparisonResponse | null
}

const INITIAL: EdaData = {
  summary: null, ohlcv: null, returns: null, drawdown: null, volSeries: null, ddHistory: null,
  seasonality: null, gaps: null, volProfile: null, acf: null, extremeDays: null, benchmark: null,
}

type LoadState = { [K in keyof EdaData]: boolean }
const INIT_LOAD: LoadState = {
  summary: false, ohlcv: false, returns: false, drawdown: false, volSeries: false, ddHistory: false,
  seasonality: false, gaps: false, volProfile: false, acf: false, extremeDays: false, benchmark: false,
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StockEDAPage() {
  const { BG, PAPER, PAPER2, BORDER, INK, INK2, INK3, CYAN } = usePalette()
  const { INPUT_SX } = useTokens()
  const { mode } = useThemeMode()
  const { symbol: urlSymbol } = useParams<{ symbol: string }>()

  const [symbols, setSymbols] = useState<string[]>([])
  const [symbol, setSymbol] = useState<string>(urlSymbol?.toUpperCase() ?? 'RELIANCE')
  const [data, setData] = useState<EdaData>(INITIAL)
  const [loading, setLoading] = useState<LoadState>(INIT_LOAD)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string>('')

  useEffect(() => {
    stockApi.getSymbols().then(r => setSymbols(r.symbols)).catch(console.error)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length > 0) {
          const topmost = visible.reduce((a, b) => a.boundingClientRect.top < b.boundingClientRect.top ? a : b)
          setActiveSection(topmost.target.id)
        }
      },
      { rootMargin: `-${NAV_H + 8}px 0px -60% 0px`, threshold: 0 }
    )
    SECTION_INDEX.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [data.ohlcv])

  useEffect(() => {
    if (!symbol) return
    setData(INITIAL)
    setError(null)

    const setLoad = (k: keyof LoadState, v: boolean) => setLoading(prev => ({ ...prev, [k]: v }))
    const load = async <K extends keyof EdaData>(key: K, fn: () => Promise<EdaData[K]>) => {
      setLoad(key, true)
      try {
        const result = await fn()
        setData(prev => ({ ...prev, [key]: result }))
      } catch (e) {
        setError(`Failed to load ${key}: ${(e as Error).message}`)
      } finally {
        setLoad(key, false)
      }
    }

    load('summary', () => stockApi.getSummary(symbol))
    load('ohlcv', () => stockApi.getOHLCV(symbol))
    load('returns', () => stockApi.getReturns(symbol))
    load('drawdown', () => stockApi.getDrawdown(symbol))
    load('volSeries', () => stockEdaApi.getVolatilitySeries(symbol))
    load('ddHistory', () => stockEdaApi.getDrawdownHistory(symbol))
    load('seasonality', () => stockEdaApi.getSeasonality(symbol))
    load('gaps', () => stockEdaApi.getGaps(symbol))
    load('volProfile', () => stockEdaApi.getVolumeProfile(symbol))
    load('acf', () => stockEdaApi.getAutocorrelation(symbol))
    load('extremeDays', () => stockEdaApi.getExtremeDays(symbol))
    load('benchmark', () => stockEdaApi.getBenchmarkComparison(symbol))
  }, [symbol])

  const summary = data.summary
  const changeColor = summary ? signColor(summary.change_pct) : INK

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK }}>
      <Navbar />

      {/* ── Sticky section nav bar ───────────────────────────────────────────── */}
      {(() => {
        const active = SECTION_INDEX.find(s => s.id === activeSection)
        return (
          <Box sx={{ position: 'sticky', top: 48, zIndex: 100, width: '100%', bgcolor: PAPER2, borderBottom: `1px solid ${BORDER}` }}>
            <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4, lg: 8 }, height: 40, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                {active ? (
                  <>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: active.accent, flexShrink: 0, boxShadow: `0 0 6px ${active.accent}80` }} />
                    <Typography sx={{ ...MONO, fontSize: '0.7rem', fontWeight: 700, color: INK2, letterSpacing: '0.06em', textTransform: 'uppercase' }} noWrap>
                      {active.label}
                    </Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>
                      {(SECTION_INDEX.findIndex(s => s.id === activeSection) + 1).toString().padStart(2, '0')} / {SECTION_INDEX.length}
                    </Typography>
                  </>
                ) : (
                  <Typography sx={{ ...COND, fontSize: '0.7rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Stock EDA
                  </Typography>
                )}
              </Box>

              <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5 }}>
                {SECTION_INDEX.map(s => {
                  const isActive = activeSection === s.id
                  return (
                    <Box
                      key={s.id} component="a" href={`#${s.id}`} title={s.label}
                      sx={{
                        width: isActive ? 18 : 6, height: 6, borderRadius: 3,
                        bgcolor: isActive ? s.accent : BORDER, transition: 'all 0.2s ease',
                        cursor: 'pointer', textDecoration: 'none',
                        '&:hover': { bgcolor: s.accent, opacity: 0.85 },
                      }}
                    />
                  )
                })}
              </Box>

              <Select
                value={activeSection || ''}
                displayEmpty
                size="small"
                renderValue={() => (
                  <Typography sx={{ ...COND, fontSize: '0.72rem', fontWeight: 700, color: INK2, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Jump to ▾
                  </Typography>
                )}
                onChange={e => {
                  const el = document.getElementById(e.target.value as string)
                  if (el) el.scrollIntoView({ behavior: 'smooth' })
                }}
                sx={{
                  height: 28, minWidth: 100, flexShrink: 0, bgcolor: PAPER, borderRadius: 1.5,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: BORDER },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: CYAN },
                  '& .MuiSelect-select': { py: '4px !important', pr: '28px !important' },
                  '& .MuiSvgIcon-root': { display: 'none' },
                }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: 2, mt: 0.5, maxHeight: 360,
                      '& .MuiMenuItem-root': {
                        ...COND, fontSize: '0.78rem', color: INK2, py: 0.75,
                        '&:hover': { bgcolor: BORDER, color: INK },
                        '&.Mui-selected': { bgcolor: `${CYAN}14`, color: CYAN },
                      },
                    },
                  },
                }}
              >
                {SECTION_INDEX.map((s, i) => (
                  <MenuItem key={s.id} value={s.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: s.accent, flexShrink: 0 }} />
                      <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3, minWidth: 20 }}>
                        {(i + 1).toString().padStart(2, '0')}
                      </Typography>
                      {s.label}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </Box>
          </Box>
        )
      })()}

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 4, md: 6 }, position: 'relative' }}>
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5,
            px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D`,
          }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN }} />
            <Typography sx={{ ...COND, fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Stock EDA · Visual Exploration
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ md: 'flex-end' }} justifyContent="space-between">
            <Box>
              <Typography sx={{ ...MONO, fontWeight: 700, color: INK, fontSize: { xs: '2.25rem', md: '3.25rem' }, lineHeight: 1, letterSpacing: '-0.02em', mb: 1 }}>
                {symbol}
              </Typography>
              {summary && (
                <Stack direction="row" spacing={1.5} alignItems="baseline">
                  <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 700, color: INK }}>₹{summary.close.toFixed(2)}</Typography>
                  <Typography sx={{ ...MONO, fontSize: '0.85rem', fontWeight: 700, color: changeColor }}>{pct(summary.change_pct)}</Typography>
                </Stack>
              )}
              <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2, mt: 1, maxWidth: 520, lineHeight: 1.6 }}>
                Chart-first exploration — distributions, seasonality, volatility, and correlations. No scores, no verdicts, just the raw data to build your own view.
              </Typography>
            </Box>
            <Select
              value={symbol}
              onChange={e => setSymbol((e.target.value as string).toUpperCase())}
              size="small"
              sx={{ minWidth: 160, bgcolor: PAPER, ...INPUT_SX }}
              MenuProps={{ PaperProps: { sx: { maxHeight: 360, bgcolor: PAPER2 } } }}
            >
              {symbols.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </Stack>
        </Box>
      </Box>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4, lg: 8 }, py: 4 }}>
        {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 1 }}>{error}</Alert>}

        <Section id="eda-price" num={1} title="Price & Volume" accent={SECTION_INDEX[0].accent}>
          <PriceVolumeSection ohlcv={data.ohlcv} loading={loading.ohlcv} />
        </Section>

        <Section id="eda-returns" num={2} title="Return Distribution" accent={SECTION_INDEX[1].accent}>
          <ReturnDistributionSection returns={data.returns} loading={loading.returns} />
        </Section>

        <Section id="eda-vol" num={3} title="Volatility Clustering" accent={SECTION_INDEX[2].accent}>
          <VolatilityClusteringSection vol={data.volSeries} loading={loading.volSeries} />
        </Section>

        <Section id="eda-drawdown" num={4} title="Drawdown" accent={SECTION_INDEX[3].accent}>
          <DrawdownSection data={data.drawdown} loading={loading.drawdown} />
          <WorstDrawdownsTable data={data.ddHistory} loading={loading.ddHistory} />
        </Section>

        <Section id="eda-seasonal" num={5} title="Seasonality" accent={SECTION_INDEX[4].accent}>
          <SeasonalityHeatmapSection data={data.seasonality} yearly={data.returns?.yearly_returns ?? []} loading={loading.seasonality} />
        </Section>

        <Section id="eda-gaps" num={6} title="Gap Analysis" accent={SECTION_INDEX[5].accent}>
          <GapAnalysisSection data={data.gaps} loading={loading.gaps} />
        </Section>

        <Section id="eda-volprofile" num={7} title="Volume Profile" accent={SECTION_INDEX[6].accent}>
          <VolumeProfileSection data={data.volProfile} loading={loading.volProfile} />
        </Section>

        <Section id="eda-acf" num={8} title="Autocorrelation" accent={SECTION_INDEX[7].accent}>
          <AutocorrelationSection data={data.acf} loading={loading.acf} />
        </Section>

        <Section id="eda-extreme" num={9} title="Extreme Days" accent={SECTION_INDEX[8].accent}>
          <ExtremeDaysSection data={data.extremeDays} loading={loading.extremeDays} />
        </Section>

        <Section id="eda-benchmark" num={10} title="Benchmark Comparison" accent={SECTION_INDEX[9].accent}>
          <BenchmarkComparisonSection data={data.benchmark} loading={loading.benchmark} />
        </Section>
      </Box>

      <Footer />
    </Box>
  )
}
