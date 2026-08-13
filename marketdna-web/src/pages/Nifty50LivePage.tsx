import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, FormControl, Grid, Select, MenuItem, Typography } from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { nifty50Api } from '../api/nifty50Api'
import { optionsApi } from '../api/optionsApi'
import { fnoApi } from '../api/fnoApi'
import { sectorHeatmapApi } from '../api/sectorHeatmapApi'
import type {
  NiftyIndexTick, ContributorRow, ContributorsResponse, NiftyWsMessage, NiftyTf, NiftyHistoryResponse,
  MoversPeriod, PeriodMovers, MoversResponse, AdvanceDeclineResponse, VixState, PcrPoint,
  AdvDecPoint, SmaTrendPoint,
} from '../types/nifty50'
import type { OIAnalysis, StrikeData } from '../types/options'
import type { StrikeChartResponse } from '../types/fno'
import type { SectorHeatmapResponse } from '../types/sector_heatmap'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const GREEN = '#22c55e'
const RED = '#ef4444'
const CONTRIB_REFRESH_MS = 10_000
const CHAIN_REFRESH_MS = 5_000

const pct = (v: number | null | undefined, dp = 2) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(dp) + '%'
const oiFmt = (v: number | null | undefined) => {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e7) return (v / 1e7).toFixed(2) + 'Cr'
  if (Math.abs(v) >= 1e5) return (v / 1e5).toFixed(2) + 'L'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

// ── Live index + all-50-constituents websocket ────────────────────────────────
// One socket, one combined message per second: the index tick plus every tracked
// constituent's tick — drives both the header number and the full stocks board.
function useNiftyTicker() {
  const [tick, setTick] = useState<NiftyIndexTick | null>(null)
  const [constituents, setConstituents] = useState<ContributorRow[]>([])
  const [wsConnected, setWsConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    // Seed with REST snapshots so the page isn't blank before the socket connects.
    nifty50Api.getState().then(s => { if (!cancelled && s?.ltp) setTick(s) }).catch(() => {})
    nifty50Api.getConstituents().then(r => { if (!cancelled) setConstituents(r.constituents) }).catch(() => {})

    const connect = () => {
      ws = new WebSocket(nifty50Api.wsUrl())
      ws.onopen = () => setWsConnected(true)
      ws.onmessage = ev => {
        try {
          const msg: NiftyWsMessage = JSON.parse(ev.data)
          if (msg.index) setTick(msg.index)
          if (msg.constituents) setConstituents(msg.constituents)
        } catch { /* ignore malformed frame */ }
      }
      ws.onclose = () => {
        setWsConnected(false)
        if (!cancelled) retryTimer = setTimeout(connect, 3000)
      }
      ws.onerror = () => ws?.close()
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [])

  return { tick, constituents, wsConnected }
}

// ── Section heading ───────────────────────────────────────────────────────────
function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
      <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ ...SANS, fontSize: '0.8rem', fontWeight: 800, color: INK }}>{title}</Typography>
      {meta && <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK3, ml: 'auto' }}>{meta}</Typography>}
    </Box>
  )
}

// ── Live badge ────────────────────────────────────────────────────────────────
function LiveBadge({ wsConnected, tick }: { wsConnected: boolean; tick: NiftyIndexTick | null }) {
  const { CYAN, INK3 } = usePalette()
  const color = !tick ? CYAN : wsConnected && tick.source === 'ws' ? GREEN : '#fbbf24'
  const label = !tick ? 'CONNECTING…' : wsConnected && tick.source === 'ws' ? 'LIVE · TICK' : 'CLOSED · LAST AVAILABLE'
  return (
    <Box sx={{
      px: 1.5, py: 0.4, borderRadius: 1, bgcolor: `${color}18`, border: `1px solid ${color}35`,
      display: 'inline-flex', alignItems: 'center', gap: 0.75,
    }}>
      <Box sx={{
        width: 6, height: 6, borderRadius: '50%', bgcolor: color,
        animation: wsConnected && tick?.source === 'ws' ? 'pulse 1.6s ease-in-out infinite' : 'none',
        '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
      }} />
      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color, letterSpacing: '0.08em' }}>
        {label}
      </Typography>
      {tick?.ts && <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>· {tick.ts.slice(11)}</Typography>}
    </Box>
  )
}

// ── Market breadth strip: advance/decline + % of 50 above SMA20/50/200 ───────
const BREADTH_REFRESH_MS = 30_000

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ minWidth: 110 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography sx={{ ...SANS, fontSize: '0.58rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: INK }}>{value.toFixed(0)}%</Typography>
      </Box>
      <Box sx={{ height: 6, borderRadius: 3, bgcolor: `${color}18`, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${Math.min(100, Math.max(0, value))}%`, bgcolor: color, transition: 'width 0.4s' }} />
      </Box>
    </Box>
  )
}

// Full session grid, 09:15 -> 15:30 at 1-minute steps -- gives the chart a fixed
// x-axis spanning the whole trading day instead of stretching to fit whatever's
// been sampled so far, and lets Advances/Declines just stop drawing at 'now'
// (via connectNulls) rather than the axis rescaling every poll.
const SESSION_MINUTES: string[] = (() => {
  const out: string[] = []
  for (let h = 9, m = 15; h < 15 || (h === 15 && m <= 30); m++) {
    if (m === 60) { m = 0; h++ }
    out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return out
})()

function AdvDecChart({ points, marketOpen }: { points: AdvDecPoint[]; marketOpen: boolean }) {
  const { INK, INK3, BORDER } = usePalette()
  const { mode } = useThemeMode()

  const options = useMemo<Highcharts.Options>(() => {
    const byMinute = new Map(points.map(p => [p.time.slice(0, 5), p]))
    const cats = SESSION_MINUTES
    const advData = cats.map(t => byMinute.get(t)?.advances ?? null)
    const decData = cats.map(t => byMinute.get(t)?.declines ?? null)
    return {
      chart: { backgroundColor: 'transparent', height: 200, spacing: [6, 10, 6, 2] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { color: INK3, fontSize: '0.58rem' } },
      xAxis: {
        categories: cats,
        labels: { style: { color: INK3, fontSize: '0.54rem' }, step: Math.ceil(cats.length / 8) },
        lineColor: BORDER, tickColor: BORDER,
      },
      yAxis: {
        title: { text: undefined },
        labels: { style: { color: INK3, fontSize: '0.54rem' } },
        gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
      },
      tooltip: { shared: true, backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER, style: { color: INK, fontSize: '0.62rem' } },
      series: [
        { type: 'line', name: 'Advances', data: advData, color: GREEN, lineWidth: 1.5, marker: { enabled: false }, connectNulls: true },
        { type: 'line', name: 'Declines', data: decData, color: RED, lineWidth: 1.5, marker: { enabled: false }, connectNulls: true },
      ],
    }
  }, [points, mode, INK, INK3, BORDER])

  return (
    <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 1, p: 1 }}>
      <Typography sx={{ ...SANS, fontSize: '0.66rem', fontWeight: 700, color: INK, mb: 0.5 }}>
        Adv / Dec — 9:15 to {marketOpen ? 'live' : '3:30'}
      </Typography>
      {!points.length ? (
        <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, textAlign: 'center', py: 4 }}>
          {marketOpen ? "Waiting for today's first snapshot…" : 'No snapshots recorded today.'}
        </Typography>
      ) : (
        <HighchartsReact highcharts={Highcharts} options={options} />
      )}
    </Box>
  )
}

function SmaTrendChart({ title, field, points, color }: {
  title: string
  field: 'pct_above_sma20' | 'pct_above_sma50' | 'pct_above_sma200'
  points: SmaTrendPoint[]
  color: string
}) {
  const { INK, INK3, BORDER } = usePalette()
  const { mode } = useThemeMode()

  const options = useMemo<Highcharts.Options>(() => {
    const cats = points.map(p => (p.is_live ? 'Live' : p.date.slice(5)))
    return {
      chart: { backgroundColor: 'transparent', height: 200, spacing: [6, 10, 6, 2] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: cats,
        labels: { style: { color: INK3, fontSize: '0.56rem' }, step: Math.ceil(cats.length / 8) },
        lineColor: BORDER, tickColor: BORDER,
      },
      yAxis: {
        title: { text: undefined }, min: 0, max: 100,
        labels: { style: { color: INK3, fontSize: '0.54rem' }, formatter: function () { return `${this.value}%` } },
        gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
      },
      tooltip: {
        backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER, style: { color: INK, fontSize: '0.62rem' },
        formatter: function () { return `<b>${this.x}</b><br/>${(this.y as number).toFixed(1)}%` },
      },
      series: [{
        type: 'area', name: title, data: points.map(p => p[field]), color, lineWidth: 1.5, fillOpacity: 0.12,
        marker: { enabled: false },
      }],
    }
  }, [points, field, color, title, mode, INK, INK3, BORDER])

  return (
    <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 1, p: 1 }}>
      <Typography sx={{ ...SANS, fontSize: '0.66rem', fontWeight: 700, color: INK, mb: 0.5 }}>{title} — 6 months to live</Typography>
      {!points.length ? (
        <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, textAlign: 'center', py: 4 }}>No history yet.</Typography>
      ) : (
        <HighchartsReact highcharts={Highcharts} options={options} />
      )}
    </Box>
  )
}

function BreadthStrip() {
  const { INK, INK3, CYAN } = usePalette()
  const { CARD } = useTokens()
  const [breadth, setBreadth] = useState<AdvanceDeclineResponse | null>(null)

  useEffect(() => {
    const load = () => nifty50Api.getBreadth().then(setBreadth).catch(() => {})
    load()
    const id = setInterval(load, BREADTH_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const advPct = breadth && breadth.total > 0 ? (breadth.advances / breadth.total) * 100 : 0

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead title="Market Breadth (Nifty 50)" accent={CYAN} meta={breadth ? breadth.breadth_label : ''} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', mb: 2 }}>
        <Box sx={{ minWidth: 160 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: GREEN }}>{breadth ? `${breadth.advances} adv` : '—'}</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: RED }}>{breadth ? `${breadth.declines} dec` : '—'}</Typography>
          </Box>
          <Box sx={{ height: 8, borderRadius: 4, bgcolor: `${RED}25`, overflow: 'hidden', display: 'flex' }}>
            <Box sx={{ height: '100%', width: `${advPct}%`, bgcolor: GREEN, transition: 'width 0.4s' }} />
          </Box>
          <Typography sx={{ ...MONO, fontSize: '0.55rem', color: INK3, mt: 0.25 }}>
            {breadth ? `${breadth.unchanged} unch · ${breadth.n_total} tracked` : ''}
          </Typography>
        </Box>
        {breadth && (
          <>
            <MiniBar label="Above SMA20" value={breadth.pct_above_sma20} color={CYAN} />
            <MiniBar label="Above SMA50" value={breadth.pct_above_sma50} color={CYAN} />
            <MiniBar label="Above SMA200" value={breadth.pct_above_sma200} color={CYAN} />
            <Box sx={{ ml: 'auto', textAlign: 'right' }}>
              <Typography sx={{ ...MONO, fontSize: '1.4rem', fontWeight: 800, color: INK, lineHeight: 1 }}>{breadth.breadth_score.toFixed(0)}</Typography>
              <Typography sx={{ ...SANS, fontSize: '0.58rem', color: INK3 }}>breadth score</Typography>
            </Box>
          </>
        )}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        <AdvDecChart points={breadth?.adv_dec_history.points ?? []} marketOpen={breadth?.market_open ?? false} />
        <SmaTrendChart title="Above SMA20" field="pct_above_sma20" points={breadth?.sma_trend.points ?? []} color={CYAN} />
        <SmaTrendChart title="Above SMA50" field="pct_above_sma50" points={breadth?.sma_trend.points ?? []} color="#a78bfa" />
        <SmaTrendChart title="Above SMA200" field="pct_above_sma200" points={breadth?.sma_trend.points ?? []} color="#f59e0b" />
      </Box>
    </Box>
  )
}

// ── India VIX: live LTP/change + chart ────────────────────────────────────────
const VIX_TF_TABS: { key: NiftyTf; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: '1m',    label: '1M' },
  { key: '3m',    label: '3M' },
  { key: '1y',    label: '1Y' },
]
const VIX_STATE_REFRESH_MS = 15_000

function VixSection() {
  const { INK, INK3, BORDER, CYAN } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const [vix, setVix] = useState<VixState | null>(null)
  const [tf, setTf] = useState<NiftyTf>('daily')
  const [hist, setHist] = useState<NiftyHistoryResponse | null>(null)

  useEffect(() => {
    const load = () => nifty50Api.getVixState().then(setVix).catch(() => {})
    load()
    const id = setInterval(load, VIX_STATE_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    nifty50Api.getHistory(tf, 'INDIA VIX').then(r => { if (!cancelled) setHist(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [tf])

  const changeColor = (vix?.change ?? 0) >= 0 ? RED : GREEN   // rising VIX = risk-off = red

  const options = useMemo<Highcharts.Options>(() => {
    const candles = hist?.candles ?? []
    const data = candles.map(c => [new Date(c.time).getTime(), c.close])
    return {
      time: { timezone: 'Asia/Kolkata' },
      chart: { backgroundColor: 'transparent', height: 220 },
      title: { text: undefined },
      credits: { enabled: false },
      rangeSelector: { enabled: false },
      scrollbar: { enabled: false },
      navigator: { enabled: false },
      xAxis: { type: 'datetime', lineColor: BORDER, tickColor: BORDER, labels: { style: { color: INK3, fontSize: '0.58rem' } } },
      yAxis: { labels: { style: { color: INK3, fontSize: '0.58rem' } }, gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7' },
      tooltip: {
        backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
        style: { color: INK, fontSize: '0.64rem' },
        formatter: function () {
          const d = this.series.chart.time.dateFormat('%e %b %Y %H:%M', this.x as number)
          return `<b>${d} IST</b><br/>VIX ${(this.y as number).toFixed(2)}`
        },
      },
      series: [{ type: 'area', name: 'India VIX', data, color: CYAN, lineWidth: 1.5, fillOpacity: 0.12, marker: { enabled: false } }],
    }
  }, [hist, INK, INK3, BORDER, CYAN, mode])

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: '#a78bfa' }} />
        <Typography sx={{ ...SANS, fontSize: '0.8rem', fontWeight: 800, color: INK }}>India VIX</Typography>
        <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: INK, ml: 1 }}>{vix?.ltp != null ? vix.ltp.toFixed(2) : '—'}</Typography>
        {vix?.change != null && (
          <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: changeColor }}>
            {vix.change >= 0 ? '+' : ''}{vix.change.toFixed(2)} ({pct(vix.change_pct)})
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
          {VIX_TF_TABS.map(t => (
            <Box
              key={t.key}
              onClick={() => setTf(t.key)}
              sx={{
                px: 1, py: 0.3, borderRadius: 1, cursor: 'pointer',
                bgcolor: tf === t.key ? `${CYAN}20` : 'transparent',
                border: `1px solid ${tf === t.key ? CYAN : BORDER}`,
              }}
            >
              <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: tf === t.key ? 800 : 600, color: tf === t.key ? CYAN : INK3 }}>{t.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
      {!hist?.candles.length ? (
        <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, py: 3, textAlign: 'center' }}>Loading…</Typography>
      ) : (
        <HighchartsReact highcharts={Highcharts} constructorType="stockChart" options={options} />
      )}
    </Box>
  )
}

// ── NIFTY 50 chart: interval buttons (1min-30min) + range buttons (daily-5y) ──
const TF_TABS: { key: NiftyTf; label: string }[] = [
  { key: '1min',  label: '1m' },
  { key: '5min',  label: '5m' },
  { key: '15min', label: '15m' },
  { key: '30min', label: '30m' },
  { key: 'daily', label: 'Daily' },
  { key: '2day',  label: '2D' },
  { key: '5day',  label: '5D' },
  { key: '1m',    label: '1M' },
  { key: '3m',    label: '3M' },
  { key: '6m',    label: '6M' },
  { key: '1y',    label: '1Y' },
  { key: '2y',    label: '2Y' },
  { key: '3y',    label: '3Y' },
  { key: '5y',    label: '5Y' },
]

function NiftyChartSection({ symbol, onClear }: { symbol: string | null; onClear: () => void }) {
  const { INK, INK3, CYAN, BORDER } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const [tf, setTf] = useState<NiftyTf>('daily')
  const [hist, setHist] = useState<NiftyHistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    nifty50Api.getHistory(tf, symbol ?? undefined)
      .then(r => { if (!cancelled) setHist(r) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tf, symbol])

  const options = useMemo<Highcharts.Options>(() => {
    const candles = hist?.candles ?? []
    const data = candles.map(c => [new Date(c.time).getTime(), c.open, c.high, c.low, c.close])
    return {
      // Candle timestamps come from Kite already in IST (+05:30); render axis/tooltip
      // labels in IST regardless of the viewer's browser timezone, not UTC (Highcharts'
      // default) or the viewer's local zone.
      time: { timezone: 'Asia/Kolkata' },
      chart: { backgroundColor: 'transparent', height: 420 },
      title: { text: undefined },
      credits: { enabled: false },
      rangeSelector: { enabled: false },
      scrollbar: { enabled: false },
      navigator: {
        enabled: candles.length > 30,
        outlineColor: BORDER,
        maskFill: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      },
      xAxis: {
        type: 'datetime',
        lineColor: BORDER, tickColor: BORDER,
        labels: { style: { color: INK3, fontSize: '0.62rem' } },
      },
      yAxis: {
        labels: { style: { color: INK3, fontSize: '0.62rem' } },
        gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
      },
      tooltip: {
        backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
        style: { color: INK, fontSize: '0.68rem' },
        formatter: function () {
          const p = this.point as Highcharts.Point & { open?: number; high?: number; low?: number; close?: number }
          // Use the chart's own Time instance (not the bare Highcharts.dateFormat
          // global) so this respects the IST `time.timezone` set on the chart above.
          const d = this.series.chart.time.dateFormat('%e %b %Y %H:%M', this.x as number)
          return `<b>${d} IST</b><br/>O ${p.open?.toFixed(2)} H ${p.high?.toFixed(2)}<br/>L ${p.low?.toFixed(2)} C ${p.close?.toFixed(2)}`
        },
      },
      series: [{
        type: 'candlestick',
        name: symbol ?? 'NIFTY 50',
        data,
        color: RED, upColor: GREEN, lineColor: RED, upLineColor: GREEN,
      }],
    }
  }, [hist, symbol, INK, INK3, BORDER, mode])

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: CYAN }} />
        <Typography sx={{ ...SANS, fontSize: '0.8rem', fontWeight: 800, color: INK }}>
          {symbol ?? 'NIFTY 50'} Chart
        </Typography>
        {symbol && (
          <Box
            onClick={onClear}
            sx={{ px: 1, py: 0.25, borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}`, '&:hover': { borderColor: CYAN } }}
          >
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>← NIFTY 50</Typography>
          </Box>
        )}
        {loading && <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>loading…</Typography>}
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
        {TF_TABS.map(t => (
          <Box
            key={t.key}
            onClick={() => setTf(t.key)}
            sx={{
              px: 1.1, py: 0.4, borderRadius: 1, cursor: 'pointer',
              bgcolor: tf === t.key ? `${CYAN}20` : 'transparent',
              border: `1px solid ${tf === t.key ? CYAN : BORDER}`,
              transition: 'all 0.15s',
            }}
          >
            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: tf === t.key ? 800 : 600, color: tf === t.key ? CYAN : INK3 }}>
              {t.label}
            </Typography>
          </Box>
        ))}
      </Box>
      {hist?.error ? (
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: RED, py: 2, textAlign: 'center' }}>{hist.error}</Typography>
      ) : !hist?.candles.length && !loading ? (
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, py: 2, textAlign: 'center' }}>No candles for this range.</Typography>
      ) : (
        <HighchartsReact highcharts={Highcharts} constructorType="stockChart" options={options} />
      )}
    </Box>
  )
}

// ── Contributors / Detractors ranked list ─────────────────────────────────────
function ContributorRowItem({ row, maxAbs, positive }: { row: ContributorRow; maxAbs: number; positive: boolean }) {
  const { INK, INK3 } = usePalette()
  const color = positive ? GREEN : RED
  const widthPct = maxAbs > 0 ? (Math.abs(row.points_contribution) / maxAbs) * 100 : 0
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '80px 1fr 64px', gap: 1, alignItems: 'center', py: 0.5 }}>
      <Typography sx={{ ...MONO, fontSize: '0.68rem', fontWeight: 700, color: INK }}>{row.symbol}</Typography>
      <Box sx={{ height: 10, borderRadius: 0.5, bgcolor: `${color}14`, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${widthPct}%`, bgcolor: `${color}88`, transition: 'width 0.4s' }} />
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography sx={{ ...MONO, fontSize: '0.66rem', fontWeight: 700, color }}>
          {row.points_contribution >= 0 ? '+' : ''}{row.points_contribution.toFixed(1)}
        </Typography>
        <Typography sx={{ ...MONO, fontSize: '0.55rem', color: INK3 }}>{pct(row.change_pct)}</Typography>
      </Box>
    </Box>
  )
}

function ContributorsPanel() {
  const { INK3, BORDER } = usePalette()
  const { CARD } = useTokens()
  const [data, setData] = useState<ContributorsResponse | null>(null)

  const load = useCallback(() => {
    nifty50Api.getContributors(10).then(setData).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, CONTRIB_REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const maxAbs = useMemo(() => {
    if (!data) return 1
    const all = [...data.contributors, ...data.detractors].map(r => Math.abs(r.points_contribution))
    return Math.max(...all, 1)
  }, [data])

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead
        title="Contributors & Detractors"
        accent="#6366f1"
        meta={data ? `${data.n_tracked}/${data.n_total} tracked` : ''}
      />
      {!data || data.n_tracked === 0 ? (
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, py: 2, textAlign: 'center' }}>
          Waiting for constituent ticks…
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
          <Box>
            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: GREEN, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.5 }}>
              Top Contributors
            </Typography>
            {data.contributors.map(r => <ContributorRowItem key={r.symbol} row={r} maxAbs={maxAbs} positive />)}
          </Box>
          <Box sx={{ borderLeft: { md: `1px solid ${BORDER}` }, pl: { md: 3 } }}>
            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: RED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.5 }}>
              Top Detractors
            </Typography>
            {data.detractors.map(r => <ContributorRowItem key={r.symbol} row={r} maxAbs={maxAbs} positive={false} />)}
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ── All 50 constituents board (2 internal columns, live off the same websocket) ─
// Clicking a row loads that stock into the chart above (NiftyChartSection).
function StockRow({ row, selected, onClick }: { row: ContributorRow; selected: boolean; onClick: () => void }) {
  const { INK, INK3, CYAN } = usePalette()
  const color = row.change_pct >= 0 ? GREEN : RED
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'grid', gridTemplateColumns: '1fr 52px 44px', gap: 0.5, alignItems: 'baseline',
        py: 0.35, px: 0.5, ml: -0.5, borderRadius: 0.5, cursor: 'pointer',
        bgcolor: selected ? `${CYAN}18` : 'transparent',
        '&:hover': { bgcolor: selected ? `${CYAN}18` : `${CYAN}0C` },
      }}
    >
      <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: selected ? CYAN : INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.symbol}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, textAlign: 'right' }}>{row.ltp.toFixed(1)}</Typography>
      <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color, textAlign: 'right' }}>{pct(row.change_pct, 1)}</Typography>
    </Box>
  )
}

type SortMode = 'weight' | 'return'

function AllStocksBoard({ constituents, wsConnected, selectedSymbol, onSelect }: {
  constituents: ContributorRow[]; wsConnected: boolean
  selectedSymbol: string | null; onSelect: (symbol: string) => void
}) {
  const { INK3, CYAN, BORDER } = usePalette()
  const { CARD } = useTokens()
  const [sortBy, setSortBy] = useState<SortMode>('weight')

  const sorted = useMemo(() => {
    const arr = [...constituents]
    arr.sort((a, b) => sortBy === 'weight' ? b.weight_pct - a.weight_pct : b.change_pct - a.change_pct)
    return arr
  }, [constituents, sortBy])

  // Split into two internal columns down the middle.
  const mid = Math.ceil(sorted.length / 2)
  const colA = sorted.slice(0, mid)
  const colB = sorted.slice(mid)

  return (
    <Box sx={{ ...CARD, p: 1.5, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 800, color: INK3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          All 50 Constituents
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {(['weight', 'return'] as SortMode[]).map(m => (
            <Box
              key={m}
              onClick={() => setSortBy(m)}
              sx={{
                px: 0.75, py: 0.15, borderRadius: 0.75, cursor: 'pointer',
                bgcolor: sortBy === m ? `${CYAN}20` : 'transparent',
                border: `1px solid ${sortBy === m ? CYAN : BORDER}`,
              }}
            >
              <Typography sx={{ ...MONO, fontSize: '0.52rem', fontWeight: sortBy === m ? 800 : 600, color: sortBy === m ? CYAN : INK3, textTransform: 'uppercase' }}>
                {m === 'weight' ? 'Wt' : 'Ret'}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Typography sx={{ ...MONO, fontSize: '0.52rem', color: INK3, mb: 1 }}>
        {constituents.length ? `${constituents.length} live${wsConnected ? '' : ' · reconnecting'}` : 'loading…'}
      </Typography>
      {!constituents.length ? (
        <Typography sx={{ ...SANS, fontSize: '0.66rem', color: INK3, py: 2, textAlign: 'center' }}>
          Waiting for ticks…
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, maxHeight: 470, overflowY: 'auto' }}>
          <Box sx={{ borderRight: `1px solid ${BORDER}`, pr: 1 }}>
            {colA.map(r => (
              <StockRow key={r.symbol} row={r} selected={r.symbol === selectedSymbol} onClick={() => onSelect(r.symbol)} />
            ))}
          </Box>
          <Box>
            {colB.map(r => (
              <StockRow key={r.symbol} row={r} selected={r.symbol === selectedSymbol} onClick={() => onSelect(r.symbol)} />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ── Option chain: expiry selector + ladder ────────────────────────────────────
function StrikeLadder({ chain }: { chain: OIAnalysis }) {
  const { INK, INK3, BORDER, PAPER2 } = usePalette()
  const maxOi = Math.max(...chain.strikes.map(s => Math.max(s.ce_oi, s.pe_oi)), 1)
  return (
    <Box sx={{ mt: 1, maxHeight: 420, overflowY: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 0.5, mb: 0.5, position: 'sticky', top: 0 }}>
        <Typography sx={{ ...SANS, fontSize: '0.55rem', color: INK3, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Call OI (resistance)</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.55rem', color: INK3, textAlign: 'center' }}>Strike</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.55rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Put OI (support)</Typography>
      </Box>
      {chain.strikes.map(s => {
        const isAtm = s.strike === chain.atm_strike
        return (
          <Box key={s.strike} sx={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 0.5, alignItems: 'center', py: 0.25, bgcolor: isAtm ? PAPER2 : 'transparent', borderRadius: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
              <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>{oiFmt(s.ce_oi)}</Typography>
              <Box sx={{ height: 9, width: `${(s.ce_oi / maxOi) * 100}%`, maxWidth: '100%', bgcolor: `${RED}88`, borderRadius: 0.5 }} />
            </Box>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: isAtm ? 800 : 600, color: isAtm ? INK : INK3, textAlign: 'center', border: isAtm ? `1px solid ${BORDER}` : 'none', borderRadius: 0.5 }}>{s.strike}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ height: 9, width: `${(s.pe_oi / maxOi) * 100}%`, maxWidth: '100%', bgcolor: `${GREEN}88`, borderRadius: 0.5 }} />
              <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>{oiFmt(s.pe_oi)}</Typography>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

// ── OI by strike + change-in-OI by strike (column charts) ────────────────────
function OiByStrikeChart({ strikes, title, ceKey, peKey }: {
  strikes: StrikeData[]
  title: string
  ceKey: 'ce_oi' | 'ce_oi_change'
  peKey: 'pe_oi' | 'pe_oi_change'
}) {
  const { INK, INK3, BORDER } = usePalette()
  const { mode } = useThemeMode()
  const hasData = strikes.some(s => s[ceKey] != null || s[peKey] != null)
  const options = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'column', backgroundColor: 'transparent', height: 240, spacing: [6, 2, 6, 2] },
    title: { text: title, align: 'left', style: { color: INK, fontSize: '0.66rem', fontWeight: '700' } },
    credits: { enabled: false },
    legend: { enabled: true, itemStyle: { color: INK3, fontSize: '0.6rem' } },
    xAxis: {
      categories: strikes.map(s => String(s.strike)),
      labels: { style: { color: INK3, fontSize: '0.5rem' }, step: Math.ceil(strikes.length / 12) },
      lineColor: BORDER, tickColor: BORDER,
    },
    yAxis: {
      title: { text: undefined },
      labels: { style: { color: INK3, fontSize: '0.55rem' }, formatter: function () { return oiFmt(this.value as number) } },
      gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
    },
    tooltip: {
      shared: true, backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
      style: { color: INK, fontSize: '0.62rem' },
      formatter: function () {
        const pts = this.points ?? []
        let html = `<span style="font-size:0.6rem">Strike ${this.x}</span><br/>`
        pts.forEach(p => { html += `<span style="color:${p.color}">●</span> ${p.series.name}: <b>${oiFmt(p.y as number)}</b><br/>` })
        return html
      },
    },
    series: [
      { type: 'column', name: 'Call', data: strikes.map(s => (s[ceKey] ?? 0) as number), color: RED },
      { type: 'column', name: 'Put', data: strikes.map(s => (s[peKey] ?? 0) as number), color: GREEN },
    ],
  }), [strikes, title, ceKey, peKey, INK, INK3, BORDER, mode])
  if (!hasData) {
    return (
      <Box sx={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2 }}>
        <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3 }}>
          {title} — no prior-day snapshot yet to diff against. Available from the next ingestion run.
        </Typography>
      </Box>
    )
  }
  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// Shared by OptionChainSection and StrikeChartsSection so both work off the
// same expiry selection and the same 5s-refreshed chain (ATM, strikes list)
// instead of each section fetching its own copy.
function useNiftyOptionChain() {
  const [expiries, setExpiries] = useState<string[]>([])
  const [expiry, setExpiry] = useState<string>('')
  const [chain, setChain] = useState<OIAnalysis | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    nifty50Api.getExpiries().then(list => {
      setExpiries(list)
      if (list.length) setExpiry(prev => prev || list[0])
    }).catch(() => {})
  }, [])

  const load = useCallback(() => {
    if (!expiry) return
    optionsApi.getOIAnalysis('NIFTY', expiry)
      .then(c => { setChain(c); setErr(null) })
      .catch(e => setErr(String(e?.message ?? e)))
  }, [expiry])

  useEffect(() => {
    load()
    const id = setInterval(load, CHAIN_REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  return { expiries, expiry, setExpiry, chain, err }
}

function OptionChainSection({ expiries, expiry, setExpiry, chain, err }: {
  expiries: string[]; expiry: string; setExpiry: (e: string) => void; chain: OIAnalysis | null; err: string | null
}) {
  const { INK, INK2, INK3, PAPER2, BORDER } = usePalette()
  const { CARD, INPUT_SX } = useTokens()

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: '#14b8a6' }} />
        <Typography sx={{ ...SANS, fontSize: '0.8rem', fontWeight: 800, color: INK }}>Option Chain</Typography>
        <FormControl size="small" sx={{ minWidth: 140, ml: 'auto' }}>
          <Select
            value={expiry}
            onChange={e => setExpiry(e.target.value)}
            displayEmpty
            sx={{ ...INPUT_SX, height: 28, fontSize: '0.72rem' }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}
          >
            {expiries.map(e => (
              <MenuItem key={e} value={e} sx={{ fontSize: '0.72rem' }}>{e}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {err && <Typography sx={{ ...SANS, fontSize: '0.72rem', color: RED, mb: 1 }}>{err}</Typography>}

      {!chain ? (
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, py: 2, textAlign: 'center' }}>
          {expiries.length ? 'Loading chain…' : 'No NIFTY option-chain data ingested yet.'}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
          <Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
              <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK2 }}>Spot <b style={{ color: INK }}>{chain.spot.toFixed(2)}</b></Typography>
              <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK2 }}>ATM <b style={{ color: INK }}>{chain.atm_strike}</b></Typography>
              <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK2 }}>PCR <b style={{ color: INK }}>{chain.pcr?.toFixed(2) ?? '—'}</b></Typography>
              <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK2 }}>Max Pain <b style={{ color: INK }}>{chain.max_pain}</b></Typography>
            </Box>
            <StrikeLadder chain={chain} />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <OiByStrikeChart strikes={chain.strikes} title="Open Interest by Strike" ceKey="ce_oi" peKey="pe_oi" />
            <OiByStrikeChart strikes={chain.strikes} title="Change in OI by Strike" ceKey="ce_oi_change" peKey="pe_oi_change" />
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ── ATM ±3 intraday price-vs-OI charts (7 Call charts + 7 Put charts) ────────
const STRIKE_CHART_REFRESH_MS = 30_000   // backend caches each strike per-minute; polling every 5s would be wasted requests

function useAtmWindowStrikes(chain: OIAnalysis | null): { strike: number; offset: number }[] {
  return useMemo(() => {
    if (!chain) return []
    const sorted = [...chain.strikes].map(s => s.strike).sort((a, b) => a - b)
    let atmIdx = 0
    let best = Infinity
    sorted.forEach((s, i) => {
      const d = Math.abs(s - chain.atm_strike)
      if (d < best) { best = d; atmIdx = i }
    })
    const lo = Math.max(0, atmIdx - 3)
    const hi = Math.min(sorted.length, atmIdx + 4)
    return sorted.slice(lo, hi).map((strike, i) => ({ strike, offset: (lo + i) - atmIdx }))
  }, [chain])
}

function StrikeOIChart({ strike, offset, data, leg, mode }: {
  strike: number; offset: number; data: StrikeChartResponse | undefined; leg: 'ce' | 'pe'; mode: 'dark' | 'light'
}) {
  const { INK, INK3, BORDER } = usePalette()
  const isAtm = offset === 0
  const price = leg === 'ce' ? data?.ce ?? [] : data?.pe ?? []
  const oi = leg === 'ce' ? data?.ce_oi ?? [] : data?.pe_oi ?? []
  const priceColor = leg === 'ce' ? GREEN : RED
  const oiColor = leg === 'ce' ? '#f59e0b' : '#a78bfa'

  const options = useMemo<Highcharts.Options>(() => {
    const cats = price.map(p => p.time)
    const oiMap = new Map(oi.map(o => [o.time, o.value]))
    const oiData = cats.map(t => (oiMap.has(t) ? oiMap.get(t)! : null))
    return {
      chart: { backgroundColor: 'transparent', height: 180, spacing: [6, 2, 6, 2] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        categories: cats,
        labels: { style: { color: INK3, fontSize: '0.5rem' }, step: Math.ceil(Math.max(cats.length, 1) / 6) },
        lineColor: BORDER, tickColor: BORDER,
      },
      yAxis: [
        { title: { text: undefined }, labels: { style: { color: priceColor, fontSize: '0.52rem' } }, gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7' },
        { title: { text: undefined }, opposite: true, labels: { style: { color: oiColor, fontSize: '0.52rem' }, formatter: function () { return oiFmt(this.value as number) } }, gridLineWidth: 0 },
      ],
      tooltip: { shared: true, backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER, style: { color: INK, fontSize: '0.62rem' } },
      series: [
        { type: 'line', name: 'Price', data: price.map(p => p.value), color: priceColor, lineWidth: 1.5, marker: { enabled: false }, yAxis: 0 },
        { type: 'line', name: 'OI', data: oiData as number[], color: oiColor, lineWidth: 1.5, step: 'left', marker: { enabled: false }, yAxis: 1, connectNulls: true, dashStyle: 'ShortDot' },
      ],
    }
  }, [price, oi, priceColor, oiColor, mode, INK, INK3, BORDER])

  return (
    <Box sx={{ border: `1px solid ${isAtm ? priceColor : BORDER}`, borderRadius: 1, p: 0.5 }}>
      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: isAtm ? 800 : 600, color: isAtm ? INK : INK3, px: 0.5 }}>
        {strike} {isAtm ? '(ATM)' : offset > 0 ? `ATM+${offset}` : `ATM${offset}`}
      </Typography>
      {!price.length ? (
        <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, textAlign: 'center', py: 3 }}>No data</Typography>
      ) : (
        <HighchartsReact highcharts={Highcharts} options={options} />
      )}
    </Box>
  )
}

function StrikeChartsSection({ chain, expiry }: { chain: OIAnalysis | null; expiry: string }) {
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const strikes = useAtmWindowStrikes(chain)
  const [charts, setCharts] = useState<Record<number, StrikeChartResponse>>({})

  const load = useCallback(() => {
    if (!expiry || !strikes.length) return
    Promise.all(
      strikes.map(({ strike }) =>
        fnoApi.getStrikeChart('NIFTY', strike, expiry).then(c => [strike, c] as const).catch(() => null)
      )
    ).then(results => {
      setCharts(prev => {
        const next = { ...prev }
        for (const r of results) if (r) next[r[0]] = r[1]
        return next
      })
    })
  }, [strikes, expiry])

  useEffect(() => {
    load()
    const id = setInterval(load, STRIKE_CHART_REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  if (!chain || !strikes.length) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ ...CARD, p: 2 }}>
        <SectionHead title="Call — Price vs Open Interest (ATM ±3)" accent={GREEN} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr 1fr' }, gap: 1.5 }}>
          {strikes.map(({ strike, offset }) => (
            <StrikeOIChart key={strike} strike={strike} offset={offset} data={charts[strike]} leg="ce" mode={mode} />
          ))}
        </Box>
      </Box>
      <Box sx={{ ...CARD, p: 2 }}>
        <SectionHead title="Put — Price vs Open Interest (ATM ±3)" accent={RED} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr 1fr' }, gap: 1.5 }}>
          {strikes.map(({ strike, offset }) => (
            <StrikeOIChart key={strike} strike={strike} offset={offset} data={charts[strike]} leg="pe" mode={mode} />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ── Top gainers/losers across 6 lookback periods (bar charts) ────────────────
const MOVERS_REFRESH_MS = 30_000   // 5 of 6 legs are EOD-cached server-side per day; 'daily' rides live ticks
const MOVERS_PERIODS: { key: MoversPeriod; label: string }[] = [
  { key: 'daily',  label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: '1m',     label: '1 Month' },
  { key: '3m',     label: '3 Month' },
  { key: 'ytd',    label: 'YTD' },
  { key: '12m',    label: '12 Month' },
]

function MoversBarChart({ label, data, mode }: { label: string; data: PeriodMovers | undefined; mode: 'dark' | 'light' }) {
  const { INK, INK3, BORDER } = usePalette()
  const { CARD } = useTokens()

  const rows = useMemo(() => {
    if (!data) return []
    // Ascending by change_pct: bar charts render the last category at the top,
    // so this puts the biggest gainer at the top and biggest loser at the bottom.
    return [...data.losers, ...data.gainers].sort((a, b) => a.change_pct - b.change_pct)
  }, [data])

  const options = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'bar', backgroundColor: 'transparent', height: 280, spacing: [6, 10, 6, 2] },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      categories: rows.map(r => r.symbol),
      labels: { style: { color: INK3, fontSize: '0.6rem' } },
      lineColor: BORDER, tickColor: BORDER,
    },
    yAxis: {
      title: { text: undefined },
      labels: { style: { color: INK3, fontSize: '0.58rem' }, formatter: function () { return `${this.value}%` } },
      gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
      style: { color: INK, fontSize: '0.66rem' },
      formatter: function () { return `<b>${this.point.name}</b><br/>${pct(this.y as number)}` },
    },
    plotOptions: { bar: { borderWidth: 0, pointPadding: 0.15, groupPadding: 0.08 } },
    series: [{
      type: 'bar',
      name: 'Change %',
      data: rows.map(r => ({ name: r.symbol, y: r.change_pct, color: r.change_pct >= 0 ? GREEN : RED })),
      dataLabels: {
        enabled: true, inside: false,
        formatter: function () { return pct(this.y as number) },
        style: { color: INK, fontSize: '0.6rem', fontWeight: '700', textOutline: 'none' },
      },
    }],
  }), [rows, mode, INK, INK3, BORDER])

  return (
    <Box sx={{ ...CARD, p: 1.5 }}>
      <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 800, color: INK, mb: 0.5 }}>{label}</Typography>
      {!data ? (
        <Typography sx={{ ...SANS, fontSize: '0.66rem', color: INK3, py: 4, textAlign: 'center' }}>Loading…</Typography>
      ) : !rows.length ? (
        <Typography sx={{ ...SANS, fontSize: '0.66rem', color: INK3, py: 4, textAlign: 'center' }}>No data for this period.</Typography>
      ) : (
        <HighchartsReact highcharts={Highcharts} options={options} />
      )}
    </Box>
  )
}

function MoversSection() {
  const { mode } = useThemeMode()
  const { CARD } = useTokens()
  const [movers, setMovers] = useState<MoversResponse | null>(null)

  useEffect(() => {
    const load = () => nifty50Api.getMovers().then(setMovers).catch(() => {})
    load()
    const id = setInterval(load, MOVERS_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead title="Top Gainers & Losers" accent="#f59e0b" meta={movers ? `${movers.n_tracked} tracked` : ''} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1.5 }}>
        {MOVERS_PERIODS.map(p => (
          <MoversBarChart key={p.key} label={p.label} data={movers?.periods?.[p.key]} mode={mode} />
        ))}
      </Box>
    </Box>
  )
}

// ── Sector heatmap (Nifty 50 scope, reuses sector_heatmap_service) ───────────
const SECTOR_HEATMAP_REFRESH_MS = 60_000

function alphaHex(a: number): string {
  return Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
}

function SectorTile({ sector }: { sector: SectorHeatmapResponse['sectors'][number] }) {
  const { INK, INK3, BORDER } = usePalette()
  const score = sector.momentum_score
  const color = score >= 0 ? GREEN : RED
  const bg = `${color}${alphaHex(0.08 + Math.min(1, Math.abs(score) / 5) * 0.3)}`
  const ret1d = sector.returns['1d'] ?? 0
  return (
    <Box sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${BORDER}`, bgcolor: bg }}>
      <Typography sx={{ ...SANS, fontSize: '0.64rem', fontWeight: 700, color: INK, mb: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {sector.name}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '0.9rem', fontWeight: 800, color }}>{pct(ret1d, 1)}</Typography>
      <Typography sx={{ ...MONO, fontSize: '0.54rem', color: INK3, mt: 0.25 }}>momentum {score.toFixed(1)}</Typography>
    </Box>
  )
}

function SectorHeatmapStrip() {
  const { INK3 } = usePalette()
  const { CARD } = useTokens()
  const [data, setData] = useState<SectorHeatmapResponse | null>(null)

  useEffect(() => {
    const load = () => sectorHeatmapApi.getHeatmap('nifty50').then(setData).catch(() => {})
    load()
    const id = setInterval(load, SECTOR_HEATMAP_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data.sectors].sort((a, b) => b.momentum_score - a.momentum_score)
  }, [data])

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead title="Sector Heatmap (Nifty 50)" accent="#8b5cf6" meta={data ? `as of ${data.as_of}` : ''} />
      {!sorted.length ? (
        <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, py: 3, textAlign: 'center' }}>Loading…</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr', lg: 'repeat(6, 1fr)' }, gap: 1 }}>
          {sorted.map(s => <SectorTile key={s.name} sector={s} />)}
        </Box>
      )}
    </Box>
  )
}

// ── PCR / Max Pain intraday trend (accumulates as the chain refreshes) ───────
const PCR_HISTORY_REFRESH_MS = 30_000

function PcrTrendChart({ expiry }: { expiry: string }) {
  const { INK, INK3, BORDER, CYAN } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const [points, setPoints] = useState<PcrPoint[]>([])
  const [marketOpen, setMarketOpen] = useState(true)

  useEffect(() => {
    if (!expiry) return
    const load = () => nifty50Api.getPcrHistory(expiry).then(r => {
      setPoints(r.points)
      setMarketOpen(r.market_open)
    }).catch(() => {})
    load()
    const id = setInterval(load, PCR_HISTORY_REFRESH_MS)
    return () => clearInterval(id)
  }, [expiry])

  const options = useMemo<Highcharts.Options>(() => {
    // Same fixed 09:15->15:30 grid as the Adv/Dec chart -- when multiple
    // snapshots land in the same minute (30s poll cadence), the later one wins.
    const byMinute = new Map(points.map(p => [p.time.slice(0, 5), p]))
    const cats = SESSION_MINUTES
    const pcrData = cats.map(t => byMinute.get(t)?.pcr ?? null)
    const maxPainData = cats.map(t => byMinute.get(t)?.max_pain ?? null)
    const spotData = cats.map(t => byMinute.get(t)?.spot ?? null)
    return {
      chart: { backgroundColor: 'transparent', height: 240, spacing: [6, 10, 6, 2] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: true, itemStyle: { color: INK3, fontSize: '0.62rem' } },
      xAxis: {
        categories: cats,
        labels: { style: { color: INK3, fontSize: '0.56rem' }, step: Math.ceil(cats.length / 8) },
        lineColor: BORDER, tickColor: BORDER,
      },
      yAxis: [
        { title: { text: 'PCR' }, labels: { style: { color: CYAN, fontSize: '0.56rem' } }, gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7' },
        { title: { text: 'Max Pain / Spot' }, opposite: true, labels: { style: { color: '#f59e0b', fontSize: '0.56rem' } }, gridLineWidth: 0 },
      ],
      tooltip: { shared: true, backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER, style: { color: INK, fontSize: '0.64rem' } },
      series: [
        { type: 'line', name: 'PCR', data: pcrData, color: CYAN, lineWidth: 1.5, marker: { enabled: false }, connectNulls: true, yAxis: 0 },
        { type: 'line', name: 'Max Pain', data: maxPainData, color: '#f59e0b', lineWidth: 1.5, step: 'left', dashStyle: 'ShortDot', marker: { enabled: false }, connectNulls: true, yAxis: 1 },
        { type: 'line', name: 'Spot', data: spotData, color: INK, lineWidth: 1, marker: { enabled: false }, connectNulls: true, yAxis: 1 },
      ],
    }
  }, [points, mode, INK, INK3, BORDER, CYAN])

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <SectionHead
        title={`PCR & Max Pain Trend — 9:15 to ${marketOpen ? 'live' : '3:30'}`}
        accent="#f59e0b"
        meta={points.length ? `${points.length} snapshots today` : ''}
      />
      {!points.length ? (
        <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, py: 3, textAlign: 'center' }}>
          {marketOpen
            ? 'No snapshots yet today — this builds up as the option chain refreshes (new ingestion or live update).'
            : 'No snapshots recorded today.'}
        </Typography>
      ) : (
        <HighchartsReact highcharts={Highcharts} options={options} />
      )}
    </Box>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Nifty50LivePage() {
  const { INK, INK2, INK3, CYAN, BG, BORDER } = usePalette()
  const { mode } = useThemeMode()
  const { tick, constituents, wsConnected } = useNiftyTicker()
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const optionChain = useNiftyOptionChain()

  const changeColor = (tick?.change ?? 0) >= 0 ? GREEN : RED

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        px: { xs: 2, md: 4 }, pt: 4, pb: 3,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: CYAN, letterSpacing: '0.18em', textTransform: 'uppercase' }}>● Nifty 50 Live</Typography>
          <LiveBadge wsConnected={wsConnected} tick={tick} />
        </Box>
        <Typography
          onClick={() => setSelectedSymbol(null)}
          sx={{ ...SANS, fontSize: { xs: '1.6rem', md: '2.1rem' }, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1, cursor: 'pointer', width: 'fit-content' }}
        >
          Nifty 50 <Box component="span" sx={{ color: CYAN }}>Live</Box>
        </Typography>
        <Box
          onClick={() => setSelectedSymbol(null)}
          sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mt: 1.5, flexWrap: 'wrap', cursor: 'pointer', width: 'fit-content', '&:hover': { opacity: 0.85 } }}
        >
          <Typography sx={{ ...MONO, fontSize: { xs: '2rem', md: '2.6rem' }, fontWeight: 800, color: INK, lineHeight: 1 }}>
            {tick ? tick.ltp.toFixed(2) : '—'}
          </Typography>
          {tick && (
            <Typography sx={{ ...MONO, fontSize: '1rem', fontWeight: 700, color: changeColor }}>
              {tick.change >= 0 ? '+' : ''}{tick.change.toFixed(2)} ({pct(tick.change_pct)})
            </Typography>
          )}
          {selectedSymbol && (
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: CYAN, letterSpacing: '0.06em' }}>
              ← click to chart NIFTY 50
            </Typography>
          )}
        </Box>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, maxWidth: 640, mt: 1 }}>
          Live index tick via a persistent Kite WebSocket, index contributors/detractors,
          and the NIFTY option chain across the next weekly expiries. Research/monitoring
          view — no order placement.
        </Typography>
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, py: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={8}>
            <NiftyChartSection symbol={selectedSymbol} onClear={() => setSelectedSymbol(null)} />
          </Grid>
          <Grid item xs={12} lg={4}>
            <AllStocksBoard
              constituents={constituents} wsConnected={wsConnected}
              selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol}
            />
          </Grid>
        </Grid>
        <BreadthStrip />
        <VixSection />
        <ContributorsPanel />
        <SectorHeatmapStrip />
        <OptionChainSection
          expiries={optionChain.expiries} expiry={optionChain.expiry} setExpiry={optionChain.setExpiry}
          chain={optionChain.chain} err={optionChain.err}
        />
        <PcrTrendChart expiry={optionChain.expiry} />
        <StrikeChartsSection chain={optionChain.chain} expiry={optionChain.expiry} />
        <MoversSection />
      </Box>

      <Footer />
    </Box>
  )
}
