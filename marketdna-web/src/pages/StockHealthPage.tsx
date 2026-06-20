import { useState, useEffect, useMemo } from 'react'
import { Footer } from '../components/Footer'
import { useParams } from 'react-router-dom'
import {
  Box, Typography, Select, MenuItem, Grid, CircularProgress, Alert, Tooltip,
} from '@mui/material'
import SearchBox from '../components/shared/SearchBox'
import SectionHead from '../components/shared/SectionHead'
import type { ArchetypeSummary, ArchetypeScanResponse } from '../types/stock_health'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import HighchartsMore from 'highcharts/highcharts-more'
HighchartsMore(Highcharts)
import Navbar from '../components/Navbar'
import { stockApi } from '../api/stockApi'
import { stockHealthApi } from '../api/stockHealthApi'
import type { StockHealthReport } from '../types/stock_health'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// ─── Normaliser (mirrors backend _norm) ──────────────────────────────────────

function norm(v: number, lo: number, hi: number, invert = false): number {
  const s = Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100))
  return invert ? 100 - s : s
}

// ─── Archetype data ───────────────────────────────────────────────────────────

const ARCHETYPES = [
  {
    name: 'Elite Compounder',
    color: '#22c55e',
    icon: '◆',
    short: 'High conviction + high compounding quality.',
    criteria: 'Conviction ≥ 80 AND Compounding ≥ 75',
    investor: 'Core long-term holding. Buy and hold for 5–10 years. Think Asian Paints, Titan, Bajaj Finance.',
    signal: 'Low return concentration, high R², fast recovery.',
  },
  {
    name: 'Steady Grinder',
    color: '#3b82f6',
    icon: '▲',
    short: 'Reliable, low-stress performer.',
    criteria: 'Conviction ≥ 70 AND SWAN ≥ 70',
    investor: 'Good for SIP investors. Lower peak returns but smoother journey. Suits conservative portfolios.',
    signal: 'Consistent monthly returns, low volatility, decent trend efficiency.',
  },
  {
    name: 'Lucky Speculator',
    color: '#f59e0b',
    icon: '◎',
    short: 'Returns driven by a few outlier days — fragile compounding.',
    criteria: 'Skill Ratio < 0.4 (after removing top 10 days, CAGR collapses)',
    investor: 'Dangerous for passive holders. Returns vanish if you miss a few big days. Needs active timing.',
    signal: 'Return concentration > 60%, skill ratio < 0.4, high pain-to-gain.',
  },
  {
    name: 'Anti-Fragile Growth',
    color: '#a855f7',
    icon: '⬡',
    short: 'Gets stronger when markets are stressed.',
    criteria: 'Anti-Fragility > 0.2 (volatility correlates positively with forward returns)',
    investor: 'Rare and valuable. Add to portfolio when VIX spikes. Defensive + offensive simultaneously.',
    signal: 'Positive vol→return correlation. Performs well after sharp sell-offs.',
  },
  {
    name: 'Volatile Performer',
    color: '#f97316',
    icon: '⬟',
    short: 'Good long-run returns but painful to hold.',
    criteria: 'Conviction ≥ 60 AND Compounding < 50',
    investor: 'Only for investors with high risk tolerance. Requires position sizing discipline. Not for SIPs.',
    signal: 'High CAGR but low R², frequent deep drawdowns, slow recovery.',
  },
  {
    name: 'Capital Trap',
    color: '#ef4444',
    icon: '▽',
    short: 'Spends most of its life below previous highs.',
    criteria: 'Time Under Water > 60%',
    investor: 'Avoid as a long-term hold. Capital is idle most of the time. Opportunity cost is enormous.',
    signal: 'Time under water > 60%, high drawdown frequency, poor capital efficiency.',
  },
  {
    name: 'Mean Reverter',
    color: '#06b6d4',
    icon: '⟲',
    short: 'Oscillates around a mean — no persistent trend.',
    criteria: 'Does not meet any of the above thresholds',
    investor: 'Better traded than held. Counter-trend entries at extremes. Not a compounder.',
    signal: 'Low trend efficiency, moderate R², choppy equity curve.',
  },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ children, sx = {} }: { children: React.ReactNode; sx?: object }) {
  const { PAPER, BORDER } = usePalette()
  return (
    <Box sx={{ bgcolor: PAPER, border: `1px solid ${BORDER}`, p: 2.5, ...sx }}>
      {children}
    </Box>
  )
}

// ─── MetricRow — click to expand explanation panel ───────────────────────────

function MetricRow({
  label, value, sub, color, formula, what, bands, insight,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  formula?: string
  what?: string
  bands?: { lo: string; mid: string; hi: string }
  insight?: string
}) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const [open, setOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const hasDetail = !!(formula || what || bands || insight)

  return (
    <Box sx={{ borderBottom: `1px solid ${BORDER}`, '&:last-child': { borderBottom: 'none' } }}>
      {/* Clickable header row */}
      <Box
        onClick={() => hasDetail && setOpen(o => !o)}
        sx={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          py: 0.875, gap: 1,
          cursor: hasDetail ? 'pointer' : 'default',
          userSelect: 'none',
          '&:hover': hasDetail ? { bgcolor: `${PAPER2}80` } : {},
          transition: 'background 0.15s',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          {hasDetail && (
            <Box sx={{
              width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: open ? CYAN : INK3, fontSize: '0.6rem',
              transition: 'transform 0.2s, color 0.2s',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            }}>
              ▶
            </Box>
          )}
          <Typography sx={{ ...SANS, fontSize: '0.78rem', color: open ? INK : INK2, fontWeight: open ? 600 : 500, transition: 'color 0.15s' }}>
            {label}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexShrink: 0 }}>
          <Typography sx={{ ...MONO, fontSize: '0.82rem', fontWeight: 700, color: color ?? INK }}>{value}</Typography>
          {sub && <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3 }}>{sub}</Typography>}
        </Box>
      </Box>

      {/* Collapsible: formula panel + insight panel */}
      {hasDetail && open && (
        <Box sx={{
          mb: 0.5,
          animation: 'fadeSlide 0.15s ease',
          '@keyframes fadeSlide': {
            from: { opacity: 0, transform: 'translateY(-4px)' },
            to:   { opacity: 1, transform: 'translateY(0)' },
          },
        }}>
          {/* Panel 1 — Formula */}
          {(what || formula || bands) && (
            <Box sx={{ bgcolor: PAPER2, borderLeft: `2px solid ${CYAN}`, px: 1.5, py: 1, mb: insight ? 0.5 : 0 }}>
              <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: CYAN, mb: 0.5 }}>
                How it's calculated
              </Typography>
              {what && (
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, mb: formula ? 0.5 : 0, lineHeight: 1.6 }}>
                  {what}
                </Typography>
              )}
              {formula && (
                <Box sx={{ mb: bands ? 0.75 : 0 }}>
                  <Box
                    onClick={e => { e.stopPropagation(); setFormulaOpen(o => !o) }}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, cursor: 'pointer', py: 0.4 }}
                  >
                    <Box sx={{ fontSize: '0.5rem', color: CYAN, transition: 'transform 0.2s', transform: formulaOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</Box>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.06em' }}>
                      Formula
                    </Typography>
                  </Box>
                  {formulaOpen && (
                    <Box sx={{ bgcolor: `${BORDER}60`, px: 1, py: 0.6, mt: 0.25, animation: 'fadeSlide 0.15s ease' }}>
                      <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK3, lineHeight: 1.7, letterSpacing: '0.01em' }}>
                        {formula}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
              {bands && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                  {[
                    { label: bands.lo, color: '#ef4444' },
                    { label: bands.mid, color: '#f59e0b' },
                    { label: bands.hi, color: '#22c55e' },
                  ].map(b => (
                    <Box key={b.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: b.color, flexShrink: 0 }} />
                      <Typography sx={{ ...SANS, fontSize: '0.64rem', color: INK3 }}>{b.label}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* Panel 2 — Insight */}
          {insight && (
            <Box sx={{ bgcolor: `${CYAN}08`, borderLeft: `2px solid #f59e0b`, px: 1.5, py: 1 }}>
              <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#f59e0b', mb: 0.5 }}>
                What this means
              </Typography>
              <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK, lineHeight: 1.65 }}>
                {insight}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

// ─── Composite score ring ─────────────────────────────────────────────────────

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const { INK3, BORDER } = usePalette()
  const r = 36, stroke = 5
  const circ = 2 * Math.PI * r
  const arc = circ * (score / 100)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ position: 'relative', width: 88, height: 88 }}>
        <svg width={88} height={88} viewBox="0 0 88 88" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={44} cy={44} r={r} fill="none" stroke={BORDER} strokeWidth={stroke} />
          <circle cx={44} cy={44} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${arc} ${circ - arc}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ ...MONO, fontSize: '1.125rem', fontWeight: 800, color, lineHeight: 1 }}>
            {score.toFixed(0)}
          </Typography>
        </Box>
      </Box>
      <Typography sx={{ ...SANS, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: INK3, textAlign: 'center' }}>
        {label}
      </Typography>
    </Box>
  )
}

// ─── Composite score breakdown ────────────────────────────────────────────────

function ScoreBreakdown({ report }: { report: StockHealthReport }) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const [formulaOpen, setFormulaOpen] = useState<Record<string, boolean>>({})

  const cr = report.core_returns
  const rs = report.resilience
  const tq = report.trend_quality
  const bh = report.behavioral

  const convComponents = [
    { label: 'Monthly Consistency',  weight: 30, raw: `${(cr.consistency_score*100).toFixed(1)}%`,  pts: norm(cr.consistency_score, 0.4, 1.0) * 0.30 },
    { label: 'Wealth Smoothness R²', weight: 25, raw: tq.wealth_smoothness_r2.toFixed(3),           pts: norm(tq.wealth_smoothness_r2, 0, 1) * 0.25 },
    { label: 'Trend Efficiency',     weight: 20, raw: `${(tq.trend_efficiency*100).toFixed(1)}%`,   pts: norm(tq.trend_efficiency, 0, 1) * 0.20 },
    { label: 'Time Above Water',     weight: 15, raw: `${((1-rs.time_under_water)*100).toFixed(1)}%`, pts: norm(rs.time_under_water, 0, 1, true) * 0.15 },
    { label: 'Pain-to-Gain (inverted)', weight: 10, raw: bh.pain_to_gain.toFixed(2),               pts: norm(bh.pain_to_gain, 0, 5, true) * 0.10 },
  ]

  const swanComponents = [
    { label: 'Monthly Consistency',    weight: 25, raw: `${(cr.consistency_score*100).toFixed(1)}%`,     pts: norm(cr.consistency_score, 0.4, 1.0) * 0.25 },
    { label: 'Time Above Water',       weight: 25, raw: `${((1-rs.time_under_water)*100).toFixed(1)}%`,  pts: norm(rs.time_under_water, 0, 0.7, true) * 0.25 },
    { label: 'Recovery Speed',         weight: 20, raw: rs.avg_recovery_days != null ? `${Math.round(rs.avg_recovery_days)}d` : '—', pts: norm(rs.avg_recovery_days ?? 200, 0, 200, true) * 0.20 },
    { label: 'Trend Efficiency',       weight: 15, raw: `${(tq.trend_efficiency*100).toFixed(1)}%`,      pts: norm(tq.trend_efficiency, 0, 1) * 0.15 },
    { label: 'Ann. Volatility',        weight: 15, raw: '(internal)',                                     pts: null },
  ]

  const cqComponents = [
    { label: 'CAGR',                  weight: 35, raw: `${cr.cagr.toFixed(1)}%`,                    pts: norm(cr.cagr, 0, 30) * 0.35 },
    { label: 'Wealth Smoothness R²',  weight: 35, raw: tq.wealth_smoothness_r2.toFixed(3),           pts: norm(tq.wealth_smoothness_r2, 0, 1) * 0.35 },
    { label: 'Recovery Factor',       weight: 15, raw: rs.avg_recovery_days != null ? `1÷(1+${Math.round(rs.avg_recovery_days)}/252)` : '—', pts: norm(1/(1+(rs.avg_recovery_days ?? 0)/252), 0, 1) * 0.15 },
    { label: 'DD Frequency (inverted)', weight: 15, raw: `${rs.drawdown_frequency} events`,          pts: norm(rs.drawdown_frequency, 0, 10, true) * 0.15 },
  ]

  const scores = [
    { title: 'Conviction', color: '#3b82f6', total: report.composite_scores.conviction, components: convComponents, desc: 'How trustworthy is the return pattern? High = consistent, efficient, low-pain growth.' },
    { title: 'SWAN',       color: '#22c55e', total: report.composite_scores.swan,       components: swanComponents, desc: 'Sleep-Well-At-Night score. How comfortable is it to hold this stock without anxiety?' },
    { title: 'Compounding Quality', color: '#a855f7', total: report.composite_scores.compounding_quality, components: cqComponents, desc: 'Is the growth genuinely compounding? High = fast CAGR + smooth curve + quick recoveries.' },
  ]

  return (
    <Grid container spacing={2}>
      {scores.map(({ title, color, total, components, desc }) => (
        <Grid item xs={12} md={4} key={title}>
          <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, p: 2, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography sx={{ ...MONO, fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{total.toFixed(0)}</Typography>
              <Typography sx={{ ...SANS, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color }}>/ 100 · {title}</Typography>
            </Box>
            <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, mb: 1.5, lineHeight: 1.5 }}>{desc}</Typography>

            {/* Formula toggle */}
            <Box sx={{ mb: 1 }}>
              <Box
                onClick={() => setFormulaOpen(prev => ({ ...prev, [title]: !prev[title] }))}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, cursor: 'pointer', py: 0.4 }}
              >
                <Box sx={{ fontSize: '0.5rem', color, transition: 'transform 0.2s', transform: formulaOpen[title] ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</Box>
                <Typography sx={{ ...SANS, fontSize: '0.68rem', fontWeight: 700, color, letterSpacing: '0.06em' }}>
                  Formula
                </Typography>
              </Box>
              {formulaOpen[title] && (
                <Box sx={{ bgcolor: `${BORDER}60`, borderLeft: `2px solid ${color}`, px: 1, py: 0.75, mt: 0.25,
                  animation: 'fadeSlide 0.15s ease',
                  '@keyframes fadeSlide': { from: { opacity: 0, transform: 'translateY(-4px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
                }}>
                  <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, lineHeight: 1.8, letterSpacing: '0.02em' }}>
                    = {components.map(c => `(${c.label.split(' ')[0]} × ${c.weight}%)`).join(' + ')}
                  </Typography>
                </Box>
              )}
            </Box>

            {components.map(c => {
              const contribution = c.pts
              const barW = contribution !== null ? Math.max(0, Math.min(100, contribution / (c.weight) * 100)) : 0
              return (
                <Box key={c.label} sx={{ mb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline' }}>
                      <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK2 }}>{c.label}</Typography>
                      <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>×{c.weight}%</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline' }}>
                      <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>{c.raw}</Typography>
                      {contribution !== null && (
                        <Typography sx={{ ...MONO, fontSize: '0.68rem', fontWeight: 700, color }}>
                          +{contribution.toFixed(1)}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ height: 3, bgcolor: BORDER, borderRadius: 2 }}>
                    <Box sx={{ height: '100%', width: `${barW}%`, bgcolor: color, borderRadius: 2, opacity: 0.7 }} />
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Grid>
      ))}
    </Grid>
  )
}

// ─── CrashBar ─────────────────────────────────────────────────────────────────

function CrashBar({ label, period, value }: { label: string; period: string; value: number | null }) {
  const { INK2, INK3, BORDER } = usePalette()
  if (value === null) {
    return (
      <Box sx={{ py: 1, borderBottom: `1px solid ${BORDER}`, '&:last-child': { borderBottom: 'none' } }}>
        <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2 }}>{label}</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK3 }}>No data for this period</Typography>
      </Box>
    )
  }
  const pct = value * 100
  const color = pct >= 0 ? '#22c55e' : '#ef4444'
  const barW = Math.min(100, Math.abs(pct) * 2)

  return (
    <Box sx={{ py: 1, borderBottom: `1px solid ${BORDER}`, '&:last-child': { borderBottom: 'none' } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2, fontWeight: 500 }}>{label}</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.82rem', fontWeight: 700, color }}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
        </Typography>
      </Box>
      <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3, mb: 0.5 }}>{period}</Typography>
      <Box sx={{ height: 4, bgcolor: BORDER, borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${barW}%`, bgcolor: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </Box>
    </Box>
  )
}

// ─── RegimeBlock ──────────────────────────────────────────────────────────────

function RegimeBlock({ label, def: defn, ret, days, color }: { label: string; def: string; ret: number | null; days: number; color: string }) {
  const { INK3, BORDER, PAPER2 } = usePalette()
  const pct = ret !== null ? ret * 100 : null

  return (
    <Box sx={{ flex: 1, p: 1.5, bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
      <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color, mb: 0.25 }}>
        {label}
      </Typography>
      <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.5 }}>{defn}</Typography>
      <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: pct !== null ? (pct >= 0 ? '#22c55e' : '#ef4444') : INK3, lineHeight: 1 }}>
        {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
      </Typography>
      <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mt: 0.25 }}>{days} days</Typography>
    </Box>
  )
}

// ─── MomentumBar ─────────────────────────────────────────────────────────────

function MomentumBar({ streak, value }: { streak: number; value: number }) {
  const { INK2, INK3, BORDER } = usePalette()
  const pct = value * 100
  const color = pct >= 55 ? '#22c55e' : pct >= 48 ? '#f59e0b' : '#ef4444'

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK2 }}>{streak}-day streak → next day up</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 700, color }}>{pct.toFixed(1)}%</Typography>
      </Box>
      <Box sx={{ height: 5, bgcolor: BORDER, borderRadius: 2.5, overflow: 'hidden', position: 'relative' }}>
        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: color, borderRadius: 2.5, transition: 'width 0.5s ease' }} />
        {/* 50% reference line */}
        <Box sx={{ position: 'absolute', top: 0, left: '50%', width: '1px', height: '100%', bgcolor: INK3, opacity: 0.5 }} />
      </Box>
      <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, mt: 0.3 }}>
        After {streak} consecutive green closes, next close was green {pct.toFixed(0)}% of the time · coin-flip baseline = 50%
      </Typography>
    </Box>
  )
}

// ─── AlphaCell ───────────────────────────────────────────────────────────────

function AlphaCell({ lag, value, lagLabel }: { lag: string; value: number | null; lagLabel: string }) {
  const { INK3, BORDER, PAPER2 } = usePalette()
  const pct = value !== null ? value * 100 : null
  const color = pct !== null ? (pct >= 2 ? '#22c55e' : pct >= 0 ? '#f59e0b' : '#ef4444') : INK3

  return (
    <Box sx={{ flex: 1, p: 1.5, bgcolor: PAPER2, border: `1px solid ${BORDER}`, textAlign: 'center' }}>
      <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: INK3, mb: 0.25 }}>
        {lagLabel}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '1rem', fontWeight: 800, color, lineHeight: 1 }}>
        {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
      </Typography>
      <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mt: 0.4, lineHeight: 1.4 }}>
        avg fwd return<br />{lag} after top-quartile month
      </Typography>
    </Box>
  )
}

// ─── DNA Radar ───────────────────────────────────────────────────────────────

function DnaRadar({ report }: { report: StockHealthReport }) {
  const { BORDER, INK, INK3, CYAN } = usePalette()
  const { mode } = useThemeMode()

  const axes = [
    { label: 'Conviction',     value: report.composite_scores.conviction },
    { label: 'SWAN',           value: report.composite_scores.swan },
    { label: 'Compounding',    value: report.composite_scores.compounding_quality },
    { label: 'Capital Eff',    value: norm(report.core_returns.capital_efficiency, 0, 1.5) },
    { label: 'Anti-Fragility', value: norm(report.behavioral.anti_fragility, -0.5, 0.5) },
    { label: 'Consistency',    value: report.core_returns.consistency_score * 100 },
  ]

  const options: Highcharts.Options = {
    chart: { polar: true, type: 'line', height: 300, backgroundColor: 'transparent', animation: false, margin: [20, 20, 20, 20] },
    title: { text: '' },
    credits: { enabled: false },
    legend: { enabled: false },
    pane: { size: '78%' },
    xAxis: {
      categories: axes.map(a => a.label),
      tickmarkPlacement: 'on',
      lineWidth: 0,
      labels: { style: { color: INK3, fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: '0.68rem', fontWeight: '700' } },
      gridLineColor: BORDER,
    },
    yAxis: {
      gridLineInterpolation: 'polygon',
      lineWidth: 0,
      min: 0, max: 100,
      tickInterval: 25,
      gridLineColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.6rem' } },
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0B1429' : '#ffffff',
      borderColor: BORDER,
      style: { color: INK, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.75rem' },
      formatter: function (this: Highcharts.TooltipFormatterContextObject) {
        return `<b>${this.point.category}</b><br/>${Number(this.y).toFixed(1)} / 100`
      },
    },
    series: [{
      type: 'line',
      name: report.symbol,
      data: axes.map(a => a.value),
      color: CYAN,
      lineWidth: 2,
      pointPlacement: 'on',
      fillColor: `${CYAN}22`,
      marker: { enabled: true, radius: 3, fillColor: CYAN, lineWidth: 0 },
    } as Highcharts.SeriesLineOptions],
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ─── Archetype Legend ─────────────────────────────────────────────────────────

function ArchetypeLegend({ current }: { current: string }) {
  const { INK, INK2, INK3, BORDER, PAPER2 } = usePalette()

  return (
    <Grid container spacing={1.5}>
      {ARCHETYPES.map(a => {
        const isActive = a.name === current
        return (
          <Grid item xs={12} sm={6} md={4} lg={3} key={a.name}>
            <Box sx={{
              p: 1.75,
              bgcolor: isActive ? `${a.color}0f` : PAPER2,
              border: `1px solid ${isActive ? a.color + '60' : BORDER}`,
              height: '100%',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Typography sx={{ fontSize: '1rem', color: a.color, lineHeight: 1 }}>{a.icon}</Typography>
                <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', color: a.color }}>
                  {a.name}
                  {isActive && <Box component="span" sx={{ ...SANS, fontSize: '0.6rem', fontWeight: 600, letterSpacing: 0, ml: 0.75, px: 0.6, py: 0.1, bgcolor: `${a.color}25`, color: a.color, textTransform: 'none' }}>← this stock</Box>}
                </Typography>
              </Box>
              <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK, fontWeight: 500, mb: 0.5, lineHeight: 1.4 }}>
                {a.short}
              </Typography>
              <Box sx={{ borderLeft: `2px solid ${a.color}50`, pl: 1, mb: 0.75 }}>
                <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, lineHeight: 1.5 }}>
                  Trigger: {a.criteria}
                </Typography>
              </Box>
              <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK2, lineHeight: 1.5 }}>
                {a.investor}
              </Typography>
            </Box>
          </Grid>
        )
      })}
    </Grid>
  )
}

// ─── Archetype Scanner ────────────────────────────────────────────────────────

function ArchetypeScanner({ onSelect }: { onSelect: (symbol: string) => void }) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const [scanResp, setScanResp]  = useState<ArchetypeScanResponse | null>(null)
  const [started, setStarted]    = useState(false)
  const [error, setError]        = useState<string | null>(null)
  const [active, setActive]      = useState<string>(ARCHETYPES[0].name)
  const [symSearch, setSymSearch] = useState('')

  const poll = () => {
    stockHealthApi.getScan()
      .then(d => {
        setScanResp(d)
        if (!d.ready) {
          setTimeout(poll, 3000)
        }
      })
      .catch(e => setError(e.message))
  }

  const start = () => {
    setStarted(true)
    poll()
  }

  const items = scanResp?.items ?? []

  const grouped = useMemo(() =>
    ARCHETYPES.reduce((acc, a) => {
      acc[a.name] = items.filter(s => s.archetype === a.name)
        .sort((x, y) => y.conviction - x.conviction)
      return acc
    }, {} as Record<string, ArchetypeSummary[]>)
  , [items])

  const activeMeta = ARCHETYPES.find(a => a.name === active) ?? ARCHETYPES[0]
  const allActiveStocks = grouped[active] ?? []
  const activeStocks = symSearch
    ? allActiveStocks.filter(s => s.symbol.toLowerCase().includes(symSearch.toLowerCase()))
    : allActiveStocks

  const handleArchetypeChange = (name: string) => { setActive(name); setSymSearch('') }

  if (!started) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography sx={{ ...SANS, fontSize: '0.82rem', color: INK3, mb: 2 }}>
          Classify every stock in the universe by behavioural archetype.
        </Typography>
        <Box
          component="button"
          onClick={start}
          sx={{
            ...SANS, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            bgcolor: CYAN, color: '#000', px: 3, py: 1.25, border: 'none', cursor: 'pointer',
            '&:hover': { opacity: 0.85 }, transition: 'opacity 0.15s',
          }}
        >
          Run Archetype Scan
        </Box>
      </Box>
    )
  }

  if (error) return <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert>

  // Show progress bar while warming up
  const isReady = scanResp?.ready ?? false
  const computed = scanResp?.computed ?? 0
  const total = scanResp?.total ?? 48
  const pct = total > 0 ? Math.round(computed / total * 100) : 0

  if (!isReady && computed === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, gap: 2 }}>
        <CircularProgress size={32} sx={{ color: CYAN }} />
        <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK3 }}>
          Computing health reports… {computed}/{total}
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      {/* Progress bar while warming up */}
      {!isReady && (
        <Box sx={{ mb: 2, px: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3 }}>
              Computing… {computed} of {total} stocks
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.7rem', color: CYAN }}>{pct}%</Typography>
          </Box>
          <Box sx={{ height: 3, bgcolor: BORDER, borderRadius: 2 }}>
            <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: CYAN, borderRadius: 2, transition: 'width 0.5s ease' }} />
          </Box>
        </Box>
      )}
    <Box sx={{ display: 'flex', gap: 0, minHeight: 480 }}>
      {/* Left: archetype selector */}
      <Box sx={{ width: 240, flexShrink: 0, borderRight: `1px solid ${BORDER}` }}>
        {ARCHETYPES.map(a => {
          const count = grouped[a.name]?.length ?? 0
          const isActive = active === a.name
          return (
            <Box
              key={a.name}
              onClick={() => handleArchetypeChange(a.name)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.25,
                px: 2, py: 1.5,
                cursor: 'pointer',
                bgcolor: isActive ? `${a.color}10` : 'transparent',
                borderLeft: `3px solid ${isActive ? a.color : 'transparent'}`,
                borderBottom: `1px solid ${BORDER}`,
                transition: 'background 0.15s',
                '&:hover': { bgcolor: `${a.color}08` },
              }}
            >
              <Typography sx={{ fontSize: '0.9rem', color: a.color, lineHeight: 1, flexShrink: 0 }}>
                {a.icon}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{
                  ...SANS, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em',
                  color: isActive ? a.color : INK2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {a.name}
                </Typography>
              </Box>
              <Box sx={{
                minWidth: 22, height: 20, px: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: isActive ? a.color : BORDER,
                transition: 'background 0.15s',
              }}>
                <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: isActive ? '#000' : INK3, lineHeight: 1 }}>
                  {count}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>

      {/* Right: stocks in selected archetype */}
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {/* Archetype header */}
        <Box sx={{ px: 3, py: 2, borderBottom: `1px solid ${BORDER}`, bgcolor: `${activeMeta.color}08` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <Typography sx={{ fontSize: '1.1rem', color: activeMeta.color }}>{activeMeta.icon}</Typography>
            <Typography sx={{ ...SANS, fontSize: '0.9rem', fontWeight: 800, letterSpacing: '0.08em', color: activeMeta.color }}>
              {activeMeta.name}
            </Typography>
            <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>
              — {activeStocks.length}{symSearch ? ` of ${allActiveStocks.length}` : ''} stock{activeStocks.length !== 1 ? 's' : ''}
            </Typography>
            <Box sx={{ ml: 'auto' }}>
              <SearchBox value={symSearch} onChange={setSymSearch} placeholder="Filter…" width={110} />
            </Box>
          </Box>
          <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.5 }}>
            {activeMeta.investor}
          </Typography>
          <Box sx={{ borderLeft: `2px solid ${activeMeta.color}50`, pl: 1, mt: 0.75 }}>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>
              Trigger: {activeMeta.criteria}
            </Typography>
          </Box>
        </Box>

        {/* Column headers */}
        {activeStocks.length > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '100px 1fr 80px 80px 80px 80px 80px', gap: 0, borderBottom: `1px solid ${BORDER}`, px: 2, py: 0.75, bgcolor: PAPER2 }}>
            {['SYMBOL', 'ARCHETYPE', 'CONV.', 'SWAN', 'CMPD.', 'CAGR', 'MAX DD'].map(h => (
              <Typography key={h} sx={{ ...SANS, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.12em', color: INK3, textAlign: h === 'SYMBOL' || h === 'ARCHETYPE' ? 'left' : 'right' }}>
                {h}
              </Typography>
            ))}
          </Box>
        )}

        {/* Stock rows */}
        {activeStocks.length === 0 ? (
          <Box sx={{ px: 3, py: 4 }}>
            <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK3 }}>
              No stocks classified as {active} in the current universe.
            </Typography>
          </Box>
        ) : (
          activeStocks.map((s, i) => (
            <Box
              key={s.symbol}
              onClick={() => onSelect(s.symbol)}
              sx={{
                display: 'grid', gridTemplateColumns: '100px 1fr 80px 80px 80px 80px 80px',
                gap: 0, px: 2, py: 1.1,
                borderBottom: `1px solid ${BORDER}`,
                cursor: 'pointer',
                bgcolor: i % 2 === 0 ? 'transparent' : `${PAPER2}50`,
                '&:hover': { bgcolor: `${activeMeta.color}08` },
                transition: 'background 0.12s',
              }}
            >
              <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 700, color: CYAN }}>
                {s.symbol}
              </Typography>
              <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3 }}>
                {s.years.toFixed(1)}y data
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 700, color: '#3b82f6', textAlign: 'right' }}>
                {s.conviction.toFixed(0)}
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 700, color: '#22c55e', textAlign: 'right' }}>
                {s.swan.toFixed(0)}
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 700, color: '#a855f7', textAlign: 'right' }}>
                {s.compounding_quality.toFixed(0)}
              </Typography>
              <Typography sx={{
                ...MONO, fontSize: '0.75rem', fontWeight: 700, textAlign: 'right',
                color: s.cagr >= 12 ? '#22c55e' : s.cagr >= 6 ? '#f59e0b' : '#ef4444',
              }}>
                {s.cagr.toFixed(1)}%
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 700, color: '#ef4444', textAlign: 'right' }}>
                {s.max_drawdown.toFixed(1)}%
              </Typography>
            </Box>
          ))
        )}
      </Box>
    </Box>
    </Box>
  )
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StockHealthPage() {
  const { BG, PAPER, BORDER, INK, INK2, INK3, CYAN, PAPER2 } = usePalette()
  const { INPUT_SX } = useTokens()
  const { mode } = useThemeMode()
  const { symbol: urlSymbol } = useParams<{ symbol: string }>()

  const [symbols, setSymbols]  = useState<string[]>([])
  const [symbol, setSymbol]    = useState(urlSymbol?.toUpperCase() ?? 'RELIANCE')
  const [report, setReport]    = useState<StockHealthReport | null>(null)
  const [loading, setLoading]  = useState(false)
  const [error, setError]      = useState<string | null>(null)
  const [view, setView]        = useState<'scanner' | 'detail'>('detail')

  useEffect(() => {
    stockApi.getSymbols().then(r => setSymbols(r.symbols)).catch(console.error)
  }, [])

  useEffect(() => {
    if (!symbol) return
    setReport(null); setError(null); setLoading(true)
    stockHealthApi.getReport(symbol)
      .then(setReport)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  const archMeta = report
    ? (ARCHETYPES.find(a => a.name === report.archetype) ?? ARCHETYPES[6])
    : null

  const ddOptions = useMemo((): Highcharts.Options => {
    if (!report?.drawdown_series.length) return {}
    const series = report.drawdown_series.map(p => [new Date(p.date).getTime(), p.drawdown])
    return {
      chart: { type: 'area', height: 240, backgroundColor: 'transparent', animation: false, margin: [8, 8, 30, 52] },
      title: { text: '' },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime', lineColor: BORDER, tickColor: BORDER,
        labels: { style: { color: INK3, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem' }, format: '{value:%b %y}' },
      },
      yAxis: {
        title: { text: '' }, gridLineColor: BORDER, max: 0,
        labels: { style: { color: INK3, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem' }, format: '{value}%' },
      },
      tooltip: {
        backgroundColor: mode === 'dark' ? '#0B1429' : '#ffffff',
        borderColor: BORDER,
        style: { color: INK, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.75rem' },
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          return `<b>${Highcharts.dateFormat('%d %b %Y', Number(this.x))}</b><br/>Drawdown: <b>${Number(this.y).toFixed(2)}%</b>`
        },
      },
      series: [{
        type: 'area', name: 'Drawdown', data: series,
        color: '#ef4444',
        fillColor: { linearGradient: { x1: 0, y1: 1, x2: 0, y2: 0 }, stops: [[0, 'rgba(239,68,68,0.35)'], [1, 'rgba(239,68,68,0.03)']] },
        lineWidth: 1.5, marker: { enabled: false }, threshold: 0,
      }],
    }
  }, [report, BORDER, INK, INK3, mode])

  // ── Formula + insight strings (computed from live report data) ──────────────

  const f = (r: StockHealthReport) => {
    const totalMonths  = Math.round(r.years * 12)
    const posMonths    = Math.round(r.core_returns.consistency_score * totalMonths)
    const growthMult   = Math.pow(1 + r.core_returns.cagr / 100, r.years).toFixed(2)
    const totalDays    = Math.round(r.years * 252)
    const uwDays       = Math.round(r.resilience.time_under_water * totalDays)
    const yearsPerDD   = r.resilience.drawdown_frequency > 0
      ? (r.years / r.resilience.drawdown_frequency).toFixed(1) : '—'
    const doublingYrs  = r.core_returns.cagr > 0
      ? (72 / r.core_returns.cagr).toFixed(1) : null
    const val10y       = r.core_returns.cagr > 0
      ? Math.pow(1 + r.core_returns.cagr / 100, 10).toFixed(1) : null
    const consBeat     = ((r.core_returns.consistency_score - 0.5) * 100).toFixed(1)
    const prob3Green   = Math.pow(r.core_returns.consistency_score, 3) * 100

    return {
      formulas: {
        cagr:        `Stock grew ${growthMult}× over ${r.years}y → (${growthMult})^(1÷${r.years}y) − 1 = ${r.core_returns.cagr.toFixed(1)}% per year`,
        consistency: `${posMonths} of ${totalMonths} months had a positive close-to-close return`,
        concentration:`Top 5 best trading days in ${r.years}y = ${(r.core_returns.return_concentration*100).toFixed(1)}% of all gains. Removing those 5 days erases most of the return.`,
        capEff:      `CAGR ÷ |Max DD| = ${r.core_returns.cagr.toFixed(1)}% ÷ ${Math.abs(r.resilience.max_drawdown).toFixed(1)}% = ${r.core_returns.capital_efficiency.toFixed(2)} — every 1% of annual return cost ${r.core_returns.capital_efficiency > 0 ? (1/r.core_returns.capital_efficiency).toFixed(1) : '∞'}% of peak-to-trough pain`,
        maxDD:       `Worst single peak-to-trough decline over the full ${r.years}y history`,
        ddFreq:      `${r.resilience.drawdown_frequency} separate falls of ≥10% over ${r.years}y ≈ one every ${yearsPerDD} years`,
        recovery:    r.resilience.avg_recovery_days != null
          ? `Average ${Math.round(r.resilience.avg_recovery_days)} trading days (≈${(r.resilience.avg_recovery_days/21).toFixed(1)} months) to climb from trough back to the prior all-time high`
          : 'No drawdown of ≥10% recovered during the observed period',
        timeUW:      `${uwDays} of ${totalDays} trading days (${(r.resilience.time_under_water*100).toFixed(1)}%) were spent below a prior all-time high`,
        trendEff:    `|Last close − First close| ÷ Σ|daily moves| = ${(r.trend_quality.trend_efficiency*100).toFixed(1)}% — how much of daily movement was directional vs. noise`,
        r2:          `R² = ${r.trend_quality.wealth_smoothness_r2.toFixed(3)} from regressing log(price) on time. 1.0 = perfectly straight-line growth, 0.0 = random walk`,
        skillRatio:  `CAGR with top-10 days removed ÷ actual CAGR = ${r.trend_quality.cagr_ex_top10.toFixed(1)}% ÷ ${r.core_returns.cagr.toFixed(1)}% = ${r.trend_quality.skill_ratio.toFixed(2)} — close to 1.0 means returns are skill-driven, not luck-driven`,
        p2g:         `Sum of all daily drawdown levels ÷ total gain% = ${r.behavioral.pain_to_gain.toFixed(2)}. Lower = less pain per unit of profit`,
        antiFrag:    `Pearson r(3-month rolling vol, 3-month forward return) = ${r.behavioral.anti_fragility.toFixed(3)}. Positive means high-vol environments precede higher returns.`,
        oppCost:     `${(r.behavioral.opportunity_cost*100).toFixed(1)}% of trading days the stock was within ±5% of its price exactly one year prior — effectively going nowhere`,
      },
      insights: {
        cagr: doublingYrs
          ? `At ${r.core_returns.cagr.toFixed(1)}% per year, this stock doubles every ${doublingYrs} years (Rule of 72). ₹1 lakh invested ${r.years}y ago would be ₹${growthMult} lakh today. Over 10 years it would become ₹${val10y} lakh. A fixed deposit at 7% would have given ₹${Math.pow(1.07, 10).toFixed(1)} lakh — this stock ${r.core_returns.cagr > 7 ? `beat FD by ${(r.core_returns.cagr - 7).toFixed(1)} percentage points annually` : 'underperformed a fixed deposit'}.`
          : 'Negative CAGR — this stock has destroyed capital over the observed period.',
        consistency: `This stock ends a positive month ${(r.core_returns.consistency_score*100).toFixed(0)}% of the time, beating the 50% coin-flip baseline by ${consBeat} percentage points. The probability of three consecutive positive months is ${prob3Green.toFixed(0)}%. For SIP investors: out of every 10 months, expect roughly ${posMonths > 0 ? Math.round(r.core_returns.consistency_score * 10) : 0} to be positive.`,
        concentration: r.core_returns.return_concentration > 0.5
          ? `More than half of all gains came from just 5 days out of ${totalDays} trading days. This is a classic "lottery ticket" return profile — being out of the market on those specific days would have eliminated most of the profit. Time-in-market is critical for this stock.`
          : `Return concentration is ${(r.core_returns.return_concentration*100).toFixed(0)}% — the return is relatively well-distributed across many days, not dependent on a few outlier events. This makes the return pattern more repeatable and less reliant on lucky timing.`,
        capEff: r.core_returns.capital_efficiency >= 0.5
          ? `For every 1% of annual return earned, the worst-case drawdown was only ${r.core_returns.capital_efficiency > 0 ? (1/r.core_returns.capital_efficiency).toFixed(1) : '∞'}%. A Calmar ratio above 0.5 is considered excellent — this stock earns its return efficiently relative to the pain endured.`
          : `For every 1% of annual return earned, the drawdown went as low as ${r.core_returns.capital_efficiency > 0 ? (1/r.core_returns.capital_efficiency).toFixed(1) : '∞'}%. The return is disproportionately small relative to the maximum pain. High-CAGR stocks with low Calmar are volatile performers — the journey is rough.`,
        maxDD: `In the worst case, a holder who bought at the peak would have seen their investment fall to ${(100 + r.resilience.max_drawdown).toFixed(0)} paise on the rupee before recovery. ${Math.abs(r.resilience.max_drawdown) > 50 ? 'A drawdown of this magnitude is severe — most investors would have panic-sold before recovery.' : Math.abs(r.resilience.max_drawdown) > 30 ? 'This required strong conviction to hold through. Many institutional investors have a −30% stop-loss, meaning they would have been forced out near the bottom.' : 'This is within the typical range for an equity investor with a long horizon.'}`,
        ddFreq: r.resilience.drawdown_frequency === 0
          ? `No drawdown of ≥10% in ${r.years}y of history — extremely rare. Either the stock is a true compounder or the history is too short to have seen a real correction.`
          : `A −10% drawdown roughly every ${yearsPerDD} years. For a long-term holder who never sells, this is just noise. For someone using stop-losses, each event is a potential forced exit. The key question is whether recovery was fast (see Avg Recovery Time above).`,
        recovery: r.resilience.avg_recovery_days != null
          ? `Average recovery of ${Math.round(r.resilience.avg_recovery_days)} days ≈ ${(r.resilience.avg_recovery_days/21).toFixed(1)} months. The Nifty 50 index took ~250 days to recover from the Covid crash. ${r.resilience.avg_recovery_days < 120 ? 'This stock recovers faster than typical — a sign of structural demand.' : r.resilience.avg_recovery_days < 250 ? 'Recovery speed is in line with the broad market.' : 'Slow recovery suggests weak institutional buying interest after drawdowns.'}`
          : 'No completed drawdown cycles observed — the stock either never fell 10% or has not yet recovered from its current drawdown.',
        timeUW: `Out of every 100 trading days, this stock spent ${(r.resilience.time_under_water*100).toFixed(0)} days below a prior all-time high. ${r.resilience.time_under_water > 0.6 ? 'More than 60% of the time underwater is the Capital Trap threshold — the stock spends most of its life in recovery mode, meaning holders are rarely at a profit on their specific entry price.' : r.resilience.time_under_water > 0.35 ? 'Moderate time underwater — expected for most equities. Holders bought at various points will often be waiting for breakeven.' : 'Rarely underwater — this stock makes new highs frequently, meaning most holders are in profit most of the time.'}`,
        trendEff: `Out of all the total price movement this stock made (up days + down days combined), only ${(r.trend_quality.trend_efficiency*100).toFixed(1)}% was net forward progress. ${r.trend_quality.trend_efficiency < 0.02 ? 'Extremely low efficiency — the stock moves a lot but goes nowhere. High transaction costs and slippage would eliminate any gains for active traders.' : r.trend_quality.trend_efficiency < 0.05 ? 'Moderate trend efficiency. Trend-following strategies would struggle — there is too much noise relative to the signal.' : 'Good trend efficiency — the stock has a meaningful directional bias, making it suitable for trend-following approaches.'}`,
        r2: `An R² of ${r.trend_quality.wealth_smoothness_r2.toFixed(3)} means log-linear regression explains ${(r.trend_quality.wealth_smoothness_r2*100).toFixed(1)}% of price variance. ${r.trend_quality.wealth_smoothness_r2 > 0.9 ? 'Near-perfect smooth compounding — SIP returns on this stock would be highly predictable regardless of entry timing.' : r.trend_quality.wealth_smoothness_r2 > 0.7 ? 'Reasonably smooth growth curve. Most entry points over a 3–5 year hold would have been profitable.' : 'Choppy equity curve — return is sensitive to entry timing. A bad entry point could require years before turning profitable.'}`,
        skillRatio: `Removing the 10 best days leaves ${r.trend_quality.cagr_ex_top10.toFixed(1)}% CAGR — ${r.trend_quality.skill_ratio.toFixed(0) === '1' ? 'essentially identical to the actual CAGR' : `${((1 - r.trend_quality.skill_ratio)*100).toFixed(0)}% lower than the actual ${r.core_returns.cagr.toFixed(1)}%`}. ${r.trend_quality.skill_ratio > 0.7 ? 'This is a skill-driven return — consistent across many days, not concentrated in lucky moments. It can be expected to repeat.' : r.trend_quality.skill_ratio > 0.4 ? 'Moderate skill ratio — some dependence on outlier days but not extreme.' : 'Low skill ratio — the return is driven by very few outlier days. Missing those days means missing most of the return. This is a "buy and pray" stock.'}`,
        p2g: `For every 1% of total gain earned, the cumulative daily drawdown pain totalled ${r.behavioral.pain_to_gain.toFixed(2)} percentage-points. ${r.behavioral.pain_to_gain < 1.5 ? 'Below 1.5 is excellent — the profit was earned with minimal pain. This is the profile of a smooth compounder that rarely makes holders anxious.' : r.behavioral.pain_to_gain < 3 ? 'Moderate pain-to-gain — typical for most equity investments. Holders had to endure some periods of drawdown but were rewarded.' : 'High pain-to-gain — the return came at significant emotional cost. Most investors would have sold before capturing the full upside.'}`,
        antiFrag: r.behavioral.anti_fragility > 0.2
          ? `Correlation of ${r.behavioral.anti_fragility.toFixed(3)} between rolling volatility and forward returns is meaningfully positive. This stock tends to perform better after volatile periods — it is genuinely anti-fragile. Adding it to a portfolio before expected market turbulence can reduce drawdown while maintaining upside.`
          : r.behavioral.anti_fragility > 0
          ? `Slight positive correlation (${r.behavioral.anti_fragility.toFixed(3)}) — marginally anti-fragile but not strongly so. The relationship between volatility and future returns is weak and may not be exploitable.`
          : `Negative correlation (${r.behavioral.anti_fragility.toFixed(3)}) — this stock tends to perform worse when markets are volatile. It is fragile under stress. Avoid increasing exposure when India VIX is rising.`,
        oppCost: `On ${(r.behavioral.opportunity_cost*100).toFixed(0)}% of trading days, an investor holding this stock for a year was sitting at roughly the same price they started at. ${r.behavioral.opportunity_cost > 0.4 ? `That is ${Math.round(r.behavioral.opportunity_cost * 252)} days per year on average when capital could have been deployed elsewhere. The opportunity cost of holding a flat stock is the alternative return — if another stock compounded at 15%, each flat year costs you 15% in forgone gains.` : r.behavioral.opportunity_cost > 0.2 ? 'Moderate dead zones. Some periods of sideways drift are normal — the question is whether the eventual breakouts were strong enough to compensate.' : 'Very low opportunity cost — the stock rarely marks time. It is either rising or falling with purpose, rarely going sideways for extended stretches.'}`,
      },
    }
  }

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

          {/* View toggle */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
            <Box sx={{ display: 'flex', border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
              {(['detail', 'scanner'] as const).map(v => (
                <Box
                  key={v}
                  onClick={() => setView(v)}
                  sx={{
                    px: 1.75, py: 0.6, cursor: 'pointer',
                    bgcolor: view === v ? CYAN : 'transparent',
                    transition: 'background 0.15s',
                    '&:hover': { bgcolor: view === v ? CYAN : `${CYAN}20` },
                  }}
                >
                  <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: view === v ? '#000' : INK3 }}>
                    {v === 'detail' ? 'Stock Detail' : 'Archetype Scanner'}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Eyebrow badge */}
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5,
            px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D` }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN,
              animation: 'hpulse 2s ease-in-out infinite',
              '@keyframes hpulse': { '0%,100%': { boxShadow: `0 0 4px ${CYAN}` }, '50%': { boxShadow: `0 0 14px ${CYAN}` } } }} />
            <Typography sx={{ ...SANS, fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Behavioral Analytics · Archetype Intelligence
            </Typography>
          </Box>

          {/* Main headline */}
          <Typography sx={{
            ...SANS, fontWeight: 800, color: INK,
            fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' },
            lineHeight: 1.1, letterSpacing: '-0.03em', mb: 1.5,
          }}>
            Stock{' '}
            <Box component="span" sx={{ color: CYAN, textShadow: `0 0 32px ${CYAN}70` }}>Health</Box>
          </Typography>

          <Typography sx={{ ...SANS, fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, mb: 3, maxWidth: 520 }}>
            20-metric behavioural profile across returns, resilience, and trend quality —
            every stock classified into one of 7 archetypes.
          </Typography>

          {/* Symbol selector — inline in hero body */}
          {view === 'detail' && (
            <Box sx={{ mb: 3 }}>
              <Select
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                size="small"
                sx={{ ...INPUT_SX, height: 36, minWidth: 200, borderRadius: 0 }}
                MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: 0, '& .MuiMenuItem-root': { ...MONO, fontSize: '0.875rem', color: INK2, '&:hover': { bgcolor: BORDER }, '&.Mui-selected': { bgcolor: BORDER, color: CYAN } } } } }}
              >
                {symbols.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </Box>
          )}

          {/* Archetype row */}
          {view === 'detail' && report && archMeta && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 3 }}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.4, border: `1px solid ${archMeta.color}40`, bgcolor: `${archMeta.color}0f` }}>
                <Typography sx={{ fontSize: '0.8rem', color: archMeta.color }}>{archMeta.icon}</Typography>
                <Typography sx={{ ...SANS, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em', color: archMeta.color }}>
                  {report.archetype}
                </Typography>
              </Box>
              <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK3 }}>{archMeta.short}</Typography>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ ...MONO, fontSize: '0.72rem', color: INK3 }}>
                {report.data_start} → {report.data_end} · {report.years}y
              </Typography>
            </Box>
          )}

          {/* Score rings */}
          {view === 'detail' && report && (
            <Box sx={{ display: 'flex', gap: { xs: 3, md: 5 }, flexWrap: 'wrap' }}>
              <ScoreRing score={report.composite_scores.conviction}          label="Conviction"          color="#3b82f6" />
              <ScoreRing score={report.composite_scores.swan}                label="SWAN"                color="#22c55e" />
              <ScoreRing score={report.composite_scores.compounding_quality} label="Compounding Quality" color="#a855f7" />
            </Box>
          )}
        </Box>
      </Box>

      {/* ── Scanner view ── */}
      {view === 'scanner' && (
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2, md: 4, lg: 6 }, py: 3 }}>
          <Card>
            <SectionHead title="Archetype Scanner — All Stocks by Classification" accent={CYAN} />
            <ArchetypeScanner onSelect={sym => { setSymbol(sym); setView('detail') }} />
          </Card>
        </Box>
      )}

      {/* ── Detail view ── */}
      {view === 'detail' && (
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2, md: 4, lg: 6 }, py: 3 }}>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={36} sx={{ color: CYAN }} />
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 0 }}>{error}</Alert>}

        {report && (() => {
          const { formulas, insights } = f(report)
          return (
          <Grid container spacing={2.5}>

            {/* ── DNA Radar ── */}
            <Grid item xs={12}>
              <Card>
                <SectionHead title="DNA Radar — Six-Axis Fingerprint" accent={CYAN} />
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2 }}>
                  All six dimensions normalised to 0–100. A larger shaded area means a stronger overall quality profile.
                </Typography>
                <Grid container spacing={0} alignItems="center">
                  <Grid item xs={12} md={5}>
                    <DnaRadar report={report} />
                  </Grid>
                  <Grid item xs={12} md={7}>
                    <Box sx={{ pl: { md: 3 } }}>
                      {[
                        { label: 'Conviction',     val: report.composite_scores.conviction,                                                            color: '#3b82f6', what: 'How trustworthy and consistent is the return pattern? Built from consistency, smoothness, trend efficiency, and pain-to-gain.' },
                        { label: 'SWAN',           val: report.composite_scores.swan,                                                                  color: '#22c55e', what: 'Sleep-Well-At-Night: low vol, quick recovery, low time-underwater. How comfortable is this stock to hold?' },
                        { label: 'Compounding',    val: report.composite_scores.compounding_quality,                                                   color: '#a855f7', what: 'True compounding quality: CAGR × smoothness × recovery speed × drawdown frequency.' },
                        { label: 'Capital Eff.',   val: Math.max(0, Math.min(100, (report.core_returns.capital_efficiency / 1.5) * 100)),              color: '#f59e0b', what: `CAGR ÷ |Max Drawdown| = ${report.core_returns.capital_efficiency.toFixed(2)} (normalised 0–1.5× range). Return per unit of pain.` },
                        { label: 'Anti-Fragility', val: Math.max(0, Math.min(100, ((report.behavioral.anti_fragility + 0.5) / 1.0) * 100)),            color: '#06b6d4', what: `Raw score ${report.behavioral.anti_fragility.toFixed(3)} (normalised −0.5…+0.5 → 0–100). Positive = thrives in volatile markets.` },
                        { label: 'Consistency',    val: report.core_returns.consistency_score * 100,                                                   color: '#84cc16', what: `${(report.core_returns.consistency_score*100).toFixed(1)}% of monthly periods had a positive return.` },
                      ].map(({ label, val, color, what }) => (
                        <Box key={label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.5 }}>
                          <Box sx={{ width: 32, flexShrink: 0, pt: 0.25 }}>
                            <Typography sx={{ ...MONO, fontSize: '0.82rem', fontWeight: 800, color }}>{val.toFixed(0)}</Typography>
                          </Box>
                          <Box sx={{ flex: 1 }}>
                            <Typography sx={{ ...SANS, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color, mb: 0.3 }}>{label}</Typography>
                            <Box sx={{ height: 3, bgcolor: BORDER, borderRadius: 2, mb: 0.4 }}>
                              <Box sx={{ height: '100%', width: `${val}%`, bgcolor: color, borderRadius: 2, opacity: 0.75 }} />
                            </Box>
                            <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3, lineHeight: 1.4 }}>{what}</Typography>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Grid>
                </Grid>
              </Card>
            </Grid>

            {/* ── Score Breakdown ── */}
            <Grid item xs={12}>
              <Card>
                <SectionHead title="How the Composite Scores Are Calculated" accent="#a855f7" />
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2 }}>
                  Each composite is a weighted sum of normalised sub-metrics. The "+X.X pts" column shows how much each input contributed to the final score out of 100.
                </Typography>
                <ScoreBreakdown report={report} />
              </Card>
            </Grid>

            {/* ── Core Returns ── */}
            <Grid item xs={12} md={6}>
              <Card>
                <SectionHead title="Core Returns" accent="#3b82f6" />
                <MetricRow
                  label="CAGR — Compound Annual Growth Rate"
                  value={`${report.core_returns.cagr.toFixed(1)}%`}
                  color={report.core_returns.cagr >= 12 ? '#22c55e' : report.core_returns.cagr >= 6 ? '#f59e0b' : '#ef4444'}
                  what="How fast the stock grew per year, on average, assuming all gains were reinvested."
                  formula={formulas.cagr}
                  bands={{ lo: '< 6% = Weak', mid: '6–12% = Decent', hi: '> 12% = Strong' }}
                  insight={insights.cagr}
                />
                <MetricRow
                  label="Monthly Consistency"
                  value={`${(report.core_returns.consistency_score * 100).toFixed(1)}%`}
                  sub="positive months"
                  color={report.core_returns.consistency_score >= 0.6 ? '#22c55e' : report.core_returns.consistency_score >= 0.5 ? '#f59e0b' : '#ef4444'}
                  what="What fraction of calendar months ended higher than they started. A coin-flip baseline is 50%."
                  formula={formulas.consistency}
                  bands={{ lo: '< 50% = Below coin-flip', mid: '50–60% = Average', hi: '> 60% = Strong' }}
                  insight={insights.consistency}
                />
                <MetricRow
                  label="Return Concentration"
                  value={`${(report.core_returns.return_concentration * 100).toFixed(1)}%`}
                  sub="from top 5 days"
                  color={report.core_returns.return_concentration > 0.5 ? '#ef4444' : report.core_returns.return_concentration > 0.3 ? '#f59e0b' : '#22c55e'}
                  what="If you missed the 5 best trading days, what fraction of total gains would you lose? High = fragile, luck-dependent return."
                  formula={formulas.concentration}
                  bands={{ lo: '> 50% = Fragile / luck-driven', mid: '30–50% = Moderate', hi: '< 30% = Robust / skill-driven' }}
                  insight={insights.concentration}
                />
                <MetricRow
                  label="Capital Efficiency (Calmar)"
                  value={report.core_returns.capital_efficiency.toFixed(2)}
                  sub="CAGR ÷ |Max DD|"
                  color={report.core_returns.capital_efficiency >= 0.5 ? '#22c55e' : report.core_returns.capital_efficiency >= 0.2 ? '#f59e0b' : '#ef4444'}
                  what="Return earned per unit of worst-case drawdown endured. Higher = more return for the pain taken."
                  formula={formulas.capEff}
                  bands={{ lo: '< 0.2 = Poor', mid: '0.2–0.5 = Acceptable', hi: '> 0.5 = Excellent' }}
                  insight={insights.capEff}
                />
              </Card>
            </Grid>

            {/* ── Resilience ── */}
            <Grid item xs={12} md={6}>
              <Card>
                <SectionHead title="Resilience" accent="#ef4444" />
                <MetricRow
                  label="Max Drawdown"
                  value={`${report.resilience.max_drawdown.toFixed(1)}%`}
                  color="#ef4444"
                  what="The largest single fall from an all-time high to the lowest point that followed, before any recovery."
                  formula={formulas.maxDD}
                  bands={{ lo: '< −40% = Severe', mid: '−20% to −40% = Moderate', hi: '> −20% = Resilient' }}
                  insight={insights.maxDD}
                />
                <MetricRow
                  label="Drawdown Events (≥10%)"
                  value={String(report.resilience.drawdown_frequency)}
                  sub={`≈ 1 per ${(report.years / Math.max(1, report.resilience.drawdown_frequency)).toFixed(1)}y`}
                  color={report.resilience.drawdown_frequency <= 3 ? '#22c55e' : report.resilience.drawdown_frequency <= 6 ? '#f59e0b' : '#ef4444'}
                  what="How many times did the stock fall 10% or more from a peak? Each event represents a significant test of holder nerve."
                  formula={formulas.ddFreq}
                  bands={{ lo: '> 6 = Frequent crashes', mid: '3–6 = Moderate', hi: '≤ 3 = Rare crashes' }}
                  insight={insights.ddFreq}
                />
                <MetricRow
                  label="Avg Recovery Time"
                  value={report.resilience.avg_recovery_days != null ? `${Math.round(report.resilience.avg_recovery_days)}d` : '—'}
                  sub={report.resilience.avg_recovery_days != null ? `≈ ${(report.resilience.avg_recovery_days / 21).toFixed(1)} months` : 'no resolved drawdowns'}
                  color={report.resilience.avg_recovery_days != null ? (report.resilience.avg_recovery_days <= 60 ? '#22c55e' : report.resilience.avg_recovery_days <= 120 ? '#f59e0b' : '#ef4444') : INK3}
                  what="After a ≥10% drawdown, how long did it typically take to recover back to the prior all-time high?"
                  formula={formulas.recovery}
                  bands={{ lo: '> 120d = Slow recovery', mid: '60–120d = Moderate', hi: '< 60d = Fast bounce' }}
                  insight={insights.recovery}
                />
                <MetricRow
                  label="Time Under Water"
                  value={`${(report.resilience.time_under_water * 100).toFixed(1)}%`}
                  sub="of history"
                  color={report.resilience.time_under_water < 0.35 ? '#22c55e' : report.resilience.time_under_water < 0.55 ? '#f59e0b' : '#ef4444'}
                  what="The fraction of all trading days where the stock was below a previous all-time high. High = lots of waiting for breakeven."
                  formula={formulas.timeUW}
                  bands={{ lo: '> 55% = Capital trap territory', mid: '35–55% = Moderate', hi: '< 35% = Rarely underwater' }}
                  insight={insights.timeUW}
                />
              </Card>
            </Grid>

            {/* ── Trend Quality ── */}
            <Grid item xs={12} md={6}>
              <Card>
                <SectionHead title="Trend Quality" accent="#8b5cf6" />
                <MetricRow
                  label="Trend Efficiency Ratio"
                  value={`${(report.trend_quality.trend_efficiency * 100).toFixed(1)}%`}
                  sub="net ÷ gross move"
                  color={report.trend_quality.trend_efficiency >= 0.04 ? '#22c55e' : '#f59e0b'}
                  what="If the stock moved 100 units in total (up and down), what fraction was net directional progress? Low = lots of back-and-forth noise."
                  formula={formulas.trendEff}
                  bands={{ lo: '< 2% = Mostly noise', mid: '2–5% = Some trend', hi: '> 5% = Strong directional trend' }}
                  insight={insights.trendEff}
                />
                <MetricRow
                  label="Wealth Smoothness R²"
                  value={report.trend_quality.wealth_smoothness_r2.toFixed(3)}
                  sub="log-linear fit"
                  color={report.trend_quality.wealth_smoothness_r2 >= 0.85 ? '#22c55e' : report.trend_quality.wealth_smoothness_r2 >= 0.65 ? '#f59e0b' : '#ef4444'}
                  what="How closely does the equity curve follow a smooth exponential growth path? 1.0 = perfectly smooth compounder, 0.0 = random walk."
                  formula={formulas.r2}
                  bands={{ lo: '< 0.65 = Choppy / unreliable', mid: '0.65–0.85 = Moderate', hi: '> 0.85 = Smooth compounder' }}
                  insight={insights.r2}
                />
                <MetricRow
                  label="Skill Ratio"
                  value={report.trend_quality.skill_ratio.toFixed(2)}
                  sub="CAGR ex-top10 ÷ CAGR"
                  color={report.trend_quality.skill_ratio >= 0.7 ? '#22c55e' : report.trend_quality.skill_ratio >= 0.4 ? '#f59e0b' : '#ef4444'}
                  what="If you removed the 10 best days, what fraction of the original CAGR would survive? High = consistent skill, Low = returns depend on a few lucky days."
                  formula={formulas.skillRatio}
                  bands={{ lo: '< 0.4 = Lucky Speculator territory', mid: '0.4–0.7 = Moderate skill', hi: '> 0.7 = Skill-driven returns' }}
                  insight={insights.skillRatio}
                />
                <Box sx={{ mt: 1.75 }}>
                  <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: INK3, mb: 0.5 }}>
                    CAGR sensitivity — what if you missed the best N days?
                  </Typography>
                  <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 1, lineHeight: 1.4 }}>
                    This tests whether the CAGR is robust or concentrated. Removing {report.years}y of data's top trading days from <Typography component="span" sx={{ ...MONO, fontSize: '0.68rem', color: INK }}>{report.core_returns.cagr.toFixed(1)}%</Typography> shows:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {[
                      { label: 'Miss 1 day', val: report.trend_quality.cagr_ex_top1 },
                      { label: 'Miss 5 days', val: report.trend_quality.cagr_ex_top5 },
                      { label: 'Miss 10 days', val: report.trend_quality.cagr_ex_top10 },
                    ].map(({ label, val }) => (
                      <Box key={label} sx={{ flex: 1, p: 1, bgcolor: PAPER2, border: `1px solid ${BORDER}`, textAlign: 'center' }}>
                        <Typography sx={{ ...MONO, fontSize: '0.85rem', fontWeight: 800, color: val >= 8 ? '#22c55e' : val >= 3 ? '#f59e0b' : '#ef4444', lineHeight: 1 }}>
                          {val.toFixed(1)}%
                        </Typography>
                        <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, mt: 0.25 }}>{label}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Card>
            </Grid>

            {/* ── Behavioral ── */}
            <Grid item xs={12} md={6}>
              <Card>
                <SectionHead title="Behavioral Profile" accent="#f59e0b" />
                <MetricRow
                  label="Pain-to-Gain Ratio"
                  value={report.behavioral.pain_to_gain > 99 ? '>99' : report.behavioral.pain_to_gain.toFixed(2)}
                  sub="lower is better"
                  color={report.behavioral.pain_to_gain <= 1.5 ? '#22c55e' : report.behavioral.pain_to_gain <= 3 ? '#f59e0b' : '#ef4444'}
                  what="How much cumulative underwater pain (sum of all daily drawdown depths) did the stock inflict per 1% of total gain? Lower = smoother journey."
                  formula={formulas.p2g}
                  bands={{ lo: '> 3 = Very painful', mid: '1.5–3 = Moderate', hi: '< 1.5 = Low-pain compounder' }}
                  insight={insights.p2g}
                />
                <MetricRow
                  label="Anti-Fragility"
                  value={report.behavioral.anti_fragility.toFixed(3)}
                  sub="vol → return correlation"
                  color={report.behavioral.anti_fragility > 0.1 ? '#22c55e' : report.behavioral.anti_fragility > -0.1 ? INK2 : '#ef4444'}
                  what="Does this stock benefit from volatility? Positive = spikes in 3-month vol are followed by higher 3-month returns. Negative = fragile during stress."
                  formula={formulas.antiFrag}
                  bands={{ lo: '< −0.1 = Fragile (hurts in volatility)', mid: '−0.1 to +0.1 = Neutral', hi: '> +0.1 = Anti-fragile (benefits from stress)' }}
                  insight={insights.antiFrag}
                />
                <MetricRow
                  label="Opportunity Cost"
                  value={`${(report.behavioral.opportunity_cost * 100).toFixed(1)}%`}
                  sub="time within ±5% of 52w start"
                  color={report.behavioral.opportunity_cost < 0.2 ? '#22c55e' : report.behavioral.opportunity_cost < 0.4 ? '#f59e0b' : '#ef4444'}
                  what="What fraction of days was the stock effectively flat vs. a year ago (within ±5%)? High = capital was sitting idle, you could have been in something else."
                  formula={formulas.oppCost}
                  bands={{ lo: '> 40% = High opportunity cost', mid: '20–40% = Moderate', hi: '< 20% = Always moving, no dead zones' }}
                  insight={insights.oppCost}
                />
                <Box sx={{ mt: 1.75 }}>
                  <Typography sx={{ ...SANS, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: INK3, mb: 0.25 }}>
                    Momentum Persistence
                  </Typography>
                  <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 1.25, lineHeight: 1.4 }}>
                    After N consecutive green days, what is the probability the next day is also green? A random stock sits at 50%.
                  </Typography>
                  <MomentumBar streak={3} value={report.behavioral.momentum_persistence_3d} />
                  <MomentumBar streak={5} value={report.behavioral.momentum_persistence_5d} />
                  <MomentumBar streak={7} value={report.behavioral.momentum_persistence_7d} />
                </Box>
              </Card>
            </Grid>

            {/* ── Drawdown chart ── */}
            <Grid item xs={12}>
              <Card>
                <SectionHead title="Drawdown History — Full Period" accent="#ef4444" />
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2, lineHeight: 1.5 }}>
                  Daily underwater depth: 0% = stock is at an all-time high, −44% = the worst single point. The chart shows the complete {report.years}y history from {report.data_start}.
                </Typography>
                <HighchartsReact highcharts={Highcharts} options={ddOptions} />
              </Card>
            </Grid>

            {/* ── Crash Resistance ── */}
            <Grid item xs={12} md={6}>
              <Card>
                <SectionHead title="Crash Resistance" accent="#f97316" />
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 1.5, lineHeight: 1.5 }}>
                  Total return of this stock during each major Indian market correction. Shows whether it held up, crashed harder, or was uncorrelated.
                </Typography>
                <CrashBar label="COVID Crash" period="17 Feb 2020 → 23 Mar 2020 (Nifty fell ~38%)" value={report.crash_resistance.covid_2020} />
                <CrashBar label="Rate Correction" period="Jan 2022 → Jun 2022 (global rate-hike selloff)" value={report.crash_resistance.correction_2022} />
                <CrashBar label="FII Selloff" period="Sep 2024 → Nov 2024 (FII withdrawal, rupee pressure)" value={report.crash_resistance.selloff_2024} />
              </Card>
            </Grid>

            {/* ── Regime Performance ── */}
            <Grid item xs={12} md={6}>
              <Card>
                <SectionHead title="Regime Performance" accent="#22c55e" />
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 1.5, lineHeight: 1.5 }}>
                  Cumulative return of this stock on days when the broader market was in each regime. Regime is defined by the market breadth score (% of Nifty 50 stocks above SMAs).
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <RegimeBlock label="Bull"     def="Breadth ≥ 60" ret={report.regime_performance.bull}     days={report.regime_performance.bull_days}     color="#22c55e" />
                  <RegimeBlock label="Bear"     def="Breadth ≤ 40" ret={report.regime_performance.bear}     days={report.regime_performance.bear_days}     color="#ef4444" />
                  <RegimeBlock label="Sideways" def="40 < Breadth < 60" ret={report.regime_performance.sideways} days={report.regime_performance.sideways_days} color="#f59e0b" />
                </Box>
              </Card>
            </Grid>

            {/* ── Alpha Half-Life ── */}
            <Grid item xs={12}>
              <Card>
                <SectionHead title="Alpha Half-Life" accent="#14b8a6" />
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2, lineHeight: 1.5 }}>
                  After a top-quartile month (a month stronger than 75% of all months in history), what is the average return over the following N months?
                  This tells you whether momentum persists at the monthly scale — and if so, for how long. A decaying positive number means alpha fades. A negative number means mean reversion kicks in.
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <AlphaCell lag="1 month later"  lagLabel="+1 month"  value={report.alpha_half_life.m1}  />
                  <AlphaCell lag="3 months later" lagLabel="+3 months" value={report.alpha_half_life.m3}  />
                  <AlphaCell lag="6 months later" lagLabel="+6 months" value={report.alpha_half_life.m6}  />
                  <AlphaCell lag="12 months later" lagLabel="+12 months" value={report.alpha_half_life.m12} />
                </Box>
              </Card>
            </Grid>

            {/* ── Archetype Legend ── */}
            <Grid item xs={12}>
              <Card>
                <SectionHead title="Archetype Legend — What Each Classification Means" accent="#f59e0b" />
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2, lineHeight: 1.5 }}>
                  Every stock in MarketDNA is classified into one of seven behavioral archetypes based on its composite score thresholds. The highlighted card is this stock's current classification.
                </Typography>
                <ArchetypeLegend current={report.archetype} />
              </Card>
            </Grid>

            {/* ── computed-at meta ── */}
            <Grid item xs={12}>
              <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3, textAlign: 'right', pb: 2 }}>
                Computed {report.computed_at} · {report.years}y of data · {report.data_start} → {report.data_end}
              </Typography>
            </Grid>

          </Grid>
          )
        })()}
      </Box>
      )}
      <Footer />
    </Box>
  )
}
