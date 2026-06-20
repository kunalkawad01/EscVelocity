import { useState, useCallback } from 'react'
import { Box, Typography, Select, MenuItem, Grid, Alert, CircularProgress } from '@mui/material'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import HighchartsMore from 'highcharts/highcharts-more'
HighchartsMore(Highcharts)

import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import SectionHead from '../components/shared/SectionHead'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { useSymbols } from '../hooks/useSymbols'
import { randomnessApi } from '../api/randomnessApi'
import type { RandomnessReport } from '../types/randomness'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// ── Insight Panel ─────────────────────────────────────────────────────────────

function InsightPanel({ report }: { report: RandomnessReport }) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const [open, setOpen] = useState(true)

  const ls = report.luck_skill
  const c  = report.concentration
  const f  = report.fragility

  // ── Derive explanation rows ──────────────────────────────────────────────────
  const explanations: { dot: string; title: string; body: string }[] = [
    {
      dot: ls.luck_score < 30 ? '#22c55e' : ls.luck_score < 60 ? '#fbbf24' : '#ef4444',
      title: 'Luck vs Skill',
      body: ls.luck_score < 30
        ? `${report.symbol}'s ${report.cagr.toFixed(1)}% CAGR appears skill-driven. Of 1,000 random entry dates, ${ls.pct_positive_starts.toFixed(0)}% produced a profit — entry timing barely matters.`
        : ls.luck_score < 60
        ? `${report.symbol}'s returns are mixed. Entry timing explains some of the outcome — ${ls.pct_positive_starts.toFixed(0)}% of random starts were profitable, but the IQR of terminal returns was ${ls.outcome_dispersion.toFixed(0)}%.`
        : `${report.symbol}'s ${report.cagr.toFixed(1)}% CAGR is heavily start-date sensitive. The return IQR across 1,000 random entries was ${ls.outcome_dispersion.toFixed(0)}% — two investors entering at different times could see wildly different outcomes.`,
    },
    {
      dot: c.rcr < 20 ? '#22c55e' : c.rcr < 50 ? '#fbbf24' : '#ef4444',
      title: 'Return Concentration',
      body: c.rcr < 20
        ? `Returns are well distributed. The top 10 days account for only ${c.rcr.toFixed(0)}% of total gains — missing a few big days would not derail the thesis.`
        : c.rcr < 50
        ? `Moderate concentration. The top 10 days contributed ${c.rcr.toFixed(0)}% of total return. Missing the best 5 days alone would cut the return from ${c.return_actual_pct.toFixed(0)}% to ${c.return_minus_best_5.toFixed(0)}%.`
        : `Extreme concentration. ${c.rcr.toFixed(0)}% of ${report.symbol}'s total return came from just 10 days out of ${(report.years * 252).toFixed(0)}. Miss those days and the return collapses from ${c.return_actual_pct.toFixed(0)}% to ${c.return_minus_best_10.toFixed(0)}%.`,
    },
    {
      dot: f.fragility_score < 30 ? '#22c55e' : f.fragility_score < 60 ? '#fbbf24' : '#ef4444',
      title: 'Path Fragility',
      body: f.fragility_score < 30
        ? `Low path dependency. Monte Carlo shows that even with shuffled return sequences, ${f.pct_shuffles_positive.toFixed(0)}% of 10,000 simulations produced a positive CAGR. The edge is structural.`
        : f.fragility_score < 60
        ? `Moderate fragility. Shuffled return paths range from ${f.monte_carlo_p10_cagr.toFixed(1)}% (P10) to ${f.monte_carlo_p90_cagr.toFixed(1)}% (P90) CAGR — the sequence of returns matters meaningfully.`
        : `High path dependency. In ${(100 - f.pct_shuffles_positive).toFixed(0)}% of 10,000 shuffled simulations the CAGR was negative, even though the actual result was ${report.cagr.toFixed(1)}%. The original return sequence was unusually favourable.`,
    },
    {
      dot: Math.abs(f.bull_regime_return - f.bear_regime_return) < 50 ? '#22c55e' : '#fbbf24',
      title: 'Regime Dependence',
      body: f.bear_regime_return < -20
        ? `${report.symbol} is strongly regime-dependent. Bull regime: +${f.bull_regime_return.toFixed(0)}%, Bear regime: ${f.bear_regime_return.toFixed(0)}%. Holding through bear regimes destroys most of the accumulated gains.`
        : `${report.symbol} shows reasonable all-regime behaviour. Bull: +${f.bull_regime_return.toFixed(0)}%, Bear: ${f.bear_regime_return.toFixed(0)}%. Losses in bear periods are contained relative to bull gains.`,
    },
    {
      dot: f.edge_persistence > 70 ? '#22c55e' : f.edge_persistence > 50 ? '#fbbf24' : '#ef4444',
      title: 'Edge Persistence',
      body: `In ${f.edge_persistence.toFixed(0)}% of all rolling 12-month periods, ${report.symbol} produced a positive return. ${
        f.edge_persistence > 70
          ? 'This is a strong persistence signal — most buy-and-hold investors who stayed a full year made money.'
          : f.edge_persistence > 50
          ? 'Marginally consistent — about half of all 12-month windows were profitable, but not reliably so.'
          : 'Poor persistence — fewer than half of 12-month holding periods produced a gain. Timing of entry and exit matters greatly.'
      }`,
    },
  ]

  // ── Derive action items ──────────────────────────────────────────────────────
  const actions: { label: string; detail: string; color: string }[] = []

  if (ls.luck_score > 60) {
    actions.push({
      label: 'Use staggered / SIP entry',
      detail: `With ${ls.outcome_dispersion.toFixed(0)}% return dispersion across random start dates, a lump-sum entry is a high-stakes timing bet. Spread purchases over 6–12 months to average out entry luck.`,
      color: '#f59e0b',
    })
  } else if (ls.luck_score < 30) {
    actions.push({
      label: 'Lump-sum entry is low-risk',
      detail: `${ls.pct_positive_starts.toFixed(0)}% of random entry dates were profitable. Waiting for a "perfect" entry is unnecessary — the edge is consistent across most entry points.`,
      color: '#22c55e',
    })
  }

  if (c.rcr > 50) {
    actions.push({
      label: 'Limit position size',
      detail: `${c.rcr.toFixed(0)}% of returns depended on just 10 days. A missed earnings move or circuit break could eliminate most of the edge. Keep this stock below 5% of portfolio until concentration normalises.`,
      color: '#ef4444',
    })
  } else if (c.rcr < 20) {
    actions.push({
      label: 'Core position sizing is justified',
      detail: `Return is broadly distributed across trading days. Missing a few key events does not materially change the outcome. A 7–10% portfolio weight is supportable.`,
      color: '#22c55e',
    })
  }

  if (f.fragility_score > 60) {
    actions.push({
      label: 'Set a hard stop-loss / regime exit',
      detail: `Path is fragile — ${(100 - f.pct_shuffles_positive).toFixed(0)}% of return-order shuffles went negative. If the stock drops >15% from your entry or crosses below its 200-day MA, exit and reassess.`,
      color: '#ef4444',
    })
  }

  if (f.bear_regime_return < -20) {
    actions.push({
      label: 'Hold only in confirmed bull regime',
      detail: `Bear regime cumulative return was ${f.bear_regime_return.toFixed(0)}%. Check MarketDNA Regime Score — if it falls below 40, consider reducing or exiting until regime recovers.`,
      color: '#f59e0b',
    })
  }

  if (f.edge_persistence > 70 && f.fragility_score < 40 && ls.luck_score < 50) {
    actions.push({
      label: 'Hold-through-volatility strategy supported',
      detail: `${f.edge_persistence.toFixed(0)}% of 12-month windows were positive and fragility is low. Panic-selling on drawdowns likely destroys value — this stock rewards patience.`,
      color: '#22c55e',
    })
  }

  if (actions.length === 0) {
    actions.push({
      label: 'Monitor — no strong action signal',
      detail: `Scores are in the moderate range. Continue monitoring the regime score and reassess if luck_score or fragility_score crosses 60.`,
      color: INK3,
    })
  }

  return (
    <Box sx={{ ...({ bgcolor: PAPER2, border: `1px solid ${BORDER}`, mb: 3 } as object) }}>
      {/* Header / toggle */}
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, cursor: 'pointer', borderBottom: open ? `1px solid ${BORDER}` : 'none', '&:hover': { bgcolor: `${BORDER}50` } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: CYAN }} />
          <Typography sx={{ ...SANS, fontSize: '0.8rem', fontWeight: 800, color: INK, letterSpacing: '0.03em' }}>
            Interpretation & Action Guide
          </Typography>
          <Box sx={{ px: 0.75, py: 0.2, bgcolor: `${CYAN}15`, border: `1px solid ${CYAN}40` }}>
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: CYAN, fontWeight: 700 }}>
              {report.symbol}
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ fontSize: '0.7rem', color: INK3, userSelect: 'none', transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </Typography>
      </Box>

      {open && (
        <Box sx={{ p: 2 }}>
          <Grid container spacing={2}>
            {/* Left: Explanations */}
            <Grid item xs={12} lg={7}>
              <Typography sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK3, mb: 1.5 }}>
                What this tells you
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {explanations.map(ex => (
                  <Box key={ex.title} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ex.dot, mt: '5px', flexShrink: 0 }} />
                    <Box>
                      <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK, mb: 0.25 }}>
                        {ex.title}
                      </Typography>
                      <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.65 }}>
                        {ex.body}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Grid>

            {/* Right: Actions */}
            <Grid item xs={12} lg={5}>
              <Typography sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK3, mb: 1.5 }}>
                Recommended actions
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {actions.map((a, i) => (
                  <Box key={i} sx={{ borderLeft: `3px solid ${a.color}`, pl: 1.5, py: 0.5 }}>
                    <Typography sx={{ ...SANS, fontSize: '0.73rem', fontWeight: 700, color: a.color, mb: 0.3 }}>
                      {a.label}
                    </Typography>
                    <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.65 }}>
                      {a.detail}
                    </Typography>
                  </Box>
                ))}
              </Box>

              {/* Quick stats recap */}
              <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${BORDER}` }}>
                <Typography sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK3, mb: 1 }}>
                  Key numbers
                </Typography>
                {[
                  { k: 'CAGR (actual)',      v: `${report.cagr > 0 ? '+' : ''}${report.cagr.toFixed(1)}%`  },
                  { k: 'Shuffled P50 CAGR',  v: `${f.monte_carlo_p50_cagr > 0 ? '+' : ''}${f.monte_carlo_p50_cagr.toFixed(1)}%` },
                  { k: 'Top-10 day share',   v: `${c.rcr.toFixed(0)}% of return`                           },
                  { k: 'Positive 12M windows', v: `${f.edge_persistence.toFixed(0)}%`                      },
                  { k: 'Profitable entries', v: `${ls.pct_positive_starts.toFixed(0)}% of 1,000 starts`    },
                ].map(r => (
                  <Box key={r.k} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4, borderBottom: `1px solid ${BORDER}` }}>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3 }}>{r.k}</Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: INK }}>{r.v}</Typography>
                  </Box>
                ))}
              </Box>
            </Grid>
          </Grid>
        </Box>
      )}
    </Box>
  )
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, color, lo, hi }: {
  label: string; value: number; color: string; lo: string; hi: string
}) {
  const { INK, INK3, BORDER } = usePalette()
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>{label}</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.82rem', fontWeight: 700, color }}>{value.toFixed(1)}</Typography>
      </Box>
      <Box sx={{ height: 6, bgcolor: BORDER, borderRadius: 3, overflow: 'hidden', mb: 0.4 }}>
        <Box sx={{ height: '100%', width: `${Math.min(100, value)}%`, bgcolor: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3 }}>{lo}</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3 }}>{hi}</Typography>
      </Box>
    </Box>
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  return (
    <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, p: 1.75 }}>
      <Typography sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: INK3, mb: 0.75 }}>{label}</Typography>
      <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: color ?? CYAN, lineHeight: 1 }}>{value}</Typography>
      {sub && <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK2, mt: 0.5 }}>{sub}</Typography>}
    </Box>
  )
}


// ── Concentration Curve chart ─────────────────────────────────────────────────

function CurvChart({ curve }: { curve: number[] }) {
  const { mode } = useThemeMode()
  const { INK, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const opts: Highcharts.Options = {
    chart: { type: 'line', backgroundColor: 'transparent', height: 240, margin: [16, 8, 40, 48] },
    title: { text: undefined },
    xAxis: { title: { text: 'Best days ranked', style: { color: INK3, fontSize: '0.65rem', fontFamily: "'IBM Plex Sans', sans-serif" } }, labels: { style: { color: INK3, fontSize: '0.65rem' } }, lineColor: BORDER, tickColor: BORDER },
    yAxis: { title: { text: '% of total return', style: { color: INK3, fontSize: '0.65rem', fontFamily: "'IBM Plex Sans', sans-serif" } }, labels: { style: { color: INK3, fontSize: '0.65rem' } }, gridLineColor: BORDER, max: 100 },
    legend: { enabled: false },
    tooltip: { formatter() { return `Day ${(this.x as number) + 1}: <b>${this.y?.toFixed(1)}%</b> cumulative` }, backgroundColor: PAPER2, borderColor: BORDER, style: { color: INK, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem' } },
    plotOptions: { line: { color: CYAN, lineWidth: 2, marker: { enabled: false } } },
    series: [
      { type: 'line', data: curve },
      { type: 'line', data: curve.map((_, i) => parseFloat(((i + 1) / curve.length * 100).toFixed(1))), color: `${INK3}60`, dashStyle: 'Dash', lineWidth: 1, name: 'Ideal' },
    ],
    credits: { enabled: false },
  }
  return <HighchartsReact highcharts={Highcharts} options={opts} />
}

// ── Missing Best Days waterfall ───────────────────────────────────────────────

function WaterfallChart({ report }: { report: RandomnessReport }) {
  const { INK, INK3, BORDER, PAPER2 } = usePalette()
  const c = report.concentration
  const categories = ['Actual', 'Miss Best 1', 'Miss Best 5', 'Miss Best 10', 'Miss Best 20']
  const values = [c.return_actual_pct, c.return_minus_best_1, c.return_minus_best_5, c.return_minus_best_10, c.return_minus_best_20]
  const colors = values.map(v => v >= 0 ? '#22c55e' : '#ef4444')

  const opts: Highcharts.Options = {
    chart: { type: 'column', backgroundColor: 'transparent', height: 240, margin: [16, 8, 56, 56] },
    title: { text: undefined },
    xAxis: { categories, labels: { style: { color: INK3, fontSize: '0.65rem', fontFamily: "'IBM Plex Sans', sans-serif" } }, lineColor: BORDER, tickColor: BORDER },
    yAxis: { title: { text: 'Return (%)', style: { color: INK3, fontSize: '0.65rem', fontFamily: "'IBM Plex Sans', sans-serif" } }, labels: { style: { color: INK3, fontSize: '0.65rem' }, format: '{value}%' }, gridLineColor: BORDER, plotLines: [{ value: 0, color: INK3, width: 1 }] },
    legend: { enabled: false },
    tooltip: { formatter() { return `<b>${this.x}</b>: ${(this.y ?? 0).toFixed(1)}%` }, backgroundColor: PAPER2, borderColor: BORDER, style: { color: INK, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem' } },
    plotOptions: { column: { colorByPoint: true, colors, borderWidth: 0, borderRadius: 2 } },
    series: [{ type: 'column', data: values }],
    credits: { enabled: false },
  }
  return <HighchartsReact highcharts={Highcharts} options={opts} />
}

// ── Fragility Radar ───────────────────────────────────────────────────────────

function RadarChart({ report }: { report: RandomnessReport }) {
  const { INK, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const f = report.fragility
  const axes = ['Concentration', 'DD Dependence', 'Regime Dep.', 'Path Sensitivity', 'Recovery Dep.']
  const vals = [
    report.concentration.rcr,
    f.dd_recovery_dependence,
    f.regime_dependence_score,
    Math.min(100, f.path_iqr * 2),
    f.worst_period_dependence,
  ]

  const opts: Highcharts.Options = {
    chart: { polar: true, type: 'line', backgroundColor: 'transparent', height: 280 },
    title: { text: undefined },
    pane: { size: '75%' },
    xAxis: { categories: axes, tickmarkPlacement: 'on', lineWidth: 0, labels: { style: { color: INK3, fontSize: '0.62rem', fontFamily: "'IBM Plex Sans', sans-serif" } } },
    yAxis: { gridLineColor: BORDER, min: 0, max: 100, tickAmount: 4, labels: { style: { color: INK3, fontSize: '0.6rem' } } },
    legend: { enabled: false },
    tooltip: { formatter() { return `<b>${this.point.category}</b>: ${(this.y ?? 0).toFixed(1)}` }, backgroundColor: PAPER2, borderColor: BORDER, style: { color: INK, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem' } },
    plotOptions: { line: { color: CYAN, lineWidth: 2, marker: { enabled: true, radius: 3, fillColor: CYAN } } },
    series: [{ type: 'line', data: vals, pointPlacement: 'on' }],
    credits: { enabled: false },
  }
  return <HighchartsReact highcharts={Highcharts} options={opts} />
}

// ── Monte Carlo histogram ─────────────────────────────────────────────────────

function MCChart({ report }: { report: RandomnessReport }) {
  const { INK, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const f = report.fragility
  const opts: Highcharts.Options = {
    chart: { type: 'column', backgroundColor: 'transparent', height: 220, margin: [16, 8, 48, 48] },
    title: { text: undefined },
    xAxis: {
      title: { text: 'Shuffled CAGR (%)', style: { color: INK3, fontSize: '0.65rem', fontFamily: "'IBM Plex Sans', sans-serif" } },
      categories: f.mc_histogram.map(b => b.cagr_pct.toString()),
      labels: { step: 5, style: { color: INK3, fontSize: '0.6rem' } },
      lineColor: BORDER, tickColor: BORDER,
      plotLines: [
        { value: f.mc_histogram.findIndex(b => b.cagr_pct >= f.monte_carlo_p10_cagr), color: '#ef4444', width: 1, dashStyle: 'Dash', label: { text: 'P10', style: { color: '#ef4444', fontSize: '0.6rem' } } },
        { value: f.mc_histogram.findIndex(b => b.cagr_pct >= f.monte_carlo_p50_cagr), color: INK3, width: 1, dashStyle: 'Dash', label: { text: 'P50', style: { color: INK3, fontSize: '0.6rem' } } },
        { value: f.mc_histogram.findIndex(b => b.cagr_pct >= f.monte_carlo_p90_cagr), color: '#22c55e', width: 1, dashStyle: 'Dash', label: { text: 'P90', style: { color: '#22c55e', fontSize: '0.6rem' } } },
      ],
    },
    yAxis: { title: { text: 'Simulations', style: { color: INK3, fontSize: '0.65rem', fontFamily: "'IBM Plex Sans', sans-serif" } }, labels: { style: { color: INK3, fontSize: '0.6rem' } }, gridLineColor: BORDER },
    legend: { enabled: false },
    tooltip: { formatter() { return `CAGR ~${this.x}%: <b>${this.y} runs</b>` }, backgroundColor: PAPER2, borderColor: BORDER, style: { color: INK, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem' } },
    plotOptions: {
      column: {
        borderWidth: 0, borderRadius: 1, groupPadding: 0, pointPadding: 0.05,
        colorByPoint: true,
        colors: f.mc_histogram.map(b => b.cagr_pct >= 0 ? `${CYAN}99` : '#ef444499'),
      },
    },
    series: [{ type: 'column', data: f.mc_histogram.map(b => b.count) }],
    credits: { enabled: false },
  }
  return <HighchartsReact highcharts={Highcharts} options={opts} />
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RandomnessPage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, BORDER, BG, PAPER, PAPER2, CYAN } = usePalette()
  const { CARD, INPUT_SX } = useTokens()
  const symbols = useSymbols()

  const [symbol, setSymbol] = useState('RELIANCE')
  const [report, setReport] = useState<RandomnessReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (sym: string) => {
    setLoading(true)
    setError(null)
    setReport(null)
    try {
      const r = await randomnessApi.getReport(sym)
      setReport(r)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [])

  const luckColor = (s: number) => s < 30 ? '#22c55e' : s < 60 ? '#fbbf24' : '#ef4444'
  const fragColor = (s: number) => s < 30 ? '#22c55e' : s < 60 ? '#fbbf24' : '#ef4444'
  const rcrColor = (s: number) => s < 20 ? '#22c55e' : s < 50 ? '#fbbf24' : '#ef4444'

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK }}>
      <Navbar />

      {/* ── Hero ── */}
      <Box sx={{
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        borderBottom: `1px solid ${BORDER}`,
        px: { xs: 3, md: 8, lg: 12 }, pt: { xs: 6, md: 8 }, pb: { xs: 5, md: 7 },
      }}>
        <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
          {/* Eyebrow badge */}
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5,
            px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D` }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN,
              animation: 'hpulse 2s ease-in-out infinite',
              '@keyframes hpulse': { '0%,100%': { boxShadow: `0 0 4px ${CYAN}` }, '50%': { boxShadow: `0 0 14px ${CYAN}` } } }} />
            <Typography sx={{ ...SANS, fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Luck vs Skill · Concentration · Fragility
            </Typography>
          </Box>

          {/* Main headline */}
          <Typography sx={{ ...SANS, fontWeight: 800, color: INK, fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' }, lineHeight: 1.1, letterSpacing: '-0.03em', mb: 1.5 }}>
            Randomness{' '}
            <Box component="span" sx={{ color: CYAN, textShadow: `0 0 32px ${CYAN}70` }}>Intelligence</Box>
          </Typography>

          <Typography sx={{ ...SANS, fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, mb: 3, maxWidth: 520 }}>
            How believable was that return? Decompose any stock's history into skill,
            concentration risk, and fragility — before you trust it with capital.
          </Typography>

          {/* Symbol selector + run button */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              size="small"
              sx={{ ...INPUT_SX, height: 36, minWidth: 200, borderRadius: 0 }}
              MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: 0, '& .MuiMenuItem-root': { ...MONO, fontSize: '0.875rem', color: INK2, '&:hover': { bgcolor: BORDER }, '&.Mui-selected': { bgcolor: BORDER, color: CYAN } } } } }}
            >
              {symbols.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
            <Box
              component="button"
              onClick={() => run(symbol)}
              disabled={loading}
              sx={{
                px: 2.5, py: 0.9, bgcolor: CYAN, color: '#000', border: 'none', cursor: loading ? 'wait' : 'pointer',
                ...SANS, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s',
                '&:hover': { opacity: loading ? 0.7 : 0.85 },
              }}
            >
              {loading ? 'Analysing…' : 'Analyse'}
            </Box>
          </Box>

          {/* Verdict strip */}
          {report && (
            <Box sx={{ mt: 3, p: 1.75, bgcolor: `${CYAN}0A`, border: `1px solid ${CYAN}30`, maxWidth: 640 }}>
              <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK, lineHeight: 1.65 }}>
                <Box component="span" sx={{ fontWeight: 700 }}>{report.verdict}</Box>
                {' '}<Box component="span" sx={{ color: '#ef4444' }}>{report.key_risk}</Box>
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* ── Body ── */}
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4, lg: 6 }, py: 4 }}>

        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 6 }}>
            <CircularProgress size={20} sx={{ color: CYAN }} />
            <Typography sx={{ ...SANS, fontSize: '0.82rem', color: INK3 }}>
              Running Luck/Skill · Concentration · Monte Carlo (10,000 shuffles)…
            </Typography>
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        {report && (() => {
          const ls = report.luck_skill
          const c = report.concentration
          const f = report.fragility

          return (
            <>
              {/* ── Three composite scores ── */}
              <Grid container spacing={2} sx={{ mb: 3 }}>
                {[
                  { label: 'Luck Score', value: ls.luck_score, sub: ls.luck_label, color: luckColor(ls.luck_score), lo: 'Pure Skill', hi: 'Pure Luck' },
                  { label: 'Concentration (RCR)', value: c.rcr, sub: c.rcr_label, color: rcrColor(c.rcr), lo: 'Healthy', hi: 'Fragile' },
                  { label: 'Fragility Score', value: f.fragility_score, sub: f.fragility_label, color: fragColor(f.fragility_score), lo: 'Robust', hi: 'Fragile' },
                ].map(item => (
                  <Grid item xs={12} md={4} key={item.label}>
                    <Box sx={{ ...CARD, p: 2 }}>
                      <Typography sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK3, mb: 1.5 }}>{item.label}</Typography>
                      <Typography sx={{ ...MONO, fontSize: '2rem', fontWeight: 800, color: item.color, lineHeight: 1, mb: 0.5 }}>{item.value.toFixed(1)}</Typography>
                      <Typography sx={{ ...SANS, fontSize: '0.75rem', color: item.color, fontWeight: 600, mb: 1.5 }}>{item.sub}</Typography>
                      <ScoreBar label="" value={item.value} color={item.color} lo={item.lo} hi={item.hi} />
                    </Box>
                  </Grid>
                ))}
              </Grid>

              {/* ── Insight Panel ── */}
              <InsightPanel report={report} />

              {/* ── Module 1: Luck / Skill ── */}
              <Box sx={{ ...CARD, p: 2.5, mb: 3 }}>
                <SectionHead title="Luck vs Skill Decomposition" accent="#3b82f6" />
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={6} sm={3}>
                    <MetricCard label="Luck Score" value={`${ls.luck_score.toFixed(1)} / 100`} sub={ls.luck_label} color={luckColor(ls.luck_score)} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard label="Consistency" value={`${ls.consistency_score.toFixed(1)}%`} sub="Positive months" color="#22c55e" />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard label="Start-Date IQR" value={`${ls.outcome_dispersion.toFixed(1)}%`} sub="Return dispersion" color={ls.outcome_dispersion > 50 ? '#ef4444' : '#fbbf24'} />
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <MetricCard label="Positive Starts" value={`${ls.pct_positive_starts.toFixed(0)}%`} sub="Of 1,000 random entries" color={ls.pct_positive_starts > 70 ? '#22c55e' : '#fbbf24'} />
                  </Grid>
                </Grid>
                <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, p: 1.5 }}>
                  <Grid container spacing={3}>
                    {[
                      { label: 'Start-Date Sensitivity', value: ls.outcome_dispersion, lo: '< 30% = low luck', hi: '> 80% = high luck', color: luckColor(Math.min(100, ls.outcome_dispersion * 1.2)) },
                      { label: 'Rolling Return CV', value: ls.rolling_cv, lo: '< 50% = stable', hi: '> 200% = volatile', color: luckColor(Math.min(100, ls.rolling_cv / 3)) },
                      { label: '1 − Consistency', value: 100 - ls.consistency_score, lo: '< 30% = skilled', hi: '> 50% = erratic', color: luckColor(100 - ls.consistency_score) },
                    ].map(row => (
                      <Grid item xs={12} sm={4} key={row.label}>
                        <ScoreBar label={row.label} value={Math.min(100, row.value)} color={row.color} lo={row.lo} hi={row.hi} />
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              </Box>

              {/* ── Module 2: Return Concentration ── */}
              <Box sx={{ ...CARD, p: 2.5, mb: 3 }}>
                <SectionHead title="Return Concentration" accent="#a855f7" />
                <Grid container spacing={2.5}>
                  <Grid item xs={12} md={5}>
                    <Grid container spacing={1.5} sx={{ mb: 2 }}>
                      {[
                        { label: 'Top 1 Day', value: c.top_1_contribution },
                        { label: 'Top 5 Days', value: c.top_5_contribution },
                        { label: 'Top 10 Days (RCR)', value: c.top_10_contribution },
                        { label: 'Top 20 Days', value: c.top_20_contribution },
                      ].map(row => (
                        <Grid item xs={6} key={row.label}>
                          <MetricCard label={row.label} value={`${row.value.toFixed(1)}%`} sub="of total return" color={rcrColor(row.value)} />
                        </Grid>
                      ))}
                    </Grid>
                    <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK3, mb: 1.25, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      If you missed the best N days…
                    </Typography>
                    <WaterfallChart report={report} />
                  </Grid>
                  <Grid item xs={12} md={7}>
                    <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK3, mb: 1, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Concentration Curve — ideal = diagonal line
                    </Typography>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 1 }}>
                      A steep early climb means gains are concentrated in very few days.
                    </Typography>
                    <CurvChart curve={c.concentration_curve} />
                    <Box sx={{ mt: 2 }}>
                      <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK3, mb: 1, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Top 20 contributing days
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                        {c.top_days.slice(0, 20).map(d => (
                          <Box key={d.date} sx={{ px: 1, py: 0.4, bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: d.return_pct > 0 ? '#22c55e' : '#ef4444' }}>
                              {d.date} +{d.return_pct.toFixed(1)}%
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  </Grid>
                </Grid>
              </Box>

              {/* ── Module 3: Fragility ── */}
              <Box sx={{ ...CARD, p: 2.5, mb: 3 }}>
                <SectionHead title="Fragility Analysis" accent="#f59e0b" />
                <Grid container spacing={2.5}>
                  <Grid item xs={12} md={4}>
                    <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK3, mb: 0.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Fragility Radar
                    </Typography>
                    <RadarChart report={report} />
                    <Grid container spacing={1} sx={{ mt: 1 }}>
                      {[
                        { label: 'Worst Period Dep.', value: `${f.worst_period_dependence.toFixed(0)}%` },
                        { label: 'DD Recovery Dep.', value: `${f.dd_recovery_dependence.toFixed(0)}%` },
                        { label: 'Regime Dependence', value: `${f.regime_dependence_score.toFixed(0)}%` },
                        { label: 'Edge Persistence', value: `${f.edge_persistence.toFixed(0)}%` },
                      ].map(row => (
                        <Grid item xs={6} key={row.label}>
                          <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, px: 1.25, py: 0.75 }}>
                            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>{row.label}</Typography>
                            <Typography sx={{ ...MONO, fontSize: '0.82rem', fontWeight: 700, color: INK }}>{row.value}</Typography>
                          </Box>
                        </Grid>
                      ))}
                    </Grid>
                  </Grid>
                  <Grid item xs={12} md={8}>
                    <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK3, mb: 0.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Monte Carlo — 10,000 Shuffled Return Sequences
                    </Typography>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 1 }}>
                      If the order of daily returns had been randomised, where would CAGR have landed?
                    </Typography>
                    <MCChart report={report} />
                    <Grid container spacing={1.5} sx={{ mt: 1.5 }}>
                      {[
                        { label: 'P10 CAGR', value: `${f.monte_carlo_p10_cagr.toFixed(1)}%`, color: '#ef4444' },
                        { label: 'P50 CAGR', value: `${f.monte_carlo_p50_cagr.toFixed(1)}%`, color: INK },
                        { label: 'P90 CAGR', value: `${f.monte_carlo_p90_cagr.toFixed(1)}%`, color: '#22c55e' },
                        { label: '% Runs Positive', value: `${f.pct_shuffles_positive.toFixed(0)}%`, color: CYAN },
                      ].map(row => (
                        <Grid item xs={6} sm={3} key={row.label}>
                          <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, p: 1.25, textAlign: 'center' }}>
                            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>{row.label}</Typography>
                            <Typography sx={{ ...MONO, fontSize: '0.95rem', fontWeight: 800, color: row.color }}>{row.value}</Typography>
                          </Box>
                        </Grid>
                      ))}
                    </Grid>

                    {/* Regime performance */}
                    <Box sx={{ mt: 2, p: 1.5, bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                      <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK3, mb: 1, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Regime Performance (vs SMA-200)
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 3 }}>
                        <Box>
                          <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>Bull regime</Typography>
                          <Typography sx={{ ...MONO, fontSize: '1rem', fontWeight: 800, color: '#22c55e' }}>{f.bull_regime_return > 0 ? '+' : ''}{f.bull_regime_return.toFixed(1)}%</Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>Bear regime</Typography>
                          <Typography sx={{ ...MONO, fontSize: '1rem', fontWeight: 800, color: f.bear_regime_return >= 0 ? '#22c55e' : '#ef4444' }}>{f.bear_regime_return > 0 ? '+' : ''}{f.bear_regime_return.toFixed(1)}%</Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>Actual CAGR</Typography>
                          <Typography sx={{ ...MONO, fontSize: '1rem', fontWeight: 800, color: CYAN }}>{report.cagr > 0 ? '+' : ''}{report.cagr.toFixed(1)}%</Typography>
                        </Box>
                      </Box>
                    </Box>
                  </Grid>
                </Grid>
              </Box>

              {/* ── Computed at ── */}
              <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3, textAlign: 'right', pb: 2 }}>
                {report.symbol} · {report.period_start} → {report.period_end} · {report.years}y · computed {report.computed_at}
              </Typography>
            </>
          )
        })()}
      </Box>
      <Footer />
    </Box>
  )
}
