import { useState, useEffect, useRef } from 'react'
import { Box, Typography, CircularProgress, Collapse } from '@mui/material'
import Navbar from '../components/Navbar'
import { deliveryApi } from '../api/deliveryApi'
import type {
  DeliverySummaryResult, DeliveryReport, DeliverySignal, DeliveryBar, SignalOccurrence,
} from '../types/delivery'
import { GRADE_COLOR, DIR_COLOR, DIST_BUCKET_ORDER } from '../types/delivery'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

// ─── Module-level font constants (not colors — safe at module level) ───────────

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const

const fmtDate = (d: string) => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const [, m, day] = d.split('-')
  return `${months[parseInt(m) - 1]} ${day}`
}

// ─── Delivery sparkline ───────────────────────────────────────────────────────

function DeliverySparkline({ bars }: { bars: DeliveryBar[] }) {
  const { INK, BORDER, CYAN } = usePalette()
  const { mode } = useThemeMode()
  if (bars.length < 2) return null
  const n = bars.length
  const tickPositions = [0, Math.floor((n - 1) / 2), n - 1]

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 100,
      margin: [4, 4, 20, 4],
      backgroundColor: 'transparent',
      animation: false,
      style: { fontFamily: 'inherit' },
    },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      categories: bars.map(b => fmtDate(b.date)),
      tickPositions,
      labels: { style: { color: '#A8A29E', fontSize: '9px' } },
      lineColor: BORDER,
      tickColor: BORDER,
    },
    yAxis: {
      min: 0,
      max: 100,
      title: { text: null },
      labels: { enabled: false },
      gridLineColor: BORDER,
      plotLines: [{
        value: 70,
        color: `${CYAN}80`,
        dashStyle: 'Dash' as const,
        width: 1,
        label: {
          text: '70%',
          style: { color: `${CYAN}99`, fontSize: '8px' },
          align: 'right',
          x: -4,
        },
      }],
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0F1C3A' : '#FFFFFF',
      borderColor: BORDER,
      borderRadius: 6,
      style: { color: INK, fontSize: '11px' },
      formatter() {
        const v = this.y as number
        return `<b>${this.x}</b><br/>Delivery: <b>${v.toFixed(1)}%</b>${v >= 70 ? ' ▲ high' : ''}`
      },
    },
    plotOptions: {
      column: { borderWidth: 0, groupPadding: 0.05, pointPadding: 0.01 },
    },
    series: [
      {
        type: 'column',
        name: 'Delivery %',
        data: bars.map(b => ({
          y: b.delivery_pct,
          color: b.delivery_pct >= 70
            ? 'rgba(34,197,94,0.55)'
            : b.delivery_spike
            ? 'rgba(251,191,36,0.45)'
            : 'rgba(96,165,250,0.25)',
        })),
      },
      {
        type: 'spline',
        name: 'Trend',
        data: bars.map(b => b.delivery_pct),
        color: CYAN,
        lineWidth: 1.5,
        marker: { enabled: false },
        enableMouseTracking: false,
      },
    ],
  }

  return (
    <HighchartsReact
      highcharts={Highcharts}
      options={options}
      containerProps={{ style: { width: '100%' } }}
    />
  )
}

// ─── Volume sparkline ─────────────────────────────────────────────────────────

function VolumeSparkline({ bars }: { bars: DeliveryBar[] }) {
  const { INK, BORDER, CYAN } = usePalette()
  const { mode } = useThemeMode()
  if (bars.length < 2) return null
  const n = bars.length
  const tickPositions = [0, Math.floor((n - 1) / 2), n - 1]
  const validRatios = bars.map(b => b.vol_ratio).filter(r => !isNaN(r) && r > 0)
  const maxRatio = Math.max(...validRatios, 3)

  const options: Highcharts.Options = {
    chart: {
      height: 100,
      margin: [4, 4, 20, 4],
      backgroundColor: 'transparent',
      animation: false,
      style: { fontFamily: 'inherit' },
    },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      categories: bars.map(b => fmtDate(b.date)),
      tickPositions,
      labels: { style: { color: '#A8A29E', fontSize: '9px' } },
      lineColor: BORDER,
      tickColor: BORDER,
    },
    yAxis: [
      {
        title: { text: null },
        labels: { enabled: false },
        gridLineColor: BORDER,
      },
      {
        title: { text: null },
        labels: { enabled: false },
        min: 0,
        max: maxRatio * 1.1,
        opposite: true,
        gridLineWidth: 0,
        plotLines: [{
          value: 1,
          color: `${CYAN}80`,
          dashStyle: 'Dash' as const,
          width: 1,
        }],
      },
    ],
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0F1C3A' : '#FFFFFF',
      borderColor: BORDER,
      borderRadius: 6,
      style: { color: INK, fontSize: '11px' },
      shared: true,
      formatter() {
        const pts = (this as Highcharts.TooltipFormatterContextObject & { points?: { series: { name: string }; y: number }[] }).points
        if (!pts) return ''
        let s = `<b>${this.x}</b>`
        pts.forEach(p => {
          const v = p.y ?? 0
          if (p.series.name === 'Volume') {
            const vol = v > 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`
            s += `<br/>Volume: <b>${vol}</b>`
          } else {
            s += `<br/>Vol Ratio: <b>${v.toFixed(2)}×</b>${v >= 2 ? ' ▲ spike' : ''}`
          }
        })
        return s
      },
    },
    plotOptions: {
      column: { borderWidth: 0, groupPadding: 0.05, pointPadding: 0.01 },
    },
    series: [
      {
        type: 'column',
        name: 'Volume',
        yAxis: 0,
        data: bars.map(b => ({
          y: b.volume,
          color: b.vol_ratio >= 2 ? 'rgba(251,191,36,0.55)' : 'rgba(148,163,184,0.22)',
        })),
      },
      {
        type: 'spline',
        name: 'Vol Ratio',
        yAxis: 1,
        data: bars.map(b => isNaN(b.vol_ratio) ? null : b.vol_ratio),
        color: '#a78bfa',
        lineWidth: 1.5,
        marker: { enabled: false },
      },
    ],
  }

  return (
    <HighchartsReact
      highcharts={Highcharts}
      options={options}
      containerProps={{ style: { width: '100%' } }}
    />
  )
}

// ─── Distribution histogram ───────────────────────────────────────────────────

function DistributionHistogram({ dist }: { dist: Record<string, number> }) {
  const { INK, INK2, BORDER } = usePalette()
  const { mode } = useThemeMode()
  const values = DIST_BUCKET_ORDER.map(k => dist[k] ?? 0)
  const total = values.reduce((a, b) => a + b, 0)
  const isNeg = (k: string) => k.startsWith('<-') || k.startsWith('-')

  const options: Highcharts.Options = {
    chart: {
      type: 'column',
      height: 130,
      margin: [16, 4, 24, 4],
      backgroundColor: 'transparent',
      animation: false,
      style: { fontFamily: 'inherit' },
    },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      categories: DIST_BUCKET_ORDER,
      labels: { style: { color: '#A8A29E', fontSize: '9px' } },
      lineColor: BORDER,
      tickColor: BORDER,
    },
    yAxis: {
      title: { text: null },
      labels: { enabled: false },
      gridLineColor: BORDER,
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0F1C3A' : '#FFFFFF',
      borderColor: BORDER,
      borderRadius: 6,
      style: { color: INK, fontSize: '11px' },
      formatter() {
        const pct = total > 0 ? Math.round((this.y as number) / total * 100) : 0
        return `<b>${this.x}</b><br/>${this.y} occurrences <b>(${pct}%)</b>`
      },
    },
    plotOptions: {
      column: {
        borderWidth: 0,
        groupPadding: 0.1,
        pointPadding: 0.05,
        borderRadius: 2,
        dataLabels: {
          enabled: true,
          formatter() {
            const pct = total > 0 ? Math.round((this.y as number) / total * 100) : 0
            return pct > 0 ? `${pct}%` : ''
          },
          style: {
            color: INK2,
            fontSize: '9px',
            fontWeight: '600',
            textOutline: 'none',
          },
        },
      },
    },
    series: [{
      type: 'column',
      name: 'Occurrences',
      data: DIST_BUCKET_ORDER.map((k, i) => ({
        y: values[i],
        color: isNeg(k) ? 'rgba(239,68,68,0.65)' : 'rgba(34,197,94,0.65)',
      })),
    }],
  }

  return (
    <HighchartsReact
      highcharts={Highcharts}
      options={options}
      containerProps={{ style: { width: '100%' } }}
    />
  )
}

// ─── Timeline scatter chart ───────────────────────────────────────────────────

type Horizon = '1d' | '1w' | '1m' | '1y'

function TimelineChart({ occurrences }: { occurrences: SignalOccurrence[] }) {
  const { INK, INK2, INK3, BORDER, CYAN, PAPER2 } = usePalette()
  const { mode } = useThemeMode()
  const [horizon, setHorizon] = useState<Horizon>('1m')

  const getVal = (o: SignalOccurrence) => {
    if (horizon === '1d') return o.ret_1d
    if (horizon === '1w') return o.ret_1w
    if (horizon === '1y') return o.ret_1y
    return o.ret_1m
  }

  const points = occurrences
    .map((o, i) => ({ i, val: getVal(o), date: o.date }))
    .filter(p => p.val !== null) as { i: number; val: number; date: string }[]

  if (points.length === 0) {
    return (
      <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK3, p: 1 }}>
        No data for {horizon} horizon yet.
      </Typography>
    )
  }

  const n = points.length
  const dateByIdx = new Map(points.map(p => [p.i, p.date]))
  const tickXVals = [points[0].i, points[Math.floor((n - 1) / 2)].i, points[n - 1].i]

  const options: Highcharts.Options = {
    chart: {
      type: 'scatter',
      height: 190,
      margin: [8, 8, 24, 42],
      backgroundColor: 'transparent',
      animation: false,
      style: { fontFamily: 'inherit' },
    },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: {
      min: -0.5,
      max: points[n - 1].i + 0.5,
      tickPositions: tickXVals,
      labels: {
        formatter() {
          const d = dateByIdx.get(this.value as number)
          return d ? fmtDate(d) : ''
        },
        style: { color: '#A8A29E', fontSize: '9px' },
      },
      lineColor: BORDER,
      tickColor: BORDER,
      gridLineWidth: 0,
    },
    yAxis: {
      title: { text: null },
      gridLineColor: BORDER,
      labels: {
        format: '{value:.1f}%',
        style: { color: '#A8A29E', fontSize: '9px' },
      },
      plotLines: [{
        value: 0,
        color: mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(28,25,23,0.18)',
        width: 1,
      }],
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0F1C3A' : '#FFFFFF',
      borderColor: BORDER,
      borderRadius: 6,
      style: { color: INK, fontSize: '11px' },
      formatter() {
        const pt = this.point as Highcharts.Point & { date?: string }
        const val = this.y as number
        return `<b>${pt.date ?? ''}</b><br/>${horizon.toUpperCase()}: <b>${val > 0 ? '+' : ''}${val.toFixed(2)}%</b>`
      },
    },
    plotOptions: {
      scatter: {
        marker: {
          radius: 5,
          symbol: 'circle',
          states: { hover: { enabled: true, radiusPlus: 2 } },
        },
      },
    },
    series: [{
      type: 'scatter',
      name: 'Return',
      data: points.map(p => ({
        x: p.i,
        y: p.val,
        date: p.date,
        color: p.val > 0 ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)',
      } as Highcharts.PointOptionsObject & { date: string })),
    }],
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
        {(['1d', '1w', '1m', '1y'] as Horizon[]).map(h => (
          <Box key={h} onClick={() => setHorizon(h)} sx={{
            px: 1, py: 0.3, borderRadius: '4px', cursor: 'pointer',
            fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', ...JAKARTA,
            bgcolor: horizon === h ? `${CYAN}25` : PAPER2,
            color: horizon === h ? CYAN : INK2,
            border: `1px solid ${horizon === h ? `${CYAN}50` : BORDER}`,
          }}>
            {h === '1y' ? '1Y*' : h.toUpperCase()}
          </Box>
        ))}
        <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK3, ml: 0.5, alignSelf: 'center' }}>
          Forward return on each signal occurrence
        </Typography>
      </Box>
      <HighchartsReact
        highcharts={Highcharts}
        options={options}
        containerProps={{ style: { width: '100%' } }}
      />
      {horizon === '1y' && (
        <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK3, mt: 0.25 }}>
          * 1Y returns only available for early occurrences (need 252 days forward data)
        </Typography>
      )}
    </Box>
  )
}

// ─── Structured interpretation component ─────────────────────────────────────

const Pos = ({ v }: { v: number }) => (
  <Box component="span" sx={{ color: v > 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</Box>
)
const WR = ({ v }: { v: number }) => (
  <Box component="span" sx={{ color: v >= 65 ? '#22c55e' : v >= 55 ? '#fbbf24' : '#ef4444', fontWeight: 700 }}>{v.toFixed(1)}%</Box>
)

function SignalInterpretation({ sig, symbol }: { sig: DeliverySignal; symbol: string }) {
  const { INK, INK2, INK3, BORDER, CYAN, PAPER, PAPER2 } = usePalette()

  // Hi helper defined inside so it has access to INK from usePalette
  const Hi = ({ children, color = INK }: { children: React.ReactNode; color?: string }) => (
    <Box component="span" sx={{ color, fontWeight: 700 }}>{children}</Box>
  )

  const st = sig.stats
  const { win_rate, expected_value, avg_1d, avg_1w, avg_1m, max_adverse, occurrences } = st
  const hi = st.mkt_regime_high_win_rate
  const lo = st.mkt_regime_low_win_rate
  const dir = sig.direction === 'Bullish' ? 'bullish' : sig.direction === 'Bearish' ? 'bearish' : 'mixed-direction'
  const quality = win_rate >= 65 && expected_value >= 3 ? 'strong, high-conviction'
    : win_rate >= 60 && expected_value >= 2 ? 'solid'
    : win_rate >= 55 ? 'moderate' : 'marginal'
  const wkVsMo = Math.abs(avg_1w) / (Math.abs(avg_1m) || 0.01)
  const largeLoss = st.distribution['<-10'] ?? 0
  const largeGain = st.distribution['>10'] ?? 0

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 1.25, alignItems: 'flex-start' }}>
      <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK2, minWidth: 96, pt: 0.1, flexShrink: 0, fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography component="div" sx={{ ...JAKARTA, fontSize: '0.74rem', color: INK2, lineHeight: 1.7 }}>
        {children}
      </Typography>
    </Box>
  )

  const Section = ({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) => (
    <Box sx={{ p: 2, borderRadius: '10px', bgcolor: PAPER,
      border: `1.5px solid ${BORDER}` }}>
      <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', fontWeight: 800, color: CYAN, mb: 1.5,
        textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 0.75,
        borderBottom: `1px solid ${CYAN}25`, pb: 1 }}>
        {icon} {title}
      </Typography>
      {children}
    </Box>
  )

  return (
    <Box sx={{ p: 2, borderRadius: '10px', bgcolor: PAPER2,
      border: `1px solid ${BORDER}`, mb: 2.5 }}>
      <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', fontWeight: 800, color: CYAN, mb: 1.75,
        textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        💡 Interpretation
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5 }}>

        {/* Section 1: Signal Quality */}
        <Section icon="📊" title="Signal Quality">
          <Row label="Summary">
            <Hi color={INK}>{symbol}</Hi>'s "{sig.name}" has fired{' '}
            <Hi>{occurrences} times</Hi> — a <Hi color={
              quality === 'strong, high-conviction' ? '#22c55e'
                : quality === 'solid' ? '#16a34a'
                : quality === 'moderate' ? '#fbbf24' : '#ef4444'
            }>{quality}</Hi> {dir} edge.
          </Row>
          <Row label="Win Rate"><WR v={win_rate} /> of occurrences reached target within 1M</Row>
          <Row label="Exp. Value">
            <Pos v={expected_value} /> per signal on average
            {expected_value <= 0 && <Hi color="#ef4444"> — losses outweigh wins in magnitude</Hi>}
          </Row>
        </Section>

        {/* Section 2: Speed of Payoff */}
        <Section icon="⚡" title="Speed of Payoff">
          <Row label="Progression">
            1D <Pos v={avg_1d} /> → 1W <Pos v={avg_1w} /> → 1M <Pos v={avg_1m} />
          </Row>
          <Row label="Holding">
            {wkVsMo > 0.75
              ? <>Move materialises <Hi color="#22c55e">quickly</Hi> — most edge plays out within 1 week. Entry timing is critical.</>
              : wkVsMo < 0.3
              ? <>Edge is <Hi color="#fbbf24">slow to develop</Hi> — 1W muted, full move takes 2–4 weeks. Avoid early exits.</>
              : <>Gradual development — returns build steadily from 1D through 1M.</>}
          </Row>
        </Section>

        {/* Section 3: Regime Effect */}
        <Section icon="🏛" title="Market Regime Effect">
          {hi !== null && lo !== null ? (() => {
            const lift = hi - lo
            const mag = Math.abs(lift)
            const strongerIn = lift >= 0 ? 'bull' : 'weak'
            const strongerWR = lift >= 0 ? hi : lo
            const weakerWR   = lift >= 0 ? lo : hi
            return (
              <>
                <Row label="Bull (≥60)">
                  <WR v={hi} /> · EV {st.mkt_regime_high_ev !== null ? <Pos v={st.mkt_regime_high_ev} /> : '—'} · N={st.mkt_regime_high_occurrences}
                  {lift >= 0 && mag >= 6 && <Hi color="#22c55e"> ✓ stronger</Hi>}
                </Row>
                <Row label="Weak (&lt;60)">
                  <WR v={lo} /> · EV {st.mkt_regime_low_ev !== null ? <Pos v={st.mkt_regime_low_ev} /> : '—'} · N={st.mkt_regime_low_occurrences}
                  {lift < 0 && mag >= 6 && <Hi color="#fbbf24"> ✓ stronger</Hi>}
                </Row>
                <Row label="Verdict">
                  {mag >= 12
                    ? strongerIn === 'bull'
                      ? <><Hi color="#22c55e">{mag.toFixed(0)}pp stronger</Hi> in trending markets (<WR v={strongerWR} /> vs <WR v={weakerWR} />) — trend-continuation signal. Use regime ≥60 as a filter.</>
                      : <><Hi color="#fbbf24">{mag.toFixed(0)}pp stronger</Hi> in weak markets (<WR v={strongerWR} /> vs <WR v={weakerWR} />) — mean-reversion signal. Delivery spikes during weakness are dip-buying, not distribution.</>
                    : mag >= 6
                    ? strongerIn === 'bull'
                      ? <>Mild <Hi color="#16a34a">{mag.toFixed(0)}pp</Hi> tilt toward trending markets — better with tailwind but has standalone value.</>
                      : <>Mild <Hi color="#fbbf24">{mag.toFixed(0)}pp</Hi> contrarian tilt — slightly stronger in weak markets.</>
                    : <><Hi>Market-independent</Hi> — {hi.toFixed(1)}% vs {lo.toFixed(1)}% across regimes. Edge is in the delivery mechanics, not market conditions.</>}
                </Row>
              </>
            )
          })() : <Row label="Status"><Hi color={INK3}>Insufficient data to split by regime.</Hi></Row>}
        </Section>

        {/* Section 4: Risk Profile */}
        <Section icon="⚠️" title="Risk Profile">
          <Row label="MAE">Avg worst-case intra-period drawdown: <Hi color="#ef4444">{max_adverse.toFixed(1)}%</Hi></Row>
          <Row label="Shape">
            {largeGain > largeLoss * 2 && largeGain > 0
              ? <><Hi color="#22c55e">Right-skewed</Hi> — {largeGain} occurrence{largeGain > 1 ? 's' : ''} &gt;+10% vs {largeLoss} &lt;−10%. Hold for outlier gains.</>
              : largeLoss > largeGain * 2 && largeLoss > 0
              ? <><Hi color="#ef4444">Left-skewed</Hi> — {largeLoss} occurrence{largeLoss > 1 ? 's' : ''} &lt;−10% vs {largeGain} &gt;+10%. Strict position sizing needed.</>
              : <>Roughly symmetric — wins and losses are balanced in magnitude.</>}
          </Row>
          <Row label="Today">
            {sig.is_active
              ? <><Hi color="#22c55e">ACTIVE</Hi> — delivery {sig.current_delivery_pct.toFixed(1)}%, vol {sig.current_vol_ratio.toFixed(2)}× avg</>
              : <><Hi color={INK3}>Not active</Hi> — signal condition not met today</>}
          </Row>
        </Section>

      </Box>
    </Box>
  )
}

// ─── Expanded signal card ─────────────────────────────────────────────────────

function SignalExpandedCard({ sig, symbol }: { sig: DeliverySignal; symbol: string }) {
  const { INK, INK2, INK3, BORDER, PAPER, CYAN } = usePalette()
  const [showTimeline, setShowTimeline] = useState(true)
  const st = sig.stats
  const dirColor = DIR_COLOR[sig.direction] ?? '#94a3b8'

  return (
    <Box sx={{ p: 2, borderRadius: '10px',
      bgcolor: PAPER,
      border: `1px solid ${dirColor}18`,
    }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ px: 0.9, py: 0.2, borderRadius: '4px', fontSize: '0.65rem', fontWeight: 900,
          bgcolor: (GRADE_COLOR[sig.grade] ?? '#94a3b8') + '20',
          color: GRADE_COLOR[sig.grade] ?? '#94a3b8' }}>
          {sig.grade}
        </Box>
        <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', fontWeight: 800, color: INK, flex: 1 }}>
          {sig.name}
        </Typography>
        <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: dirColor, fontWeight: 700 }}>
          {sig.direction}
        </Typography>
        {sig.is_active && (
          <Box sx={{ px: 0.75, py: 0.2, borderRadius: '4px', fontSize: '0.58rem', fontWeight: 700,
            bgcolor: dirColor + '20', color: dirColor, border: `1px solid ${dirColor}40` }}>
            ACTIVE
          </Box>
        )}
      </Box>

      {/* Key metrics */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        {[
          ['Win Rate', `${st.win_rate.toFixed(1)}%`, st.win_rate >= 60 ? '#22c55e' : st.win_rate >= 50 ? '#fbbf24' : '#ef4444'],
          ['EV (1M)',  `${st.expected_value > 0 ? '+' : ''}${st.expected_value.toFixed(2)}%`, st.expected_value > 0 ? '#22c55e' : '#ef4444'],
          ['Avg 1D',  `${st.avg_1d > 0 ? '+' : ''}${st.avg_1d.toFixed(2)}%`, st.avg_1d > 0 ? '#16a34a' : '#ef4444'],
          ['Avg 1W',  `${st.avg_1w > 0 ? '+' : ''}${st.avg_1w.toFixed(2)}%`, st.avg_1w > 0 ? '#16a34a' : '#ef4444'],
          ['Avg 1M',  `${st.avg_1m > 0 ? '+' : ''}${st.avg_1m.toFixed(2)}%`, st.avg_1m > 0 ? '#22c55e' : '#ef4444'],
          ['MAE',     `-${st.max_adverse.toFixed(2)}%`, '#ef4444'],
          ['N',       `${st.occurrences}`, INK2],
        ].map(([label, val, color]) => (
          <Box key={label}>
            <Typography sx={{ ...JAKARTA, fontSize: '0.55rem', color: INK3, mb: 0.2 }}>{label}</Typography>
            <Typography sx={{ ...JAKARTA, fontSize: '0.82rem', fontWeight: 800, color }}>{val}</Typography>
          </Box>
        ))}
      </Box>

      <SignalInterpretation sig={sig} symbol={symbol} />

      {/* Distribution + Regime side-by-side */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box sx={{ flex: '1 1 220px' }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK3, textTransform: 'uppercase',
            letterSpacing: '0.07em', mb: 0.75 }}>
            1M Return Distribution
          </Typography>
          <DistributionHistogram dist={st.distribution} />
        </Box>

        {(st.mkt_regime_high_win_rate !== null || st.mkt_regime_low_win_rate !== null) && (
          <Box sx={{ flex: '1 1 160px' }}>
            <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK3, textTransform: 'uppercase',
              letterSpacing: '0.07em', mb: 0.75 }}>
              Market Regime Effect
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {st.mkt_regime_high_win_rate !== null && (
                <Box sx={{ p: 1, borderRadius: '6px',
                  bgcolor: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', color: '#22c55e', fontWeight: 700 }}>
                    Mkt Regime ≥60 · N={st.mkt_regime_high_occurrences}
                  </Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '1.1rem', fontWeight: 900,
                    color: st.mkt_regime_high_win_rate >= 60 ? '#22c55e' : '#fbbf24' }}>
                    {st.mkt_regime_high_win_rate.toFixed(1)}%
                  </Typography>
                  {st.mkt_regime_high_ev !== null && (
                    <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', color: INK2 }}>
                      EV {st.mkt_regime_high_ev > 0 ? '+' : ''}{st.mkt_regime_high_ev.toFixed(2)}%
                    </Typography>
                  )}
                </Box>
              )}
              {st.mkt_regime_low_win_rate !== null && (
                <Box sx={{ p: 1, borderRadius: '6px',
                  bgcolor: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', color: '#ef4444', fontWeight: 700 }}>
                    Mkt Regime &lt;60 · N={st.mkt_regime_low_occurrences}
                  </Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '1.1rem', fontWeight: 900,
                    color: st.mkt_regime_low_win_rate >= 60 ? '#22c55e' : '#fbbf24' }}>
                    {st.mkt_regime_low_win_rate.toFixed(1)}%
                  </Typography>
                  {st.mkt_regime_low_ev !== null && (
                    <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', color: INK2 }}>
                      EV {st.mkt_regime_low_ev > 0 ? '+' : ''}{st.mkt_regime_low_ev.toFixed(2)}%
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Box>

      {/* Timeline */}
      <Box>
        <Box onClick={() => setShowTimeline(p => !p)}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, cursor: 'pointer' }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK2, textTransform: 'uppercase',
            letterSpacing: '0.07em', fontWeight: 700 }}>
            Signal History Timeline
          </Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK3 }}>
            {showTimeline ? '▲' : '▼'}
          </Typography>
        </Box>
        <Collapse in={showTimeline}>
          <TimelineChart occurrences={st.timeline} />
        </Collapse>
      </Box>
    </Box>
  )
}

// ─── Stock detail panel ───────────────────────────────────────────────────────

function StockDetail({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const { INK, INK2, INK3, BORDER, PAPER, CYAN } = usePalette()
  const { CARD } = useTokens()
  const [report, setReport] = useState<DeliveryReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    deliveryApi.getReport(symbol)
      .then(setReport)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  return (
    <Box sx={{ ...CARD, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography sx={{ ...JAKARTA, fontSize: '0.9rem', fontWeight: 900, color: INK }}>
          {symbol} — Delivery Intelligence
        </Typography>
        <Box onClick={onClose} sx={{ cursor: 'pointer', fontSize: '0.65rem', color: INK2,
          '&:hover': { color: INK } }}>✕ close</Box>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}>
          <CircularProgress size={18} sx={{ color: CYAN }} />
          <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK2 }}>
            Loading delivery data…
          </Typography>
        </Box>
      ) : error ? (
        <Typography sx={{ fontSize: '0.75rem', color: '#ef4444', p: 1 }}>{error}</Typography>
      ) : report && (
        <>
          {/* Gauges row */}
          <Box sx={{ display: 'flex', gap: 2.5, mb: 2, flexWrap: 'wrap' }}>
            {/* Delivery % gauge */}
            <Box sx={{ minWidth: 130 }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.55rem', color: INK3, textTransform: 'uppercase',
                letterSpacing: '0.07em', mb: 0.4 }}>Delivery %</Typography>
              <Typography sx={{ ...JAKARTA, fontSize: '2rem', fontWeight: 900, lineHeight: 1,
                color: report.current_delivery_pct >= 70 ? '#22c55e'
                  : report.current_delivery_pct >= 50 ? '#fbbf24' : INK2 }}>
                {report.current_delivery_pct.toFixed(1)}%
              </Typography>
              <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK2, mt: 0.4 }}>
                20D avg: {report.avg_delivery_pct_20d.toFixed(1)}%
                {report.avg_delivery_pct_20d > 0 && (
                  <Box component="span" sx={{ ml: 0.75,
                    color: report.current_delivery_pct / report.avg_delivery_pct_20d >= 1.5
                      ? CYAN : INK3 }}>
                    ({(report.current_delivery_pct / report.avg_delivery_pct_20d).toFixed(2)}× avg)
                  </Box>
                )}
              </Typography>
            </Box>

            {/* Volume ratio gauge — from today's best signal */}
            {report.signals.length > 0 && (() => {
              const vr = report.signals[0].current_vol_ratio
              return (
                <Box sx={{ minWidth: 130 }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.55rem', color: INK3, textTransform: 'uppercase',
                    letterSpacing: '0.07em', mb: 0.4 }}>Volume Ratio</Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '2rem', fontWeight: 900, lineHeight: 1,
                    color: vr >= 2 ? '#fbbf24' : vr >= 1.5 ? '#22c55e' : INK2 }}>
                    {vr.toFixed(2)}×
                  </Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK2, mt: 0.4 }}>
                    vs 20D avg volume
                    <Box component="span" sx={{ ml: 0.75,
                      color: vr >= 2 ? CYAN : INK3 }}>
                      {vr >= 2 ? '— spike' : vr >= 1.5 ? '— elevated' : vr >= 0.8 ? '— normal' : '— low'}
                    </Box>
                  </Typography>
                </Box>
              )
            })()}

            {/* Data range */}
            <Box sx={{ display: 'flex', alignItems: 'flex-end', pb: 0.25 }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', color: INK3 }}>
                {report.data_start} → {report.data_end}<br />{report.total_bars} bars with delivery data
              </Typography>
            </Box>
          </Box>

          {/* Dual sparkline: delivery + volume — one row, no wrap */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2.5, flexWrap: 'nowrap', minWidth: 0 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.55rem', color: INK3, mb: 0.4, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Delivery % ·{' '}
                <Box component="span" sx={{ color: '#22c55e' }}>█ ≥70%</Box>
                {' '}<Box component="span" sx={{ color: 'rgba(251,191,36,0.8)' }}>█ spike</Box>
                {' '}<Box component="span" sx={{ color: 'rgba(96,165,250,0.7)' }}>█ normal</Box>
                {' '}— — 70% line
              </Typography>
              <DeliverySparkline bars={report.history.slice(-60)} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.55rem', color: INK3, mb: 0.4, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Volume ·{' '}
                <Box component="span" sx={{ color: '#a78bfa' }}>— vol ratio</Box>
                {' '}<Box component="span" sx={{ color: 'rgba(251,191,36,0.8)' }}>█ 2× spike</Box>
                {' '}<Box component="span" sx={{ color: 'rgba(148,163,184,0.6)' }}>█ normal</Box>
                {' '}— — 1× avg
              </Typography>
              <VolumeSparkline bars={report.history.slice(-60)} />
            </Box>
          </Box>

          {/* Signals */}
          {report.signals.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', fontWeight: 700, color: INK2,
                textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Validated Signals ({report.signals.length})
              </Typography>
              {report.signals.map(sig => (
                <SignalExpandedCard key={sig.name} sig={sig} symbol={symbol} />
              ))}
            </Box>
          ) : (
            <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3, p: 1 }}>
              No validated signals for this symbol.
            </Typography>
          )}
        </>
      )}
    </Box>
  )
}

// ─── How It Works panel ───────────────────────────────────────────────────────

const SIGNALS_TABLE = [
  ['Accumulation',         'vol > 2× avg AND delivery ≥ 65% AND close > open', 'Bullish', 'Heavy vol + high delivery + up close — institutional buying'],
  ['Distribution',         'vol > 2× avg AND delivery ≥ 65% AND close < open', 'Bearish', 'Heavy vol + high delivery + down close — institutional selling'],
  ['High Delivery — Up',   'delivery ≥ 70% AND close > open',                   'Bullish', 'Conviction buying without requiring a volume spike'],
  ['High Delivery — Down', 'delivery ≥ 70% AND close < open',                   'Bearish', 'Conviction selling without requiring a volume spike'],
  ['Delivery Spike',       'del_ratio ≥ 1.5× own 20D avg',                      'Mixed',   'Delivery % abnormally high vs stock\'s own recent history'],
  ['Vol + Del Spike',      'vol_ratio ≥ 1.5× AND del_ratio ≥ 1.5×',             'Mixed',   'Both volume and delivery anomalous simultaneously'],
]

const GRADES_TABLE = [
  ['A+', '≥ 65%', '≥ 3.0%', '≥ 15'],
  ['A',  '≥ 60%', '≥ 2.0%', '≥ 10'],
  ['B',  '≥ 55%', '≥ 1.0%', '≥ 5'],
  ['C',  '≥ 50%', '> 0',    '≥ 5'],
  ['D',  'anything else', '—', '—'],
]

function HowItWorks() {
  const { INK, INK2, INK3, BORDER, PAPER, PAPER2, CYAN } = usePalette()
  const { CARD } = useTokens()
  const [open, setOpen] = useState(false)

  const P = ({ children }: { children: React.ReactNode }) => (
    <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK2, lineHeight: 1.7, mb: 0.75 }}>{children}</Typography>
  )
  const Label = ({ children }: { children: React.ReactNode }) => (
    <Box component="span" sx={{ color: INK, fontWeight: 700 }}>{children}</Box>
  )
  const Code = ({ children }: { children: React.ReactNode }) => (
    <Box component="span" sx={{ ...MONO, fontSize: '0.68rem',
      bgcolor: PAPER2, px: 0.5, py: 0.1, borderRadius: '3px', color: CYAN }}>
      {children}
    </Box>
  )
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ ...JAKARTA, fontSize: '0.75rem', fontWeight: 800, color: CYAN,
        textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1,
        borderBottom: `1px solid ${CYAN}33`, pb: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )

  return (
    <Box sx={{ ...CARD, mb: 2 }}>
      <Box onClick={() => setOpen(p => !p)} sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 2.5, py: 1.5, cursor: 'pointer', userSelect: 'none',
        '&:hover': { bgcolor: PAPER2 }, borderRadius: '14px',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ fontSize: '1rem' }}>📖</Box>
          <Box>
            <Typography sx={{ ...JAKARTA, fontSize: '0.82rem', fontWeight: 800, color: INK }}>
              How Delivery Intelligence Works
            </Typography>
            <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK2 }}>
              Data source · signals · validation framework · grading
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3, fontWeight: 700 }}>
          {open ? '▲ collapse' : '▼ expand'}
        </Typography>
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 2.5, pb: 2.5, pt: 0.5 }}>
          <Box sx={{ height: '1px', bgcolor: BORDER, mb: 2.5 }} />

          <Section title="Data Source">
            <P>Every trading day after market close, NSE publishes a <Label>daily bhavcopy file</Label> containing
            one row per listed security. The key fields are <Code>DELIV_QTY</Code> (shares that resulted in actual
            overnight delivery) and <Code>DELIV_PER</Code> (delivery as % of total traded quantity).</P>
            <P><Label>What delivery % physically means:</Label> If 10 million HDFCBANK shares traded today and 6 million
            resulted in actual delivery, delivery % = 60%. The remaining 40% were pure intraday trades. High delivery %
            means more participants were <Label>investing</Label>, not just speculating.</P>
            <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: `${CYAN}08`,
              border: `1px solid ${CYAN}25`, mb: 1 }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK2, lineHeight: 1.7 }}>
                <Box component="span" sx={{ color: CYAN, fontWeight: 700 }}>Source: </Box>
                <Code>archives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv</Code><br />
                <Box component="span" sx={{ color: CYAN, fontWeight: 700 }}>Range: </Box>
                2025-01-01 → today (365 days). Extendable to 2016 via downloader.<br />
                <Box component="span" sx={{ color: CYAN, fontWeight: 700 }}>Frequency: </Box>
                Daily end-of-day · Universe: NIFTY 50 only
              </Typography>
            </Box>
          </Section>

          <Section title="Feature Engineering">
            <P>Two derived features power all signal logic:</P>
            <Box sx={{ display: 'flex', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
              {[
                ['Volume Ratio', 'vol / 20D avg vol', 'How unusual today\'s volume is. 2.0× = double normal. Uses each stock\'s own history.'],
                ['Delivery Ratio', 'del_pct / 20D avg del_pct', 'How unusual today\'s delivery % is vs its own recent baseline. A stock normally at 80% won\'t trigger a spike signal unless it goes to 120%+.'],
              ].map(([name, formula, desc]) => (
                <Box key={name} sx={{ flex: 1, minWidth: 220, p: 1.25, borderRadius: '8px',
                  bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', fontWeight: 800, color: INK, mb: 0.25 }}>{name}</Typography>
                  <Code>{formula}</Code>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK2, mt: 0.5, lineHeight: 1.5 }}>{desc}</Typography>
                </Box>
              ))}
            </Box>
          </Section>

          <Section title="The 6 Signals">
            <Box sx={{ overflowX: 'auto' }}>
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
                <Box component="thead">
                  <Box component="tr">
                    {['Signal', 'Condition', 'Dir', 'Interpretation'].map(h => (
                      <Box component="th" key={h} sx={{ px: 1.25, py: 0.75, textAlign: 'left',
                        color: INK2, fontWeight: 700, textTransform: 'uppercase', ...JAKARTA,
                        letterSpacing: '0.06em', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }}>
                        {h}
                      </Box>
                    ))}
                  </Box>
                </Box>
                <Box component="tbody">
                  {SIGNALS_TABLE.map(([name, cond, dir, interp]) => (
                    <Box component="tr" key={name} sx={{ '&:hover': { bgcolor: PAPER2 } }}>
                      <Box component="td" sx={{ px: 1.25, py: 0.9, borderBottom: `1px solid ${BORDER}`, fontWeight: 700, color: INK, whiteSpace: 'nowrap', ...JAKARTA }}>{name}</Box>
                      <Box component="td" sx={{ px: 1.25, py: 0.9, borderBottom: `1px solid ${BORDER}`, ...MONO, color: CYAN, fontSize: '0.62rem' }}>{cond}</Box>
                      <Box component="td" sx={{ px: 1.25, py: 0.9, borderBottom: `1px solid ${BORDER}`, color: dir === 'Bullish' ? '#22c55e' : dir === 'Bearish' ? '#ef4444' : '#fbbf24', fontWeight: 700, whiteSpace: 'nowrap', ...JAKARTA }}>{dir}</Box>
                      <Box component="td" sx={{ px: 1.25, py: 0.9, borderBottom: `1px solid ${BORDER}`, color: INK2, ...JAKARTA }}>{interp}</Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          </Section>

          <Section title="Forward Return Validation">
            <P>For every signal occurrence, the engine looks forward <Label>21 trading days (~1 month)</Label> and
            measures the actual price change. For bearish signals, the return is sign-flipped — win rate always means
            "signal worked as predicted" regardless of direction.</P>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              {[
                ['Win Rate', '% of occurrences where direction-adjusted return > 0'],
                ['EV', '(win_rate × avg_win) + ((1−win_rate) × avg_loss)'],
                ['Distribution', 'Histogram of 1M returns across 6 buckets showing shape of outcomes'],
                ['Timeline', 'Scatter of every signal date vs its actual 1D/1W/1M/1Y forward return'],
              ].map(([name, desc]) => (
                <Box key={name} sx={{ flex: '1 1 180px', p: 1, borderRadius: '6px',
                  bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', fontWeight: 800, color: INK, mb: 0.25 }}>{name}</Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK2, lineHeight: 1.5 }}>{desc}</Typography>
                </Box>
              ))}
            </Box>
          </Section>

          <Section title="Grading System">
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              {GRADES_TABLE.map(([grade, wr, ev, n]) => (
                <Box key={grade} sx={{ p: 1.25, borderRadius: '8px', minWidth: 110,
                  bgcolor: (GRADE_COLOR[grade] ?? '#94a3b8') + '08',
                  border: `1px solid ${(GRADE_COLOR[grade] ?? '#94a3b8')}20` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                    <Box sx={{ px: 0.75, py: 0.15, borderRadius: '4px', fontSize: '0.72rem', fontWeight: 900,
                      bgcolor: (GRADE_COLOR[grade] ?? '#94a3b8') + '20',
                      color: GRADE_COLOR[grade] ?? '#94a3b8' }}>{grade}</Box>
                    {grade === 'D' && <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK3 }}>excluded</Typography>}
                  </Box>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', color: INK2, lineHeight: 1.6 }}>
                    WR {wr}<br />EV {ev}<br />N {n}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Section>

          <Section title="Market Regime Conditioning">
            <P>Each signal occurrence is tagged with the market regime score on that day (average across all 50 NIFTY
            stocks, 0–100). Occurrences are split into <Label>regime ≥60</Label> (trending) and <Label>&lt;60</Label> (weak),
            with separate win rates computed. If the two buckets diverge by ≥10%, the signal has a regime dependency
            worth filtering on. The two columns in the summary table show this split for each stock's best signal.</P>
          </Section>

          <Section title="Edge Score">
            <P>Combines quality and frequency into one ranking number:</P>
            <Box sx={{ p: 1.25, borderRadius: '8px', bgcolor: PAPER2,
              border: `1px solid ${BORDER}`, ...MONO, fontSize: '0.68rem',
              color: CYAN, mb: 1 }}>
              edge_score = (win_rate / 100) × max(EV, 0) × frequency<br />
              <Box component="span" sx={{ color: INK2 }}>frequency = occurrences / total_bars × 100</Box>
            </Box>
            <P>A 70% signal that fires once a year scores lower than a 60% signal firing 20 times.</P>
          </Section>
        </Box>
      </Collapse>
    </Box>
  )
}

// ─── Intent selector ─────────────────────────────────────────────────────────

type UserIntent = 'buy' | 'short' | 'hold' | 'square_long' | 'square_short' | 'explore'

const signalDir = (name: string): 'Bullish' | 'Bearish' | 'Mixed' => {
  if (/accumulation|— up/i.test(name)) return 'Bullish'
  if (/distribution|— down/i.test(name)) return 'Bearish'
  return 'Mixed'
}

interface IntentCfg {
  label: string; emoji: string; color: string; tagline: string
  primaryDirs: ('Bullish' | 'Bearish' | 'Mixed')[]
  headline: string
  bullets: { point: string; detail: string }[]
  avoid: string
  regime: string
}

const INTENT_CONFIG: Record<UserIntent, IntentCfg> = {
  buy: {
    label: 'Buy', emoji: '📈', color: '#22c55e',
    tagline: 'Open a long position',
    primaryDirs: ['Bullish', 'Mixed'],
    headline: 'Accumulation and conviction buying — look for institutional footprints entering a position, not just price going up.',
    bullets: [
      { point: 'Grade A+ / A only', detail: 'Win rate ≥60%, positive EV, N ≥10 occurrences. Lower grades lack statistical edge to justify capital risk.' },
      { point: 'Signal active today', detail: 'Historical quality is irrelevant if the condition is not live right now. Use the Active filter to see only today\'s signals.' },
      { point: 'Match your regime', detail: 'Check the Mkt ≥60 WR column. If the signal is materially stronger in bull markets, only act when Market Breadth ≥60.' },
      { point: 'Right-skewed distribution', detail: 'More occurrences >+10% than <−10% means asymmetric upside. Size positions for that outlier tail — don\'t cut winners early.' },
    ],
    avoid: 'Do not buy a stock that also shows an active Distribution or High Delivery — Down signal. Conflicting signals mean institutional participants are divided — that is not an edge, that is noise.',
    regime: 'Highest conviction setup: Market Breadth ≥60 + active Accumulation signal + Mkt ≥60 WR materially higher than Mkt <60 WR. All three together = trend-continuation with institutional backing.',
  },
  short: {
    label: 'Short', emoji: '📉', color: '#ef4444',
    tagline: 'Open a short position',
    primaryDirs: ['Bearish', 'Mixed'],
    headline: 'Distribution and conviction selling — identify where institutional supply is consistently overpowering demand.',
    bullets: [
      { point: 'Win rate is direction-adjusted', detail: 'A 65% WR on Distribution means the stock fell 65% of the time after the signal fired — that is your edge, already sign-flipped for you.' },
      { point: 'Weak market bias is critical', detail: 'Bearish delivery signals have consistently higher win rates when Breadth <60. Do not short into a market breadth ≥70 — you are fighting the tide.' },
      { point: 'N ≥10 is non-negotiable', detail: 'Bearish signals fire less frequently than bullish. Below 10 occurrences, the win rate is not statistically meaningful — you are trading on luck.' },
      { point: 'EV must be positive even on shorts', detail: 'High win rate + negative EV means losses when wrong are outsized. Negative-EV shorts need very tight stops or should be skipped.' },
    ],
    avoid: 'Never short into an active Accumulation signal on the same stock. High delivery on an up-close day means buyers absorbed all the selling — the short thesis is structurally broken on that day.',
    regime: 'Highest conviction short: Market Breadth <60 + active Distribution signal + Mkt <60 WR significantly higher than Mkt ≥60 WR. Weak market amplifies the bearish signal\'s edge.',
  },
  hold: {
    label: 'Hold', emoji: '🔒', color: '#0099CC',
    tagline: 'Monitor existing positions',
    primaryDirs: ['Bullish', 'Bearish', 'Mixed'],
    headline: 'Scan for signals that confirm your thesis is intact — or warn that smart money is quietly exiting your position.',
    bullets: [
      { point: 'Bullish signal active = thesis intact', detail: 'Active Accumulation or High Delivery — Up means institutional money is still entering or holding. You have company on the long side.' },
      { point: 'Distribution active = review your stop', detail: 'If a stock you hold shows active Distribution, institutional selling has started. This does not mean exit immediately — but tighten your stop and don\'t add.' },
      { point: 'Vol+Del Spike on green day = add candidate', detail: 'Breakout with delivery conviction. Consider adding to an existing long — this is not a new signal, it is confirmation your position is working.' },
      { point: 'Regime deterioration is the silent risk', detail: 'If Market Breadth drops below 50 AND your stock\'s bullish signal shows lower WR in weak markets — start watching the exit. The regime is working against you.' },
    ],
    avoid: 'Absence of an active signal is not a sell signal. It means today\'s specific condition did not trigger — not that your thesis is dead. Check if the signal fired recently in the timeline.',
    regime: 'If your stock\'s best signal shows Mkt ≥60 WR >> Mkt <60 WR (10pp+ gap), your position is regime-dependent. Monitor Market Breadth daily and plan your exit level if it drops below 50.',
  },
  square_long: {
    label: 'Square off Long', emoji: '🔴', color: '#f97316',
    tagline: 'Exit an existing long position',
    primaryDirs: ['Bearish'],
    headline: 'Bearish delivery signals give you data-backed evidence that the buying thesis has reversed — these are your exit triggers.',
    bullets: [
      { point: 'Active Distribution = highest urgency exit', detail: 'Heavy volume + high delivery + down close means institutions are selling into any rally. This is not a dip — this is supply. Act before it accelerates.' },
      { point: 'High Delivery — Down is quieter but real', detail: 'No volume spike required — just conviction selling with overnight delivery. Quieter than Distribution but equally meaningful as an exit signal.' },
      { point: 'Rising delivery on red days', detail: 'If the 20D average delivery % has been rising while the stock price falls, dip-buyers are failing to hold price. Supply is winning — your long is in trouble.' },
      { point: 'Grade B bearish signal still matters for exits', detail: 'When managing an existing long, you are managing risk — not finding edge. Even a Grade B bearish signal that is active is a stop-loss trigger, not a wait-and-see.' },
    ],
    avoid: 'A single Mixed signal (Delivery Spike alone without direction) is not an exit trigger. Wait for directional confirmation — a spike on a green day means absorption, not distribution. Context matters.',
    regime: 'Exit long when Market Breadth drops below 40 AND an active Distribution signal is present. Breadth <40 means the market is amplifying every bearish signal — do not fight it.',
  },
  explore: {
    label: 'Explore', emoji: '🔭', color: '#7A90B4',
    tagline: 'Browse all signals, no filter',
    primaryDirs: ['Bullish', 'Bearish', 'Mixed'],
    headline: 'No intent selected — all signals visible. Use this to research patterns, compare stocks, or understand what the data looks like before committing to a direction.',
    bullets: [
      { point: 'Sort by Edge Score', detail: 'The edge score combines win rate, EV, and frequency into one number. Highest scores = best risk-adjusted, most actionable signals.' },
      { point: 'Compare regime splits', detail: 'Look at Mkt ≥60 WR vs Mkt <60 WR across all stocks. Wide gaps (>15pp) reveal regime-dependent signals — the most useful filter you have.' },
      { point: 'Distribution shape tells you the trade type', detail: 'Right-skewed = hold for outliers, size small. Left-skewed = tight stops, size even smaller. Symmetric = straightforward mean-reversion.' },
      { point: 'Timeline scatter reveals consistency', detail: 'Dots clustered above zero = reliable signal. Dots scattered randomly = high win rate may be statistical noise. Check the pattern, not just the number.' },
    ],
    avoid: 'Don\'t act on signals just because they appear in Explore mode. Without an intent, there is no context for position sizing, stop placement, or regime filtering. Research first, decide intent, then filter.',
    regime: 'In Explore mode, pay attention to which signals cluster on high Mkt ≥60 WR vs high Mkt <60 WR — this tells you whether the current market environment favours that signal or suppresses it.',
  },
  square_short: {
    label: 'Square off Short', emoji: '🟢', color: '#a78bfa',
    tagline: 'Cover / exit an existing short position',
    primaryDirs: ['Bullish'],
    headline: 'Bullish delivery signals warn that buying conviction is absorbing your short — act before the covering squeeze begins.',
    bullets: [
      { point: 'Active Accumulation = cover immediately', detail: 'Volume spike + high delivery + up close means dip-buyers with real conviction have arrived. This is the most dangerous signal to be short against — the squeeze begins here.' },
      { point: 'High Delivery — Up = buying is real, not a bounce', detail: 'Even without a volume spike, high delivery on a green day = genuine investors buying overnight. Dead-cat bounces have low delivery. This one does not.' },
      { point: 'Mean-reversion signals in weak market', detail: 'If the signal shows materially higher WR in Mkt <60, it was built for weak-market recoveries — exactly the scenario your short is in. Cover before the recovery gains momentum.' },
      { point: 'Delivery ratio rising while price falls', detail: 'The 20D average delivery % climbing while price is still down means supply is being absorbed silently. Your short thesis is structurally weakening even before price reverses.' },
    ],
    avoid: 'One day of high delivery does not invalidate a short thesis. Check N ≥10 and confirm EV is positive before covering in panic. Strong momentum shorts can absorb a few false signals before the real reversal.',
    regime: 'Cover short when Market Breadth recovers above 50 AND the stock shows active Accumulation with high Mkt ≥60 WR. Both conditions together = high-probability bottom. Waiting for both reduces false covers.',
  },
}

function IntentPanel({ intent, onSelect }: {
  intent: UserIntent | null
  onSelect: (i: UserIntent | null) => void
}) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const { CARD } = useTokens()
  const cfg = intent ? INTENT_CONFIG[intent] : null
  return (
    <Box sx={{ ...CARD, mb: 2 }}>
      <Box sx={{ px: 2.5, pt: 2, pb: cfg ? 1.75 : 2 }}>
        <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', fontWeight: 800, color: INK2,
          textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1.5 }}>
          What are you looking to do?
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {(Object.keys(INTENT_CONFIG) as UserIntent[]).map(key => {
            const c = INTENT_CONFIG[key]
            const active = intent === key
            return (
              <Box key={key} onClick={() => onSelect(active ? null : key)} sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                px: 1.75, py: 0.9, borderRadius: '10px', cursor: 'pointer',
                border: `1px solid ${active ? c.color + '55' : BORDER}`,
                bgcolor: active ? c.color + '12' : PAPER2,
                transition: 'all 0.12s',
                '&:hover': { borderColor: c.color + '40', bgcolor: c.color + '0d' },
              }}>
                <Typography sx={{ fontSize: '1.1rem', lineHeight: 1 }}>{c.emoji}</Typography>
                <Box>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', fontWeight: 800, lineHeight: 1.2,
                    color: active ? c.color : INK }}>
                    {c.label}
                  </Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.58rem', color: INK2, lineHeight: 1.3 }}>
                    {c.tagline}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>

      <Collapse in={!!cfg}>
        {cfg && (
          <Box sx={{ px: 2.5, pb: 2.5 }}>
            <Box sx={{ height: '1px', bgcolor: BORDER, mb: 2 }} />

            {/* Headline */}
            <Box sx={{ px: 1.75, py: 1.25, borderRadius: '8px', mb: 2.5,
              bgcolor: cfg.color + '0a', border: `1px solid ${cfg.color}28` }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', fontWeight: 700, color: INK, lineHeight: 1.6 }}>
                {cfg.emoji} {cfg.headline}
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, gap: 2.5 }}>

              {/* Left — what to look for */}
              <Box>
                <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', fontWeight: 800, color: cfg.color,
                  textTransform: 'uppercase', letterSpacing: '0.09em', mb: 1.5 }}>
                  ✓ What to look for
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {cfg.bullets.map((b, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                      <Box sx={{ flexShrink: 0, mt: 0.2,
                        width: 20, height: 20, borderRadius: '50%',
                        bgcolor: cfg.color + '18', border: `1px solid ${cfg.color}40`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.62rem', fontWeight: 900, color: cfg.color }}>
                        {i + 1}
                      </Box>
                      <Box>
                        <Typography sx={{ ...JAKARTA, fontSize: '0.73rem', fontWeight: 700, color: INK, mb: 0.4 }}>
                          {b.point}
                        </Typography>
                        <Typography sx={{ ...JAKARTA, fontSize: '0.67rem', color: INK2, lineHeight: 1.7 }}>
                          {b.detail}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Right — avoid + regime + filter note */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ p: 1.75, borderRadius: '8px',
                  bgcolor: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', fontWeight: 800, color: '#ef4444',
                    textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.75 }}>
                    ✗ Avoid
                  </Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.69rem', color: INK2, lineHeight: 1.75 }}>
                    {cfg.avoid}
                  </Typography>
                </Box>

                <Box sx={{ p: 1.75, borderRadius: '8px',
                  bgcolor: `${CYAN}08`, border: `1px solid ${CYAN}25` }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.6rem', fontWeight: 800, color: CYAN,
                    textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.75 }}>
                    🏛 Regime context
                  </Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.69rem', color: INK2, lineHeight: 1.75 }}>
                    {cfg.regime}
                  </Typography>
                </Box>

                <Box sx={{ p: 1.25, borderRadius: '8px',
                  bgcolor: cfg.color + '08', border: `1px solid ${cfg.color}22` }}>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.66rem', fontWeight: 700, color: cfg.color }}>
                    Table filtered for {cfg.label}
                  </Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK2, mt: 0.3 }}>
                    Showing only signals that match your intent. Click intent again to clear.
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </Collapse>
    </Box>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  const { PAPER, BORDER, CYAN, INK, INK2, INK3 } = usePalette()
  const NAV = [
    { label: 'Platform',     links: ['Stock DNA', 'Pattern DNA', 'Markov Options', 'Quant Strategies', 'Indicators'] },
    { label: 'Intelligence', links: ['Market Regime', 'Breadth Score', 'Edge Lab', 'Cointegration', 'Delivery Intel'] },
    { label: 'Research',     links: ['Validation Framework', 'MCP Architecture', 'AI Agents', 'Feature Store', 'Backtests'] },
  ]
  return (
    <Box component="footer" sx={{ bgcolor: PAPER, borderTop: `1px solid ${BORDER}`, mt: 8 }}>
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, pt: 6, pb: 4 }}>
        <Box sx={{ display: 'flex', gap: 6, flexWrap: 'wrap', mb: 5 }}>
          <Box sx={{ flex: '0 0 auto', maxWidth: 260 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Box sx={{ width: 7, height: 7, bgcolor: CYAN, animation: 'blink 1.4s step-end infinite', '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } } }} />
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 800, fontSize: '1rem', color: INK, letterSpacing: '0.08em' }}>
                MARKET<Box component="span" sx={{ color: CYAN }}>DNA</Box>
              </Typography>
            </Box>
            <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.8rem', color: INK3, lineHeight: 1.7 }}>
              Quantitative market intelligence for Indian equities and options. Research precedes product. Validation is mandatory.
            </Typography>
          </Box>
          {NAV.map(col => (
            <Box key={col.label} sx={{ flex: '1 1 140px' }}>
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', fontWeight: 700, color: CYAN, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1.75 }}>{col.label}</Typography>
              {col.links.map(link => (
                <Typography key={link} sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.8rem', color: INK3, mb: 0.875, cursor: 'default', transition: 'color 0.12s', '&:hover': { color: INK2 } }}>{link}</Typography>
              ))}
            </Box>
          ))}
        </Box>
        <Box sx={{ borderTop: `1px solid ${BORDER}`, pt: 3, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', color: INK3 }}>© 2024 MarketDNA · For research purposes only</Typography>
          <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', color: INK3 }}>Not investment advice</Typography>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Summary table ────────────────────────────────────────────────────────────

type SortKey = 'delivery_ratio' | 'current_delivery_pct' | 'win_rate' | 'edge_score' | 'grade' | 'mkt_high' | 'mkt_low' | 'vol_ratio'

export default function DeliveryPage() {
  const { BG, INK, INK2, INK3, BORDER, PAPER, PAPER2, CYAN } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()

  const [summary, setSummary]   = useState<DeliverySummaryResult | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [sortKey, setSortKey]   = useState<SortKey>('edge_score')
  const [sortAsc, setSortAsc]   = useState(false)
  const [filter, setFilter]     = useState<'all' | 'active' | 'spike'>('all')
  const [userIntent, setUserIntent] = useState<UserIntent | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    deliveryApi.getSummary()
      .then(setSummary)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (selected && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selected])

  const gradeOrder: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4 }

  const rows = (summary?.items ?? [])
    .filter(item => {
      if (filter === 'active') return item.is_active
      if (filter === 'spike')  return item.delivery_ratio >= 1.5
      return true
    })
    .filter(item => {
      if (!userIntent) return true
      const cfg = INTENT_CONFIG[userIntent]
      return cfg.primaryDirs.includes(signalDir(item.best_signal))
    })
    .sort((a, b) => {
      let va: number, vb: number
      switch (sortKey) {
        case 'grade':                va = gradeOrder[a.grade] ?? 9; vb = gradeOrder[b.grade] ?? 9; break
        case 'delivery_ratio':       va = a.delivery_ratio;          vb = b.delivery_ratio;          break
        case 'current_delivery_pct': va = a.current_delivery_pct;    vb = b.current_delivery_pct;    break
        case 'win_rate':             va = a.win_rate;                 vb = b.win_rate;                break
        case 'edge_score':           va = a.edge_score;               vb = b.edge_score;              break
        case 'mkt_high':             va = a.mkt_regime_high_win_rate ?? -1; vb = b.mkt_regime_high_win_rate ?? -1; break
        case 'mkt_low':              va = a.mkt_regime_low_win_rate  ?? -1; vb = b.mkt_regime_low_win_rate  ?? -1; break
        case 'vol_ratio':            va = a.current_vol_ratio;              vb = b.current_vol_ratio;              break
        default: va = 0; vb = 0
      }
      return sortAsc ? va - vb : vb - va
    })

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc(p => !p); else { setSortKey(k); setSortAsc(false) }
  }

  const Th = ({ label, k, title }: { label: string; k: SortKey; title?: string }) => (
    <Box component="th" onClick={() => handleSort(k)} title={title} sx={{
      px: 1.25, py: 1, textAlign: 'left', cursor: 'pointer', userSelect: 'none',
      fontSize: '0.58rem', fontWeight: 700, ...JAKARTA,
      color: sortKey === k ? CYAN : INK2,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
      '&:hover': { color: INK },
    }}>
      {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </Box>
  )

  const WRCell = ({ wr }: { wr: number | null }) => (
    <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
      {wr !== null ? (
        <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', fontWeight: 700,
          color: wr >= 65 ? '#22c55e' : wr >= 55 ? '#fbbf24' : wr >= 50 ? INK2 : '#ef4444' }}>
          {wr.toFixed(1)}%
        </Typography>
      ) : (
        <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK3 }}>—</Typography>
      )}
    </Box>
  )

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        pt: 5, pb: 4, px: { xs: 2.5, md: 5 },
      }}>
        <Box sx={{ px: 1.5, py: 0.4, borderRadius: '20px', display: 'inline-block',
          border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}10`, mb: 2 }}>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: CYAN,
            letterSpacing: '0.12em', fontFamily: "'IBM Plex Sans', sans-serif" }}>
            DELIVERY INTELLIGENCE · NSE DATA
          </Typography>
        </Box>
        <Typography sx={{ fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 900,
          color: INK, letterSpacing: '-0.02em', lineHeight: 1.1, mb: 1,
          fontFamily: "'IBM Plex Sans Condensed', sans-serif" }}>
          Delivery <span style={{ color: CYAN }}>Intelligence</span>
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: INK2, maxWidth: 520,
          fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Institutional footprints in NSE delivery data — validated signals with forward-return statistics.
        </Typography>

        {/* Stats row */}
        {summary && (
          <Box sx={{ display: 'flex', gap: 3, mt: 3, flexWrap: 'wrap' }}>
            <Box>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 900, color: INK, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                {summary.items.length}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: INK3, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                Stocks tracked
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 900, color: CYAN, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                {summary.items.filter(i => i.is_active).length}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: INK3, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                Active signals
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 900, color: INK, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                {summary.items.filter(i => i.grade === 'A+' || i.grade === 'A').length}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: INK3, fontFamily: "'IBM Plex Sans', sans-serif" }}>
                Grade A+ / A
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2.5, md: 8, lg: 12 }, py: 4 }}>

        <HowItWorks />

        <IntentPanel intent={userIntent} onSelect={setUserIntent} />

        {selected && (
          <Box ref={detailRef}>
            <StockDetail symbol={selected} onClose={() => setSelected(null)} />
          </Box>
        )}

        {/* Summary table */}
        <Box sx={{ ...CARD, p: 2.5 }}>
          {loading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 6 }}>
              <CircularProgress size={28} sx={{ color: CYAN }} />
              <Typography sx={{ ...JAKARTA, fontSize: '0.75rem', color: INK2 }}>
                Computing delivery signals across NIFTY 50…
              </Typography>
            </Box>
          ) : error ? (
            <Box sx={{ p: 2 }}>
              <Typography sx={{ fontSize: '0.8rem', color: '#ef4444', mb: 1 }}>{error}</Typography>
            </Box>
          ) : (
            <>
              {/* Filters */}
              <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                {(['all', 'active', 'spike'] as const).map(f => (
                  <Box key={f} onClick={() => setFilter(f)} sx={{
                    px: 1.5, py: 0.5, borderRadius: '6px', cursor: 'pointer',
                    fontSize: '0.65rem', fontWeight: 700, ...JAKARTA,
                    bgcolor: filter === f ? `${CYAN}25` : PAPER2,
                    color: filter === f ? CYAN : INK2,
                    border: `1px solid ${filter === f ? `${CYAN}50` : BORDER}`,
                  }}>
                    {f === 'active' ? '🔴 Active' : f === 'spike' ? '📈 Del Spike >1.5×' : 'All Stocks'}
                  </Box>
                ))}
                <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK3, ml: 'auto' }}>
                  {rows.length} stocks · click row to expand
                  {summary && <Box component="span" sx={{ ml: 1 }}>· {summary.computed_at}</Box>}
                </Typography>
              </Box>

              <Box sx={{ overflowX: 'auto' }}>
                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                  <Box component="thead">
                    <Box component="tr">
                      <Th label="Symbol"       k="grade" />
                      <Th label="Del% Today"   k="current_delivery_pct" />
                      <Th label="20D Avg"      k="delivery_ratio" />
                      <Th label="Del Ratio"    k="delivery_ratio"    title="Today's delivery % / 20D avg delivery %" />
                      <Th label="Vol Ratio"    k="vol_ratio"         title="Today's volume / 20D avg volume" />
                      <Th label="Best Signal"  k="grade" />
                      <Th label="Grade"        k="grade" />
                      <Th label="Win Rate"     k="win_rate"  title="Overall win rate of best signal" />
                      <Th label="Mkt ≥60 WR"   k="mkt_high"  title="Win rate when market regime ≥60 (trending)" />
                      <Th label="Mkt <60 WR"   k="mkt_low"   title="Win rate when market regime <60 (weak)" />
                      <Th label="Edge Score"   k="edge_score" />
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {rows.map(item => (
                      <Box
                        component="tr"
                        key={item.symbol}
                        onClick={() => setSelected(prev => prev === item.symbol ? null : item.symbol)}
                        sx={{
                          cursor: 'pointer',
                          bgcolor: selected === item.symbol ? `${CYAN}10` : 'transparent',
                          '&:hover': { bgcolor: PAPER2 },
                        }}
                      >
                        {/* Symbol */}
                        <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography sx={{ ...JAKARTA, fontSize: '0.78rem', fontWeight: 800, color: INK }}>
                              {item.symbol}
                            </Typography>
                            {item.is_active && (
                              <Box sx={{ width: 6, height: 6, borderRadius: '50%',
                                bgcolor: '#ef4444', boxShadow: '0 0 4px #ef4444' }} />
                            )}
                          </Box>
                        </Box>

                        {/* Del% today */}
                        <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
                          <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', fontWeight: 800,
                            color: item.current_delivery_pct >= 70 ? '#22c55e'
                              : item.current_delivery_pct >= 55 ? '#fbbf24' : INK2 }}>
                            {item.current_delivery_pct.toFixed(1)}%
                          </Typography>
                          <Box sx={{ mt: 0.3, width: 52, height: 2.5, borderRadius: 1,
                            bgcolor: PAPER2, overflow: 'hidden' }}>
                            <Box sx={{ height: '100%', borderRadius: 1,
                              width: `${Math.min(100, item.current_delivery_pct)}%`,
                              bgcolor: item.current_delivery_pct >= 70 ? '#22c55e'
                                : item.current_delivery_pct >= 55 ? '#fbbf24' : INK3 }} />
                          </Box>
                        </Box>

                        {/* 20D avg */}
                        <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
                          <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK2 }}>
                            {item.avg_delivery_pct_20d.toFixed(1)}%
                          </Typography>
                        </Box>

                        {/* Del Ratio */}
                        <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
                          <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', fontWeight: 700,
                            color: item.delivery_ratio >= 1.5 ? '#fbbf24'
                              : item.delivery_ratio >= 1.2 ? '#22c55e' : INK3 }}>
                            {item.delivery_ratio.toFixed(2)}×
                          </Typography>
                        </Box>

                        {/* Vol Ratio */}
                        <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
                          <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', fontWeight: 700,
                            color: item.current_vol_ratio >= 2 ? '#fbbf24'
                              : item.current_vol_ratio >= 1.5 ? '#22c55e'
                              : item.current_vol_ratio >= 0.8 ? INK2 : INK3 }}>
                            {item.current_vol_ratio.toFixed(2)}×
                          </Typography>
                        </Box>

                        {/* Best signal */}
                        <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
                          <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK2, whiteSpace: 'nowrap' }}>
                            {item.best_signal}
                          </Typography>
                        </Box>

                        {/* Grade */}
                        <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
                          <Box sx={{ display: 'inline-flex', px: 0.9, py: 0.2, borderRadius: '4px',
                            fontSize: '0.68rem', fontWeight: 900,
                            bgcolor: (GRADE_COLOR[item.grade] ?? '#94a3b8') + '20',
                            color: GRADE_COLOR[item.grade] ?? '#94a3b8' }}>
                            {item.grade}
                          </Box>
                        </Box>

                        {/* Overall win rate */}
                        <WRCell wr={item.win_rate} />
                        {/* Mkt ≥60 WR */}
                        <WRCell wr={item.mkt_regime_high_win_rate} />
                        {/* Mkt <60 WR */}
                        <WRCell wr={item.mkt_regime_low_win_rate} />

                        {/* Edge score */}
                        <Box component="td" sx={{ px: 1.25, py: 1.1, borderBottom: `1px solid ${BORDER}` }}>
                          <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3 }}>
                            {item.edge_score.toFixed(3)}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Box>

      <Footer />
    </Box>
  )
}
