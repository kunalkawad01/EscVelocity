import React, { useState, useEffect, useMemo } from 'react'
import {
  Box, Typography, Chip, CircularProgress, Alert, Autocomplete, TextField, Collapse,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material'
import Highcharts from 'highcharts'
import HighchartsMore from 'highcharts/highcharts-more'
import HighchartsReact from 'highcharts-react-official'

HighchartsMore(Highcharts)

import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { optionsApi } from '../api/optionsApi'
import { stockApi } from '../api/stockApi'
import type { IVSmileResponse } from '../types/options'
import { hcTheme } from '../theme'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
}

type Tone = 'fear' | 'greed' | 'neutral'

// Turns the skew metrics into one sentence a non-options user understands.
function skewSummary(d: IVSmileResponse): { text: string; tone: Tone } {
  const { atm_iv: iv, rr_25d: rr, put_wing_iv: pw, call_wing_iv: cw } = d

  // 1. How nervous is the market overall (ATM IV regime)
  let vol = 'typical'
  if (iv !== null) {
    vol = iv < 18 ? 'unusually calm' : iv < 28 ? 'moderate' : iv < 40 ? 'elevated' : 'high'
  }
  const ivStr = iv !== null ? ` (ATM IV ${iv.toFixed(1)}%)` : ''

  // 2. Which way is the fear leaning (25Δ risk reversal)
  let tone: Tone = 'neutral'
  let lean = 'is roughly balanced between upside and downside bets'
  if (rr !== null && Math.abs(rr) > 0.2) {
    const strength = Math.abs(rr) < 0.5 ? 'a slight' : Math.abs(rr) < 1.5 ? 'a clear' : 'a strong'
    if (rr > 0) { tone = 'fear'; lean = `is paying up for downside protection — ${strength} fear tilt` }
    else { tone = 'greed'; lean = `is chasing upside — ${strength} bullish tilt` }
  }

  // 3. Quantify the imbalance from the wings
  let gap = ''
  if (pw !== null && cw !== null && Math.abs(pw - cw) >= 0.3) {
    const side = pw > cw ? 'crash puts' : 'upside calls'
    gap = `, where ${side} cost about ${Math.abs(pw - cw).toFixed(1)} vol points more than the other side`
  }

  const dteStr = `${d.dte} day${d.dte === 1 ? '' : 's'} to expiry`
  return {
    text: `${d.symbol} options are pricing ${vol} turbulence${ivStr} with ${dteStr}. The market ${lean}${gap}.`,
    tone,
  }
}

// ── Strategy Lens — deterministic, rule-based research (NOT advice) ────────────
interface StrategyStructure { name: string; rationale: string; driver: string }
interface StrategyLensResult { bias: string; tone: Tone; reads: string[]; structures: StrategyStructure[]; provisional: boolean }

function strategyLens(d: IVSmileResponse): StrategyLensResult {
  const { atm_iv: iv, rr_25d: rr, put_wing_iv: pw, call_wing_iv: cw } = d

  // Vol read — prefer IV-Rank (history-aware) once enough days exist; else absolute IV (provisional).
  let volWord = 'moderate'; let volBias: 'sell' | 'buy' | 'neutral' = 'neutral'
  let volRead = ''; let provisional = true
  if (d.iv_rank !== null) {
    provisional = false
    const r = d.iv_rank
    if (r < 25) { volWord = 'cheap'; volBias = 'buy' }
    else if (r < 50) { volWord = 'below-average'; volBias = 'neutral' }
    else if (r < 75) { volWord = 'elevated'; volBias = 'sell' }
    else { volWord = 'rich'; volBias = 'sell' }
    volRead = `IV Rank ${r.toFixed(0)} · ${volWord}`
  } else if (iv !== null) {
    if (iv < 18) { volWord = 'cheap'; volBias = 'buy' }
    else if (iv < 28) { volWord = 'moderate'; volBias = 'neutral' }
    else if (iv < 40) { volWord = 'elevated'; volBias = 'sell' }
    else { volWord = 'rich'; volBias = 'sell' }
    volRead = `ATM IV ${iv.toFixed(1)}% · ${volWord}`
  }

  // 25Δ reference strikes (same locate rule as the RR / chart markers)
  const nearest = (arr: typeof d.strikes, key: (s: typeof d.strikes[0]) => number) =>
    arr.length ? arr.reduce((a, b) => Math.abs(key(b)) < Math.abs(key(a)) ? b : a) : null
  const call25 = nearest(d.strikes.filter(s => s.ce_delta !== null && s.ce_iv !== null), s => (s.ce_delta as number) - 0.25)
  const put25 = nearest(d.strikes.filter(s => s.pe_delta !== null && s.pe_iv !== null), s => (s.pe_delta as number) + 0.25)
  const putRef = put25 ? `the ~${put25.strike.toFixed(0)} put (25Δ)` : 'the 25Δ put'
  const callRef = call25 ? `the ~${call25.strike.toFixed(0)} call (25Δ)` : 'the 25Δ call'

  // Skew direction / strength
  let skewWord = 'balanced skew'; let side: 'put' | 'call' | 'none' = 'none'
  if (rr !== null) {
    if (rr > 1.5) { skewWord = 'strong put skew'; side = 'put' }
    else if (rr > 0.2) { skewWord = 'mild put skew'; side = 'put' }
    else if (rr < -1.5) { skewWord = 'strong call skew'; side = 'call' }
    else if (rr < -0.2) { skewWord = 'mild call skew'; side = 'call' }
  }

  // Smile steepness (tails vs ATM)
  const wingAvg = (pw !== null && cw !== null) ? (pw + cw) / 2 : null
  const tailPremium = (wingAvg !== null && iv !== null) ? wingAvg - iv : null
  const tailsRich = tailPremium !== null && tailPremium > 4

  // Reasoning chips
  const reads: string[] = []
  if (volRead) reads.push(volRead)
  if (rr !== null) reads.push(`RR ${rr > 0 ? '+' : ''}${rr.toFixed(2)} · ${skewWord}`)
  reads.push(`${d.dte}d · ${d.dte <= 14 ? 'short-dated (high θ/γ)' : d.dte <= 45 ? 'balanced tenor' : 'longer-dated'}`)
  if (tailsRich) reads.push(`tails +${tailPremium!.toFixed(1)} vs ATM · steep`)

  // Structure selection
  const structures: StrategyStructure[] = []
  if (volBias === 'sell') {
    if (side === 'put') {
      structures.push({ name: 'Bull put spread', driver: 'elevated IV + put skew',
        rationale: `Sell ${putRef} (fear-bid) and buy a lower put — harvest the put skew with defined risk.` })
      if (rr !== null && rr > 1.5) structures.push({ name: 'Risk reversal (sell put / buy call)', driver: 'strong put skew',
        rationale: `${putRef} is much richer than ${callRef} — finance a bullish structure cheaply.` })
    } else if (side === 'call') {
      structures.push({ name: 'Bear call spread', driver: 'elevated IV + call skew',
        rationale: `Sell ${callRef} (rich) and buy a higher call — harvest the call skew with defined risk.` })
    }
    if (tailsRich) structures.push({ name: 'Iron condor', driver: 'steep smile + elevated IV',
      rationale: 'Both tails price well above ATM — sell both wings, buy further-out protection.' })
    if (structures.length === 0) structures.push({ name: 'Short strangle (spread-capped)', driver: 'elevated IV, flat skew',
      rationale: 'High IV with symmetric skew — sell premium both sides; cap risk with long wings.' })
  } else if (volBias === 'buy') {
    structures.push({ name: 'Long debit spread / calendar', driver: 'cheap IV',
      rationale: 'Vol is cheap — own gamma/vega rather than sell it.' })
    if (side === 'none') structures.push({ name: 'Long straddle / strangle', driver: 'cheap + flat skew',
      rationale: 'Cheap symmetric vol — position for a move if you expect one.' })
  } else {
    if (side === 'put') structures.push({ name: 'Bull put spread (modest edge)', driver: 'put skew only',
      rationale: `Vol is middling, but ${putRef} carries a skew premium — a small, defined-risk sell.` })
    else if (side === 'call') structures.push({ name: 'Bear call spread (modest edge)', driver: 'call skew only',
      rationale: `Vol is middling, but ${callRef} carries a skew premium.` })
    else structures.push({ name: 'Directional debit spread', driver: 'no vol/skew edge',
      rationale: 'No clear vol or skew edge — express your own directional view with defined risk.' })
  }

  const biasVol = volBias === 'sell' ? 'Net-short-vega' : volBias === 'buy' ? 'Net-long-vega' : 'Vol-neutral'
  const biasSkew = side === 'put' ? 'put-skew lean' : side === 'call' ? 'call-skew lean' : 'no skew lean'
  const tone: Tone = side === 'put' ? 'fear' : side === 'call' ? 'greed' : 'neutral'
  return { bias: `${biasVol} · ${biasSkew}`, tone, reads, structures, provisional }
}

function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: INK, ...SANS }}>{title}</Typography>
      {meta && <Typography sx={{ fontSize: '0.7rem', color: INK3, ...MONO }}>{meta}</Typography>}
    </Box>
  )
}

// ── Sparkline (tiny inline trend chart) ──────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const options = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'area', height: 30, margin: [3, 0, 3, 0], backgroundColor: 'transparent' },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: { visible: false },
    yAxis: { visible: false, startOnTick: false, endOnTick: false },
    tooltip: {
      enabled: true, hideDelay: 0, outside: false, shadow: false,
      formatter: function (this: any) { return `<span style="font-size:0.6rem">IV ${Number(this.y).toFixed(1)}%</span>` },
    },
    plotOptions: {
      area: {
        animation: false, lineWidth: 1.5, lineColor: color, color,
        fillColor: `${color}26`, threshold: null,
        marker: { enabled: false, states: { hover: { enabled: true, radius: 2.5 } } },
        states: { hover: { lineWidth: 1.5 } },
      },
    },
    series: [{ type: 'area', data }],
  }), [data, color])
  return <Box sx={{ mt: 0.6, mx: -0.5 }}><HighchartsReact highcharts={Highcharts} options={options} /></Box>
}

// ── Metric tile ────────────────────────────────────────────────────────────
function Metric({ label, value, sub, color, spark, sparkColor }:
  { label: string; value: string; sub?: string; color?: string; spark?: number[]; sparkColor?: string }) {
  const { INK, INK3, CYAN, BORDER, PAPER2 } = usePalette()
  return (
    <Box sx={{ flex: '1 1 120px', minWidth: 120, p: 1.5, borderRadius: 2, border: `1px solid ${BORDER}`, bgcolor: PAPER2 }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em', color: INK3, textTransform: 'uppercase', ...SANS }}>{label}</Typography>
      <Typography sx={{ fontSize: '1.05rem', fontWeight: 700, color: color || INK, mt: 0.3, ...MONO }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: '0.62rem', color: INK3, mt: 0.2, ...SANS }}>{sub}</Typography>}
      {spark && spark.length >= 2 && <Sparkline data={spark} color={sparkColor || color || CYAN} />}
    </Box>
  )
}

// ── Smile chart ──────────────────────────────────────────────────────────────
function SmileChart({ data }: { data: IVSmileResponse }) {
  const { INK, INK3, CYAN } = usePalette()
  const options = useMemo<Highcharts.Options>(() => {
    const ce = data.strikes.filter(s => s.ce_iv !== null).map(s => [s.strike, s.ce_iv])
    const pe = data.strikes.filter(s => s.pe_iv !== null).map(s => [s.strike, s.pe_iv])
    const smile = data.strikes.filter(s => s.smile_iv !== null).map(s => [s.strike, s.smile_iv])

    // #1 — skew-slope trendline: uses the reported slope, anchored at (spot, ATM IV).
    // IV(K) = atm_iv + skew_slope × moneyness(K),  moneyness(K) = (K − spot)/spot × 100
    const slopeLine: [number, number][] = []
    if (data.skew_slope !== null && data.atm_iv !== null && data.strikes.length) {
      const ks = data.strikes.map(s => s.strike)
      const ivAt = (k: number) => (data.atm_iv as number) + (data.skew_slope as number) * ((k - data.spot) / data.spot * 100)
      const kMin = Math.min(...ks), kMax = Math.max(...ks)
      slopeLine.push([kMin, ivAt(kMin)], [kMax, ivAt(kMax)])
    }

    // #2 — 25-delta wing markers: re-locate the same strikes the backend used for RR.
    const withCe = data.strikes.filter(s => s.ce_delta !== null && s.ce_iv !== null)
    const withPe = data.strikes.filter(s => s.pe_delta !== null && s.pe_iv !== null)
    const call25 = withCe.length
      ? withCe.reduce((a, b) => Math.abs((b.ce_delta as number) - 0.25) < Math.abs((a.ce_delta as number) - 0.25) ? b : a)
      : null
    const put25 = withPe.length
      ? withPe.reduce((a, b) => Math.abs((b.pe_delta as number) + 0.25) < Math.abs((a.pe_delta as number) + 0.25) ? b : a)
      : null
    const wingPoints: Array<{ x: number; y: number | null; name: string }> = []
    if (put25) wingPoints.push({ x: put25.strike, y: put25.pe_iv, name: '25Δ Put' })
    if (call25) wingPoints.push({ x: call25.strike, y: call25.ce_iv, name: '25Δ Call' })

    // #3 — wing bands: shade the ±8-12% moneyness regions the wing IVs are averaged over.
    // moneyness m% → strike = spot × (1 + m/100)
    const wingBands: Highcharts.XAxisPlotBandsOptions[] = []
    if (data.put_wing_iv !== null) {
      wingBands.push({ from: data.spot * 0.88, to: data.spot * 0.92, color: '#ef444416', zIndex: 0,
        label: { text: `Put wing ${fmt(data.put_wing_iv)}%`, align: 'center', verticalAlign: 'top', y: 12,
                 style: { color: '#ef4444', fontSize: '0.55rem', fontWeight: '700' } } })
    }
    if (data.call_wing_iv !== null) {
      wingBands.push({ from: data.spot * 1.08, to: data.spot * 1.12, color: '#22c55e16', zIndex: 0,
        label: { text: `Call wing ${fmt(data.call_wing_iv)}%`, align: 'center', verticalAlign: 'top', y: 12,
                 style: { color: '#22c55e', fontSize: '0.55rem', fontWeight: '700' } } })
    }

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 380, type: 'spline' },
      title: { text: undefined },
      xAxis: {
        ...hcTheme.xAxis,
        title: { text: 'Strike', style: { color: INK3, fontSize: '0.65rem' } },
        plotBands: wingBands,
        plotLines: [
          { value: data.spot, color: CYAN, width: 1.5, dashStyle: 'Dash', zIndex: 4,
            label: { text: `Spot ${fmt(data.spot, 0)}`, style: { color: CYAN, fontSize: '0.6rem' } } },
        ],
      },
      yAxis: {
        ...hcTheme.yAxis,
        title: { text: 'Implied Vol (%)', style: { color: INK3, fontSize: '0.65rem' } },
        labels: { ...hcTheme.yAxis?.labels, formatter: function (this: any) { return this.value + '%' } },
      },
      legend: { ...hcTheme.legend, enabled: true },
      tooltip: {
        ...hcTheme.tooltip,
        shared: true,
        formatter: function (this: any) {
          const rows = this.points.map((p: any) => `<b>${p.series.name}:</b> ${fmt(p.y)}%`).join('<br/>')
          return `Strike <b>${fmt(this.x, 0)}</b><br/>${rows}`
        },
      },
      plotOptions: { spline: { marker: { enabled: true, radius: 3 } }, scatter: { marker: { radius: 3 } } },
      series: [
        { type: 'line', name: 'Skew fit', data: slopeLine, color: INK3, dashStyle: 'ShortDot',
          lineWidth: 1.5, marker: { enabled: false }, enableMouseTracking: false, zIndex: 2 },
        { type: 'spline', name: 'Smile (OTM IV)', data: smile, color: CYAN, lineWidth: 2.5, zIndex: 3,
          marker: { radius: 4, symbol: 'circle' } },
        { type: 'scatter', name: 'Call IV', data: ce, color: '#22c55e', zIndex: 1, marker: { symbol: 'triangle' } },
        { type: 'scatter', name: 'Put IV', data: pe, color: '#ef4444', zIndex: 1, marker: { symbol: 'triangle-down' } },
        { type: 'scatter', name: '25Δ wings', data: wingPoints as any, color: '#8b5cf6', zIndex: 6,
          marker: { radius: 7, symbol: 'diamond', lineWidth: 1.5, lineColor: '#8b5cf6', fillColor: '#8b5cf655' },
          dataLabels: { enabled: true, format: '{point.name}', style: { color: INK, fontSize: '0.6rem', fontWeight: '700', textOutline: 'none' } } },
      ] as Highcharts.SeriesOptionsType[],
      credits: { enabled: false },
    }
  }, [data, INK, INK3, CYAN])
  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Greeks table ─────────────────────────────────────────────────────────────
function GreeksTable({ data }: { data: IVSmileResponse }) {
  const { INK, INK2, CYAN, PAPER2 } = usePalette()
  const { TH, TD } = useTokens()
  const cols = ['Strike', 'Mny %', 'Smile IV', 'Call Δ', 'Put Δ', 'Gamma', 'Vega', 'CE OI', 'PE OI']
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 640 }}>
        <TableHead>
          <TableRow>{cols.map(c => <TableCell key={c} sx={{ ...TH, textAlign: c === 'Strike' ? 'left' : 'right' }}>{c}</TableCell>)}</TableRow>
        </TableHead>
        <TableBody>
          {data.strikes.map(s => {
            const isAtm = s.strike === data.atm_strike
            return (
              <TableRow key={s.strike} sx={{ bgcolor: isAtm ? `${CYAN}14` : 'transparent' }}>
                <TableCell sx={{ ...TD, ...MONO, fontWeight: isAtm ? 800 : 600, color: isAtm ? CYAN : INK }}>
                  {fmt(s.strike, 0)}{isAtm ? ' ·ATM' : ''}
                </TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: s.moneyness < 0 ? '#ef4444' : '#22c55e' }}>{fmt(s.moneyness, 1)}</TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', fontWeight: 700, color: INK }}>{fmt(s.smile_iv)}</TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: INK2 }}>{fmt(s.ce_delta, 3)}</TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: INK2 }}>{fmt(s.pe_delta, 3)}</TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: INK2 }}>{fmt(s.gamma, 5)}</TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: INK2 }}>{fmt(s.vega, 3)}</TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: INK2 }}>{fmt(s.ce_oi, 0)}</TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: INK2 }}>{fmt(s.pe_oi, 0)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Box>
  )
}

// ── "How to read this page" collapsible glossary ─────────────────────────────
interface GlossItem { term: string; formula?: string; what: string; why: string; use?: string }
const GLOSSARY_INTRO =
  "Implied Volatility (IV) is the market's estimate of how turbulent a stock will be, priced into its options. " +
  "High IV = expensive options (big moves expected); low IV = calm. This page shows how IV varies across strike " +
  "prices — that shape is the “smile” — and what the shape implies for direction, fear, and strategy."

const GLOSSARY: { title: string; accent: string; items: GlossItem[] }[] = [
  { title: 'Start here — the building blocks', accent: '#64748b', items: [
    { term: 'Moneyness', formula: '(Strike − Spot) / Spot × 100',
      what: 'How far a strike sits from the current price, in %.',
      why: 'Negative = below price (put side), positive = above (call side). Puts different-priced stocks on one scale.',
      use: 'The chart’s x-axis; the red/green % column in the greeks table.' },
    { term: 'Smile IV', formula: 'OTM-side IV, cleaned to 1–150%',
      what: 'Per-strike vol using the out-of-the-money side (puts below spot, calls above), feed garbage filtered out.',
      why: 'The honest, liquid vol per strike — the curve every skew metric is measured on.',
      use: 'The cyan spline on the chart.' },
    { term: 'Spot · ATM strike · DTE', formula: 'DTE = business days to expiry',
      what: 'Current price, the strike nearest it, and days left to the front expiry.',
      why: 'Spot is the reference; ATM anchors the smile; DTE drives time-decay and every greek.',
      use: 'Dashed cyan line (spot), highlighted table row (ATM), the day chip (DTE).' },
  ]},
  { title: 'Volatility level — is vol high or low?', accent: '#06b6d4', items: [
    { term: 'ATM IV', formula: 'mean(CE_IV, PE_IV) at nearest strike',
      what: 'The at-the-money expected turbulence — one number for how nervous the market is about this stock.',
      why: 'Higher = pricier options. But absolute level can’t say rich vs cheap (30% is high for a bank, low for a small-cap) — that’s IV Rank’s job.',
      use: 'The big cyan tile.' },
    { term: 'IV Rank', formula: '(ATM_IV − min)/(max − min) × 100  over ≤252d',
      what: 'Where today’s vol sits within its own trailing year, 0–100.',
      why: 'THE rich/cheap answer. ≥70 = expensive → favour SELLING premium; ≤30 = cheap → favour BUYING. Stock-relative, so comparable across names. Null until 20 days of history exist.',
      use: 'IV Rank tile — green ≤30, amber ≥70; shows “building · n/20d” until history is sufficient.' },
    { term: 'IV Percentile', formula: '% of history days with IV < today',
      what: 'Share of past days where vol was lower than now.',
      why: 'Cross-check on IV Rank — counts days instead of min/max, so one spike day can’t distort it. Rank ≫ Percentile means an outlier is inflating Rank.',
      use: 'Sub-line of the IV Rank tile.' },
    { term: 'ATM-IV sparkline',
      what: 'The trailing daily ATM-IV series.',
      why: 'Shows the trajectory — vol rising into an event vs bleeding lower — that a single number hides.',
      use: 'The mini cyan area chart in the IV Rank tile; hover for each day’s value.' },
  ]},
  { title: 'Skew — which way is the fear, and how steep?', accent: '#8b5cf6', items: [
    { term: '25Δ Risk Reversal', formula: 'IV(25Δ put) − IV(25Δ call)',
      what: 'The IV gap between the 25-delta put and the 25-delta call.',
      why: 'Directional fear gauge. Positive = crash puts richer than upside calls → downside fear (the equity norm). Strongly positive = the market is paying up for protection.',
      use: 'Red/green tile + the two violet diamonds on the chart marking the exact strikes.' },
    { term: 'Skew Slope', formula: 'OLS slope of smile-IV vs moneyness',
      what: 'Best-fit tilt of the whole smile, in IV points per +1% toward calls.',
      why: 'More robust than the risk reversal (uses every strike). Negative = smile rises toward the downside (puts bid).',
      use: 'The “Skew Slope” tile + the dashed grey fit-line on the chart.' },
    { term: 'Put / Call Wing IV', formula: 'mean smile-IV over ∓8–12% OTM',
      what: 'Average vol of the far out-of-the-money tails on each side.',
      why: 'Price of “lottery ticket” options. Put wing ≫ call wing = crash protection is expensive → tail-sellers get paid.',
      use: 'Red / green tiles + the shaded red/green bands on the chart.' },
  ]},
  { title: 'Per-strike greeks — Black-Scholes, r = 6.5%', accent: '#f59e0b', items: [
    { term: 'Delta', formula: 'N(d1) call / N(d1)−1 put',
      what: 'Price change per ₹1 of stock; roughly the chance of finishing in-the-money.',
      why: 'Directional exposure. ATM ≈ ±0.5; deep OTM → 0. The 25Δ strikes are located from here.',
      use: 'Call Δ / Put Δ columns.' },
    { term: 'Gamma', formula: 'φ(d1) / (S·σ·√T)',
      what: 'How fast delta itself changes.',
      why: 'Pin / whipsaw risk — high gamma flips direction fast. Peaks at the money and near expiry.',
      use: 'Gamma column.' },
    { term: 'Vega', formula: 'S·φ(d1)·√T / 100',
      what: 'Price change per +1 vol point.',
      why: 'Your exposure to IV itself moving — the purest volatility bet is the highest-vega (ATM) strike.',
      use: 'Vega column.' },
    { term: 'Theta', formula: 'BS theta / 365',
      what: 'Value lost per day from time passing.',
      why: 'Negative for buyers, positive for sellers. Fast when DTE is short — the seller’s tailwind, the buyer’s bleed.',
      use: 'Theta column.' },
    { term: 'Open Interest',
      what: 'Live contracts outstanding at a strike.',
      why: 'Where the crowd is positioned — heavy-OI strikes act as support/resistance “walls”.',
      use: 'CE OI / PE OI columns.' },
  ]},
  { title: 'Putting it together', accent: '#14b8a6', items: [
    { term: 'Skew summary',
      what: 'One auto-written sentence from ATM IV + RR + wings + DTE.',
      why: 'The 5-second read for a non-options user.',
      use: 'The tone-coloured callout atop the Skew Snapshot.' },
    { term: 'Strategy Lens',
      what: 'Rule-based research combining vol (IV Rank → sell/buy), skew (RR → which side), and DTE (short → defined-risk) into candidate structures.',
      why: 'Reads the COMBINATION, not one metric — vol + skew aligned → higher conviction. Deterministic, explainable, not advice.',
      use: 'The Strategy Lens card — bias chip, reasoning chips, structures with drivers.' },
  ]},
]
const READING_FLOW = [
  'Summary sentence — the 5-second read of nervousness + direction.',
  'Tiles — ATM IV & IV Rank (how expensive), RR/Slope/Wings (which way the skew leans).',
  'Strategy Lens — what the combination implies, with its reasoning.',
  'Smile chart — visual proof: tilt (fit line), RR strikes (diamonds), wings (bands), spot line.',
  'Greeks table — strike-level detail to actually structure a trade.',
]

function GlossaryPanel() {
  const { INK, INK2, INK3, CYAN, BORDER, PAPER, PAPER2 } = usePalette()
  const { CARD } = useTokens()
  const [open, setOpen] = useState(false)
  const Label = ({ t }: { t: string }) => (
    <Typography component="span" sx={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.04em', color: INK3, textTransform: 'uppercase', mr: 0.6, ...MONO }}>{t}</Typography>
  )
  return (
    <Box sx={{ ...CARD, mb: 3, overflow: 'hidden' }}>
      <Box onClick={() => setOpen(o => !o)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.2, p: 2, cursor: 'pointer', userSelect: 'none',
               bgcolor: open ? PAPER2 : 'transparent' }}>
        <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: CYAN }} />
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: INK, ...SANS, flex: 1 }}>How to read this page</Typography>
        <Typography sx={{ fontSize: '0.62rem', color: INK3, ...MONO }}>{open ? 'hide' : 'new to options? start here'}</Typography>
        <Typography sx={{ fontSize: '0.85rem', color: INK3, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▸</Typography>
      </Box>
      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 2.5, pt: 1 }}>
          <Typography sx={{ fontSize: '0.76rem', color: INK2, lineHeight: 1.55, mb: 2.5, ...SANS }}>{GLOSSARY_INTRO}</Typography>
          {GLOSSARY.map(g => (
            <Box key={g.title} sx={{ mb: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.2 }}>
                <Box sx={{ width: 3, height: 14, borderRadius: 2, bgcolor: g.accent }} />
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: INK2, ...SANS }}>{g.title}</Typography>
              </Box>
              {g.items.map(it => (
                <Box key={it.term} sx={{ mb: 1.4, pl: 1.5, borderLeft: `2px solid ${g.accent}44` }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mb: 0.4 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: INK, ...SANS }}>{it.term}</Typography>
                    {it.formula && (
                      <Typography component="span" sx={{ fontSize: '0.6rem', color: CYAN, ...MONO, bgcolor: PAPER2, px: 0.7, py: 0.2, borderRadius: 1, border: `1px solid ${BORDER}` }}>{it.formula}</Typography>
                    )}
                  </Box>
                  <Typography sx={{ fontSize: '0.73rem', color: INK2, lineHeight: 1.5, ...SANS }}><Label t="What" />{it.what}</Typography>
                  <Typography sx={{ fontSize: '0.73rem', color: INK2, lineHeight: 1.5, ...SANS }}><Label t="Why" />{it.why}</Typography>
                  {it.use && <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5, ...SANS }}><Label t="On the page" />{it.use}</Typography>}
                </Box>
              ))}
            </Box>
          ))}
          <Box sx={{ mt: 1, p: 1.75, borderRadius: 2, bgcolor: PAPER, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: CYAN, mb: 0.8, ...SANS }}>Reading order</Typography>
            {READING_FLOW.map((r, i) => (
              <Typography key={i} sx={{ fontSize: '0.73rem', color: INK2, lineHeight: 1.5, mb: 0.3, ...SANS }}>
                <Box component="span" sx={{ ...MONO, color: CYAN, fontWeight: 700, mr: 0.8 }}>{i + 1}.</Box>{r}
              </Typography>
            ))}
          </Box>
        </Box>
      </Collapse>
    </Box>
  )
}

export default function IVSmilePage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BORDER, BG, PAPER, PAPER2 } = usePalette()
  const { CARD, INPUT_SX } = useTokens()

  const [symbols, setSymbols] = useState<string[]>([])
  const [symbol, setSymbol] = useState('RELIANCE')
  const [data, setData] = useState<IVSmileResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    stockApi.getSymbols().then(r => setSymbols(r.symbols)).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    optionsApi.getIVSmile(symbol)
      .then(r => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(`No options / IV data for ${symbol}`); setData(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [symbol])

  // Skew interpretation
  const rr = data?.rr_25d
  const skewLabel = rr === null || rr === undefined ? '—'
    : rr > 0.2 ? 'Put skew (downside fear)'
    : rr < -0.2 ? 'Call skew (upside chase)'
    : 'Flat / symmetric'
  const skewColor = rr === null || rr === undefined ? INK3 : rr > 0.2 ? '#ef4444' : rr < -0.2 ? '#22c55e' : '#fbbf24'

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  return (
    <Box sx={{ bgcolor: BG, minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{ background: heroBg, borderBottom: `1px solid ${BORDER}`, px: { xs: 2, md: 6 }, pt: 5, pb: 4 }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
          <Chip label="OPTIONS · VOLATILITY" size="small"
            sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', color: CYAN,
                  bgcolor: `${CYAN}18`, border: `1px solid ${CYAN}44`, mb: 1.5,
                  animation: 'pulse 2.4s ease-in-out infinite', '@keyframes pulse': { '50%': { opacity: 0.55 } } }} />
          <Typography sx={{ fontSize: { xs: '1.9rem', md: '2.5rem' }, fontWeight: 800, color: INK, lineHeight: 1.05, ...SANS }}>
            Volatility <Box component="span" sx={{ color: CYAN }}>Smile</Box>
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: INK2, mt: 1, maxWidth: 720, ...SANS }}>
            Per-strike implied-vol smile with Black-Scholes greeks and skew analytics for the front expiry.
            Read where the market is pricing fear — 25-delta risk reversal, skew slope, and put/call wing IVs.
          </Typography>

          <Box sx={{ mt: 2.5, maxWidth: 360 }}>
            <Autocomplete
              options={symbols}
              value={symbol}
              onChange={(_, v) => v && setSymbol(v)}
              disableClearable
              renderInput={(params) => (
                <TextField {...params} label="Symbol" size="small" sx={{ ...INPUT_SX, ...MONO }} />
              )}
            />
          </Box>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2, md: 6 }, py: 4 }}>
        <GlossaryPanel />

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress sx={{ color: CYAN }} /></Box>
        )}
        {error && !loading && <Alert severity="warning" sx={{ mb: 3 }}>{error}</Alert>}

        {data && !loading && (
          <>
            {/* Skew metrics */}
            <Box sx={{ ...CARD, p: 2.5, mb: 3 }}>
              <SectionHead title="Skew Snapshot" accent="#8b5cf6"
                meta={`${data.symbol} · ${data.expiry} · ${data.dte}d · ${data.date}`} />
              {(() => {
                const { text, tone } = skewSummary(data)
                const toneColor = tone === 'fear' ? '#ef4444' : tone === 'greed' ? '#22c55e' : '#fbbf24'
                const label = tone === 'fear' ? 'DOWNSIDE FEAR' : tone === 'greed' ? 'UPSIDE CHASE' : 'BALANCED'
                return (
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 1.75, mb: 2,
                             borderRadius: 2, borderLeft: `3px solid ${toneColor}`, bgcolor: `${toneColor}12` }}>
                    <Chip label={label} size="small"
                      sx={{ ...MONO, fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.08em',
                            color: toneColor, bgcolor: `${toneColor}1f`, border: `1px solid ${toneColor}55`, flexShrink: 0, mt: 0.2 }} />
                    <Typography sx={{ fontSize: '0.86rem', lineHeight: 1.5, color: INK, ...SANS }}>{text}</Typography>
                  </Box>
                )
              })()}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                <Metric label="Spot" value={fmt(data.spot, 1)} />
                <Metric label="ATM IV" value={`${fmt(data.atm_iv)}%`} color={CYAN} />
                <Metric label="IV Rank"
                  value={data.iv_rank !== null ? fmt(data.iv_rank, 0) : '—'}
                  sub={data.iv_rank !== null ? `${data.iv_history_days}d · pctl ${fmt(data.iv_percentile, 0)}` : `building · ${data.iv_history_days}/20d`}
                  color={data.iv_rank === null ? undefined : data.iv_rank >= 70 ? '#fbbf24' : data.iv_rank <= 30 ? '#22c55e' : INK}
                  spark={data.atm_iv_history.map(p => p.atm_iv)}
                  sparkColor={CYAN} />
                <Metric label="25Δ Risk Reversal" value={fmt(rr)} sub={skewLabel} color={skewColor} />
                <Metric label="Skew Slope" value={fmt(data.skew_slope, 3)} sub="IV pts / +1% OTM" />
                <Metric label="Put Wing IV" value={`${fmt(data.put_wing_iv)}%`} color="#ef4444" />
                <Metric label="Call Wing IV" value={`${fmt(data.call_wing_iv)}%`} color="#22c55e" />
              </Box>
            </Box>

            {/* Strategy Lens */}
            {(() => {
              const lens = strategyLens(data)
              const tc = lens.tone === 'fear' ? '#ef4444' : lens.tone === 'greed' ? '#22c55e' : '#14b8a6'
              return (
                <Box sx={{ ...CARD, p: 2.5, mb: 3 }}>
                  <SectionHead title="Strategy Lens" accent="#14b8a6" meta="rule-based · research, not advice" />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1.5, flexWrap: 'wrap' }}>
                    <Chip label={lens.bias} size="small"
                      sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 800, color: tc, bgcolor: `${tc}1f`, border: `1px solid ${tc}55` }} />
                    {lens.reads.map(r => (
                      <Chip key={r} label={r} size="small"
                        sx={{ ...MONO, fontSize: '0.56rem', color: INK2, bgcolor: PAPER2, border: `1px solid ${BORDER}` }} />
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {lens.structures.map((s, i) => (
                      <Box key={s.name} sx={{ p: 1.5, borderRadius: 2, border: `1px solid ${BORDER}`,
                                              bgcolor: i === 0 ? `${tc}0d` : 'transparent' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3, flexWrap: 'wrap' }}>
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: INK, ...SANS }}>
                            {i === 0 ? '▸ ' : ''}{s.name}
                          </Typography>
                          <Chip label={s.driver} size="small"
                            sx={{ ...MONO, fontSize: '0.5rem', height: 17, color: INK3, bgcolor: PAPER2, border: `1px solid ${BORDER}` }} />
                        </Box>
                        <Typography sx={{ fontSize: '0.75rem', color: INK2, ...SANS }}>{s.rationale}</Typography>
                      </Box>
                    ))}
                  </Box>
                  <Typography sx={{ fontSize: '0.64rem', color: INK3, mt: 1.5, ...SANS }}>
                    Deterministic rule-based lens — <b>research, not financial advice</b>.{' '}
                    {lens.provisional
                      ? <>The vol rich/cheap read uses absolute IV bands and is <b>provisional</b> until ≥20 days of IV-Rank history accumulate (currently {data.iv_history_days}).</>
                      : <>Vol rich/cheap is graded by <b>IV-Rank</b> over {data.iv_history_days} days of history.</>}
                  </Typography>
                </Box>
              )
            })()}

            {/* Smile chart */}
            <Box sx={{ ...CARD, p: 2.5, mb: 3 }}>
              <SectionHead title="Implied Volatility Smile" accent="#06b6d4" meta="OTM-side IV per strike" />
              <SmileChart data={data} />
            </Box>

            {/* Greeks table */}
            <Box sx={{ ...CARD, p: 2.5, mb: 3 }}>
              <SectionHead title="Strike Greeks" accent="#f59e0b" meta="Black-Scholes" />
              <GreeksTable data={data} />
            </Box>

            <Typography sx={{ fontSize: '0.68rem', color: INK3, ...SANS, mb: 4 }}>{data.note}</Typography>
          </>
        )}
      </Box>

      <Footer />
    </Box>
  )
}
