import { useEffect, useMemo, useState } from 'react'
import { Box, Grid, Typography, CircularProgress } from '@mui/material'
import Highcharts from 'highcharts'
import HighchartsMore from 'highcharts/highcharts-more'
import HighchartsReact from 'highcharts-react-official'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { edgesApi } from '../api/edgesApi'
import type { EdgeCard, EdgeStatus, EdgeReportResponse, ObservatoryResponse } from '../types/edges'

HighchartsMore(Highcharts)

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// Status palette — reserved state colors, always shipped WITH a text label.
const STATUS_COLOR: Record<EdgeStatus, string> = {
  HEALTHY: '#22c55e',
  FADING: '#fbbf24',
  REVIVING: '#3b82f6',
  WEAK: '#f97316',
  DEAD: '#ef4444',
  TOO_NOISY: '#94a3b8',
}
const STATUS_LABEL: Record<EdgeStatus, string> = {
  HEALTHY: 'Healthy',
  FADING: 'Fading',
  REVIVING: 'Reviving',
  WEAK: 'Weak',
  DEAD: 'Dead',
  TOO_NOISY: 'Too noisy',
}
const STATUS_DESC: Record<EdgeStatus, string> = {
  HEALTHY: 'edge positive with confidence interval clear of zero',
  FADING: 'statistically significant downtrend in the edge',
  REVIVING: 'significant uptrend — edge crossing up through zero',
  WEAK: 'latest confidence interval includes zero',
  DEAD: 'CI has straddled zero for 6+ straight readings with a near-zero edge',
  TOO_NOISY: 'not enough readings yet to judge',
}

const fmt = (v: number | null | undefined, dp = 1, suffix = '') =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}${suffix}`

function StatusChip({ status }: { status: EdgeStatus }) {
  const c = STATUS_COLOR[status]
  return (
    <Box sx={{ px: 1.25, py: 0.35, borderRadius: 1, bgcolor: `${c}1A`, border: `1px solid ${c}55`,
               display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: c }} />
      <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: c, letterSpacing: '0.08em' }}>
        {STATUS_LABEL[status].toUpperCase()}
      </Typography>
    </Box>
  )
}

function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
      <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ ...SANS, fontSize: '0.8rem', fontWeight: 800, color: INK }}>{title}</Typography>
      {meta && <Typography sx={{ ...MONO, fontSize: '0.64rem', color: INK3, ml: 'auto' }}>{meta}</Typography>}
    </Box>
  )
}

// ── Decay chart: edge_ann_pct line + CI band, dashed while backfilled ─────────
function DecayChart({ card, mode }: { card: EdgeCard; mode: 'dark' | 'light' }) {
  const { INK, INK3, CYAN, BORDER } = usePalette()
  const options = useMemo<Highcharts.Options>(() => {
    const periods = card.series.map(p => p.period)
    const line = card.series.map(p => p.edge_ann_pct)
    const band = card.series.map(p =>
      p.ci_low != null && p.ci_high != null ? [p.ci_low, p.ci_high] : [null, null])
    const firstLive = card.series.findIndex(p => !p.is_backfilled)
    const zones = firstLive > 0
      ? [{ value: firstLive, dashStyle: 'ShortDash' as const }, { dashStyle: 'Solid' as const }]
      : undefined
    return {
      chart: { backgroundColor: 'transparent', height: 210, spacingTop: 8 },
      title: { text: undefined }, credits: { enabled: false },
      legend: { enabled: false },                     // single series — the card names it
      xAxis: {
        categories: periods, lineColor: BORDER, tickColor: BORDER,
        labels: { style: { color: INK3, fontSize: '0.56rem' }, step: Math.ceil(periods.length / 7) },
      },
      yAxis: {
        title: { text: 'edge %/yr', style: { color: INK3, fontSize: '0.58rem' } },
        gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
        labels: { style: { color: INK3, fontSize: '0.56rem' } },
        plotLines: [{ value: 0, color: mode === 'dark' ? '#475569' : '#94a3b8', width: 1.5, zIndex: 3 }],
      },
      tooltip: {
        shared: true, backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
        style: { color: INK, fontSize: '0.66rem' }, valueDecimals: 1, valueSuffix: '%/yr',
      },
      series: [
        { type: 'arearange', name: '95% CI', data: band, color: CYAN, fillOpacity: 0.10,
          lineWidth: 0, marker: { enabled: false }, enableMouseTracking: false, zIndex: 0 },
        { type: 'line', name: 'Edge', data: line, color: CYAN, lineWidth: 2,
          marker: { enabled: false, symbol: 'circle', radius: 3 },
          zoneAxis: 'x', zones, zIndex: 1 },
      ],
    }
  }, [card, mode, INK, INK3, CYAN, BORDER])
  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── One edge card ──────────────────────────────────────────────────────────────
function EdgeCardBox({ card, mode }: { card: EdgeCard; mode: 'dark' | 'light' }) {
  const { INK, INK2, INK3, BORDER, PAPER, PAPER2 } = usePalette()
  const { CARD } = useTokens()
  const [open, setOpen] = useState(false)
  const hasBackfill = card.series.some(p => p.is_backfilled)

  const Metric = ({ label, value }: { label: string; value: string }) => (
    <Box sx={{ pr: 2.5 }}>
      <Typography sx={{ ...SANS, fontSize: '0.56rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</Typography>
      <Typography sx={{ ...MONO, fontSize: '0.92rem', fontWeight: 700, color: INK }}>{value}</Typography>
    </Box>
  )

  return (
    <Box sx={{ ...CARD, p: 2.25, bgcolor: PAPER, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography sx={{ ...SANS, fontSize: '0.92rem', fontWeight: 800, color: INK }}>{card.label}</Typography>
        <StatusChip status={card.status} />
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, ml: 'auto' }}>
          {card.n_readings} readings · {card.kind}
        </Typography>
      </Box>
      <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, mb: 1.5 }}>{card.blurb}</Typography>

      {card.latest && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', mb: 0.5 }}>
          <Metric label="Edge (ann.)" value={fmt(card.latest.edge_ann_pct, 1, '%')} />
          <Metric label="Hit rate" value={fmt(card.latest.hit_rate, 0, '%').replace('+', '')} />
          {card.latest.decile_spread != null && (
            <Metric label="Decile spread" value={fmt(card.latest.decile_spread, 2, '%/mo')} />
          )}
          <Metric label="Signals" value={String(card.latest.n_signals)} />
          <Metric label="Latest" value={card.latest.period} />
        </Box>
      )}
      <Typography sx={{ ...SANS, fontSize: '0.68rem', color: STATUS_COLOR[card.status], mb: 1 }}>
        {card.reason}
      </Typography>

      <DecayChart card={card} mode={mode} />
      {hasBackfill && (
        <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, fontStyle: 'italic' }}>
          dashed = backfilled from immutable raw data · solid = measured live
        </Typography>
      )}

      <Typography onClick={() => setOpen(o => !o)}
        sx={{ ...MONO, fontSize: '0.64rem', color: INK3, cursor: 'pointer', mt: 1,
              '&:hover': { color: INK } }}>
        {open ? '▼' : '▶'} measurement record
      </Typography>
      {open && (
        <Box sx={{ mt: 1, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Period', 'Edge %/yr', 'Hit %', 'n', '95% CI', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.58rem',
                                       fontFamily: "'IBM Plex Sans', sans-serif", color: '#94a3b8',
                                       textTransform: 'uppercase', letterSpacing: '0.06em',
                                       borderBottom: `1px solid ${BORDER}`, background: PAPER2 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...card.series].reverse().map(p => (
                <tr key={p.period}>
                  <td style={{ padding: '3px 8px', fontSize: '0.66rem', fontFamily: "'IBM Plex Mono', monospace", color: INK2 }}>{p.period}</td>
                  <td style={{ padding: '3px 8px', fontSize: '0.66rem', fontFamily: "'IBM Plex Mono', monospace",
                               color: (p.edge_ann_pct ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(p.edge_ann_pct, 1)}</td>
                  <td style={{ padding: '3px 8px', fontSize: '0.66rem', fontFamily: "'IBM Plex Mono', monospace", color: INK2 }}>
                    {p.hit_rate != null ? p.hit_rate.toFixed(0) : '—'}
                  </td>
                  <td style={{ padding: '3px 8px', fontSize: '0.66rem', fontFamily: "'IBM Plex Mono', monospace", color: INK2 }}>{p.n_signals}</td>
                  <td style={{ padding: '3px 8px', fontSize: '0.66rem', fontFamily: "'IBM Plex Mono', monospace", color: INK2 }}>
                    [{fmt(p.ci_low, 1)}, {fmt(p.ci_high, 1)}]
                  </td>
                  <td style={{ padding: '3px 8px', fontSize: '0.6rem', fontFamily: "'IBM Plex Sans', sans-serif", color: '#94a3b8' }}>
                    {p.is_backfilled ? 'backfilled' : 'live'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Box>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function EdgeObservatoryPage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BG, BORDER, PAPER } = usePalette()
  const { CARD } = useTokens()
  const [data, setData] = useState<ObservatoryResponse | null>(null)
  const [report, setReport] = useState<EdgeReportResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    edgesApi.getObservatory().then(setData).catch(e => setErr(String(e.message ?? e)))
    edgesApi.getReport().then(setReport).catch(() => {})   // best-effort
  }, [])

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  const counts = useMemo(() => {
    const c: Partial<Record<EdgeStatus, number>> = {}
    for (const e of data?.edges ?? []) c[e.status] = (c[e.status] ?? 0) + 1
    return c
  }, [data])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar sections={[]} />

      {/* Hero */}
      <Box sx={{ background: heroBg, borderBottom: `1px solid ${BORDER}`, px: { xs: 2, md: 4 }, pt: 4.5, pb: 3.5 }}>
        <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: CYAN, letterSpacing: '0.18em', textTransform: 'uppercase', mb: 1 }}>
            ● Edge Decay Observatory
          </Typography>
          <Typography sx={{ ...SANS, fontSize: { xs: '1.7rem', md: '2.2rem' }, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1.08 }}>
            Edge <Box component="span" sx={{ color: CYAN }}>Observatory</Box>
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.84rem', color: INK2, maxWidth: 720, mt: 1.25 }}>
            Not "does it work?" — <b>is it still working, and how fast is it dying?</b> Every edge is
            re-measured monthly with the same fixed battery on rolling 24-month windows. The record is
            append-only: readings are never revised, formulas never silently changed.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            {(Object.keys(STATUS_LABEL) as EdgeStatus[]).map(s => (counts[s] ?? 0) > 0 && (
              <Box key={s} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
                <StatusChip status={s} />
                <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK2, mr: 1 }}>×{counts[s]}</Typography>
              </Box>
            ))}
            {data && (
              <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3, ml: 'auto' }}>
                {data.universe.toUpperCase()} · methodology {data.methodology_version} · as of {data.as_of}
              </Typography>
            )}
          </Box>
          {err && <Typography sx={{ ...SANS, fontSize: '0.74rem', color: '#ef4444', mt: 1.5 }}>Backend error: {err}</Typography>}
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4 }, py: 3 }}>
        {!data && !err && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={26} sx={{ color: CYAN }} />
          </Box>
        )}

        {data && (
          <Grid container spacing={2.5}>
            {data.edges.map(card => (
              <Grid item xs={12} md={6} key={card.edge_key}>
                <EdgeCardBox card={card} mode={mode} />
              </Grid>
            ))}
          </Grid>
        )}

        {/* Monthly report — the shareable artifact */}
        {report && (
          <Box sx={{ ...CARD, p: 2.5, mt: 3, bgcolor: PAPER }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: '#14b8a6' }} />
              <Typography sx={{ ...SANS, fontSize: '0.8rem', fontWeight: 800, color: INK }}>
                State of the Edges — {report.period}
              </Typography>
              <Typography
                onClick={() => { navigator.clipboard.writeText(report.markdown); setCopied(true); setTimeout(() => setCopied(false), 1600) }}
                sx={{ ...MONO, fontSize: '0.64rem', color: copied ? '#22c55e' : INK3, ml: 'auto',
                      cursor: 'pointer', '&:hover': { color: INK } }}>
                {copied ? '✓ copied' : '⧉ copy markdown'}
              </Typography>
            </Box>
            <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 1.25 }}>
              Generated deterministically from the measurement record — every number is a stored reading.
            </Typography>
            <Box component="pre" sx={{ ...MONO, fontSize: '0.7rem', color: INK2, lineHeight: 1.65,
                                       whiteSpace: 'pre-wrap', m: 0, p: 1.75, borderRadius: 2,
                                       bgcolor: mode === 'dark' ? '#0B1020' : '#F8FAFC',
                                       border: `1px solid ${BORDER}`, overflowX: 'auto' }}>
              {report.markdown}
            </Box>
          </Box>
        )}

        {/* Methodology — the referee's credibility lives here */}
        {data && (
          <Box sx={{ ...CARD, p: 2.5, mt: 3, bgcolor: PAPER }}>
            <SectionHead title="Methodology & honest caveats" accent="#8b5cf6" />
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.7 }}>
                  <b>Protocol.</b> Rolling 24-month windows, one formation per 21 trading days, 21-day
                  forward returns — no signal is scored without a complete forward window. Ranking edges
                  compare top vs bottom decile; event edges compare signal events vs the equal-weight
                  universe, sign-adjusted so positive always means the trade worked. CIs are
                  deterministic bootstraps (seed 42). Statuses are derived on read from the immutable
                  record — a formula change bumps the methodology version and starts a new series.
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.7 }}>
                  <b>Caveats we won't hide.</b> (1) The universe is today's NSE-500 members — early
                  windows carry survivorship bias, which flatters every edge. (2) Dashed history is
                  backfilled from immutable raw data; solid points were measured at the time.
                  (3) Delivery edges start mid-2025 (data availability) and use ~50 NIFTY symbols.
                  (4) One horizon (21 trading days) — an edge can live at horizons we don't measure.
                </Typography>
              </Grid>
            </Grid>
            <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {(Object.keys(STATUS_LABEL) as EdgeStatus[]).map(s => (
                <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATUS_COLOR[s] }} />
                  <Typography sx={{ ...SANS, fontSize: '0.66rem', color: INK3 }}>
                    <b style={{ color: STATUS_COLOR[s] }}>{STATUS_LABEL[s]}</b> — {STATUS_DESC[s]}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
      <Footer />
    </Box>
  )
}
