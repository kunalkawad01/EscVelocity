import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Grid, Typography, TextField, IconButton, Collapse } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { fnoApi } from '../api/fnoApi'
import type {
  MarketState, FnoUniverseResponse, FnoUniverseRow, BreadthVerdict,
  NormalizedSeries, OptionChainResponse, StrikeChartResponse, Quadrant, Verdict,
  FnoToolCall,
} from '../types/fno'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const REFRESH_MS = 5_000

const QUAD_COLOR: Record<Quadrant, string> = {
  LONG_BUILDUP:   '#22c55e',
  SHORT_COVERING: '#86efac',
  SHORT_BUILDUP:  '#ef4444',
  LONG_UNWINDING: '#fca5a5',
}
const QUAD_LABEL: Record<Quadrant, string> = {
  LONG_BUILDUP:   'Long Buildup',
  SHORT_COVERING: 'Short Covering',
  SHORT_BUILDUP:  'Short Buildup',
  LONG_UNWINDING: 'Long Unwinding',
}
const VERDICT_COLOR: Record<Verdict, string> = {
  RISK_ON:  '#22c55e',
  RISK_OFF: '#ef4444',
  NEUTRAL:  '#fbbf24',
}
const GREEN = '#22c55e'
const RED = '#ef4444'

// ── Helpers ───────────────────────────────────────────────────────────────────
const pct = (v: number | null | undefined, dp = 2) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(dp) + '%'
const num = (v: number | null | undefined, dp = 2) => (v == null ? '—' : v.toFixed(dp))
const oiFmt = (v: number | null | undefined) => {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e7) return (v / 1e7).toFixed(2) + 'Cr'
  if (Math.abs(v) >= 1e5) return (v / 1e5).toFixed(2) + 'L'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

// ── State pill (invariant: never render a frame without state + session date) ──
function StatePill({ state, loading }: { state: MarketState | null; loading: boolean }) {
  const { CYAN, INK3 } = usePalette()
  if (!state) {
    return (
      <Box sx={{ px: 1.5, py: 0.4, borderRadius: 1, bgcolor: `${CYAN}18`, border: `1px solid ${CYAN}30`, display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: CYAN, letterSpacing: '0.1em' }}>CONNECTING…</Typography>
      </Box>
    )
  }
  const isLive = state.is_live
  const color = loading ? CYAN : isLive ? GREEN : state.state === 'PRE_OPEN' || state.state === 'PRE_PRECOMPUTE' ? '#fbbf24' : INK3
  return (
    <Box sx={{ px: 1.5, py: 0.4, borderRadius: 1, bgcolor: `${color}18`, border: `1px solid ${color}35`, display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, animation: isLive ? 'pulse 1.6s ease-in-out infinite' : 'none', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } } }} />
      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color, letterSpacing: '0.08em' }}>
        {state.label}
      </Typography>
    </Box>
  )
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

// ── Zone 0 — Breadth gate ─────────────────────────────────────────────────────
function BreadthGate({ b, disabled }: { b: BreadthVerdict | null; disabled: boolean }) {
  const { INK, INK2, INK3, PAPER2, BORDER } = usePalette()
  const { CARD } = useTokens()
  const color = b ? VERDICT_COLOR[b.verdict] : INK3
  const Metric = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <Box sx={{ px: 2, py: 0.5, borderLeft: `1px solid ${BORDER}` }}>
      <Typography sx={{ ...SANS, fontSize: '0.58rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</Typography>
      <Typography sx={{ ...MONO, fontSize: '0.9rem', fontWeight: 700, color: INK }}>{value}</Typography>
      {sub && <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3 }}>{sub}</Typography>}
    </Box>
  )
  return (
    <Box sx={{ ...CARD, p: 1.5, mb: 2.5, opacity: disabled ? 0.5 : 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, bgcolor: PAPER2 }}>
      <Box sx={{ px: 2, py: 0.75, borderRadius: 1.5, bgcolor: `${color}1A`, border: `1px solid ${color}45`, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color }} />
        <Typography sx={{ ...SANS, fontSize: '0.9rem', fontWeight: 800, color, letterSpacing: '0.04em' }}>
          {b ? b.verdict.replace('_', '-') : 'BREADTH'}
        </Typography>
      </Box>
      <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, mr: 1, maxWidth: 260 }}>{b?.rationale ?? (disabled ? 'Session-only — market not live' : '')}</Typography>
      {b && <>
        <Metric label="% Above VWAP" value={b.pct_above_vwap == null ? '—' : b.pct_above_vwap.toFixed(0) + '%'} />
        <Metric label="Adv / Decl" value={b.adv_decl.toFixed(2)} sub={`${b.advances} up · ${b.declines} down`} />
        <Metric label="Nifty from 9:15" value={pct(b.nifty_from_0915)} />
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, pr: 1 }}>
          <Chip on={b.longs_enabled} label="LONGS" color={GREEN} />
          <Chip on={b.shorts_enabled} label="SHORTS" color={RED} />
        </Box>
      </>}
    </Box>
  )
}
function Chip({ on, label, color }: { on: boolean; label: string; color: string }) {
  const { INK3 } = usePalette()
  return (
    <Box sx={{ px: 1, py: 0.3, borderRadius: 1, border: `1px solid ${on ? color + '55' : INK3 + '30'}`, bgcolor: on ? `${color}18` : 'transparent' }}>
      <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: on ? color : INK3, letterSpacing: '0.06em' }}>
        {on ? '● ' : '○ '}{label}
      </Typography>
    </Box>
  )
}

// ── Zone 1 — Positioning scatter ──────────────────────────────────────────────
function PositioningScatter({ rows, onPick, mode }: { rows: FnoUniverseRow[]; onPick: (s: string) => void; mode: 'dark' | 'light' }) {
  const { INK, INK3, BORDER, CYAN } = usePalette()
  const options = useMemo<Highcharts.Options>(() => {
    // One series per quadrant → the native Highcharts legend is clickable
    // (click to hide/show, like Plotly). Only quadrants with points appear.
    const grouped: Record<Quadrant, any[]> = {
      LONG_BUILDUP: [], SHORT_COVERING: [], SHORT_BUILDUP: [], LONG_UNWINDING: [],
    }
    rows.forEach(r => {
      if (!r.quadrant) return
      grouped[r.quadrant as Quadrant].push({
        x: r.oi_chg_pct, y: r.ret_pct, name: r.symbol,
        marker: { radius: 6, fillColor: `${QUAD_COLOR[r.quadrant as Quadrant]}CC`, lineColor: QUAD_COLOR[r.quadrant as Quadrant], lineWidth: 1 },
        custom: r,
      })
    })
    const series: Highcharts.SeriesOptionsType[] = (Object.keys(QUAD_COLOR) as Quadrant[])
      .filter(q => grouped[q].length > 0)
      .map(q => ({
        type: 'scatter', name: `${QUAD_LABEL[q]} (${grouped[q].length})`,
        color: QUAD_COLOR[q], data: grouped[q], dataLabels: { enabled: false },
      }))
    const axisColor = mode === 'dark' ? '#334155' : '#cbd5e1'
    return {
      chart: { type: 'scatter', backgroundColor: 'transparent', height: 380, zooming: { type: 'xy' } },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        enabled: true, align: 'center', verticalAlign: 'top', margin: 12,
        itemStyle: { color: INK3, fontSize: '0.62rem', fontWeight: '600' },
        itemHoverStyle: { color: INK },
        itemHiddenStyle: { color: mode === 'dark' ? '#475569' : '#cbd5e1' },
      },
      xAxis: {
        title: { text: 'OI change (%)', style: { color: INK3, fontSize: '0.62rem' } },
        gridLineWidth: 0, lineColor: BORDER, tickColor: BORDER,
        labels: { style: { color: INK3, fontSize: '0.6rem' } },
        plotLines: [{ value: 0, color: axisColor, width: 1, dashStyle: 'Dash', zIndex: 2 }],
      },
      yAxis: {
        title: { text: 'Intraday return from 9:15 (%)', style: { color: INK3, fontSize: '0.62rem' } },
        gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
        labels: { style: { color: INK3, fontSize: '0.6rem' } },
        plotLines: [{ value: 0, color: axisColor, width: 1, dashStyle: 'Dash', zIndex: 2 }],
      },
      tooltip: {
        useHTML: true,
        backgroundColor: mode === 'dark' ? '#0B1020' : '#ffffff',
        borderColor: BORDER, style: { color: INK, fontSize: '0.68rem' },
        formatter: function (this: any) {
          const r: FnoUniverseRow = this.point.custom
          const g = r.grade
          return `<b>${r.symbol}</b> · ${r.trend}<br/>
            ${QUAD_LABEL[r.quadrant as Quadrant]}<br/>
            OIΔ ${pct(r.oi_chg_pct)}<br/>
            Ret ${pct(r.ret_pct)} · ${num(r.ret_per_atr)} ATR<br/>
            ${g.grade !== 'NONE' ? `<b style="color:${g.direction === 'long' ? GREEN : RED}">${g.grade}-grade ${g.direction} (${g.size})</b>` : '<span style="opacity:.6">no signal</span>'}`
        },
      },
      plotOptions: {
        scatter: {
          cursor: 'pointer',
          point: { events: { click: function (this: any) { onPick(this.name) } } },
          states: { hover: { halo: { size: 6 } } },
        },
      },
      series,
    }
  }, [rows, mode, INK, INK3, BORDER, CYAN, onPick])

  const hasData = rows.some(r => r.quadrant)

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        {!hasData && (
          <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3 }}>No positioning data yet</Typography>
        )}
        <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, ml: 'auto', fontStyle: 'italic' }}>click legend to toggle</Typography>
      </Box>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </>
  )
}

// ── Zone 2 — Normalized 9:15 lines ────────────────────────────────────────────
function NormalizedLines({ data, mode }: { data: NormalizedSeries | null; mode: 'dark' | 'light' }) {
  const { INK, INK3, BORDER } = usePalette()
  const options = useMemo<Highcharts.Options>(() => {
    const series: Highcharts.SeriesOptionsType[] = []
    const palette = ['#60a5fa', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#22d3ee', '#fb923c', '#4ade80']
    let ci = 0
    Object.entries(data?.series ?? {}).forEach(([name, vals]) => {
      const isNifty = name === 'NIFTY'
      const isSector = name === 'SECTOR'
      series.push({
        type: 'line', name, data: vals,
        color: isNifty ? (mode === 'dark' ? '#e2e8f0' : '#0f172a') : isSector ? '#94a3b8' : palette[ci++ % palette.length],
        lineWidth: isNifty ? 2.5 : isSector ? 1.5 : 1.25,
        dashStyle: isSector ? 'ShortDash' : 'Solid',
        marker: { enabled: false }, zIndex: isNifty ? 5 : isSector ? 4 : 1,
      })
    })
    return {
      chart: { backgroundColor: 'transparent', height: 300 },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: true, itemStyle: { color: INK3, fontSize: '0.6rem' }, itemHoverStyle: { color: INK } },
      xAxis: { categories: data?.times ?? [], labels: { style: { color: INK3, fontSize: '0.55rem' }, step: Math.ceil((data?.times.length ?? 1) / 8) }, lineColor: BORDER, tickColor: BORDER },
      yAxis: {
        title: { text: '% from 9:15', style: { color: INK3, fontSize: '0.6rem' } },
        gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
        labels: { style: { color: INK3, fontSize: '0.58rem' }, format: '{value}%' },
        plotLines: [{ value: 0, color: mode === 'dark' ? '#334155' : '#cbd5e1', width: 1 }],
      },
      tooltip: { shared: false, backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER, style: { color: INK, fontSize: '0.66rem' }, valueSuffix: '%', valueDecimals: 2 },
      series,
    }
  }, [data, mode, INK, INK3, BORDER])

  if (!data || data.times.length === 0) {
    return <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, py: 4, textAlign: 'center' }}>
      {data?.note ?? 'Normalized lines populate from live 9:15 ticks during market hours.'}
    </Typography>
  }
  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Zone 3 — dual-axis price + OI (OI = step-line; Kite OI steps, price streams) ─
function OIChart({ title, price, oi, priceColor, oiColor, mode }: {
  title: string; price: { time: string; value: number }[]; oi: { time: string; value: number }[]; priceColor: string; oiColor: string; mode: 'dark' | 'light'
}) {
  const { INK, INK3, BORDER } = usePalette()
  const options = useMemo<Highcharts.Options>(() => {
    const cats = price.map(p => p.time)
    const oiMap = new Map(oi.map(o => [o.time, o.value]))
    const oiData = cats.map(t => (oiMap.has(t) ? oiMap.get(t)! : null))
    return {
      chart: { backgroundColor: 'transparent', height: 180, spacing: [6, 2, 6, 2] },
      title: { text: title, align: 'left', style: { color: INK, fontSize: '0.66rem', fontWeight: '700' } },
      credits: { enabled: false }, legend: { enabled: false },
      xAxis: { categories: cats, labels: { style: { color: INK3, fontSize: '0.5rem' }, step: Math.ceil(Math.max(cats.length, 1) / 6) }, lineColor: BORDER, tickColor: BORDER },
      yAxis: [
        { title: { text: undefined }, labels: { style: { color: priceColor, fontSize: '0.52rem' } }, gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7' },
        { title: { text: undefined }, opposite: true, labels: { style: { color: oiColor, fontSize: '0.52rem' }, formatter: function (this: any) { return oiFmt(this.value) } }, gridLineWidth: 0 },
      ],
      tooltip: { shared: true, backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER, style: { color: INK, fontSize: '0.62rem' } },
      series: [
        { type: 'line', name: 'Price', data: price.map(p => p.value), color: priceColor, lineWidth: 1.5, marker: { enabled: false }, yAxis: 0 },
        { type: 'line', name: 'OI', data: oiData as number[], color: oiColor, lineWidth: 1.5, step: 'left', marker: { enabled: false }, yAxis: 1, connectNulls: true, dashStyle: 'ShortDot' },
      ],
    }
  }, [title, price, oi, priceColor, oiColor, mode, INK, INK3, BORDER])
  return <HighchartsReact highcharts={Highcharts} options={options} />
}

function StrikeLadder({ chain }: { chain: OptionChainResponse }) {
  const { INK, INK3, BORDER, PAPER2 } = usePalette()
  const maxOi = Math.max(...chain.strikes.map(s => Math.max(s.ce_oi, s.pe_oi)), 1)
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 0.5, mb: 0.5 }}>
        <Typography sx={{ ...SANS, fontSize: '0.55rem', color: INK3, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Call OI (resistance)</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.55rem', color: INK3, textAlign: 'center' }}>Strike</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.55rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Put OI (support)</Typography>
      </Box>
      {chain.strikes.map(s => (
        <Box key={s.strike} sx={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 0.5, alignItems: 'center', py: 0.25, bgcolor: s.is_atm ? PAPER2 : 'transparent', borderRadius: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>{oiFmt(s.ce_oi)}</Typography>
            <Box sx={{ height: 9, width: `${(s.ce_oi / maxOi) * 100}%`, maxWidth: '100%', bgcolor: `${RED}88`, borderRadius: 0.5 }} />
          </Box>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: s.is_atm ? 800 : 600, color: s.is_atm ? INK : INK3, textAlign: 'center', border: s.is_atm ? `1px solid ${BORDER}` : 'none', borderRadius: 0.5 }}>{s.strike}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ height: 9, width: `${(s.pe_oi / maxOi) * 100}%`, maxWidth: '100%', bgcolor: `${GREEN}88`, borderRadius: 0.5 }} />
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>{oiFmt(s.pe_oi)}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function OptionChainPanel({ symbol, live, mode, onClose }: { symbol: string | null; live: boolean; mode: 'dark' | 'light'; onClose: () => void }) {
  const { INK, INK2, INK3, CYAN, BORDER } = usePalette()
  const { CARD } = useTokens()
  const [chain, setChain] = useState<OptionChainResponse | null>(null)
  const [chart, setChart] = useState<StrikeChartResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (sym: string) => {
    try {
      const c = await fnoApi.getOptionChain(sym)
      setChain(c)
      setErr(null)
      if (c.is_fo && c.atm_strike != null && c.expiry) {
        const sc = await fnoApi.getStrikeChart(sym, c.atm_strike, c.expiry)
        setChart(sc)
      } else {
        setChart(null)
      }
    } catch (e: any) { setErr(String(e?.message ?? e)) }
  }, [])

  useEffect(() => {
    if (!symbol) { setChain(null); setChart(null); return }
    load(symbol)
    if (!live) return
    const id = setInterval(() => load(symbol), REFRESH_MS)
    return () => clearInterval(id)
  }, [symbol, live, load])

  if (!symbol) {
    return (
      <Box sx={{ ...CARD, p: 3, textAlign: 'center' }}>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', fontWeight: 700, color: INK, mb: 1 }}>Option Chain</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>Click a bubble in the scatter to load its live option chain — ATM ±3 strikes with Future / Call / Put price-vs-OI.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ ...CARD, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography sx={{ ...MONO, fontSize: '0.95rem', fontWeight: 800, color: INK }}>{symbol}</Typography>
        {chain?.expiry && <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, ml: 1 }}>exp {chain.expiry}</Typography>}
        <Box component="button" onClick={onClose} sx={{ ml: 'auto', background: 'none', border: `1px solid ${BORDER}`, borderRadius: 1, color: INK3, cursor: 'pointer', px: 1, py: 0.25, fontSize: '0.7rem', '&:hover': { color: INK } }}>✕</Box>
      </Box>

      {!live && (
        <Typography sx={{ ...SANS, fontSize: '0.68rem', color: '#fbbf24', mb: 1 }}>Live option chain available during market hours — showing last available.</Typography>
      )}
      {err && <Typography sx={{ ...SANS, fontSize: '0.7rem', color: RED }}>{err}</Typography>}
      {chain && !chain.is_fo && <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>No F&O contracts for {symbol}.</Typography>}

      {chain?.is_fo && (
        <>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
            <Stat label="Spot" value={num(chain.spot)} />
            <Stat label="ATM" value={num(chain.atm_strike, 0)} />
            <Stat label="Straddle" value={num(chain.straddle)} />
            <Stat label="PCR" value={num(chain.total_pcr)} />
            <Stat label="Range" value={`${num(chain.lower_be, 0)}–${num(chain.upper_be, 0)}`} />
          </Box>
          {chart && (
            <Box sx={{ borderTop: `1px solid ${BORDER}`, pt: 0.5 }}>
              <OIChart title="Future — price vs OI (step)" price={chart.futures} oi={chart.futures_oi} priceColor={mode === 'dark' ? '#e2e8f0' : '#0f172a'} oiColor={CYAN} mode={mode} />
              <OIChart title="Call — price vs OI (writing = OI↑ price↓)" price={chart.ce} oi={chart.ce_oi} priceColor={GREEN} oiColor="#f59e0b" mode={mode} />
              <OIChart title="Put — price vs OI (writing = OI↑ price↓)" price={chart.pe} oi={chart.pe_oi} priceColor={RED} oiColor="#a78bfa" mode={mode} />
            </Box>
          )}
          <StrikeLadder chain={chain} />
        </>
      )}
    </Box>
  )
}
function Stat({ label, value }: { label: string; value: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box>
      <Typography sx={{ ...SANS, fontSize: '0.55rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</Typography>
      <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 700, color: INK }}>{value}</Typography>
    </Box>
  )
}

// ── Graded signals table ──────────────────────────────────────────────────────
function GradedSignals({ rows, onPick }: { rows: FnoUniverseRow[]; onPick: (s: string) => void }) {
  const { INK, INK3, PAPER2, BORDER } = usePalette()
  const { TH, TD } = useTokens()
  const graded = rows.filter(r => r.grade.grade !== 'NONE')
    .sort((a, b) => (a.grade.grade === b.grade.grade ? Math.abs(b.rel_strength) - Math.abs(a.rel_strength) : a.grade.grade < b.grade.grade ? -1 : 1))
  if (!graded.length) {
    return <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, py: 3, textAlign: 'center' }}>No trend-aligned, gate-approved signals right now. The stack is doing its job — sit out.</Typography>
  }
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <Box component="thead">
          <Box component="tr">
            {['Symbol', 'Dir', 'Grade', 'Size', 'Trend', 'Quadrant', 'Ret', 'ATR', 'RS', 'Why'].map(h => (
              <Box component="th" key={h} sx={{ ...TH, textAlign: 'left', py: 0.75, px: 1, position: 'sticky', top: 0 }}>{h}</Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {graded.map(r => {
            const dirColor = r.grade.direction === 'long' ? GREEN : RED
            return (
              <Box component="tr" key={r.symbol} onClick={() => onPick(r.symbol)} sx={{ cursor: 'pointer', borderBottom: `1px solid ${BORDER}`, '&:hover': { bgcolor: PAPER2 } }}>
                <Box component="td" sx={{ ...TD, px: 1, py: 0.6, fontWeight: 700, fontFamily: MONO.fontFamily, color: INK }}>{r.symbol}</Box>
                <Box component="td" sx={{ ...TD, px: 1, color: dirColor, fontWeight: 700 }}>{r.grade.direction.toUpperCase()}</Box>
                <Box component="td" sx={{ ...TD, px: 1 }}><Box sx={{ display: 'inline-block', px: 0.75, borderRadius: 0.75, bgcolor: `${dirColor}1A`, color: dirColor, fontWeight: 800, fontSize: '0.66rem' }}>{r.grade.grade}</Box></Box>
                <Box component="td" sx={{ ...TD, px: 1, color: INK3 }}>{r.grade.size}</Box>
                <Box component="td" sx={{ ...TD, px: 1, color: r.trend === 'UP' ? GREEN : r.trend === 'DOWN' ? RED : INK3 }}>{r.trend}</Box>
                <Box component="td" sx={{ ...TD, px: 1, color: r.quadrant ? QUAD_COLOR[r.quadrant] : INK3, fontSize: '0.66rem' }}>{r.quadrant ? QUAD_LABEL[r.quadrant] : '—'}</Box>
                <Box component="td" sx={{ ...TD, px: 1, fontFamily: MONO.fontFamily, color: r.ret_pct >= 0 ? GREEN : RED }}>{pct(r.ret_pct)}</Box>
                <Box component="td" sx={{ ...TD, px: 1, fontFamily: MONO.fontFamily, color: INK }}>{num(r.ret_per_atr)}</Box>
                <Box component="td" sx={{ ...TD, px: 1, fontFamily: MONO.fontFamily, color: r.rel_strength >= 0 ? GREEN : RED }}>{pct(r.rel_strength)}</Box>
                <Box component="td" sx={{ ...TD, px: 1, color: INK3, fontSize: '0.64rem', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.grade.reasons[0]}</Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}

// ── AI Desk — chat over live F&O data ─────────────────────────────────────────
interface DeskMessage {
  id: number
  role: 'user' | 'assistant' | 'error'
  content: string
  queries?: FnoToolCall[]
}

const DESK_SUGGESTIONS = [
  'Is it risk-on or risk-off right now, and why?',
  'What are the best graded signals on the board?',
  'Which symbols are in long buildup?',
]

let deskMsgId = 0

function AiDesk() {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const [messages, setMessages] = useState<DeskMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || loading) return
    setInput('')
    setMessages(prev => [...prev, { id: ++deskMsgId, role: 'user', content: q }])
    setLoading(true)
    try {
      const res = await fnoApi.chat(q)
      setMessages(prev => [...prev, { id: ++deskMsgId, role: 'assistant', content: res.answer, queries: res.queries }])
    } catch (e: any) {
      setMessages(prev => [...prev, { id: ++deskMsgId, role: 'error', content: String(e?.message ?? e) }])
    } finally {
      setLoading(false)
    }
  }

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <Box>
      {messages.length === 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          {DESK_SUGGESTIONS.map(s => (
            <Box
              key={s} onClick={() => send(s)}
              sx={{
                px: 1.25, py: 0.5, borderRadius: 1.5, cursor: 'pointer',
                bgcolor: `${CYAN}0F`, border: `1px solid ${CYAN}30`,
                transition: 'all 0.15s ease',
                '&:hover': { bgcolor: `${CYAN}1E`, borderColor: `${CYAN}55` },
              }}
            >
              <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2 }}>{s}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {(messages.length > 0 || loading) && (
        <Box sx={{ maxHeight: 420, overflowY: 'auto', mb: 2, pr: 0.5 }}>
          {messages.map(msg => (
            <Box key={msg.id} sx={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', mb: 1.25 }}>
              {msg.role === 'user' ? (
                <Box sx={{ px: 1.5, py: 0.8, maxWidth: '75%', bgcolor: `${CYAN}18`, border: `1px solid ${CYAN}30`, borderRadius: '14px 14px 3px 14px' }}>
                  <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK }}>{msg.content}</Typography>
                </Box>
              ) : (
                <Box sx={{ maxWidth: '88%', px: 1.5, py: 1.1, bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderLeft: '3px solid #a78bfa55', borderRadius: '3px 14px 14px 14px' }}>
                  <Typography sx={{ ...SANS, fontSize: '0.75rem', color: msg.role === 'error' ? RED : INK2, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </Typography>
                  {msg.queries && msg.queries.length > 0 && (
                    <Box sx={{ mt: 0.75, pt: 0.75, borderTop: `1px solid ${BORDER}` }}>
                      <Box onClick={() => toggle(msg.id)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: INK3, '&:hover': { color: INK2 } }}>
                        <Typography sx={{ ...MONO, fontSize: '0.62rem' }}>
                          {msg.queries.length} tool {msg.queries.length === 1 ? 'call' : 'calls'}
                        </Typography>
                        {expanded.has(msg.id) ? <ExpandLessIcon sx={{ fontSize: 13 }} /> : <ExpandMoreIcon sx={{ fontSize: 13 }} />}
                      </Box>
                      <Collapse in={expanded.has(msg.id)}>
                        <Box sx={{ mt: 0.5 }}>
                          {msg.queries.map((q, i) => (
                            <Box key={i} sx={{ mb: 0.5, p: 0.75, borderRadius: 1, bgcolor: `${INK3}0F`, fontSize: '0.62rem' }}>
                              <Typography sx={{ ...MONO, fontSize: '0.62rem', color: CYAN }}>{q.tool}({JSON.stringify(q.input)})</Typography>
                              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{q.result_preview}</Typography>
                            </Box>
                          ))}
                        </Box>
                      </Collapse>
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          ))}
          {loading && (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', px: 0.5 }}>
              {[0, 1, 2].map(i => (
                <Box key={i} sx={{
                  width: 5, height: 5, borderRadius: '50%', bgcolor: '#a78bfa',
                  animation: 'deskPulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s`,
                  '@keyframes deskPulse': { '0%,80%,100%': { opacity: 0.2 }, '40%': { opacity: 1 } },
                }} />
              ))}
              <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, ml: 0.75 }}>Analysing the board…</Typography>
            </Box>
          )}
          <div ref={bottomRef} />
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          fullWidth multiline maxRows={3} size="small"
          placeholder="Ask about breadth, a symbol's quadrant, or its option chain…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
          disabled={loading}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: PAPER2, '& fieldset': { borderColor: BORDER }, '&.Mui-focused fieldset': { borderColor: `${CYAN}80 !important` } } }}
        />
        <IconButton
          onClick={() => send(input)} disabled={loading || !input.trim()} size="medium"
          sx={{ bgcolor: CYAN, color: '#00131a', '&:hover': { bgcolor: CYAN, opacity: 0.85 }, '&.Mui-disabled': { bgcolor: BORDER, color: INK3 }, flexShrink: 0 }}
        >
          <SendIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function FnoTacticalPage() {
  const { INK, INK2, INK3, CYAN, BG, PAPER, BORDER } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()

  const [state, setState] = useState<MarketState | null>(null)
  const [universe, setUniverse] = useState<FnoUniverseResponse | null>(null)
  const [breadth, setBreadth] = useState<BreadthVerdict | null>(null)
  const [normalized, setNormalized] = useState<NormalizedSeries | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [st, uni, br, nm] = await Promise.all([
        fnoApi.getState(), fnoApi.getUniverse(), fnoApi.getBreadth(), fnoApi.getNormalized(),
      ])
      setState(st); setUniverse(uni); setBreadth(br); setNormalized(nm); setErr(null)
      return st
    } catch (e: any) {
      setErr(String(e?.message ?? e)); return null
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const st = await fetchAll()
      if (cancelled) return
      // Invariant: only keep the 5s poller running while LIVE.
      if (st && st.is_live) {
        if (!timer.current) timer.current = setInterval(fetchAll, REFRESH_MS)
      } else if (timer.current) {
        clearInterval(timer.current); timer.current = null
      }
    }
    tick()
    return () => { cancelled = true; if (timer.current) { clearInterval(timer.current); timer.current = null } }
  }, [fetchAll])

  const isLive = state?.is_live ?? false
  const rows = universe?.rows ?? []
  const gradedCount = rows.filter(r => r.grade.grade !== 'NONE').length

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
          <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: CYAN, letterSpacing: '0.18em', textTransform: 'uppercase' }}>● F&O Live Tactical</Typography>
          <StatePill state={state} loading={loading} />
          {universe && <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>{universe.data_mode.toUpperCase()}{universe.oi_live ? ' · OI LIVE' : ''} · {rows.length} names · {gradedCount} signals</Typography>}
        </Box>
        <Typography sx={{ ...SANS, fontSize: { xs: '1.6rem', md: '2.1rem' }, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          F&amp;O <Box component="span" sx={{ color: CYAN }}>Tactical</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, maxWidth: 640, mt: 1 }}>
          Trade <b>with the monthly trend, against the intraday move</b>. Four stacked filters — breadth gate → OI positioning → 9:15 timing → option-chain confirmation — cut trade count and raise quality.
        </Typography>
        {err && <Typography sx={{ ...SANS, fontSize: '0.72rem', color: RED, mt: 1 }}>Backend error: {err}</Typography>}
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, py: 3 }}>
        {/* Zone 0 */}
        <BreadthGate b={breadth} disabled={!isLive} />

        {/* Zones 1 + 2 (left) / Zone 3 (right) */}
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={7}>
            <Box sx={{ ...CARD, p: 2, mb: 2.5 }}>
              <SectionHead title="OI Positioning — Returns vs OI Change" accent="#6366f1" meta={universe ? `nifty ${pct(universe.nifty_ret)}` : ''} />
              <PositioningScatter rows={rows} onPick={setFocus} mode={mode} />
            </Box>
            <Box sx={{ ...CARD, p: 2 }}>
              <SectionHead title="Normalized 9:15 — Relative Strength" accent="#14b8a6" meta="V = long · inverted-V = short" />
              <NormalizedLines data={normalized} mode={mode} />
            </Box>
          </Grid>
          <Grid item xs={12} lg={5}>
            <Box sx={{ position: { lg: 'sticky' }, top: 60 }}>
              <OptionChainPanel symbol={focus} live={isLive} mode={mode} onClose={() => setFocus(null)} />
            </Box>
          </Grid>
        </Grid>

        {/* Graded signals */}
        <Box sx={{ ...CARD, p: 2, mt: 2.5 }}>
          <SectionHead title="Graded Signals — trend-aligned, gate-approved" accent="#f59e0b" meta={`${gradedCount} live`} />
          <GradedSignals rows={rows} onPick={setFocus} />
        </Box>

        {/* AI Desk */}
        <Box sx={{ ...CARD, p: 2, mt: 2.5 }}>
          <SectionHead title="AI Trading Desk" accent="#a78bfa" meta="Sonnet 5 · via aicredits.in" />
          <AiDesk />
        </Box>
      </Box>

      <Footer />
    </Box>
  )
}
